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
        sync::{Mutex, RwLock, atomic::AtomicU16},
    };

    use discuss_companion_lib::commands;
    use tauri::{
        Manager,
        http::HeaderMap,
        ipc::{CallbackFn, InvokeBody},
        test::{INVOKE_KEY, assert_ipc_response, mock_builder, mock_context, noop_assets},
        webview::InvokeRequest,
    };
    use tokio::sync::broadcast;

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
                url: "http://tauri.localhost".parse().unwrap(),
                body: InvokeBody::default(),
                headers: HeaderMap::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
            Ok("0.4.0"),
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
                url: "http://tauri.localhost".parse().unwrap(),
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

        app.manage(discuss_companion_lib::WsState {
            port: AtomicU16::new(12345),
            ws_tx: broadcast::channel(1).0,
            server_shutdown_tx: Mutex::new(broadcast::channel(1).0),
            conn_tx: crossbeam_channel::unbounded().0,
            event_channel: RwLock::new(None),
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
                url: "http://tauri.localhost".parse().unwrap(),
                body: InvokeBody::default(),
                headers: HeaderMap::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
            Ok(12345),
        );
    }
}
