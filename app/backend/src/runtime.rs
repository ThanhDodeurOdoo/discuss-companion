use std::{
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, AtomicU16},
    },
    thread,
};

use tauri::{Emitter, Manager, async_runtime};
use tauri_plugin_store::StoreExt;
use tokio::sync::broadcast;
use tracing::{debug, error};

#[cfg(target_os = "macos")]
use crate::interface::dock_menu;
use crate::{
    AppSettings, DEFAULT_PORT, WsState, api,
    interface::{call_controls_menu, call_controls_window, tray},
    protocol, ptt_engine, store_keys,
};

#[allow(
    clippy::too_many_lines,
    reason = "Builder setup aggregates wiring for runtime, commands, and window events."
)]
pub fn build_app(
    shutdown: &Arc<AtomicBool>,
    ws_tx: broadcast::Sender<Vec<u8>>,
    ws_shutdown_tx: &broadcast::Sender<()>,
    ws_shutdown_rx: broadcast::Receiver<()>,
) -> tauri::Builder<tauri::Wry> {
    let shutdown_clone = Arc::clone(shutdown);
    let ws_tx_clone = ws_tx.clone();
    let ws_shutdown_tx_clone = ws_shutdown_tx.clone();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            let mut port = DEFAULT_PORT;
            let mut app_visibility_mode = protocol::AppVisibilityMode::default();
            if let Ok(store) = app.app_handle().store(store_keys::STORE_FILENAME) {
                if let Some(value) = store.get(store_keys::PTT_BINDING)
                    && let Ok(binding) = serde_json::from_value(value)
                {
                    ptt_engine::set_binding(binding);
                }
                if let Some(value) = store.get(store_keys::APP_VISIBILITY_MODE)
                    && let Ok(mode) = serde_json::from_value(value)
                {
                    app_visibility_mode = mode;
                }
                if let Some(value) = store.get(store_keys::WS_PORT)
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
            app.manage(AppSettings {
                app_visibility_mode: RwLock::new(app_visibility_mode),
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
                if let Err(e) = ptt_engine::start_engine(event_tx, &shutdown_clone) {
                    error!("Platform engine error: {}", e);
                    if let Some(state) = handle_tap.try_state::<WsState>() {
                        let payload = protocol::encode_backend_error(&format!(
                            "Global shortcut error: {e:?}"
                        ));
                        state.broadcast(&payload);
                    }
                }
            });

            tray::setup_tray(app)?;
            apply_app_visibility_mode(app.handle(), app_visibility_mode);

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
            api::commands::get_version,
            api::commands::get_features,
            api::commands::get_app_visibility_mode,
            api::commands::set_app_visibility_mode,
            api::commands::update_binding,
            api::commands::set_recording_mode,
            api::commands::get_current_binding,
            api::commands::is_accessibility_granted,
            api::commands::is_extension_connected,
            api::commands::force_ptt_up,
            api::commands::show_main_window,
            api::commands::quit_app,
            api::commands::get_ws_port,
            api::commands::update_ws_port,
            api::commands::establish_channel,
            api::commands::send_call_command,
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
                #[cfg(target_os = "macos")]
                if window.label() == "main" {
                    let mode = window
                        .app_handle()
                        .try_state::<AppSettings>()
                        .map(|settings| settings.app_visibility_mode())
                        .unwrap_or_default();
                    if mode == protocol::AppVisibilityMode::TrayAndDockWhenWindowOpen {
                        let _ = window
                            .app_handle()
                            .set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                }
            }
            tauri::WindowEvent::Focused(false) => {
                if window.label() == call_controls_window::CALL_CONTROLS_WINDOW_LABEL {
                    let _ = window.hide();
                }
            }
            _ => {}
        });

    #[cfg(target_os = "windows")]
    let builder = builder.device_event_filter(tauri::DeviceEventFilter::Always);

    builder
}

pub(crate) fn handle_ws_server(
    app_handle: tauri::AppHandle,
    port: u16,
    ws_tx: broadcast::Sender<Vec<u8>>,
    ws_shutdown_rx: broadcast::Receiver<()>,
    conn_tx: crossbeam_channel::Sender<bool>,
) {
    async_runtime::spawn(async move {
        api::ws_server::start_ws_server(port, ws_tx, ws_shutdown_rx, app_handle, conn_tx).await;
    });
}

#[cfg(target_os = "macos")]
fn is_main_window_visible<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) -> bool {
    app_handle
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub(crate) fn apply_app_visibility_mode<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    mode: protocol::AppVisibilityMode,
) {
    if let Some(tray_icon) = app_handle.tray_by_id(tray::TRAY_ID) {
        let show_tray = mode != protocol::AppVisibilityMode::DockOnly;
        let _ = tray_icon.set_visible(show_tray);
    }

    #[cfg(target_os = "macos")]
    {
        let policy = match mode {
            protocol::AppVisibilityMode::TrayAndDockWhenWindowOpen => {
                if is_main_window_visible(app_handle) {
                    tauri::ActivationPolicy::Regular
                } else {
                    tauri::ActivationPolicy::Accessory
                }
            }
            protocol::AppVisibilityMode::TrayAndDockAlways
            | protocol::AppVisibilityMode::DockOnly => tauri::ActivationPolicy::Regular,
        };
        let _ = app_handle.set_activation_policy(policy);
    }
}

struct PttHandler {
    app_handle: tauri::AppHandle,
    ws_tx: broadcast::Sender<Vec<u8>>,
    is_active: bool,
    is_connected: bool,
}

impl PttHandler {
    fn new(app_handle: tauri::AppHandle, ws_tx: broadcast::Sender<Vec<u8>>) -> Self {
        Self {
            app_handle,
            ws_tx,
            is_active: false,
            is_connected: false,
        }
    }

    fn handle_ptt_ipc(&self, event: &protocol::OutgoingMessage) {
        let (is_active, key, is_repeat) = match event {
            protocol::OutgoingMessage::PttDown { key, is_repeat, .. } => (true, key, *is_repeat),
            protocol::OutgoingMessage::PttUp { key, .. } => (false, key, false),
            _ => return, // Only PttDown/PttUp are relevant for active state
        };
        if let Some(state) = self.app_handle.try_state::<WsState>() {
            let payload = protocol::encode_ptt_state(is_active, key.code, key.modifiers, is_repeat);
            state.broadcast(&payload);
        }
    }
    fn handle_ptt_ws(&mut self, msg: &protocol::OutgoingMessage) {
        debug!("PttHandler handling event: {:?}", msg);
        let _ = self.app_handle.emit("ptt-event", msg);

        let mut should_update_tray = false;
        match msg {
            protocol::OutgoingMessage::PttDown { is_repeat, .. } => {
                if !is_repeat && !self.is_active {
                    self.is_active = true;
                    should_update_tray = true;
                }
            }
            protocol::OutgoingMessage::PttUp { .. } => {
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

    fn update_tray(&self) {
        tray::set_connection_state(&self.app_handle, self.is_connected);
        tray::set_talking_state(&self.app_handle, self.is_active);
    }
}

fn handle_ptt_events(
    app_handle: tauri::AppHandle,
    event_rx: crossbeam_channel::Receiver<protocol::OutgoingMessage>,
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
