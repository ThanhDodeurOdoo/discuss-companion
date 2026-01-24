use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tauri::Emitter;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info};

pub async fn start_ws_server(
    port: u16,
    tx: broadcast::Sender<String>,
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

    // Spawn a task to handle the actual broadcasting of PTT events from the channel
    // This is a placeholder for where events from the event_tap will come.

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
    tx: broadcast::Sender<String>,
    app_handle: tauri::AppHandle,
) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(s) => s,
        Err(e) => {
            error!("Error during websocket handshake: {}", e);
            return;
        }
    };
    info!("New WebSocket connection from: {}", addr);
    let _ = app_handle.emit("ws-connection", format!("Connected: {addr}"));

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut rx = tx.subscribe();

    loop {
        tokio::select! {
            msg = rx.recv() => {
                if let Ok(msg) = msg {
                    if let Err(e) = ws_sender.send(Message::Text(msg.into())).await {
                        error!("Error sending message to {}: {}", addr, e);
                        break;
                    }
                }
            }
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        use crate::state::{IncomingMessage, OutgoingMessage, current_timestamp};
                        if let Ok(incoming) = serde_json::from_str::<IncomingMessage>(&text) {
                            if let IncomingMessage::Ping = incoming {
                                let pong = OutgoingMessage::Pong { ts: current_timestamp() };
                                if let Ok(json) = serde_json::to_string(&pong) {
                                    if let Err(e) = ws_sender.send(Message::Text(json.into())).await {
                                        error!("Error sending pong to {}: {}", addr, e);
                                    }
                                }
                            } else {
                                info!("Received command from {}: {:?}", addr, incoming);
                                let _ = app_handle.emit("ws-message", &incoming);
                            }
                        } else {
                            info!("Received non-JSON message from {}: {}", addr, text);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("WebSocket connection closed: {}", addr);
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
