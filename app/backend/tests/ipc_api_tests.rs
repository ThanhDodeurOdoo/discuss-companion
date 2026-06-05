#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "tests are allowed to panic"
)]

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex, RwLock, atomic::AtomicU16},
    };

    use discuss_companion_lib::{
        api::commands, flatbuffers::ipc_protocol_generated::discuss::ipc_protocol,
        protocol::CallState, state::WsState,
    };
    use tauri::{
        Manager,
        http::HeaderMap,
        ipc::{CallbackFn, Channel, InvokeBody, InvokeResponseBody},
        test::{INVOKE_KEY, assert_ipc_response, mock_builder, mock_context, noop_assets},
        webview::InvokeRequest,
    };
    use tokio::sync::broadcast;

    fn local_ipc_url() -> tauri::Url {
        if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap()
    }

    #[tokio::test]
    async fn test_get_version() {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![commands::get_version])
            .build(mock_context(noop_assets()))
            .expect("failed to build app");

        let window = tauri::webview::WebviewWindowBuilder::new(
            &app,
            "main",
            tauri::WebviewUrl::App(PathBuf::default()),
        )
        .build()
        .unwrap();

        assert_ipc_response(
            &window,
            InvokeRequest {
                cmd: "get_version".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: local_ipc_url(),
                body: InvokeBody::default(),
                headers: HeaderMap::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
            Ok(env!("CARGO_PKG_VERSION")),
        );
    }

    #[tokio::test]
    async fn test_is_extension_connected() {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![commands::is_extension_connected])
            .build(mock_context(noop_assets()))
            .expect("failed to build app");

        let window = tauri::webview::WebviewWindowBuilder::new(
            &app,
            "main",
            tauri::WebviewUrl::App(PathBuf::default()),
        )
        .build()
        .unwrap();

        assert_ipc_response(
            &window,
            InvokeRequest {
                cmd: "is_extension_connected".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: local_ipc_url(),
                body: InvokeBody::default(),
                headers: HeaderMap::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
            Ok(false),
        );
    }

    #[tokio::test]
    async fn test_get_ws_port() {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![commands::get_ws_port])
            .build(mock_context(noop_assets()))
            .expect("failed to build app");

        app.manage(WsState {
            port: AtomicU16::new(12345),
            ws_tx: broadcast::channel(1).0,
            server_shutdown_tx: Mutex::new(broadcast::channel(1).0),
            conn_tx: crossbeam_channel::unbounded().0,
            event_channels: RwLock::new(Vec::new()),
            call_state: RwLock::new(None),
        });

        let window = tauri::webview::WebviewWindowBuilder::new(
            &app,
            "main",
            tauri::WebviewUrl::App(PathBuf::default()),
        )
        .build()
        .unwrap();

        assert_ipc_response(
            &window,
            InvokeRequest {
                cmd: "get_ws_port".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: local_ipc_url(),
                body: InvokeBody::default(),
                headers: HeaderMap::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
            Ok(12345),
        );
    }

    #[tokio::test]
    async fn test_establish_channel_sends_cached_call_state() {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![commands::establish_channel])
            .build(mock_context(noop_assets()))
            .expect("failed to build app");

        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx, _) = crossbeam_channel::unbounded();
        let call_state = CallState {
            has_call: true,
            has_state: true,
            is_mute: false,
            is_deaf: true,
            is_camera_on: false,
            is_screen_on: true,
        };

        let received: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let handler_received = Arc::clone(&received);
        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                handler_received.lock().unwrap().push(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(12345),
            ws_tx: broadcast::channel(1).0,
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx,
            event_channels: RwLock::new(Vec::new()),
            call_state: RwLock::new(Some(call_state)),
        });

        commands::establish_channel(app.state::<WsState>(), channel);

        let event = {
            let events = received.lock().unwrap();
            assert_eq!(events.len(), 1, "expected cached call state to be sent");
            events
                .first()
                .expect("expected cached call state payload")
                .clone()
        };
        let msg =
            ipc_protocol::root_as_to_frontend_message(&event).expect("valid flatbuffer event");
        assert_eq!(msg.event_type(), ipc_protocol::ToFrontend::CallState);
        let payload = msg.event_as_call_state().expect("call state payload");
        assert!(payload.has_call());
        assert!(payload.has_state());
        assert!(!payload.is_mute());
        assert!(payload.is_deaf());
        assert!(!payload.is_camera_on());
        assert!(payload.is_screen_on());
    }

    #[tokio::test]
    async fn test_establish_channel_registers_without_call_state() {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![commands::establish_channel])
            .build(mock_context(noop_assets()))
            .expect("failed to build app");

        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx, _) = crossbeam_channel::unbounded();

        let received: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let handler_received = Arc::clone(&received);
        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                handler_received.lock().unwrap().push(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(12345),
            ws_tx: broadcast::channel(1).0,
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx,
            event_channels: RwLock::new(Vec::new()),
            call_state: RwLock::new(None),
        });

        commands::establish_channel(app.state::<WsState>(), channel);

        let events_len = { received.lock().unwrap().len() };
        assert_eq!(events_len, 0, "no cached call state expected");
        let channels_len = {
            let state = app.state::<WsState>();
            let channels = state.event_channels.read().unwrap();
            channels.len()
        };
        assert_eq!(channels_len, 1, "channel should be registered");
    }

    // Note: show_main_window and quit_app commands require AppHandle which
    // cannot be tested with MockRuntime. These are tested via frontend tests.
}
