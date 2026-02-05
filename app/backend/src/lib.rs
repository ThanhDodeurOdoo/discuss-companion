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
        Arc, Mutex, RwLock,
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

pub const DEFAULT_PORT: u16 = 49152;
pub const APP_VISIBILITY_MODE_KEY: &str = "app_visibility_mode";

pub struct AppSettings {
    pub app_visibility_mode: RwLock<protocol::AppVisibilityMode>,
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
    /// Broadcasts a binary payload to all connected frontend channels.
    ///
    /// Note: Each channel receives a clone of the payload because Tauri's
    /// `InvokeBody::Raw` requires `Vec<u8>` ownership. Using `Arc<[u8]>` is
    /// not possible with the current Tauri IPC API. This is acceptable since:
    /// - Typically only 1-2 channels are connected
    /// - Payloads are small (`FlatBuffers` are compact)
    pub(crate) fn broadcast(&self, payload: &[u8]) {
        if let Ok(mut guard) = self.event_channels.write() {
            guard.retain(|channel| {
                channel
                    .send(InvokeBody::Raw(payload.to_vec()).into())
                    .is_ok()
            });
        }
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
    shutdown.store(true, Ordering::SeqCst);
}
