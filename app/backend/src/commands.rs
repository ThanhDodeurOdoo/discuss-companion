use crate::WsState;
use crate::platform::{check_accessibility_permission, get_binding, set_binding, set_recording};
use crate::state::{KeyBinding, VERSION};
use tauri::{Emitter, State};
use tauri_plugin_store::StoreExt;
use tracing::info;

#[tauri::command]
pub fn get_version() -> String {
    VERSION.to_string()
}

#[tauri::command]
/// JUSTIFICATION: `clippy::needless_pass_by_value`
/// Tauri commands require owned values for dependency injection of the app handle
/// and for deserialization of arguments.
#[allow(clippy::needless_pass_by_value)]
pub fn update_binding(app_handle: tauri::AppHandle, binding: KeyBinding) {
    set_binding(binding.clone());

    // Save to store
    if let Ok(store) = app_handle.store("settings.json") {
        store.set(
            "ptt_binding",
            serde_json::to_value(binding).unwrap_or_default(),
        );
        let _ = store.save();
    }
}

#[tauri::command]
pub fn set_recording_mode(recording: bool) {
    set_recording(recording);
}

#[tauri::command]
pub fn get_current_binding() -> KeyBinding {
    get_binding()
}

#[tauri::command]
pub fn is_accessibility_granted() -> bool {
    check_accessibility_permission()
}

#[tauri::command]
pub fn is_extension_connected() -> bool {
    crate::server::is_connected()
}

#[tauri::command]
pub fn force_ptt_up() {
    crate::platform::force_ptt_up();
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn get_ws_port(state: State<'_, WsState>) -> u16 {
    state.port.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn update_ws_port(app_handle: tauri::AppHandle, port: u16, state: State<'_, WsState>) {
    info!("Updating WS port to: {}", port);

    // Save to store
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("ws_port", serde_json::json!(port));
        let _ = store.save();
    }

    let current_port = state.port.load(std::sync::atomic::Ordering::SeqCst);
    if current_port == port {
        let _ = app_handle.emit(
            "ws-server-status",
            serde_json::json!({
                 "status": "restarted",
                 "port": port
            }),
        );
        info!("WS server port unchanged, frontend notified.");
        return;
    }
    state.port.store(port, std::sync::atomic::Ordering::SeqCst);

    // Shutdown previous server
    // SAFETY: Mutex poisoning is fatal/unrecoverable in this context
    #[allow(clippy::unwrap_used)]
    let mut shutdown_guard = state.server_shutdown_tx.lock().unwrap();
    info!("Shutting down previous WS server...");
    let _ = shutdown_guard.send(());

    // Create new shutdown channel
    let (tx, rx) = tokio::sync::broadcast::channel(1);
    *shutdown_guard = tx;

    // Start new server
    info!("Starting new WS server on port {}...", port);
    crate::handle_ws_server(
        app_handle.clone(),
        port,
        state.ws_tx.clone(),
        rx,
        state.conn_tx.clone(),
    );

    // Notify frontend
    let _ = app_handle.emit(
        "ws-server-status",
        serde_json::json!({
             "status": "restarted",
             "port": port
        }),
    );
    info!("WS server restart initiated, frontend notified.");
}
