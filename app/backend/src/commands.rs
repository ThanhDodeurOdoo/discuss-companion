use std::{env, sync::atomic::Ordering};

use tauri::{
    Emitter, Manager, State,
    ipc::{Channel, InvokeBody},
};
use tauri_plugin_store::StoreExt;
use tokio::sync::broadcast;
use tracing::info;

use crate::{
    WsState,
    flatbuffers::ipc_protocol_generated::discuss::ipc_protocol::{
        PttBinding, SetRecordingMode, SetWsPort,
    },
    menu::CALL_CONTROLS_WINDOW_LABEL,
    platform,
    platform::{check_accessibility_permission, get_binding, set_binding, set_recording},
    server,
    state::{KeyBinding, OutgoingMessage, VERSION, current_timestamp, encode_call_state},
};

/// JUSTIFICATION: for all `clippy::needless_pass_by_value` below
/// Tauri commands require owned values for dependency injection of the app handle
/// and for deserialization of arguments. This does not matter from the rust side since
/// these handlers are called from the front-end where ownership is not a relevant concept

#[tauri::command]
#[must_use]
pub fn get_version() -> String {
    VERSION.to_string()
}

#[tauri::command]
#[must_use]
pub fn get_platform() -> &'static str {
    env::consts::OS
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
#[must_use]
pub fn get_current_binding() -> KeyBinding {
    get_binding()
}

#[tauri::command]
#[must_use]
pub fn is_accessibility_granted() -> bool {
    check_accessibility_permission()
}

#[tauri::command]
#[must_use]
pub fn is_extension_connected() -> bool {
    server::is_connected()
}

#[tauri::command]
pub fn force_ptt_up() {
    platform::force_ptt_up();
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
pub fn show_main_window(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
pub fn quit_app(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window(CALL_CONTROLS_WINDOW_LABEL) {
        let _ = window.hide();
    }
    app_handle.exit(0);
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[must_use]
pub fn get_ws_port(state: State<'_, WsState>) -> u16 {
    state.port.load(Ordering::SeqCst)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[allow(clippy::collapsible_if, reason = "nested if let")]
#[allow(clippy::missing_panics_doc, reason = "tauri API")]
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
#[allow(clippy::missing_panics_doc, reason = "tauri API")]
pub fn establish_channel(state: State<'_, WsState>, channel: Channel) {
    let call_state = state.call_state.read().ok().and_then(|guard| *guard);
    if let Some(call_state) = call_state {
        let _ = channel.send(InvokeBody::Raw(encode_call_state(&call_state)).into());
    }
    if let Ok(mut guard) = state.event_channels.write() {
        guard.push(channel);
    }
}

fn build_call_command_payload(command: &str, value: Option<bool>) -> String {
    value.map_or_else(
        || command.to_string(),
        |value| serde_json::json!({ "command": command, "value": value }).to_string(),
    )
}

pub(crate) fn dispatch_call_command(state: &WsState, command: &str, value: Option<bool>) -> bool {
    let payload = build_call_command_payload(command, value);
    let message = OutgoingMessage::Status {
        ts: current_timestamp(),
        state: payload,
        version: VERSION.to_string(),
    };
    state.ws_tx.send(message.to_flatbuffer()).is_ok()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[must_use]
pub fn send_call_command(state: State<'_, WsState>, command: String, value: Option<bool>) -> bool {
    dispatch_call_command(&state, &command, value)
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, RwLock, atomic::AtomicU16};

    use tokio::sync::broadcast;

    use super::*;
    use crate::flatbuffers::ws_protocol_generated::discuss::ws_protocol;

    #[test]
    fn test_build_call_command_payload_plain() {
        let payload = build_call_command_payload("toggle-microphone", None);
        assert_eq!(payload, "toggle-microphone");
    }

    #[test]
    fn test_build_call_command_payload_with_value() {
        let payload = build_call_command_payload("set-mute", Some(true));
        let parsed: serde_json::Value = serde_json::from_str(&payload).expect("valid json payload");
        assert_eq!(
            parsed.get("command").and_then(|value| value.as_str()),
            Some("set-mute")
        );
        assert_eq!(
            parsed.get("value").and_then(serde_json::Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn test_dispatch_call_command_sends_status() {
        let (ws_tx, mut ws_rx) = broadcast::channel(1);
        let (shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx, _) = crossbeam_channel::unbounded();
        let state = WsState {
            port: AtomicU16::new(0),
            ws_tx,
            server_shutdown_tx: Mutex::new(shutdown_tx),
            conn_tx,
            event_channels: RwLock::new(Vec::new()),
            call_state: RwLock::new(None),
        };

        let did_send = dispatch_call_command(&state, "set-mute", Some(true));
        assert!(did_send, "expected ws send to succeed");

        let bin = ws_rx.try_recv().expect("expected ws payload");
        let decoded = ws_protocol::root_as_message(&bin).expect("valid ws message");
        assert_eq!(decoded.body_type(), ws_protocol::MessageBody::Status);

        let status = decoded.body_as_status().expect("status payload");
        let payload = status.state().expect("status state");
        let parsed: serde_json::Value = serde_json::from_str(payload).expect("valid status json");
        assert_eq!(
            parsed.get("command").and_then(|value| value.as_str()),
            Some("set-mute")
        );
        assert_eq!(
            parsed.get("value").and_then(serde_json::Value::as_bool),
            Some(true)
        );
    }
}
