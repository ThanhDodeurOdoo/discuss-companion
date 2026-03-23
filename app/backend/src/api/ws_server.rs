use std::{
    net::SocketAddr,
    sync::atomic::{AtomicU64, AtomicUsize, Ordering},
};

use futures_util::{SinkExt, StreamExt};
use tauri::Manager;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::broadcast,
};
use tokio_tungstenite::tungstenite::{Message, handshake};
use tracing::{error, info};

use super::commands;
#[cfg(target_os = "macos")]
use crate::interface::dock_menu;
use crate::{
    WsState,
    flatbuffers::ws_protocol_generated::discuss::ws_protocol,
    interface::tray,
    protocol::{self, CallState, current_timestamp},
};

static CONNECTION_COUNT: AtomicUsize = AtomicUsize::new(0);
static CURRENT_SERVER_ID: AtomicU64 = AtomicU64::new(0);
const REFRESH_CALL_STATE_COMMAND: &str = "refresh-call-state";

pub fn is_connected() -> bool {
    CONNECTION_COUNT.load(Ordering::Acquire) > 0
}

// Helper for testing
pub fn reset_connection_count() {
    CONNECTION_COUNT.store(0, Ordering::Release);
    CURRENT_SERVER_ID.store(0, Ordering::Release);
}

pub async fn start_ws_server<R: tauri::Runtime>(
    port: u16,
    tx: broadcast::Sender<Vec<u8>>,
    mut shutdown_rx: broadcast::Receiver<()>,
    app_handle: tauri::AppHandle<R>,
    conn_tx: crossbeam_channel::Sender<bool>,
) {
    let server_id = CURRENT_SERVER_ID.fetch_add(1, Ordering::AcqRel) + 1;
    CONNECTION_COUNT.store(0, Ordering::Release);
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
                let shutdown_rx = shutdown_rx.resubscribe();
                tokio::spawn(handle_connection(stream, addr, tx, app_handle, conn_tx, shutdown_rx, server_id));
            }
            _ = shutdown_rx.recv() => {
                info!("WS server shutting down");
                break;
            }
        }
    }
}

fn send_to_frontend<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>, bin: &[u8]) {
    // We use try_state because this might be called during shutdown or tests where state is gone
    if let Some(state) = app_handle.try_state::<WsState>() {
        state.broadcast(bin);
    }
}

#[allow(
    clippy::too_many_lines,
    clippy::cognitive_complexity,
    reason = "WebSocket loop handles multiple message types and connection states."
)]
async fn handle_connection<R: tauri::Runtime>(
    stream: TcpStream,
    addr: SocketAddr,
    tx: broadcast::Sender<Vec<u8>>,
    app_handle: tauri::AppHandle<R>,
    conn_tx: crossbeam_channel::Sender<bool>,
    mut shutdown_rx: broadcast::Receiver<()>,
    server_id: u64,
) {
    let is_current_server = |id| CURRENT_SERVER_ID.load(Ordering::Acquire) == id;
    let callback = |request: &handshake::server::Request, response: handshake::server::Response| {
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
    let counted = if is_current_server(server_id) {
        if CONNECTION_COUNT.fetch_add(1, Ordering::AcqRel) == 0 {
            let _ = conn_tx.send(true);
        }
        true
    } else {
        false
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut rx = tx.subscribe();

    if is_current_server(server_id) {
        let payload =
            protocol::ipc::encode_ws_connection(protocol::ipc::ConnectionStatus::Connected);
        send_to_frontend(&app_handle, &payload);
        if let Some(state) = app_handle.try_state::<WsState>() {
            let _ = commands::dispatch_call_command(&state, REFRESH_CALL_STATE_COMMAND, None);
        }
    }

    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                let _ = ws_sender.send(Message::Close(None)).await;
                break;
            }
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
                        match ws_protocol::root_as_message(&bin) {
                            Ok(message) => {
                                match message.body_type() {
                                    ws_protocol::MessageBody::Ping => {
                                        let pong =
                                            protocol::ws::OutgoingMessage::Pong { ts: current_timestamp() };
                                        let bin = pong.to_flatbuffer();
                                        if let Err(e) = ws_sender.send(Message::Binary(bin.into())).await {
                                            error!("Error sending pong to {}: {}", addr, e);
                                        }
                                    }
                                    ws_protocol::MessageBody::Shutdown => {
                                        if is_current_server(server_id) {
                                            let payload = protocol::ipc::encode_ws_shutdown_event();
                                            send_to_frontend(&app_handle, &payload);
                                        }
                                    }
                                    ws_protocol::MessageBody::CallState => {
                                        if let Some(call_state) = message.body_as_call_state() {
                                            let state = CallState::from(call_state);
                                            if is_current_server(server_id) {
                                                if let Some(ws_state) =
                                                    app_handle.try_state::<WsState>()
                                                {
                                                    ws_state.set_call_state(Some(state));
                                                }
                                                let payload = protocol::ipc::encode_call_state(&state);
                                                send_to_frontend(&app_handle, &payload);
                                                let _ =
                                                    tray::update_tray_menu(&app_handle, Some(state));
                                                tray::set_call_state(&app_handle, Some(state));
                                                #[cfg(target_os = "macos")]
                                                let _ = dock_menu::update_dock_menu(&app_handle, Some(state));
                                            }
                                        }
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
                        break;
                    }
                    _ => {}
                }
            }
        }
        if !is_current_server(server_id) {
            break;
        }
    }
    if counted
        && is_current_server(server_id)
        && CONNECTION_COUNT.fetch_sub(1, Ordering::AcqRel) == 1
    {
        let _ = conn_tx.send(false);
        let payload =
            protocol::ipc::encode_ws_connection(protocol::ipc::ConnectionStatus::Disconnected);
        send_to_frontend(&app_handle, &payload);
    }
}
