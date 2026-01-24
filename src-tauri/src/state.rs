use crate::flatbuffers::protocol_generated::discuss::flatbuffers as protocol;
use flatbuffers::FlatBufferBuilder;
use serde::{Deserialize, Serialize};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyBinding {
    pub code: u16,
    pub modifiers: Vec<String>,
}

impl Default for KeyBinding {
    fn default() -> Self {
        Self {
            code: 49, // Space key
            modifiers: vec![],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PttState {
    #[default]
    Idle,
    Held,
}

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

/// JUSTIFICATION: `clippy::too_many_lines`
/// This function is a bit long,
/// but it's a simple match statement with no nested logic.
/// JUSTIFICATION: `clippy::use_self`
/// As the function is long, it's easier to read and understand
/// if we don't use self.
#[allow(clippy::use_self, clippy::too_many_lines)]
impl OutgoingMessage {
    pub fn to_flatbuffer(&self) -> Vec<u8> {
        let mut builder = FlatBufferBuilder::new();
        let message_offset = match self {
            OutgoingMessage::PttDown { ts, key, is_repeat } => {
                let modifiers: Vec<_> = key
                    .modifiers
                    .iter()
                    .map(|m| builder.create_string(m))
                    .collect();
                let modifiers_offset = builder.create_vector(&modifiers);
                let key_offset = protocol::KeyBinding::create(
                    &mut builder,
                    &protocol::KeyBindingArgs {
                        code: key.code,
                        modifiers: Some(modifiers_offset),
                    },
                );
                let body_offset = protocol::PttDown::create(
                    &mut builder,
                    &protocol::PttDownArgs {
                        ts: *ts,
                        key: Some(key_offset),
                        is_repeat: *is_repeat,
                    },
                );
                protocol::Message::create(
                    &mut builder,
                    &protocol::MessageArgs {
                        body_type: protocol::MessageBody::PttDown,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::PttUp { ts, key } => {
                let modifiers: Vec<_> = key
                    .modifiers
                    .iter()
                    .map(|m| builder.create_string(m))
                    .collect();
                let modifiers_offset = builder.create_vector(&modifiers);
                let key_offset = protocol::KeyBinding::create(
                    &mut builder,
                    &protocol::KeyBindingArgs {
                        code: key.code,
                        modifiers: Some(modifiers_offset),
                    },
                );
                let body_offset = protocol::PttUp::create(
                    &mut builder,
                    &protocol::PttUpArgs {
                        ts: *ts,
                        key: Some(key_offset),
                    },
                );
                protocol::Message::create(
                    &mut builder,
                    &protocol::MessageArgs {
                        body_type: protocol::MessageBody::PttUp,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::Status { ts, state, version } => {
                let state_offset = builder.create_string(state);
                let version_offset = builder.create_string(version);
                let body_offset = protocol::Status::create(
                    &mut builder,
                    &protocol::StatusArgs {
                        ts: *ts,
                        state: Some(state_offset),
                        version: Some(version_offset),
                    },
                );
                protocol::Message::create(
                    &mut builder,
                    &protocol::MessageArgs {
                        body_type: protocol::MessageBody::Status,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::Error { ts, message } => {
                let message_offset = builder.create_string(message);
                let body_offset = protocol::Error::create(
                    &mut builder,
                    &protocol::ErrorArgs {
                        ts: *ts,
                        message: Some(message_offset),
                    },
                );
                protocol::Message::create(
                    &mut builder,
                    &protocol::MessageArgs {
                        body_type: protocol::MessageBody::Error,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::BindingInfo { ts, binding } => {
                let modifiers: Vec<_> = binding
                    .modifiers
                    .iter()
                    .map(|m| builder.create_string(m))
                    .collect();
                let modifiers_offset = builder.create_vector(&modifiers);
                let key_offset = protocol::KeyBinding::create(
                    &mut builder,
                    &protocol::KeyBindingArgs {
                        code: binding.code,
                        modifiers: Some(modifiers_offset),
                    },
                );
                let body_offset = protocol::BindingInfo::create(
                    &mut builder,
                    &protocol::BindingInfoArgs {
                        ts: *ts,
                        binding: Some(key_offset),
                    },
                );
                protocol::Message::create(
                    &mut builder,
                    &protocol::MessageArgs {
                        body_type: protocol::MessageBody::BindingInfo,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
            OutgoingMessage::Pong { ts } => {
                let body_offset =
                    protocol::Pong::create(&mut builder, &protocol::PongArgs { ts: *ts });
                protocol::Message::create(
                    &mut builder,
                    &protocol::MessageArgs {
                        body_type: protocol::MessageBody::Pong,
                        body: Some(body_offset.as_union_value()),
                    },
                )
            }
        };
        builder.finish(message_offset, None);
        builder.finished_data().to_vec()
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    Ping,
    SetBinding { binding: KeyBinding },
    GetBinding,
    Shutdown,
}

pub fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_binding_default() {
        let binding = KeyBinding::default();
        assert_eq!(binding.code, 49);
        assert!(binding.modifiers.is_empty());
    }

    #[test]
    fn test_outgoing_message_serialization() {
        let msg = OutgoingMessage::Status {
            ts: 100,
            state: "idle".to_string(),
            version: "0.1.0".to_string(),
        };
        let json = serde_json::to_string(&msg).expect("Should serialize");
        assert!(json.contains("\"type\":\"status\""));
        assert!(json.contains("\"state\":\"idle\""));
    }

    #[test]
    fn test_incoming_message_deserialization() {
        let json = r#"{"type":"set_binding","binding":{"code":10,"modifiers":[]}}"#;
        let msg: IncomingMessage = serde_json::from_str(json).expect("Should deserialize");
        if let IncomingMessage::SetBinding { binding } = msg {
            assert_eq!(binding.code, 10);
        } else {
            panic!("Wrong message type");
        }
    }
}
