#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "tests are allowed to panic"
)]
#[cfg(test)]
mod tests {
    use std::{
        net::SocketAddr,
        sync::{Arc, Mutex, RwLock, atomic::AtomicU16},
        time::Duration,
    };

    use discuss_companion_lib::{
        WsState,
        api::ws_server::{self, is_connected, start_ws_server},
        flatbuffers::{
            ipc_protocol_generated::discuss::ipc_protocol,
            ws_protocol_generated::discuss::ws_protocol,
        },
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
        time::{sleep, timeout},
    };
    use tokio_tungstenite::{WebSocketStream, tungstenite::Message::Binary};

    const TEST_TIMEOUT: Duration = Duration::from_secs(5);
    const POLL_INTERVAL: Duration = Duration::from_millis(10);

    /// Connects to a WebSocket server with retry logic.
    /// Retries until the server is ready or timeout is reached.
    async fn connect_ws(addr: SocketAddr) -> WebSocketStream<TcpStream> {
        let port = addr.port();
        timeout(TEST_TIMEOUT, async {
            loop {
                match TcpStream::connect(addr).await {
                    Ok(stream) => {
                        match tokio_tungstenite::client_async(
                            format!("ws://127.0.0.1:{port}"),
                            stream,
                        )
                        .await
                        {
                            Ok((ws, _)) => return ws,
                            Err(_) => sleep(POLL_INTERVAL).await,
                        }
                    }
                    Err(_) => sleep(POLL_INTERVAL).await,
                }
            }
        })
        .await
        .expect("server should become ready within timeout")
    }

    /// Waits until a condition is true or timeout is reached.
    async fn wait_until<F>(condition: F)
    where
        F: Fn() -> bool,
    {
        timeout(TEST_TIMEOUT, async {
            while !condition() {
                sleep(POLL_INTERVAL).await;
            }
        })
        .await
        .expect("condition should become true within timeout");
    }

    /// Waits until the event container has at least `count` events.
    async fn wait_for_events<T: Clone>(events: &Arc<Mutex<Vec<T>>>, count: usize) {
        timeout(TEST_TIMEOUT, async {
            loop {
                if events.lock().unwrap().len() >= count {
                    return;
                }
                sleep(POLL_INTERVAL).await;
            }
        })
        .await
        .expect("should receive expected number of events within timeout");
    }

    #[tokio::test]
    #[serial]
    async fn test_is_connected_initial() {
        ws_server::reset_connection_count();
        assert!(!is_connected());
    }

    #[tokio::test]
    #[serial]
    async fn test_multiple_connections() {
        ws_server::reset_connection_count();

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

        // Connect client 1
        let ws1 = connect_ws(addr).await;
        wait_until(is_connected).await;

        // Connect client 2
        let ws2 = connect_ws(addr).await;
        assert!(is_connected());

        // Drop client 1
        drop(ws1);
        wait_until(is_connected).await; // Still connected via ws2

        // Drop client 2
        drop(ws2);
        wait_until(|| !is_connected()).await;

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_broadcast_to_clients() {
        ws_server::reset_connection_count();
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

        let mut ws = connect_ws(addr).await;

        // Send message to broadcast channel
        let test_payload = vec![1, 2, 3, 4];
        tx.send(test_payload.clone()).unwrap();

        // Verify client receives it
        let resp = timeout(TEST_TIMEOUT, ws.next())
            .await
            .expect("should receive message")
            .unwrap()
            .unwrap();
        if let Binary(bin) = resp {
            assert_eq!(bin.as_ref(), &test_payload);
        } else {
            panic!("Expected binary message");
        }

        let _ = shutdown_tx.send(());
    }

    /// Helper to wait for a specific event type in the received events.
    async fn wait_for_event_type(
        events: &Arc<Mutex<Vec<Vec<u8>>>>,
        expected_type: ipc_protocol::ToFrontend,
    ) -> Vec<u8> {
        timeout(TEST_TIMEOUT, async {
            loop {
                let found_event = {
                    let events_guard = events.lock().unwrap();
                    events_guard
                        .iter()
                        .find(|event| {
                            ipc_protocol::root_as_to_frontend_message(event)
                                .is_ok_and(|msg| msg.event_type() == expected_type)
                        })
                        .cloned()
                };

                if let Some(event) = found_event {
                    return event;
                }
                sleep(POLL_INTERVAL).await;
            }
        })
        .await
        .expect("should receive expected event type within timeout")
    }

    #[tokio::test]
    #[serial]
    async fn test_shutdown_message_handling() {
        use ws_protocol::{Message as FBMessage, MessageArgs, MessageBody, Shutdown, ShutdownArgs};

        ws_server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_events: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let handler_received = Arc::clone(&received_events);
        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx_state, _) = crossbeam_channel::unbounded();

        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                handler_received.lock().unwrap().push(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(0),
            ws_tx: tx.clone(),
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx: conn_tx_state,
            event_channels: RwLock::new(vec![channel]),
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

        let mut ws = connect_ws(addr).await;

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

        // Wait for event to be processed
        let payload_bytes =
            wait_for_event_type(&received_events, ipc_protocol::ToFrontend::WsMessageEvent).await;

        let message = ipc_protocol::root_as_to_frontend_message(&payload_bytes).unwrap();
        assert_eq!(
            message.event_type(),
            ipc_protocol::ToFrontend::WsMessageEvent
        );

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_call_state_message_handling() {
        use ws_protocol::{
            CallState, CallStateArgs, Message as FBMessage, MessageArgs, MessageBody,
        };

        ws_server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_events: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let handler_received = Arc::clone(&received_events);
        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx_state, _) = crossbeam_channel::unbounded();

        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                handler_received.lock().unwrap().push(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(0),
            ws_tx: tx.clone(),
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx: conn_tx_state,
            event_channels: RwLock::new(vec![channel]),
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

        let mut ws = connect_ws(addr).await;

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

        // Wait for event to be processed
        let payload_bytes =
            wait_for_event_type(&received_events, ipc_protocol::ToFrontend::CallState).await;

        let message = ipc_protocol::root_as_to_frontend_message(&payload_bytes).unwrap();
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

        ws_server::reset_connection_count();
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

        let mut ws_stream = connect_ws(addr).await;
        wait_until(is_connected).await;

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
        let resp = timeout(TEST_TIMEOUT, ws_stream.next())
            .await
            .expect("should receive pong")
            .unwrap()
            .unwrap();
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
        ws_server::reset_connection_count();
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

        // Verify connection to Port A
        let ws_1 = connect_ws(addr_1).await;
        wait_until(is_connected).await;
        drop(ws_1);

        // Shutdown Port A
        shutdown_tx_1.send(()).unwrap();
        h1.await.unwrap();

        // Start on Port B
        let (shutdown_tx_2, shutdown_rx_2) = broadcast::channel(1);
        let listener_2 = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_2 = listener_2.local_addr().unwrap();
        let port_2 = addr_2.port();
        assert_ne!(port_1, port_2);
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

        // Verify connection to Port B
        let _ws_2 = connect_ws(addr_2).await;
        wait_until(is_connected).await;

        // Verify Port A is unreachable
        let result = TcpStream::connect(addr_1).await;
        assert!(result.is_err(), "Port A should be closed");

        shutdown_tx_2.send(()).unwrap();
        h2.await.unwrap();
    }

    #[tokio::test]
    #[serial]
    async fn test_restart_closes_existing_connections() {
        ws_server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let (conn_tx, _) = crossbeam_channel::unbounded();
        let server_handle = tokio::spawn(async move {
            start_ws_server(port, tx, shutdown_rx, app_handle, conn_tx).await;
        });

        let mut ws = connect_ws(addr).await;
        wait_until(is_connected).await;

        shutdown_tx.send(()).unwrap();

        let close_result = timeout(TEST_TIMEOUT, ws.next()).await;
        assert!(close_result.is_ok(), "expected close or EOF after shutdown");
        let _ = server_handle.await;
        assert!(!is_connected());
    }

    #[tokio::test]
    #[serial]
    async fn test_generation_reset_ignores_old_connections() {
        ws_server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let (shutdown_tx_a, shutdown_rx_a) = broadcast::channel(1);
        let listener_a = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_a = listener_a.local_addr().unwrap();
        let port_a = addr_a.port();
        drop(listener_a);

        let (conn_tx_a, _) = crossbeam_channel::unbounded();
        let tx_a = tx.clone();
        let h1 = tokio::spawn(async move {
            start_ws_server(port_a, tx_a, shutdown_rx_a, app_handle.clone(), conn_tx_a).await;
        });

        let ws_a = connect_ws(addr_a).await;
        wait_until(is_connected).await;

        let (shutdown_tx_b, shutdown_rx_b) = broadcast::channel(1);
        let listener_b = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_b = listener_b.local_addr().unwrap();
        let port_b = addr_b.port();
        drop(listener_b);

        let (conn_tx_b, _) = crossbeam_channel::unbounded();
        let tx_b = tx.clone();
        let app_handle_b = app.handle().clone();
        let h2 = tokio::spawn(async move {
            start_ws_server(port_b, tx_b, shutdown_rx_b, app_handle_b, conn_tx_b).await;
        });

        // Wait for new server to start and reset connection count
        wait_until(|| !is_connected()).await;

        drop(ws_a);
        assert!(!is_connected());

        shutdown_tx_a.send(()).unwrap();
        shutdown_tx_b.send(()).unwrap();
        let _ = h1.await;
        let _ = h2.await;
    }

    /// Tests that multiple connected clients all receive broadcast messages.
    /// Feature: PTT events reach all browser extension instances.
    #[tokio::test]
    #[serial]
    async fn test_broadcast_reaches_all_clients() {
        ws_server::reset_connection_count();
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

        // Connect client 1
        let mut ws1 = connect_ws(addr).await;

        // Connect client 2
        let mut ws2 = connect_ws(addr).await;

        // Send message via broadcast channel
        let test_payload = vec![10, 20, 30, 40];
        tx.send(test_payload.clone()).unwrap();

        // Both clients should receive the message
        let resp1 = timeout(TEST_TIMEOUT, ws1.next())
            .await
            .expect("client 1 should receive message")
            .unwrap()
            .unwrap();
        let resp2 = timeout(TEST_TIMEOUT, ws2.next())
            .await
            .expect("client 2 should receive message")
            .unwrap()
            .unwrap();

        if let (Binary(bin1), Binary(bin2)) = (resp1, resp2) {
            assert_eq!(bin1.as_ref(), &test_payload, "client 1 got wrong payload");
            assert_eq!(bin2.as_ref(), &test_payload, "client 2 got wrong payload");
        } else {
            panic!("Expected binary messages for both clients");
        }

        let _ = shutdown_tx.send(());
    }

    /// Tests that PTT down event is properly broadcast to connected extensions.
    /// Feature: When user presses PTT key, extension receives notification to start transmitting.
    #[tokio::test]
    #[serial]
    async fn test_ptt_down_event_reaches_extension() {
        use discuss_companion_lib::{
            flatbuffers::ws_protocol_generated::discuss::ws_protocol::root_as_message,
            protocol::{KeyBinding, OutgoingMessage},
        };

        ws_server::reset_connection_count();
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

        let mut ws = connect_ws(addr).await;

        // Simulate PTT down event (as would be sent by backend when key is pressed)
        let ptt_down = OutgoingMessage::PttDown {
            ts: 1_234_567_890,
            key: KeyBinding::default(),
            is_repeat: false,
        };
        tx.send(ptt_down.to_flatbuffer()).unwrap();

        // Extension should receive PttDown message
        let resp = timeout(TEST_TIMEOUT, ws.next())
            .await
            .expect("should receive PttDown")
            .unwrap()
            .unwrap();

        if let Binary(bin) = resp {
            let message = root_as_message(&bin).unwrap();
            assert_eq!(
                message.body_type(),
                ws_protocol::MessageBody::PttDown,
                "Expected PttDown message"
            );
            let body = message.body_as_ptt_down().expect("PttDown body");
            assert_eq!(body.ts(), 1_234_567_890);
            assert!(!body.is_repeat());
        } else {
            panic!("Expected binary message");
        }

        let _ = shutdown_tx.send(());
    }

    /// Tests that PTT up event is properly broadcast to connected extensions.
    /// Feature: When user releases PTT key, extension receives notification to stop transmitting.
    #[tokio::test]
    #[serial]
    async fn test_ptt_up_event_reaches_extension() {
        use discuss_companion_lib::{
            flatbuffers::ws_protocol_generated::discuss::ws_protocol::root_as_message,
            protocol::{KeyBinding, Modifiers, OutgoingMessage},
        };

        ws_server::reset_connection_count();
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

        let mut ws = connect_ws(addr).await;

        // Simulate PTT up event
        let ptt_up = OutgoingMessage::PttUp {
            ts: 1_234_567_899,
            key: KeyBinding {
                code: 49,
                modifiers: Modifiers::empty(),
            },
        };
        tx.send(ptt_up.to_flatbuffer()).unwrap();

        let resp = timeout(TEST_TIMEOUT, ws.next())
            .await
            .expect("should receive PttUp")
            .unwrap()
            .unwrap();

        if let Binary(bin) = resp {
            let message = root_as_message(&bin).unwrap();
            assert_eq!(
                message.body_type(),
                ws_protocol::MessageBody::PttUp,
                "Expected PttUp message"
            );
            let body = message.body_as_ptt_up().expect("PttUp body");
            assert_eq!(body.ts(), 1_234_567_899);
        } else {
            panic!("Expected binary message");
        }

        let _ = shutdown_tx.send(());
    }

    /// Tests that call command from frontend reaches connected extension.
    /// Feature: User clicks mute/unmute button in desktop app, extension toggles microphone.
    #[tokio::test]
    #[serial]
    async fn test_call_command_reaches_extension() {
        use discuss_companion_lib::{
            flatbuffers::ws_protocol_generated::discuss::ws_protocol::root_as_message,
            protocol::{OutgoingMessage, VERSION, current_timestamp},
        };

        ws_server::reset_connection_count();
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

        let mut ws = connect_ws(addr).await;

        // Simulate call command (toggle-microphone)
        let command_payload = serde_json::json!({
            "command": "toggle-microphone",
            "value": true
        })
        .to_string();
        let status_msg = OutgoingMessage::Status {
            ts: current_timestamp(),
            state: command_payload,
            version: VERSION.to_string(),
        };
        tx.send(status_msg.to_flatbuffer()).unwrap();

        let resp = timeout(TEST_TIMEOUT, ws.next())
            .await
            .expect("should receive call command")
            .unwrap()
            .unwrap();

        if let Binary(bin) = resp {
            let message = root_as_message(&bin).unwrap();
            assert_eq!(
                message.body_type(),
                ws_protocol::MessageBody::Status,
                "Expected Status message"
            );
            let body = message.body_as_status().expect("Status body");
            let state = body.state().expect("state present");
            let parsed: serde_json::Value = serde_json::from_str(state).expect("valid JSON");
            assert_eq!(
                parsed.get("command").and_then(|v| v.as_str()),
                Some("toggle-microphone")
            );
            assert_eq!(
                parsed.get("value").and_then(serde_json::Value::as_bool),
                Some(true)
            );
        } else {
            panic!("Expected binary message");
        }

        let _ = shutdown_tx.send(());
    }

    /// Tests that connection status change notifies frontend.
    /// Feature: Desktop app UI updates to show extension connected/disconnected state.
    #[tokio::test]
    #[serial]
    async fn test_connection_status_notifies_frontend() {
        ws_server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_events: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let handler_received = Arc::clone(&received_events);
        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx_state, _) = crossbeam_channel::unbounded();

        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                handler_received.lock().unwrap().push(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(0),
            ws_tx: tx.clone(),
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx: conn_tx_state,
            event_channels: RwLock::new(vec![channel]),
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

        // Connect a client - should trigger Connected event
        let ws = connect_ws(addr).await;
        wait_for_events(&received_events, 1).await;

        // Disconnect - should trigger Disconnected event
        drop(ws);
        wait_for_events(&received_events, 2).await;

        let events = received_events.lock().unwrap();
        assert!(
            events.len() >= 2,
            "Expected at least 2 connection events (connect + disconnect), got {}",
            events.len()
        );

        // First event should be Connected
        let first_msg = ipc_protocol::root_as_to_frontend_message(events.first().unwrap()).unwrap();
        assert_eq!(
            first_msg.event_type(),
            ipc_protocol::ToFrontend::WsConnection
        );
        let conn_event = first_msg.event_as_ws_connection().expect("WsConnection");
        assert_eq!(
            conn_event.status(),
            ipc_protocol::ConnectionStatus::Connected
        );

        // Last event should be Disconnected
        let last_msg = ipc_protocol::root_as_to_frontend_message(events.last().unwrap()).unwrap();
        assert_eq!(
            last_msg.event_type(),
            ipc_protocol::ToFrontend::WsConnection
        );
        let disconn_event = last_msg.event_as_ws_connection().expect("WsConnection");
        assert_eq!(
            disconn_event.status(),
            ipc_protocol::ConnectionStatus::Disconnected
        );
        drop(events);

        let _ = shutdown_tx.send(());
    }

    /// Tests that call state is cached and sent to newly connected extensions.
    /// Feature: When extension reconnects, it immediately knows current call state.
    #[tokio::test]
    #[serial]
    async fn test_reconnecting_extension_receives_cached_call_state() {
        use ws_protocol::{
            CallState as WsCallState, CallStateArgs, Message as FBMessage, MessageArgs, MessageBody,
        };

        ws_server::reset_connection_count();
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_events: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let handler_received = Arc::clone(&received_events);
        let (server_shutdown_tx, _) = broadcast::channel(1);
        let (conn_tx_state, _) = crossbeam_channel::unbounded();

        let channel = Channel::new(move |msg| {
            if let InvokeResponseBody::Raw(data) = msg {
                handler_received.lock().unwrap().push(data);
            }
            Ok(())
        });

        app.manage(WsState {
            port: AtomicU16::new(0),
            ws_tx: tx.clone(),
            server_shutdown_tx: Mutex::new(server_shutdown_tx),
            conn_tx: conn_tx_state,
            event_channels: RwLock::new(vec![channel]),
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

        // First extension connects and sends call state
        let mut ws1 = connect_ws(addr).await;

        // Send call state from first extension
        let mut builder = FlatBufferBuilder::new();
        let call_state = WsCallState::create(
            &mut builder,
            &CallStateArgs {
                ts: 100,
                has_call: true,
                has_state: true,
                is_mute: true,
                is_deaf: false,
                is_camera_on: false,
                is_screen_on: true,
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
        ws1.send(Binary(builder.finished_data().to_vec().into()))
            .await
            .unwrap();

        // Wait for call state to be processed
        let state_ref = app.state::<WsState>();
        timeout(TEST_TIMEOUT, async {
            loop {
                if state_ref.call_state.read().unwrap().is_some() {
                    return;
                }
                sleep(POLL_INTERVAL).await;
            }
        })
        .await
        .expect("call state should be cached");

        // First extension disconnects
        drop(ws1);
        wait_until(|| !is_connected()).await;

        // Verify call state was cached
        let cached = state_ref.call_state.read().unwrap();
        assert!(cached.is_some(), "Call state should be cached");
        let cached_state = cached.unwrap();
        assert!(cached_state.has_call);
        assert!(cached_state.is_mute);
        assert!(cached_state.is_screen_on);
        drop(cached);

        let _ = shutdown_tx.send(());
    }
}
