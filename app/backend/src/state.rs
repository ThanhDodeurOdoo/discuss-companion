use std::sync::{
    Mutex, PoisonError, RwLock,
    atomic::{AtomicU16, AtomicU64, AtomicUsize, Ordering},
};

use tauri::ipc::{Channel, InvokeBody};
use tokio::sync::broadcast;

use crate::protocol;

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

pub(crate) struct WsServerRuntimeState {
    connection_count: AtomicUsize,
    current_server_id: AtomicU64,
}

pub(crate) static WS_SERVER_RUNTIME_STATE: WsServerRuntimeState = WsServerRuntimeState::new();

impl WsServerRuntimeState {
    const fn new() -> Self {
        Self {
            connection_count: AtomicUsize::new(0),
            current_server_id: AtomicU64::new(0),
        }
    }

    #[must_use]
    pub(crate) fn is_connected(&self) -> bool {
        self.connection_count.load(Ordering::Acquire) > 0
    }

    pub(crate) fn reset(&self) {
        self.connection_count.store(0, Ordering::Release);
        self.current_server_id.store(0, Ordering::Release);
    }

    #[must_use]
    pub(crate) fn start_server(&self) -> u64 {
        self.connection_count.store(0, Ordering::Release);
        self.current_server_id.fetch_add(1, Ordering::AcqRel) + 1
    }

    #[must_use]
    pub(crate) fn is_current_server(&self, server_id: u64) -> bool {
        self.current_server_id.load(Ordering::Acquire) == server_id
    }

    #[must_use]
    pub(crate) fn register_connection(&self) -> bool {
        self.connection_count.fetch_add(1, Ordering::AcqRel) == 0
    }

    #[must_use]
    pub(crate) fn unregister_connection(&self) -> bool {
        self.connection_count.fetch_sub(1, Ordering::AcqRel) == 1
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fmt::Debug,
        sync::{Arc, Mutex, RwLock, atomic::AtomicU16},
        thread,
    };

    use tokio::sync::broadcast;

    use super::{AppSettings, WsState};
    use crate::protocol;

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
