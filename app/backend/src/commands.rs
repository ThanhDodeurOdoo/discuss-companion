use std::sync::atomic::Ordering;

use tauri::{Emitter, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::broadcast;
use tracing::info;

use crate::WsState;
use crate::flatbuffers::ipc_protocol_generated::discuss::ipc_protocol::{
    PttBinding, SetRecordingMode, SetWsPort,
};
use crate::platform;
use crate::platform::{check_accessibility_permission, get_binding, set_binding, set_recording};
use crate::server;
use crate::state::{KeyBinding, VERSION};
use tauri::ipc::{Channel, InvokeBody};

/// JUSTIFICATION: for all `clippy::needless_pass_by_value` below
/// Tauri commands require owned values for dependency injection of the app handle
/// and for deserialization of arguments. This does not matter from the rust side since
/// these handlers are called from the front-end where ownership is not a relevant concept

#[tauri::command]
pub fn get_version() -> String {
    VERSION.to_string()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[allow(clippy::collapsible_if, reason = "nested if let")]
pub fn update_binding(app_handle: tauri::AppHandle, request: tauri::ipc::Request) {
    if let InvokeBody::Raw(data) = request.body()
        && let Ok(binding) = flatbuffers::root::<PttBinding>(data)
    {
        let key_binding: KeyBinding = binding.into();
        set_binding(key_binding.clone());

        // Save to store
        if let Ok(store) = app_handle.store("settings.json") {
            store.set(
                "ptt_binding",
                serde_json::to_value(key_binding).unwrap_or_default(),
            );
            let _ = store.save();
        }
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[allow(clippy::collapsible_if, reason = "nested if let")]
pub fn set_recording_mode(request: tauri::ipc::Request) {
    if let InvokeBody::Raw(data) = request.body()
        && let Ok(msg) = flatbuffers::root::<SetRecordingMode>(data)
    {
        set_recording(msg.recording());
    }
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
    server::is_connected()
}

#[tauri::command]
pub fn force_ptt_up() {
    platform::force_ptt_up();
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
pub fn get_ws_port(state: State<'_, WsState>) -> u16 {
    state.port.load(Ordering::SeqCst)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[allow(clippy::collapsible_if, reason = "nested if let")]
pub fn update_ws_port(
    app_handle: tauri::AppHandle,
    state: State<'_, WsState>,
    request: tauri::ipc::Request,
) {
    if let InvokeBody::Raw(data) = request.body()
        && let Ok(msg) = flatbuffers::root::<SetWsPort>(data)
    {
        let port = msg.port();
        info!("Updating WS port to: {}", port);

        // Save to store
        if let Ok(store) = app_handle.store("settings.json") {
            store.set("ws_port", serde_json::json!(port));
            let _ = store.save();
        }

        let current_port = state.port.load(Ordering::SeqCst);
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
        state.port.store(port, Ordering::SeqCst);

        // Shutdown previous server
        // SAFETY: Mutex poisoning is fatal/unrecoverable in this context
        #[allow(clippy::unwrap_used, reason = "tauri API")]
        let mut shutdown_guard = state.server_shutdown_tx.lock().unwrap();
        info!("Shutting down previous WS server...");
        let _ = shutdown_guard.send(());

        // Create new shutdown channel
        let (tx, rx) = broadcast::channel(1);
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
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[allow(clippy::unwrap_used, reason = "mutex poisoning")]
pub fn establish_channel(state: State<'_, WsState>, channel: Channel) {
    *state.event_channel.lock().unwrap() = Some(channel);
}
