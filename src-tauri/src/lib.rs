mod commands;
mod event_tap;
mod messaging;
mod server;
mod state;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tracing::{error, info};

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

/// Starts the Discuss PTT Agent application.
///
/// # Panics
///
/// This function will panic if the Tauri application fail to initialize or run,
/// which can happen if the environment is not properly set up (e.g., missing system symbols).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_logging();
    info!("Discuss Companion starting");

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);

    // Create WS broadcast channel
    let (ws_tx, _) = tokio::sync::broadcast::channel::<String>(100);

    // Start WS server in a tokio runtime (placeholder, moved to setup)
    let (ws_shutdown_tx, ws_shutdown_rx) = tokio::sync::broadcast::channel::<()>(1);
    let ws_tx_clone = ws_tx.clone();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            // Start WS server with app handle
            thread::spawn(move || {
                let rt_result = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build();

                match rt_result {
                    Ok(rt) => {
                        rt.block_on(async {
                            // Port 49152 is in the dynamic/private range
                            server::start_ws_server(49152, ws_tx_clone, ws_shutdown_rx, app_handle)
                                .await;
                        });
                    }
                    Err(e) => {
                        error!("Failed to create tokio runtime: {e}");
                    }
                }
            });

            // Load saved binding
            // use tauri_plugin_store::StoreExt; // Removed from here
            if let Ok(store) = app.app_handle().store("settings.json") {
                if let Some(value) = store.get("ptt_binding") {
                    if let Ok(binding) = serde_json::from_value(value) {
                        event_tap::set_binding(binding);
                    }
                }
            }

            let (event_tx, event_rx) = crossbeam_channel::unbounded();

            let handle_events = app.handle().clone();
            let ws_tx_for_events = ws_tx.clone();
            thread::spawn(move || {
                while let Ok(msg) = event_rx.recv() {
                    let _ = handle_events.emit("ptt-event", &msg);

                    // Forward to WebSockets
                    if let Ok(json) = serde_json::to_string(&msg) {
                        let _ = ws_tx_for_events.send(json);
                    }
                }
            });

            let handle_tap = app.handle().clone();
            thread::spawn(move || {
                if let Err(e) = event_tap::start_event_tap(event_tx, &shutdown_clone) {
                    error!("Event tap error: {}", e);
                    let _ = handle_tap.emit("error", format!("Event tap error: {e}"));
                }
            });

            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let icon = app.default_window_icon().cloned().ok_or_else(|| {
                tauri::Error::AssetNotFound("default window icon not found".to_string())
            })?;

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Instead of closing, just hide the window
                if let Err(e) = window.hide() {
                    error!("failed to hide window: {e}");
                }
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
        ]);

    if let Err(e) = builder.run(tauri::generate_context!()) {
        error!("error while running tauri application: {e}");
    }

    let _ = ws_shutdown_tx.send(());
    shutdown.store(true, Ordering::SeqCst);
}
