use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};

use futures_util::{SinkExt, StreamExt};
use tauri::Emitter;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info};

use crate::flatbuffers::protocol_generated::discuss::flatbuffers as protocol;
use crate::state::{IncomingMessage, KeyBinding, Modifier, OutgoingMessage, current_timestamp};

static CONNECTION_COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn is_connected() -> bool {
    CONNECTION_COUNT.load(Ordering::SeqCst) > 0
}

pub async fn start_ws_server<R: tauri::Runtime>(
    port: u16,
    tx: broadcast::Sender<Vec<u8>>,
    mut shutdown_rx: tokio::sync::broadcast::Receiver<()>,
    app_handle: tauri::AppHandle<R>,
    conn_tx: crossbeam_channel::Sender<bool>,
) {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            error!("Failed to bind WS server to {}: {}", addr, e);
            return;
        }
    };
    info!("WS server listening on: ws://{}", addr);

    let tx_clone = tx;
    let conn_tx_clone = conn_tx.clone();

    // Reset connection count on start
    CONNECTION_COUNT.store(0, Ordering::SeqCst);
    let _ = conn_tx.send(false);

    loop {
        tokio::select! {
            result = listener.accept() => {
                let (stream, addr) = match result {
                    Ok(res) => res,
                    Err(e) => {
                        error!("Error accepting connection: {}", e);
                        continue;
                    }
                };
                let tx = tx_clone.clone();
                let app_handle = app_handle.clone();
                let conn_tx = conn_tx_clone.clone();
                tokio::spawn(handle_connection(stream, addr, tx, app_handle, conn_tx));
            }
            _ = shutdown_rx.recv() => {
                info!("WS server shutting down");
                break;
            }
        }
    }
}

async fn handle_connection<R: tauri::Runtime>(
    stream: TcpStream,
    addr: SocketAddr,
    tx: broadcast::Sender<Vec<u8>>,
    app_handle: tauri::AppHandle<R>,
    conn_tx: crossbeam_channel::Sender<bool>,
) {
    let callback =
        |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
         response: tokio_tungstenite::tungstenite::handshake::server::Response| {
            info!("Received handshake request from: {:?}", addr);
            for (name, value) in request.headers() {
                info!("Header: {:?}: {:?}", name, value);
            }
            Ok(response)
        };

    let ws_stream = match tokio_tungstenite::accept_hdr_async(stream, callback).await {
        Ok(s) => s,
        Err(e) => {
            error!("Error during websocket handshake from {}: {}", addr, e);
            return;
        }
    };
    info!("New WebSocket connection from: {}", addr);
    if CONNECTION_COUNT.fetch_add(1, Ordering::SeqCst) == 0 {
        let _ = conn_tx.send(true);
    }
    let _ = app_handle.emit("ws-connection", format!("Connected: {addr}"));

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut rx = tx.subscribe();

    loop {
        tokio::select! {
            msg = rx.recv() => {
                if let Ok(msg) = msg
                    && let Err(e) = ws_sender.send(Message::Binary(msg.into())).await
                {
                    error!("Error sending message to {}: {}", addr, e);
                    break;
                }
            }
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Binary(bin))) => {
                        match protocol::root_as_message(&bin) {
                            Ok(message) => {
                                match message.body_type() {
                                    protocol::MessageBody::Ping => {
                                        let pong = OutgoingMessage::Pong { ts: current_timestamp() };
                                        let bin = pong.to_flatbuffer();
                                        if let Err(e) = ws_sender.send(Message::Binary(bin.into())).await {
                                            error!("Error sending pong to {}: {}", addr, e);
                                        }
                                    }
                                    protocol::MessageBody::SetBinding => {
                                        if let Some(binding_table) = message.body_as_set_binding()
                                            && let Some(key) = binding_table.binding()
                                        {
                                            let modifiers: Vec<Modifier> = key.modifiers().map(|m| m.iter().map(Modifier::from).collect()).unwrap_or_default();
                                            let binding = KeyBinding {
                                                code: key.code(),
                                                modifiers,
                                            };
                                            let incoming = IncomingMessage::SetBinding { binding };
                                            let _ = app_handle.emit("ws-message", &incoming);
                                        }
                                    }
                                    protocol::MessageBody::GetBinding => {
                                         let incoming = IncomingMessage::GetBinding;
                                         let _ = app_handle.emit("ws-message", &incoming);
                                    }
                                    protocol::MessageBody::Shutdown => {
                                         let incoming = IncomingMessage::Shutdown;
                                         let _ = app_handle.emit("ws-message", &incoming);
                                    }
                                    _ => {
                                        // Ignore other messages from client or unhandled types
                                    }
                                }
                            }
                            Err(e) => {
                                error!("Error converting to flatbuffer message from {}: {}", addr, e);
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("WebSocket connection closed: {}", addr);
                        if CONNECTION_COUNT.fetch_sub(1, Ordering::SeqCst) == 1 {
                             let _ = conn_tx.send(false);
                        }
                        let _ =
                            app_handle.emit("ws-disconnection", format!("Disconnected: {addr}"));
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[tokio::test]
    async fn test_is_connected_initial() {
        assert!(!is_connected());
    }

    use serial_test::serial;

    #[tokio::test]
    #[serial]
    async fn test_multiple_connections() {
        CONNECTION_COUNT.store(0, Ordering::SeqCst);

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

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Connect client 1
        let stream1 = TcpStream::connect(addr).await.unwrap();
        let (ws1, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}", port), stream1)
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(is_connected());

        // Connect client 2
        let stream2 = TcpStream::connect(addr).await.unwrap();
        let (ws2, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}", port), stream2)
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(is_connected());

        // Drop client 1
        drop(ws1);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(is_connected()); // Still connected via ws2

        // Drop client 2
        drop(ws2);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!is_connected());

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_broadcast_to_clients() {
        CONNECTION_COUNT.store(0, Ordering::SeqCst);
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

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut ws, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}", port), stream)
                .await
                .unwrap();

        // Send message to broadcast channel
        let test_payload = vec![1, 2, 3, 4];
        tx.send(test_payload.clone()).unwrap();

        // Verify client receives it
        let resp = ws.next().await.unwrap().unwrap();
        if let tokio_tungstenite::tungstenite::Message::Binary(bin) = resp {
            assert_eq!(bin.as_ref(), &test_payload);
        } else {
            panic!("Expected binary message");
        }

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_set_binding_message_handling() {
        use std::sync::{Arc, Mutex};
        use tauri::Listener;

        CONNECTION_COUNT.store(0, Ordering::SeqCst);
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_event = Arc::new(Mutex::new(None));
        let handler_received = Arc::clone(&received_event);
        app_handle.listen_any("ws-message", move |event| {
            let mut guard = handler_received.lock().unwrap();
            *guard = Some(event.payload().to_string());
        });

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let (conn_tx, _) = crossbeam_channel::unbounded();
        tokio::spawn(async move {
            start_ws_server(port, tx, shutdown_rx, app_handle, conn_tx).await;
        });

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut ws, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}", port), stream)
                .await
                .unwrap();

        use crate::flatbuffers::protocol_generated::discuss::flatbuffers::{
            KeyBindingArgs, Message as FBMessage, MessageArgs, MessageBody, SetBinding,
            SetBindingArgs,
        };
        let mut builder = flatbuffers::FlatBufferBuilder::new();
        let mods =
            vec![crate::flatbuffers::protocol_generated::discuss::flatbuffers::Modifier::Shift];
        let mods_vec = builder.create_vector(&mods);
        let key_binding =
            crate::flatbuffers::protocol_generated::discuss::flatbuffers::KeyBinding::create(
                &mut builder,
                &KeyBindingArgs {
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

        ws.send(tokio_tungstenite::tungstenite::Message::Binary(bin.into()))
            .await
            .unwrap();

        // Wait for event to be processed and emitted
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let event_payload = received_event.lock().unwrap();
        assert!(
            event_payload.is_some(),
            "Expected ws-message event to be emitted"
        );
        let payload = event_payload.as_ref().unwrap();
        assert!(payload.contains("\"code\":42"));
        assert!(payload.contains("\"modifiers\":[0]"));

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_shutdown_message_handling() {
        use std::sync::{Arc, Mutex};
        use tauri::Listener;

        CONNECTION_COUNT.store(0, Ordering::SeqCst);
        let (tx, _) = broadcast::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let app_handle = app.handle().clone();

        let received_event = Arc::new(Mutex::new(None));
        let handler_received = Arc::clone(&received_event);
        app_handle.listen_any("ws-message", move |event| {
            let mut guard = handler_received.lock().unwrap();
            *guard = Some(event.payload().to_string());
        });

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        drop(listener);

        let (conn_tx, _) = crossbeam_channel::unbounded();
        tokio::spawn(async move {
            start_ws_server(port, tx, shutdown_rx, app_handle, conn_tx).await;
        });

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut ws, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}", port), stream)
                .await
                .unwrap();

        // Construct Shutdown flatbuffer
        use crate::flatbuffers::protocol_generated::discuss::flatbuffers::{
            Message as FBMessage, MessageArgs, MessageBody, Shutdown, ShutdownArgs,
        };
        let mut builder = flatbuffers::FlatBufferBuilder::new();
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

        ws.send(tokio_tungstenite::tungstenite::Message::Binary(bin.into()))
            .await
            .unwrap();

        // Wait for event to be processed and emitted
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let event_payload = received_event.lock().unwrap();
        assert!(
            event_payload.is_some(),
            "Expected ws-message event to be emitted"
        );
        let payload = event_payload.as_ref().unwrap();
        assert!(payload.contains("\"type\":\"shutdown\""));

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    #[serial]
    async fn test_handshake_and_ping_pong() {
        CONNECTION_COUNT.store(0, Ordering::SeqCst);
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

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let stream = TcpStream::connect(addr).await.expect("Failed to connect");
        let (mut ws_stream, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}", port), stream)
                .await
                .expect("Failed to handshake");

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(is_connected());

        // Construct a Ping flatbuffer
        use crate::flatbuffers::protocol_generated::discuss::flatbuffers::{
            Message as FBMessage, MessageArgs, MessageBody, Ping, PingArgs,
        };
        let mut builder = flatbuffers::FlatBufferBuilder::new();
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

        ws_stream
            .send(tokio_tungstenite::tungstenite::Message::Binary(
                ping_bin.into(),
            ))
            .await
            .unwrap();

        // Wait for response
        let resp = ws_stream.next().await.unwrap().unwrap();
        if let tokio_tungstenite::tungstenite::Message::Binary(bin) = resp {
            let message = protocol::root_as_message(&bin).unwrap();
            assert_eq!(message.body_type(), protocol::MessageBody::Pong);
        } else {
            panic!("Expected binary message (Pong)");
        }

        let _ = shutdown_tx.send(());
    }
    #[tokio::test]
    #[serial]
    async fn test_restart_on_different_port() {
        CONNECTION_COUNT.store(0, Ordering::SeqCst);
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

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Verify connection to Port A
        let stream_1 = TcpStream::connect(addr_1)
            .await
            .expect("Failed to connect to Port A");
        let (ws_1, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}", port_1), stream_1)
                .await
                .expect("Failed to handshake Port A");
        assert!(is_connected());
        drop(ws_1); // Close client

        // Shutdown Port A
        shutdown_tx_1.send(()).unwrap();
        h1.await.unwrap(); // Wait for server to finish

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

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

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Verify connection to Port B
        let stream_2 = TcpStream::connect(addr_2)
            .await
            .expect("Failed to connect to Port B");
        let (_ws_2, _) =
            tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}", port_2), stream_2)
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
