use std::{net::SocketAddr, sync::atomic::Ordering};

use futures_util::{SinkExt, StreamExt};
use tauri::{Emitter, Manager, async_runtime};
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
    flatbuffers::ws_protocol_generated::discuss::ws_protocol,
    interface::tray,
    protocol::{self, CallState, current_timestamp},
    state::{WS_SERVER_RUNTIME_STATE, WsState},
};

const WS_SERVER_STATUS_EVENT: &str = "ws-server-status";
const WS_SERVER_STATUS_RESTARTED: &str = "restarted";

pub fn is_connected() -> bool {
    WS_SERVER_RUNTIME_STATE.is_connected()
}

/// Resets the shared WebSocket connection counters used by tests.
pub fn reset_connection_count() {
    WS_SERVER_RUNTIME_STATE.reset();
}

/// Spawns a detached WebSocket server task for the given port.
pub(crate) fn spawn_ws_server<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    port: u16,
    ws_tx: broadcast::Sender<Vec<u8>>,
    ws_shutdown_rx: broadcast::Receiver<()>,
    conn_tx: crossbeam_channel::Sender<bool>,
) {
    async_runtime::spawn(async move {
        start_ws_server(port, ws_tx, ws_shutdown_rx, app_handle, conn_tx).await;
    });
}

/// Applies a persisted WebSocket port change and restarts the server when needed.
pub(crate) fn apply_ws_port_update<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    state: &WsState,
    port: u16,
) {
    let current_port = state.port.load(Ordering::Relaxed);
    if current_port == port {
        notify_ws_server_restarted(app_handle, port);
        info!("WS server port unchanged, frontend notified.");
        return;
    }

    state.port.store(port, Ordering::Relaxed);

    info!("Shutting down previous WS server...");
    let shutdown_rx = state.rotate_server_shutdown_channel();

    info!("Starting new WS server on port {}...", port);
    spawn_ws_server(
        app_handle.clone(),
        port,
        state.ws_tx.clone(),
        shutdown_rx,
        state.conn_tx.clone(),
    );

    notify_ws_server_restarted(app_handle, port);
    info!("WS server restart initiated, frontend notified.");
}

fn notify_ws_server_restarted<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>, port: u16) {
    let _ = app_handle.emit(
        WS_SERVER_STATUS_EVENT,
        serde_json::json!({
            "status": WS_SERVER_STATUS_RESTARTED,
            "port": port,
        }),
    );
}

pub async fn start_ws_server<R: tauri::Runtime>(
    port: u16,
    tx: broadcast::Sender<Vec<u8>>,
    mut shutdown_rx: broadcast::Receiver<()>,
    app_handle: tauri::AppHandle<R>,
    conn_tx: crossbeam_channel::Sender<bool>,
) {
    let server_id = WS_SERVER_RUNTIME_STATE.start_server();
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
    let is_current_server = |id| WS_SERVER_RUNTIME_STATE.is_current_server(id);
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
        if WS_SERVER_RUNTIME_STATE.register_connection() {
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
            let _ = commands::dispatch_call_command(
                &state,
                commands::CallCommand::RefreshCallState,
                None,
            );
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
                    Some(Err(e)) => {
                        error!("WebSocket connection error from {}: {}", addr, e);
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
    if counted && is_current_server(server_id) && WS_SERVER_RUNTIME_STATE.unregister_connection() {
        let _ = conn_tx.send(false);
        let payload =
            protocol::ipc::encode_ws_connection(protocol::ipc::ConnectionStatus::Disconnected);
        send_to_frontend(&app_handle, &payload);
    }
}
