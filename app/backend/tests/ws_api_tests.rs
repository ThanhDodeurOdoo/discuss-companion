#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "tests are allowed to panic"
)]
#[cfg(test)]
mod tests {
    use std::{sync::atomic::AtomicU16, time::Duration};

    use discuss_companion_lib::{
        WsState,
        flatbuffers::{
            ipc_protocol_generated::discuss::ipc_protocol,
            ws_protocol_generated::discuss::ws_protocol,
        },
        server::{self, is_connected, start_ws_server},
    };
    use flatbuffers::FlatBufferBuilder;
    use futures_util::{SinkExt, StreamExt};
    use serial_test::serial;
    use tauri::{
        Manager,
        ipc::{Channel, InvokeResponseBody},
        test::{mock_builder, mock_context, noop_assets},
    };
    use tokio::{
        net::{TcpListener, TcpStream},
        sync::broadcast,
        time::sleep,
    };
    use tokio_tungstenite::tungstenite::Message::Binary;

    #[tokio::test]
    async fn test_is_connected_initial() {
        assert!(!is_connected());
    }

    #[tokio::test]
    #[serial]
    async fn test_multiple_connections() {
        server::reset_connection_count();

        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let (conn_tx, _) = crossbeam_channel::unbounded();
        tokio::spawn(async move {
            start_ws_server(port, tx, shutdown_rx, app_handle, conn_tx).await;
        });

        sleep(Duration::from_millis(100)).await;

        // Connect client 1
        let stream1 = TcpStream::connect(addr).await.unwrap();
        let (ws1, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}"), stream1)
            .await
            .unwrap();
        sleep(Duration::from_millis(50)).await;
        assert!(is_connected());

        // Connect client 2
        let stream2 = TcpStream::connect(addr).await.unwrap();
        let (ws2, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}"), stream2)
            .await
            .unwrap();
        sleep(Duration::from_millis(50)).await;
        assert!(is_connected());

        // Drop client 1
        drop(ws1);
        sleep(Duration::from_millis(50)).await;
        assert!(is_connected()); // Still connected via ws2

        // Drop client 2
        drop(ws2);
        sleep(Duration::from_millis(50)).await;
        assert!(!is_connected());

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_broadcast_to_clients() {
        server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let tx_server = tx.clone();
        let (conn_tx, _) = crossbeam_channel::unbounded();
        tokio::spawn(async move {
            start_ws_server(port, tx_server, shutdown_rx, app_handle, conn_tx).await;
        });

        sleep(Duration::from_millis(100)).await;

        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut ws, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}"), stream)
            .await
            .unwrap();

        // Send message to broadcast channel
        let test_payload = vec![1, 2, 3, 4];
        tx.send(test_payload.clone()).unwrap();

        // Verify client receives it
        let resp = ws.next().await.unwrap().unwrap();
        if let Binary(bin) = resp {
            assert_eq!(bin.as_ref(), &test_payload);
        } else {
            panic!("Expected binary message");
        }

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_set_binding_message_handling() {
        use std::sync::{Arc, Mutex, RwLock};

        use ws_protocol::{
            Message as FBMessage, MessageArgs, MessageBody, SetBinding, SetBindingArgs,
        };

        server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_event = Arc::new(Mutex::new(None));
        let handler_received = Arc::clone(&received_event);
        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx_state, _) = crossbeam_channel::unbounded();

        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                *handler_received.lock().unwrap() = Some(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(0),
            ws_tx: tx.clone(),
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx: conn_tx_state,
            event_channel: RwLock::new(Some(channel)),
            call_state: RwLock::new(None),
        });

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let (conn_tx, _) = crossbeam_channel::unbounded();
        tokio::spawn(async move {
            start_ws_server(port, tx, shutdown_rx, app_handle, conn_tx).await;
        });

        sleep(Duration::from_millis(100)).await;
        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut ws, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}"), stream)
            .await
            .unwrap();

        let mut builder = FlatBufferBuilder::new();
        let mods_vec = vec![ws_protocol::Modifier::Shift];
        let mods_vec = builder.create_vector(&mods_vec);
        let key_binding = ws_protocol::KeyBinding::create(
            &mut builder,
            &ws_protocol::KeyBindingArgs {
                code: 42,
                modifiers: Some(mods_vec),
            },
        );
        let set_binding = SetBinding::create(
            &mut builder,
            &SetBindingArgs {
                binding: Some(key_binding),
            },
        );
        let msg_offset = FBMessage::create(
            &mut builder,
            &MessageArgs {
                body_type: MessageBody::SetBinding,
                body: Some(set_binding.as_union_value()),
            },
        );
        builder.finish(msg_offset, None);
        let bin = builder.finished_data().to_vec();

        ws.send(Binary(bin.into())).await.unwrap();

        // Wait for event to be processed and emitted
        sleep(Duration::from_millis(200)).await;

        let event_payload = received_event.lock().unwrap();
        assert!(
            event_payload.is_some(),
            "Expected ws-message event to be emitted via channel"
        );
        let payload_bytes = event_payload.as_ref().unwrap();

        let message = ipc_protocol::root_as_to_frontend_message(payload_bytes).unwrap();
        assert_eq!(
            message.event_type(),
            ipc_protocol::ToFrontend::WsMessageEvent
        );
        // Deep inspection of the flatbuffer could go here, but verifying the event type is a good start.

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_shutdown_message_handling() {
        use std::sync::{Arc, Mutex, RwLock};

        use ws_protocol::{Message as FBMessage, MessageArgs, MessageBody, Shutdown, ShutdownArgs};

        server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_event = Arc::new(Mutex::new(None));
        let handler_received = Arc::clone(&received_event);
        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx_state, _) = crossbeam_channel::unbounded();

        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                *handler_received.lock().unwrap() = Some(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(0),
            ws_tx: tx.clone(),
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx: conn_tx_state,
            event_channel: RwLock::new(Some(channel)),
            call_state: RwLock::new(None),
        });

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let (conn_tx, _) = crossbeam_channel::unbounded();
        tokio::spawn(async move {
            start_ws_server(port, tx, shutdown_rx, app_handle, conn_tx).await;
        });

        sleep(Duration::from_millis(100)).await;
        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut ws, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}"), stream)
            .await
            .unwrap();

        // Construct Shutdown flatbuffer
        let mut builder = FlatBufferBuilder::new();
        let shutdown_body = Shutdown::create(&mut builder, &ShutdownArgs {});
        let msg_offset = FBMessage::create(
            &mut builder,
            &MessageArgs {
                body_type: MessageBody::Shutdown,
                body: Some(shutdown_body.as_union_value()),
            },
        );
        builder.finish(msg_offset, None);
        let bin = builder.finished_data().to_vec();

        ws.send(Binary(bin.into())).await.unwrap();

        // Wait for event to be processed and emitted
        sleep(Duration::from_millis(200)).await;

        let event_payload = received_event.lock().unwrap();
        assert!(
            event_payload.is_some(),
            "Expected ws-message event to be emitted via channel"
        );
        let payload_bytes = event_payload.as_ref().unwrap();

        let message = ipc_protocol::root_as_to_frontend_message(payload_bytes).unwrap();
        assert_eq!(
            message.event_type(),
            ipc_protocol::ToFrontend::WsMessageEvent
        );

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_call_state_message_handling() {
        use std::sync::{Arc, Mutex, RwLock};

        use ws_protocol::{
            CallState, CallStateArgs, Message as FBMessage, MessageArgs, MessageBody,
        };

        server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_event = Arc::new(Mutex::new(None));
        let handler_received = Arc::clone(&received_event);
        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx_state, _) = crossbeam_channel::unbounded();

        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                *handler_received.lock().unwrap() = Some(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(0),
            ws_tx: tx.clone(),
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx: conn_tx_state,
            event_channel: RwLock::new(Some(channel)),
            call_state: RwLock::new(None),
        });

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let (conn_tx, _) = crossbeam_channel::unbounded();
        tokio::spawn(async move {
            start_ws_server(port, tx, shutdown_rx, app_handle, conn_tx).await;
        });

        sleep(Duration::from_millis(100)).await;
        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut ws, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}"), stream)
            .await
            .unwrap();

        let mut builder = FlatBufferBuilder::new();
        let call_state = CallState::create(
            &mut builder,
            &CallStateArgs {
                ts: 42,
                has_call: true,
                has_state: true,
                is_mute: true,
                is_deaf: false,
                is_camera_on: true,
                is_screen_on: false,
            },
        );
        let msg_offset = FBMessage::create(
            &mut builder,
            &MessageArgs {
                body_type: MessageBody::CallState,
                body: Some(call_state.as_union_value()),
            },
        );
        builder.finish(msg_offset, None);
        let bin = builder.finished_data().to_vec();

        ws.send(Binary(bin.into())).await.unwrap();
        sleep(Duration::from_millis(200)).await;

        let event_payload = received_event.lock().unwrap();
        assert!(event_payload.is_some(), "Expected call state event");
        let payload_bytes = event_payload.as_ref().unwrap();

        let message = ipc_protocol::root_as_to_frontend_message(payload_bytes).unwrap();
        assert_eq!(message.event_type(), ipc_protocol::ToFrontend::CallState);
        let state = message.event_as_call_state().expect("call state payload");
        assert!(state.has_call());
        assert!(state.has_state());
        assert!(state.is_mute());
        assert!(state.is_camera_on());

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_handshake_and_ping_pong() {
        use discuss_companion_lib::flatbuffers::ws_protocol_generated::discuss::ws_protocol::root_as_message;
        use ws_protocol::{Message as FBMessage, MessageArgs, MessageBody, Ping, PingArgs};

        server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let (conn_tx, _) = crossbeam_channel::unbounded();
        tokio::spawn(async move {
            start_ws_server(port, tx, shutdown_rx, app_handle, conn_tx).await;
        });

        sleep(Duration::from_millis(100)).await;

        let stream = TcpStream::connect(addr).await.expect("Failed to connect");
        let (mut ws_stream, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}"), stream)
                .await
                .expect("Failed to handshake");

        sleep(Duration::from_millis(100)).await;
        assert!(is_connected());

        // Construct a Ping flatbuffer
        let mut builder = FlatBufferBuilder::new();
        let ping_offset = Ping::create(&mut builder, &PingArgs {});
        let msg_offset = FBMessage::create(
            &mut builder,
            &MessageArgs {
                body_type: MessageBody::Ping,
                body: Some(ping_offset.as_union_value()),
            },
        );
        builder.finish(msg_offset, None);
        let ping_bin = builder.finished_data().to_vec();

        ws_stream.send(Binary(ping_bin.into())).await.unwrap();

        // Wait for response
        let resp = ws_stream.next().await.unwrap().unwrap();
        if let Binary(bin) = resp {
            let message = root_as_message(&bin).unwrap();
            assert_eq!(message.body_type(), MessageBody::Pong);
        } else {
            panic!("Expected binary message (Pong)");
        }

        let _ = shutdown_tx.send(());
    }
    #[tokio::test]
    #[serial]
    async fn test_restart_on_different_port() {
        server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        // Start on Port A
        let (shutdown_tx_1, shutdown_rx_1) = broadcast::channel(1);
        let listener_1 = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_1 = listener_1.local_addr().unwrap();
        let port_1 = addr_1.port();
        drop(listener_1);

        let tx_clone = tx.clone();
        let (conn_tx, _) = crossbeam_channel::unbounded();
        let app_handle_clone = app_handle.clone();
        let h1 = tokio::spawn(async move {
            start_ws_server(port_1, tx_clone, shutdown_rx_1, app_handle_clone, conn_tx).await;
        });

        sleep(Duration::from_millis(100)).await;

        // Verify connection to Port A
        let stream_1 = TcpStream::connect(addr_1)
            .await
            .expect("Failed to connect to Port A");
        let (ws_1, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port_1}"), stream_1)
                .await
                .expect("Failed to handshake Port A");
        assert!(is_connected());
        drop(ws_1); // Close client

        // Shutdown Port A
        shutdown_tx_1.send(()).unwrap();
        h1.await.unwrap(); // Wait for server to finish

        sleep(Duration::from_millis(100)).await;

        // Start on Port B
        let (shutdown_tx_2, shutdown_rx_2) = broadcast::channel(1);
        let listener_2 = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_2 = listener_2.local_addr().unwrap();
        let port_2 = addr_2.port();
        assert_ne!(port_1, port_2); // Ensure different ports
        drop(listener_2);

        let tx_clone_2 = tx.clone();
        let (conn_tx, _) = crossbeam_channel::unbounded();
        let app_handle_clone_2 = app_handle.clone();
        let h2 = tokio::spawn(async move {
            start_ws_server(
                port_2,
                tx_clone_2,
                shutdown_rx_2,
                app_handle_clone_2,
                conn_tx,
            )
            .await;
        });

        sleep(Duration::from_millis(100)).await;

        // Verify connection to Port B
        let stream_2 = TcpStream::connect(addr_2)
            .await
            .expect("Failed to connect to Port B");
        let (_ws_2, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port_2}"), stream_2)
                .await
                .expect("Failed to handshake Port B");
        assert!(is_connected());

        // Verify Port A is unreachable
        let result = TcpStream::connect(addr_1).await;
        assert!(result.is_err(), "Port A should be closed");

        shutdown_tx_2.send(()).unwrap();
        h2.await.unwrap();
    }
}
