use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::{
    Emitter, Manager, Runtime, State,
    ipc::{Channel, InvokeBody, Request},
};
use tauri_plugin_store::StoreExt;
use tracing::info;

use crate::{
    api::ws_server,
    config::store_keys,
    flatbuffers::ipc_protocol_generated::discuss::ipc_protocol::{
        PttBinding, SetRecordingMode, SetWsPort,
    },
    interface::call_controls_window::CALL_CONTROLS_WINDOW_LABEL,
    protocol,
    protocol::{FEATURES, Features, KeyBinding, VERSION, current_timestamp},
    ptt_engine,
    ptt_engine::{check_accessibility_permission, get_binding, set_binding, set_recording},
    runtime,
    state::{AppSettings, WsState},
};

/// JUSTIFICATION: for all `clippy::needless_pass_by_value` below
/// Tauri commands require owned values for dependency injection of the app handle
/// and for deserialization of arguments. This does not matter from the rust side since
/// these handlers are called from the front-end where ownership is not a relevant concept

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CallCommand {
    ToggleMicrophone,
    ToggleDeafen,
    ToggleCamera,
    ToggleScreen,
    OpenPip,
    LeaveCall,
    OpenChannel,
    SetMute,
    SetDeaf,
    SetCamera,
    SetScreen,
    FocusCallTab,
    RefreshCallState,
}

impl CallCommand {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ToggleMicrophone => "toggle-microphone",
            Self::ToggleDeafen => "toggle-deafen",
            Self::ToggleCamera => "toggle-camera",
            Self::ToggleScreen => "toggle-screen",
            Self::OpenPip => "open-pip",
            Self::LeaveCall => "leave-call",
            Self::OpenChannel => "open-channel",
            Self::SetMute => "set-mute",
            Self::SetDeaf => "set-deaf",
            Self::SetCamera => "set-camera",
            Self::SetScreen => "set-screen",
            Self::FocusCallTab => "focus-call-tab",
            Self::RefreshCallState => "refresh-call-state",
        }
    }
}

#[tauri::command]
#[must_use]
pub fn get_version() -> String {
    VERSION.to_string()
}

#[tauri::command]
#[must_use]
pub fn get_features() -> Features {
    FEATURES
}

#[tauri::command]
#[must_use]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
pub fn get_app_visibility_mode(state: State<'_, AppSettings>) -> protocol::AppVisibilityMode {
    state.app_visibility_mode()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
pub fn set_app_visibility_mode(
    app_handle: tauri::AppHandle,
    state: State<'_, AppSettings>,
    mode: protocol::AppVisibilityMode,
) {
    state.set_app_visibility_mode(mode);

    if let Ok(store) = app_handle.store(store_keys::STORE_FILENAME) {
        store.set(
            store_keys::APP_VISIBILITY_MODE,
            serde_json::to_value(mode).unwrap_or_default(),
        );
        let _ = store.save();
    }

    runtime::apply_app_visibility_mode(&app_handle, mode);
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[allow(clippy::collapsible_if, reason = "nested if let")]
pub fn update_binding(app_handle: tauri::AppHandle, request: Request<'_>) {
    if let InvokeBody::Raw(data) = request.body()
        && let Ok(binding) = flatbuffers::root::<PttBinding<'_>>(data)
    {
        let key_binding: KeyBinding = binding.into();
        set_binding(key_binding);

        // Save to store
        if let Ok(store) = app_handle.store(store_keys::STORE_FILENAME) {
            store.set(
                store_keys::PTT_BINDING,
                serde_json::to_value(key_binding).unwrap_or_default(),
            );
            let _ = store.save();
        }
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[allow(clippy::collapsible_if, reason = "nested if let")]
pub fn set_recording_mode(request: Request<'_>) {
    if let InvokeBody::Raw(data) = request.body()
        && let Ok(msg) = flatbuffers::root::<SetRecordingMode<'_>>(data)
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
    ws_server::is_connected()
}

#[tauri::command]
pub fn force_ptt_up() {
    ptt_engine::force_ptt_up();
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
pub fn show_main_window(app_handle: tauri::AppHandle) {
    show_main_window_with_handle(&app_handle);
}

pub(crate) fn show_main_window_with_handle<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
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
    crate::profiling_drop!();
    app_handle.exit(0);
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[must_use]
pub fn get_ws_port(state: State<'_, WsState>) -> u16 {
    state.port.load(Ordering::Relaxed)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[allow(clippy::collapsible_if, reason = "nested if let")]
#[allow(clippy::missing_panics_doc, reason = "tauri API")]
pub fn update_ws_port(
    app_handle: tauri::AppHandle,
    state: State<'_, WsState>,
    request: Request<'_>,
) {
    if let InvokeBody::Raw(data) = request.body()
        && let Ok(msg) = flatbuffers::root::<SetWsPort<'_>>(data)
    {
        let port = msg.port();
        info!("Updating WS port to: {}", port);

        // Save to store
        if let Ok(store) = app_handle.store(store_keys::STORE_FILENAME) {
            store.set(store_keys::WS_PORT, serde_json::json!(port));
            let _ = store.save();
        }

        let current_port = state.port.load(Ordering::Relaxed);
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
        state.port.store(port, Ordering::Relaxed);

        // Shutdown previous server
        info!("Shutting down previous WS server...");
        let rx = state.rotate_server_shutdown_channel();

        // Start new server
        info!("Starting new WS server on port {}...", port);
        runtime::handle_ws_server(
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
    let call_state = state.call_state();
    if let Some(call_state) = call_state {
        let _ = channel.send(InvokeBody::Raw(protocol::ipc::encode_call_state(&call_state)).into());
    }
    state.push_event_channel(channel);
}

fn build_call_command_payload(command: CallCommand, value: Option<bool>) -> String {
    value.map_or_else(
        || command.as_str().to_string(),
        |value| serde_json::json!({ "command": command, "value": value }).to_string(),
    )
}

pub(crate) fn dispatch_call_command(
    state: &WsState,
    command: CallCommand,
    value: Option<bool>,
) -> bool {
    let payload = build_call_command_payload(command, value);
    let message = protocol::ws::OutgoingMessage::Status {
        ts: current_timestamp(),
        state: payload,
        version: VERSION.to_string(),
    };
    state.ws_tx.send(message.to_flatbuffer()).is_ok()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "tauri API")]
#[must_use]
pub fn send_call_command(
    state: State<'_, WsState>,
    command: CallCommand,
    value: Option<bool>,
) -> bool {
    dispatch_call_command(&state, command, value)
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, RwLock, atomic::AtomicU16};

    use tokio::sync::broadcast;

    use super::*;
    use crate::flatbuffers::ws_protocol_generated::discuss::ws_protocol;

    #[test]
    fn test_build_call_command_payload_plain() {
        let payload = build_call_command_payload(CallCommand::ToggleMicrophone, None);
        assert_eq!(payload, "toggle-microphone");
    }

    #[test]
    fn test_build_call_command_payload_with_value() {
        let payload = build_call_command_payload(CallCommand::SetMute, Some(true));
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

        let did_send = dispatch_call_command(&state, CallCommand::SetMute, Some(true));
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
