#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        reason = "tests are allowed to panic"
    )
)]

use std::{
    io::stderr,
    sync::{
        Arc, Mutex, PoisonError, RwLock,
        atomic::{AtomicBool, AtomicU16, Ordering},
    },
    thread::sleep,
    time::Duration,
};

use tauri::ipc::{Channel, InvokeBody};
use tokio::sync::broadcast;
use tracing::{debug, error, info};

pub mod api;
pub mod flatbuffers;
pub mod interface;
mod profiling;
pub mod protocol;
pub mod ptt_engine;
pub mod runtime;
pub mod utils;

pub const DEFAULT_PORT: u16 = 49152;
pub mod store_keys {
    pub const STORE_FILENAME: &str = "settings.json";
    pub const APP_VISIBILITY_MODE: &str = "app_visibility_mode";
    pub const WS_PORT: &str = "ws_port";
    pub const PTT_BINDING: &str = "ptt_binding";
}

pub struct AppSettings {
    pub app_visibility_mode: RwLock<protocol::AppVisibilityMode>,
}

impl AppSettings {
    /// Recovers poisoned locks to keep settings access available after panics in worker threads.
    #[must_use]
    pub(crate) fn app_visibility_mode(&self) -> protocol::AppVisibilityMode {
        *self
            .app_visibility_mode
            .read()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn set_app_visibility_mode(&self, mode: protocol::AppVisibilityMode) {
        *self
            .app_visibility_mode
            .write()
            .unwrap_or_else(PoisonError::into_inner) = mode;
    }
}

pub struct WsState {
    pub port: AtomicU16,
    pub ws_tx: broadcast::Sender<Vec<u8>>,
    pub server_shutdown_tx: Mutex<broadcast::Sender<()>>,
    pub conn_tx: crossbeam_channel::Sender<bool>,
    pub event_channels: RwLock<Vec<Channel>>,
    pub call_state: RwLock<Option<protocol::CallState>>,
}

impl WsState {
    /// Recovers poisoned locks to keep runtime state mutable after panics in worker threads.
    #[must_use]
    pub(crate) fn call_state(&self) -> Option<protocol::CallState> {
        *self
            .call_state
            .read()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn set_call_state(&self, call_state: Option<protocol::CallState>) {
        *self
            .call_state
            .write()
            .unwrap_or_else(PoisonError::into_inner) = call_state;
    }

    pub(crate) fn push_event_channel(&self, channel: Channel) {
        self.event_channels
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .push(channel);
    }

    pub(crate) fn rotate_server_shutdown_channel(&self) -> broadcast::Receiver<()> {
        let mut shutdown_tx = self
            .server_shutdown_tx
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let _ = shutdown_tx.send(());
        let (next_tx, next_rx) = broadcast::channel(1);
        *shutdown_tx = next_tx;
        next_rx
    }

    /// Broadcasts a binary payload to all connected frontend channels.
    ///
    /// Note: Each channel receives a clone of the payload because Tauri's
    /// `InvokeBody::Raw` requires `Vec<u8>` ownership. Using `Arc<[u8]>` is
    /// not possible with the current Tauri IPC API. This is acceptable since:
    /// - Typically only 1-2 channels are connected
    /// - Payloads are small (`FlatBuffers` are compact)
    pub(crate) fn broadcast(&self, payload: &[u8]) {
        self.event_channels
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|channel| {
                channel
                    .send(InvokeBody::Raw(payload.to_vec()).into())
                    .is_ok()
            });
    }
}

fn setup_logging() {
    use tracing_subscriber::EnvFilter;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")),
        )
        .with_writer(stderr)
        .with_target(false)
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(
    clippy::too_many_lines,
    clippy::exit,
    reason = "Main run loop, hard to split; clippy::exit is triggered by tauri::generate_context!"
)]
pub fn run() {
    setup_logging();
    crate::profiling_init!();
    debug!("debug enabled");
    info!("Discuss Companion starting");

    let shutdown = Arc::new(AtomicBool::new(false));
    let (ws_tx, _) = broadcast::channel::<Vec<u8>>(100);
    let (ws_shutdown_tx, ws_shutdown_rx) = broadcast::channel::<()>(1);
    let builder = runtime::build_app(&shutdown, ws_tx, &ws_shutdown_tx, ws_shutdown_rx);

    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(e) => {
            error!("error while running tauri application: {e}");
            return;
        }
    };

    #[cfg(target_os = "macos")]
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Reopen { .. } = event {
            api::commands::show_main_window_with_handle(app_handle);
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});

    crate::profiling_drop!();

    // Safety: Ensure PTT is released when app quits
    ptt_engine::force_ptt_up();
    // Allow a brief moment for the message to traverse the channel and WS
    sleep(Duration::from_millis(100));

    // Cleanup: Send shutdown to WS server if still running
    let _ = ws_shutdown_tx.send(());
    shutdown.store(true, Ordering::Release);
}

#[cfg(test)]
mod tests {
    use std::{
        fmt::Debug,
        sync::{Arc, Mutex, RwLock, atomic::AtomicU16},
        thread,
    };

    use tokio::sync::broadcast;

    use super::*;

    fn make_ws_state(shutdown_tx: broadcast::Sender<()>) -> WsState {
        let (ws_tx, _) = broadcast::channel(1);
        let (conn_tx, _) = crossbeam_channel::unbounded();
        WsState {
            port: AtomicU16::new(0),
            ws_tx,
            server_shutdown_tx: Mutex::new(shutdown_tx),
            conn_tx,
            event_channels: RwLock::new(Vec::new()),
            call_state: RwLock::new(None),
        }
    }

    fn sample_call_state() -> protocol::CallState {
        protocol::CallState {
            has_call: true,
            has_state: true,
            is_mute: true,
            is_deaf: false,
            is_camera_on: true,
            is_screen_on: false,
        }
    }

    fn panic_with_guard<T: Debug>(guard: T) -> ! {
        panic!("poison lock while holding guard: {guard:?}");
    }

    #[test]
    fn app_settings_recovers_from_poisoned_lock() {
        let settings = Arc::new(AppSettings {
            app_visibility_mode: RwLock::new(protocol::AppVisibilityMode::default()),
        });

        let poisoned_settings = Arc::clone(&settings);
        let join_result = thread::spawn(move || {
            let mut guard = poisoned_settings
                .app_visibility_mode
                .write()
                .expect("lock app visibility mode");
            *guard = protocol::AppVisibilityMode::DockOnly;
            panic_with_guard(guard);
        })
        .join();
        assert!(join_result.is_err(), "expected thread panic to poison lock");

        assert_eq!(
            settings.app_visibility_mode(),
            protocol::AppVisibilityMode::DockOnly
        );

        settings.set_app_visibility_mode(protocol::AppVisibilityMode::TrayAndDockAlways);
        assert_eq!(
            settings.app_visibility_mode(),
            protocol::AppVisibilityMode::TrayAndDockAlways
        );
    }

    #[test]
    fn ws_state_call_state_recovers_from_poisoned_lock() {
        let (shutdown_tx, _) = broadcast::channel(1);
        let state = Arc::new(make_ws_state(shutdown_tx));
        let expected = sample_call_state();

        let poisoned_state = Arc::clone(&state);
        let join_result = thread::spawn(move || {
            let mut guard = poisoned_state.call_state.write().expect("lock call state");
            *guard = Some(expected);
            panic_with_guard(guard);
        })
        .join();
        assert!(join_result.is_err(), "expected thread panic to poison lock");

        assert_eq!(state.call_state(), Some(expected));

        state.set_call_state(None);
        assert_eq!(state.call_state(), None);
    }

    #[test]
    fn ws_state_rotate_shutdown_channel_notifies_previous_sender() {
        let (shutdown_tx, mut previous_shutdown_rx) = broadcast::channel::<()>(1);
        let state = make_ws_state(shutdown_tx);

        let _ = state.rotate_server_shutdown_channel();

        assert!(matches!(previous_shutdown_rx.try_recv(), Ok(())));
    }

    #[test]
    fn ws_state_rotate_shutdown_channel_recovers_from_poisoned_lock() {
        let (shutdown_tx, _) = broadcast::channel::<()>(1);
        let state = Arc::new(make_ws_state(shutdown_tx));

        let poisoned_state = Arc::clone(&state);
        let join_result = thread::spawn(move || {
            let _guard = poisoned_state
                .server_shutdown_tx
                .lock()
                .expect("lock shutdown sender");
            panic!("poison shutdown sender lock");
        })
        .join();
        assert!(join_result.is_err(), "expected thread panic to poison lock");

        let mut current_shutdown_rx = state.rotate_server_shutdown_channel();
        let _ = state.rotate_server_shutdown_channel();

        assert!(matches!(current_shutdown_rx.try_recv(), Ok(())));
    }
}
