mod commands;
mod messaging;
mod platform;

mod flatbuffers;
#[allow(dead_code, unused_imports, clippy::all)]
mod server;
mod state;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tracing::{error, info};

const TRAY_ID: &str = "main-tray";
const ICON_IDLE: &[u8] = include_bytes!("../icons/tray-idle.png");
const ICON_ACTIVE: &[u8] = include_bytes!("../icons/tray-active.png");

fn setup_logging() {
    use tracing_subscriber::EnvFilter;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive(
                "discuss_agent_app=warn"
                    .parse()
                    .unwrap_or_else(|_| tracing::level_filters::LevelFilter::WARN.into()),
            ),
        )
        .with_writer(std::io::stderr)
        .with_target(false)
        .init();
}

fn handle_ws_server(
    app_handle: tauri::AppHandle,
    ws_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
    ws_shutdown_rx: tokio::sync::broadcast::Receiver<()>,
) {
    thread::spawn(move || {
        let rt_result = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build();

        match rt_result {
            Ok(rt) => {
                rt.block_on(async {
                    server::start_ws_server(49152, ws_tx, ws_shutdown_rx, app_handle).await;
                });
            }
            Err(e) => {
                error!("Failed to create tokio runtime: {e}");
            }
        }
    });
}

struct PttHandler {
    app_handle: tauri::AppHandle,
    ws_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
    idle_img: Option<Image<'static>>,
    active_img: Option<Image<'static>>,
    is_active: bool,
}

impl PttHandler {
    fn new(app_handle: tauri::AppHandle, ws_tx: tokio::sync::broadcast::Sender<Vec<u8>>) -> Self {
        Self {
            app_handle,
            ws_tx,
            idle_img: Image::from_bytes(ICON_IDLE).ok(),
            active_img: Image::from_bytes(ICON_ACTIVE).ok(),
            is_active: false,
        }
    }

    fn handle(&mut self, msg: &state::OutgoingMessage) {
        // Notify Frontend
        let _ = self.app_handle.emit("ptt-event", msg);

        // Update Tray Icon efficiently
        self.update_tray(msg);

        // Broadcast to WebSocket
        let bin = msg.to_flatbuffer();
        let _ = self.ws_tx.send(bin);
    }

    fn update_tray(&mut self, msg: &state::OutgoingMessage) {
        let Some(tray) = self.app_handle.tray_by_id(TRAY_ID) else {
            return;
        };

        match msg {
            state::OutgoingMessage::PttDown { is_repeat, .. } => {
                if !is_repeat && !self.is_active {
                    self.is_active = true;
                    if let Some(img) = self.active_img.as_ref() {
                        let _ = tray.set_icon(Some(img.clone()));
                    }
                }
            }
            state::OutgoingMessage::PttUp { .. } => {
                if self.is_active {
                    self.is_active = false;
                    if let Some(img) = self.idle_img.as_ref() {
                        let _ = tray.set_icon(Some(img.clone()));
                    }
                }
            }
            _ => {}
        }
    }
}

fn handle_ptt_events(
    app_handle: tauri::AppHandle,
    event_rx: crossbeam_channel::Receiver<state::OutgoingMessage>,
    ws_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
) {
    thread::spawn(move || {
        let mut handler = PttHandler::new(app_handle, ws_tx);
        while let Ok(msg) = event_rx.recv() {
            handler.handle(&msg);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_logging();
    info!("Discuss Companion starting");

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);
    let (ws_tx, _) = tokio::sync::broadcast::channel::<Vec<u8>>(100);
    let (ws_shutdown_tx, ws_shutdown_rx) = tokio::sync::broadcast::channel::<()>(1);
    let ws_tx_clone = ws_tx.clone();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            handle_ws_server(app.handle().clone(), ws_tx_clone, ws_shutdown_rx);

            if let Ok(store) = app.app_handle().store("settings.json") {
                if let Some(value) = store.get("ptt_binding") {
                    if let Ok(binding) = serde_json::from_value(value) {
                        platform::set_binding(binding);
                    }
                }
            }

            let (event_tx, event_rx) = crossbeam_channel::unbounded();
            handle_ptt_events(app.handle().clone(), event_rx, ws_tx.clone());

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

            let tray_icon = Image::from_bytes(ICON_IDLE)?;

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
        ]);

    if let Err(e) = builder.run(tauri::generate_context!()) {
        error!("error while running tauri application: {e}");
    }

    // Safety: Ensure PTT is released when app quits
    platform::force_ptt_up();
    // Allow a brief moment for the message to traverse the channel and WS
    std::thread::sleep(std::time::Duration::from_millis(100));

    let _ = ws_shutdown_tx.send(());
    shutdown.store(true, Ordering::SeqCst);
}
