use std::time::SystemTime;

use flatbuffers::FlatBufferBuilder;
use serde::{Deserialize, Serialize};

use super::types::{CallState, KeyBinding, Modifiers};
use crate::flatbuffers::{
    ipc_protocol_generated::discuss::ipc_protocol, ws_protocol_generated::discuss::ws_protocol,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    #[serde(rename_all = "snake_case")]
    PttDown {
        ts: u64,
        key: KeyBinding,
        is_repeat: bool,
    },
    #[serde(rename_all = "snake_case")]
    PttUp {
        ts: u64,
        key: KeyBinding,
    },
    Status {
        ts: u64,
        state: String,
        version: String,
    },
    Error {
        ts: u64,
        message: String,
    },
    BindingInfo {
        ts: u64,
        binding: KeyBinding,
    },
    Pong {
        ts: u64,
    },
}

#[allow(
    clippy::use_self,
    clippy::too_many_lines,
    reason = "
        JUSTIFICATION: `clippy::too_many_lines`
        This function is a bit long,
        but it's a simple match statement with no nested logic.
        JUSTIFICATION: `clippy::use_self`
        As the function is long, it's easier to read and understand
        if we don't use self."
)]
impl OutgoingMessage {
    /// Serializes the message to a `FlatBuffer` binary format.
    ///
    /// Note: Creates a new `FlatBufferBuilder` on each call. Reusing builders
    /// via thread-local storage or pooling would add complexity for marginal
    /// gains.
    #[must_use]
    pub fn to_flatbuffer(&self) -> Vec<u8> {
        let mut builder = FlatBufferBuilder::new();
        let message_offset = match self {
            OutgoingMessage::PttDown { ts, key, is_repeat } => {
                let modifiers: Vec<ws_protocol::Modifier> =
                    key.modifiers.iter().map(Into::into).collect();
                let modifiers_offset = builder.create_vector(&modifiers);
                let key_offset = ws_protocol::KeyBinding::create(
                    &mut builder,
                    &ws_protocol::KeyBindingArgs {
                        code: key.code,
                        modifiers: Some(modifiers_offset),
                    },
                );
                let body_offset = ws_protocol::PttDown::create(
                    &mut builder,
                    &ws_protocol::PttDownArgs {
                        ts: *ts,
                        key: Some(key_offset),
                        is_repeat: *is_repeat,
                    },
                );
                ws_protocol::Message::create(
                    &mut builder,
                    &ws_protocol::MessageArgs {
                        body_type: ws_protocol::MessageBody::PttDown,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::PttUp { ts, key } => {
                let modifiers: Vec<ws_protocol::Modifier> =
                    key.modifiers.iter().map(Into::into).collect();
                let modifiers_offset = builder.create_vector(&modifiers);
                let key_offset = ws_protocol::KeyBinding::create(
                    &mut builder,
                    &ws_protocol::KeyBindingArgs {
                        code: key.code,
                        modifiers: Some(modifiers_offset),
                    },
                );
                let body_offset = ws_protocol::PttUp::create(
                    &mut builder,
                    &ws_protocol::PttUpArgs {
                        ts: *ts,
                        key: Some(key_offset),
                    },
                );
                ws_protocol::Message::create(
                    &mut builder,
                    &ws_protocol::MessageArgs {
                        body_type: ws_protocol::MessageBody::PttUp,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::Status { ts, state, version } => {
                let state_offset = builder.create_string(state);
                let version_offset = builder.create_string(version);
                let body_offset = ws_protocol::Status::create(
                    &mut builder,
                    &ws_protocol::StatusArgs {
                        ts: *ts,
                        state: Some(state_offset),
                        version: Some(version_offset),
                    },
                );
                ws_protocol::Message::create(
                    &mut builder,
                    &ws_protocol::MessageArgs {
                        body_type: ws_protocol::MessageBody::Status,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::Error { ts, message } => {
                let message_offset = builder.create_string(message);
                let body_offset = ws_protocol::Error::create(
                    &mut builder,
                    &ws_protocol::ErrorArgs {
                        ts: *ts,
                        message: Some(message_offset),
                    },
                );
                ws_protocol::Message::create(
                    &mut builder,
                    &ws_protocol::MessageArgs {
                        body_type: ws_protocol::MessageBody::Error,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::BindingInfo { ts, binding } => {
                let modifiers: Vec<ws_protocol::Modifier> =
                    binding.modifiers.iter().map(Into::into).collect();
                let modifiers_offset = builder.create_vector(&modifiers);
                let key_offset = ws_protocol::KeyBinding::create(
                    &mut builder,
                    &ws_protocol::KeyBindingArgs {
                        code: binding.code,
                        modifiers: Some(modifiers_offset),
                    },
                );
                let body_offset = ws_protocol::BindingInfo::create(
                    &mut builder,
                    &ws_protocol::BindingInfoArgs {
                        ts: *ts,
                        binding: Some(key_offset),
                    },
                );
                ws_protocol::Message::create(
                    &mut builder,
                    &ws_protocol::MessageArgs {
                        body_type: ws_protocol::MessageBody::BindingInfo,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::Pong { ts } => {
                let body_offset =
                    ws_protocol::Pong::create(&mut builder, &ws_protocol::PongArgs { ts: *ts });
                ws_protocol::Message::create(
                    &mut builder,
                    &ws_protocol::MessageArgs {
                        body_type: ws_protocol::MessageBody::Pong,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
        };
        builder.finish(message_offset, None);
        builder.finished_data().to_vec()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    SetBinding { binding: KeyBinding },
    GetBinding,
    Shutdown,
}

impl IncomingMessage {
    #[must_use]
    pub fn to_ipc_flatbuffer(&self) -> Vec<u8> {
        let mut builder = FlatBufferBuilder::new();
        let union_offset = match self {
            Self::SetBinding { binding } => {
                let modifiers: Vec<ipc_protocol::Modifier> =
                    binding.modifiers.iter().map(Into::into).collect();
                let modifiers_offset = builder.create_vector(&modifiers);
                let binding_offset = ipc_protocol::PttBinding::create(
                    &mut builder,
                    &ipc_protocol::PttBindingArgs {
                        code: binding.code,
                        modifiers: Some(modifiers_offset),
                    },
                );
                let incoming_offset = ipc_protocol::IncomingSetBinding::create(
                    &mut builder,
                    &ipc_protocol::IncomingSetBindingArgs {
                        binding: Some(binding_offset),
                    },
                );
                incoming_offset.as_union_value()
            }
            Self::GetBinding => {
                let incoming_offset = ipc_protocol::IncomingGetBinding::create(
                    &mut builder,
                    &ipc_protocol::IncomingGetBindingArgs {},
                );
                incoming_offset.as_union_value()
            }
            Self::Shutdown => {
                let incoming_offset = ipc_protocol::IncomingShutdown::create(
                    &mut builder,
                    &ipc_protocol::IncomingShutdownArgs {},
                );
                incoming_offset.as_union_value()
            }
        };

        let message_type = match self {
            Self::SetBinding { .. } => ipc_protocol::IncomingMessageUnion::IncomingSetBinding,
            Self::GetBinding => ipc_protocol::IncomingMessageUnion::IncomingGetBinding,
            Self::Shutdown => ipc_protocol::IncomingMessageUnion::IncomingShutdown,
        };

        let ws_message_offset = ipc_protocol::WsMessageEvent::create(
            &mut builder,
            &ipc_protocol::WsMessageEventArgs {
                message_type,
                message: Some(union_offset),
            },
        );

        let event_offset = ipc_protocol::ToFrontendMessage::create(
            &mut builder,
            &ipc_protocol::ToFrontendMessageArgs {
                event_type: ipc_protocol::ToFrontend::WsMessageEvent,
                event: Some(ws_message_offset.as_union_value()),
            },
        );

        builder.finish(event_offset, None);
        builder.finished_data().to_vec()
    }
}

#[must_use]
pub fn encode_ws_connection(status: ipc_protocol::ConnectionStatus) -> Vec<u8> {
    let mut builder = FlatBufferBuilder::new();

    let connection_offset = ipc_protocol::WsConnection::create(
        &mut builder,
        &ipc_protocol::WsConnectionArgs { status },
    );

    let event_offset = ipc_protocol::ToFrontendMessage::create(
        &mut builder,
        &ipc_protocol::ToFrontendMessageArgs {
            event_type: ipc_protocol::ToFrontend::WsConnection,
            event: Some(connection_offset.as_union_value()),
        },
    );

    builder.finish(event_offset, None);
    builder.finished_data().to_vec()
}

#[must_use]
pub fn encode_call_state(state: &CallState) -> Vec<u8> {
    let mut builder = FlatBufferBuilder::new();

    let call_state_offset = ipc_protocol::CallState::create(
        &mut builder,
        &ipc_protocol::CallStateArgs {
            has_call: state.has_call,
            has_state: state.has_state,
            is_mute: state.is_mute,
            is_deaf: state.is_deaf,
            is_camera_on: state.is_camera_on,
            is_screen_on: state.is_screen_on,
        },
    );

    let event_offset = ipc_protocol::ToFrontendMessage::create(
        &mut builder,
        &ipc_protocol::ToFrontendMessageArgs {
            event_type: ipc_protocol::ToFrontend::CallState,
            event: Some(call_state_offset.as_union_value()),
        },
    );

    builder.finish(event_offset, None);
    builder.finished_data().to_vec()
}

#[must_use]
pub fn encode_ptt_state(
    is_active: bool,
    code: u16,
    modifiers: Modifiers,
    is_repeat: bool,
) -> Vec<u8> {
    let mut builder = flatbuffers::FlatBufferBuilder::new();

    let modifiers_vec: Vec<ipc_protocol::Modifier> = modifiers.iter().map(Into::into).collect();
    let modifiers_offset = builder.create_vector(&modifiers_vec);

    let ptt_state_offset = ipc_protocol::PttState::create(
        &mut builder,
        &ipc_protocol::PttStateArgs {
            is_active,
            code,
            modifiers: Some(modifiers_offset),
            is_repeat,
        },
    );

    let message_offset = ipc_protocol::ToFrontendMessage::create(
        &mut builder,
        &ipc_protocol::ToFrontendMessageArgs {
            event_type: ipc_protocol::ToFrontend::PttState,
            event: Some(ptt_state_offset.as_union_value()),
        },
    );

    builder.finish(message_offset, None);
    builder.finished_data().to_vec()
}

#[must_use]
pub fn encode_backend_error(message: &str) -> Vec<u8> {
    let mut builder = FlatBufferBuilder::new();
    let message_offset = builder.create_string(message);

    let error_offset = ipc_protocol::BackendError::create(
        &mut builder,
        &ipc_protocol::BackendErrorArgs {
            message: Some(message_offset),
        },
    );

    let event_offset = ipc_protocol::ToFrontendMessage::create(
        &mut builder,
        &ipc_protocol::ToFrontendMessageArgs {
            event_type: ipc_protocol::ToFrontend::BackendError,
            event: Some(error_offset.as_union_value()),
        },
    );

    builder.finish(event_offset, None);
    builder.finished_data().to_vec()
}

#[must_use]
pub fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::types::Modifier;

    #[test]
    fn test_current_timestamp() {
        let ts = current_timestamp();
        assert!(ts > 0);
    }

    #[test]
    fn test_ptt_down_flatbuffer() {
        let msg = OutgoingMessage::PttDown {
            ts: 123_456_789,
            key: KeyBinding {
                code: 1,
                modifiers: [Modifier::Shift].into_iter().collect(),
            },
            is_repeat: true,
        };
        let bin = msg.to_flatbuffer();
        let decoded = ws_protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), ws_protocol::MessageBody::PttDown);
        let body = decoded.body_as_ptt_down().expect("Body is PttDown");
        assert_eq!(body.ts(), 123_456_789);
        assert!(body.is_repeat());
        let key = body.key().expect("Key present");
        assert_eq!(key.code(), 1);
        let mods = key.modifiers().expect("Modifiers present");
        assert_eq!(mods.len(), 1);
        assert_eq!(mods.get(0), ws_protocol::Modifier::Shift);
    }

    #[test]
    fn test_ptt_up_flatbuffer() {
        let msg = OutgoingMessage::PttUp {
            ts: 987_654_321,
            key: KeyBinding::default(),
        };
        let bin = msg.to_flatbuffer();
        let decoded = ws_protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), ws_protocol::MessageBody::PttUp);
        let body = decoded.body_as_ptt_up().expect("Body is PttUp");
        assert_eq!(body.ts(), 987_654_321);
    }

    #[test]
    fn test_status_flatbuffer() {
        let msg = OutgoingMessage::Status {
            ts: 111,
            state: "active".to_string(),
            version: "1.2.3".to_string(),
        };
        let bin = msg.to_flatbuffer();
        let decoded = ws_protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), ws_protocol::MessageBody::Status);
        let body = decoded.body_as_status().expect("Body is Status");
        assert_eq!(body.ts(), 111);
        assert_eq!(body.state(), Some("active"));
        assert_eq!(body.version(), Some("1.2.3"));
    }

    #[test]
    fn test_binding_info_flatbuffer() {
        let msg = OutgoingMessage::BindingInfo {
            ts: 222,
            binding: KeyBinding {
                code: 56,
                modifiers: [Modifier::Control, Modifier::Alt].into_iter().collect(),
            },
        };
        let bin = msg.to_flatbuffer();
        let decoded = ws_protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), ws_protocol::MessageBody::BindingInfo);
        let body = decoded.body_as_binding_info().expect("Body is BindingInfo");
        assert_eq!(body.ts(), 222);
        let key = body.binding().expect("Binding present");
        assert_eq!(key.code(), 56);
        let mods = key.modifiers().expect("Modifiers present");
        assert_eq!(mods.len(), 2);
    }

    #[test]
    fn test_pong_flatbuffer() {
        let msg = OutgoingMessage::Pong { ts: 333 };
        let bin = msg.to_flatbuffer();
        let decoded = ws_protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), ws_protocol::MessageBody::Pong);
        let body = decoded.body_as_pong().expect("Body is Pong");
        assert_eq!(body.ts(), 333);
    }

    #[test]
    fn test_error_flatbuffer() {
        let msg = OutgoingMessage::Error {
            ts: 444,
            message: "Something went wrong".to_string(),
        };
        let bin = msg.to_flatbuffer();
        let decoded = ws_protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), ws_protocol::MessageBody::Error);
        let body = decoded.body_as_error().expect("Body is Error");
        assert_eq!(body.ts(), 444);
        assert_eq!(body.message(), Some("Something went wrong"));
    }
}
