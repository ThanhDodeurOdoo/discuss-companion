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
    env,
    io::stderr,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, AtomicU16, Ordering},
    },
    thread,
    thread::sleep,
    time::Duration,
};

use tauri::{
    Emitter, Manager, async_runtime,
    image::Image,
    ipc::{Channel, InvokeBody},
};
use tauri_plugin_store::StoreExt;
use tokio::sync::broadcast;
use tracing::{debug, error, info};

pub mod call_controls_menu;
pub mod call_controls_window;
pub mod commands;
#[cfg(target_os = "macos")]
pub mod dock_menu;
pub mod flatbuffers;
pub mod menu;
pub mod platform;
mod profiling;
pub mod server;
pub mod state;

pub const DEFAULT_PORT: u16 = 49152;
const ICON_ACTIVE_ONLINE: &[u8] = include_bytes!("../../../assets/icons/active_online_icon.png");
const ICON_INACTIVE_ONLINE: &[u8] =
    include_bytes!("../../../assets/icons/inactive_online_icon.png");
const ICON_INACTIVE_OFFLINE: &[u8] =
    include_bytes!("../../../assets/icons/inactive_offline_icon.png");

pub struct WsState {
    pub port: AtomicU16,
    pub ws_tx: broadcast::Sender<Vec<u8>>,
    pub server_shutdown_tx: Mutex<broadcast::Sender<()>>,
    pub conn_tx: crossbeam_channel::Sender<bool>,
    pub event_channels: RwLock<Vec<Channel>>,
    pub call_state: RwLock<Option<state::CallState>>,
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

fn handle_ws_server(
    app_handle: tauri::AppHandle,
    port: u16,
    ws_tx: broadcast::Sender<Vec<u8>>,
    ws_shutdown_rx: broadcast::Receiver<()>,
    conn_tx: crossbeam_channel::Sender<bool>,
) {
    async_runtime::spawn(async move {
        server::start_ws_server(port, ws_tx, ws_shutdown_rx, app_handle, conn_tx).await;
    });
}

struct PttHandler {
    app_handle: tauri::AppHandle,
    ws_tx: broadcast::Sender<Vec<u8>>,
    active_online_img: Option<Image<'static>>,
    inactive_online_img: Option<Image<'static>>,
    inactive_offline_img: Option<Image<'static>>,
    is_active: bool,
    is_connected: bool,
    last_tray_state: Option<TrayIconState>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrayIconState {
    InactiveOffline,
    InactiveOnline,
    ActiveOnline,
}

impl PttHandler {
    fn new(app_handle: tauri::AppHandle, ws_tx: broadcast::Sender<Vec<u8>>) -> Self {
        Self {
            app_handle,
            ws_tx,
            active_online_img: Image::from_bytes(ICON_ACTIVE_ONLINE).ok(),
            inactive_online_img: Image::from_bytes(ICON_INACTIVE_ONLINE).ok(),
            inactive_offline_img: Image::from_bytes(ICON_INACTIVE_OFFLINE).ok(),
            is_active: false,
            is_connected: false,
            last_tray_state: None,
        }
    }

    fn handle_ptt_ipc(&self, event: &state::OutgoingMessage) {
        let (is_active, key, is_repeat) = match event {
            state::OutgoingMessage::PttDown { key, is_repeat, .. } => (true, key, *is_repeat),
            state::OutgoingMessage::PttUp { key, .. } => (false, key, false),
            _ => return, // Only PttDown/PttUp are relevant for active state
        };
        if let Some(state) = self.app_handle.try_state::<WsState>() {
            let payload = state::encode_ptt_state(is_active, key.code, key.modifiers, is_repeat);
            state.broadcast(&payload);
        }
    }
    fn handle_ptt_ws(&mut self, msg: &state::OutgoingMessage) {
        debug!("PttHandler handling event: {:?}", msg);
        let _ = self.app_handle.emit("ptt-event", msg);

        let mut should_update_tray = false;
        match msg {
            state::OutgoingMessage::PttDown { is_repeat, .. } => {
                if !is_repeat && !self.is_active {
                    self.is_active = true;
                    should_update_tray = true;
                }
            }
            state::OutgoingMessage::PttUp { .. } => {
                if self.is_active {
                    self.is_active = false;
                    should_update_tray = true;
                }
            }
            _ => {}
        }

        if should_update_tray {
            self.update_tray();
        }
        let bin = msg.to_flatbuffer();
        let _ = self.ws_tx.send(bin);
    }

    fn handle_connection_change(&mut self, is_connected: bool) {
        debug!("Connection state changed: connected={}", is_connected);
        if self.is_connected != is_connected {
            self.is_connected = is_connected;
            self.update_tray();
        }
    }

    fn update_tray(&mut self) {
        let Some(tray) = self.app_handle.tray_by_id(menu::TRAY_ID) else {
            return;
        };

        let state = if !self.is_connected {
            TrayIconState::InactiveOffline
        } else if self.is_active {
            TrayIconState::ActiveOnline
        } else {
            TrayIconState::InactiveOnline
        };

        if self.last_tray_state == Some(state) {
            return;
        }

        if let Some(img) = self.tray_image(state) {
            let _ = tray.set_icon(Some(img));
            self.last_tray_state = Some(state);
        }
    }

    fn tray_image(&self, state: TrayIconState) -> Option<Image<'_>> {
        let img = match state {
            TrayIconState::InactiveOffline => self.inactive_offline_img.as_ref(),
            TrayIconState::InactiveOnline => self.inactive_online_img.as_ref(),
            TrayIconState::ActiveOnline => self.active_online_img.as_ref(),
        }?;

        Some(Image::new(img.rgba(), img.width(), img.height()))
    }
}

fn handle_ptt_events(
    app_handle: tauri::AppHandle,
    event_rx: crossbeam_channel::Receiver<state::OutgoingMessage>,
    ws_tx: broadcast::Sender<Vec<u8>>,
    conn_rx: crossbeam_channel::Receiver<bool>,
) {
    thread::spawn(move || {
        let mut handler = PttHandler::new(app_handle, ws_tx);
        loop {
            crossbeam_channel::select! {
                recv(event_rx) -> msg => {
                    if let Ok(msg) = msg {
                        handler.handle_ptt_ipc(&msg);
                        handler.handle_ptt_ws(&msg); // Keep old logic for now
                    } else {
                        break;
                    }
                },
                recv(conn_rx) -> connected => {
                    if let Ok(connected) = connected {
                        handler.handle_connection_change(connected);
                    }
                }
            }
        }
    });
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
    let shutdown_clone = Arc::clone(&shutdown);
    let (ws_tx, _) = broadcast::channel::<Vec<u8>>(100);
    let (ws_shutdown_tx, ws_shutdown_rx) = broadcast::channel::<()>(1);
    let ws_tx_clone = ws_tx.clone();
    let ws_shutdown_tx_clone = ws_shutdown_tx.clone();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            let mut port = DEFAULT_PORT;
            if let Ok(store) = app.app_handle().store("settings.json") {
                if let Some(value) = store.get("ptt_binding")
                    && let Ok(binding) = serde_json::from_value(value)
                {
                    platform::set_binding(binding);
                }
                if let Some(value) = store.get("ws_port")
                    && let Some(p) = value.as_u64()
                    && let Ok(p_u16) = u16::try_from(p)
                {
                    port = p_u16;
                }
            }

            let (conn_tx, conn_rx) = crossbeam_channel::unbounded::<bool>();

            app.manage(WsState {
                port: AtomicU16::new(port),
                ws_tx: ws_tx_clone.clone(),
                server_shutdown_tx: Mutex::new(ws_shutdown_tx_clone),
                conn_tx: conn_tx.clone(),
                event_channels: RwLock::new(Vec::new()),
                call_state: RwLock::new(None),
            });

            handle_ws_server(
                app.handle().clone(),
                port,
                ws_tx_clone,
                ws_shutdown_rx,
                conn_tx,
            );

            let (event_tx, event_rx) = crossbeam_channel::unbounded();
            handle_ptt_events(app.handle().clone(), event_rx, ws_tx.clone(), conn_rx);

            let handle_tap = app.handle().clone();
            thread::spawn(move || {
                if let Err(e) = platform::start_engine(event_tx, &shutdown_clone) {
                    error!("Platform engine error: {}", e);
                    if let Some(state) = handle_tap.try_state::<WsState>() {
                        let payload =
                            state::encode_backend_error(&format!("Global shortcut error: {e:?}"));
                        state.broadcast(&payload);
                    }
                }
            });

            let tray_icon = Image::from_bytes(ICON_INACTIVE_OFFLINE)?;
            menu::setup_tray(app, tray_icon)?;

            #[cfg(target_os = "macos")]
            dock_menu::setup_dock_menu(app.handle())?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            if !call_controls_menu::handle_menu_action(app, event.id().as_ref()) {
                #[cfg(target_os = "macos")]
                {
                    if event.id() == dock_menu::DOCK_MENU_SHOW_CALL_CONTROLS_ID {
                        call_controls_window::show_at_cursor(app);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_version,
            commands::get_features,
            commands::update_binding,
            commands::set_recording_mode,
            commands::get_current_binding,
            commands::is_accessibility_granted,
            commands::is_extension_connected,
            commands::force_ptt_up,
            commands::show_main_window,
            commands::quit_app,
            commands::get_ws_port,
            commands::update_ws_port,
            commands::establish_channel,
            commands::send_call_command,
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
                #[cfg(target_os = "macos")]
                if window.label() == "main" {
                    let _ = window
                        .app_handle()
                        .set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
            tauri::WindowEvent::Focused(false) => {
                if window.label() == call_controls_window::CALL_CONTROLS_WINDOW_LABEL {
                    let _ = window.hide();
                }
            }
            _ => {}
        });

    if let Err(e) = builder.run(tauri::generate_context!()) {
        error!("error while running tauri application: {e}");
    }

    crate::profiling_drop!();

    // Safety: Ensure PTT is released when app quits
    platform::force_ptt_up();
    // Allow a brief moment for the message to traverse the channel and WS
    sleep(Duration::from_millis(100));

    // Cleanup: Send shutdown to WS server if still running
    let _ = ws_shutdown_tx.send(());
    shutdown.store(true, Ordering::SeqCst);
}
