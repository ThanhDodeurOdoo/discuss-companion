use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::Emitter;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info};

use crate::flatbuffers::protocol_generated::discuss::flatbuffers as protocol;
use crate::state::{current_timestamp, IncomingMessage, KeyBinding, OutgoingMessage};

static CONNECTION_COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn is_connected() -> bool {
    CONNECTION_COUNT.load(Ordering::SeqCst) > 0
}

pub async fn start_ws_server(
    port: u16,
    tx: broadcast::Sender<Vec<u8>>,
    mut shutdown_rx: tokio::sync::broadcast::Receiver<()>,
    app_handle: tauri::AppHandle,
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
                tokio::spawn(handle_connection(stream, addr, tx, app_handle));
            }
            _ = shutdown_rx.recv() => {
                info!("WS server shutting down");
                break;
            }
        }
    }
}

async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    tx: broadcast::Sender<Vec<u8>>,
    app_handle: tauri::AppHandle,
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
    CONNECTION_COUNT.fetch_add(1, Ordering::SeqCst);
    let _ = app_handle.emit("ws-connection", format!("Connected: {addr}"));

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut rx = tx.subscribe();

    loop {
        tokio::select! {
            msg = rx.recv() => {
                if let Ok(msg) = msg {
                    if let Err(e) = ws_sender.send(Message::Binary(msg.into())).await {
                        error!("Error sending message to {}: {}", addr, e);
                        break;
                    }
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
                                        if let Some(binding_table) = message.body_as_set_binding() {
                                            if let Some(key) = binding_table.binding() {
                                                let modifiers: Vec<String> = key.modifiers().map(|m| m.iter().map(ToString::to_string).collect()).unwrap_or_default();
                                                let binding = KeyBinding {
                                                    code: key.code(),
                                                    modifiers,
                                                };
                                                let incoming = IncomingMessage::SetBinding { binding };
                                                let _ = app_handle.emit("ws-message", &incoming);
                                            }
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
                        CONNECTION_COUNT.fetch_sub(1, Ordering::SeqCst);
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
