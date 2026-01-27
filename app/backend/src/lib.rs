#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        reason = "tests are allowed to panic"
    )
)]
use std::io::stderr;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::sleep;
use std::time::Duration;

use tauri::async_runtime;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tokio::sync::broadcast;
use tracing::{debug, error, info, level_filters::LevelFilter};

mod commands;
mod flatbuffers;
mod platform;
mod server;
mod state;

pub const DEFAULT_PORT: u16 = 49152;
const TRAY_ID: &str = "main-tray";
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
}

fn setup_logging() {
    use tracing_subscriber::EnvFilter;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive(
                "discuss_agent_app=warn"
                    .parse()
                    .unwrap_or_else(|_| LevelFilter::WARN.into()),
            ),
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
        }
    }

    fn handle_ptt(&mut self, msg: &state::OutgoingMessage) {
        debug!("PttHandler handling event: {:?}", msg);
        let _ = self.app_handle.emit("ptt-event", msg);

        match msg {
            state::OutgoingMessage::PttDown { is_repeat, .. } => {
                if !is_repeat {
                    self.is_active = true;
                }
            }
            state::OutgoingMessage::PttUp { .. } => {
                self.is_active = false;
            }
            _ => {}
        }

        self.update_tray();
        let bin = msg.to_flatbuffer();
        let _ = self.ws_tx.send(bin);
    }

    fn handle_connection_change(&mut self, is_connected: bool) {
        debug!("Connection state changed: connected={}", is_connected);
        self.is_connected = is_connected;
        self.update_tray();
    }

    fn update_tray(&self) {
        let Some(tray) = self.app_handle.tray_by_id(TRAY_ID) else {
            return;
        };

        let img = if !self.is_connected {
            self.inactive_offline_img.as_ref()
        } else if self.is_active {
            self.active_online_img.as_ref()
        } else {
            self.inactive_online_img.as_ref()
        };

        if let Some(img) = img {
            let _ = tray.set_icon(Some(img.clone()));
        }
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
                        handler.handle_ptt(&msg);
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
pub fn run() {
    setup_logging();
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
                    let _ = handle_tap.emit("error", format!("Platform engine error: {e}"));
                }
            });

            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let tray_icon = Image::from_bytes(ICON_INACTIVE_OFFLINE)?;

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_icon)
                .menu(&menu)
                .on_menu_event(move |app_handle, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app_handle.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_version,
            commands::update_binding,
            commands::set_recording_mode,
            commands::get_current_binding,
            commands::is_accessibility_granted,
            commands::is_extension_connected,
            commands::force_ptt_up,
            commands::get_ws_port,
            commands::update_ws_port,
        ]);

    if let Err(e) = builder.run(tauri::generate_context!()) {
        error!("error while running tauri application: {e}");
    }

    // Safety: Ensure PTT is released when app quits
    platform::force_ptt_up();
    // Allow a brief moment for the message to traverse the channel and WS
    sleep(Duration::from_millis(100));

    // Cleanup: Send shutdown to WS server if still running
    let _ = ws_shutdown_tx.send(());
    shutdown.store(true, Ordering::SeqCst);
}
