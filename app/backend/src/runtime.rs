use std::{
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, AtomicU16},
    },
    thread,
};

use tauri::{Emitter, Manager, async_runtime, image::Image};
use tauri_plugin_store::StoreExt;
use tokio::sync::broadcast;
use tracing::{debug, error};

#[cfg(target_os = "macos")]
use crate::interface::dock_menu;
use crate::{
    DEFAULT_PORT, WsState, api,
    interface::{call_controls_menu, call_controls_window, tray},
    protocol, ptt_engine,
};

const ICON_ACTIVE_ONLINE: &[u8] = include_bytes!("../../../assets/icons/active_online_icon.png");
const ICON_INACTIVE_ONLINE: &[u8] =
    include_bytes!("../../../assets/icons/inactive_online_icon.png");
const ICON_INACTIVE_OFFLINE: &[u8] =
    include_bytes!("../../../assets/icons/inactive_offline_icon.png");

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            let mut port = DEFAULT_PORT;
            if let Ok(store) = app.app_handle().store("settings.json") {
                if let Some(value) = store.get("ptt_binding")
                    && let Ok(binding) = serde_json::from_value(value)
                {
                    ptt_engine::set_binding(binding);
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

            let tray_icon = Image::from_bytes(ICON_INACTIVE_OFFLINE)?;
            tray::setup_tray(app, tray_icon)?;

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
        })
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

    fn update_tray(&mut self) {
        let Some(tray_icon) = self.app_handle.tray_by_id(tray::TRAY_ID) else {
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
            let _ = tray_icon.set_icon(Some(img));
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
