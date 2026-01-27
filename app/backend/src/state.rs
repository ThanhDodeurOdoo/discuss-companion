use std::time::SystemTime;

use flatbuffers::FlatBufferBuilder;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::flatbuffers::protocol_generated::discuss::flatbuffers as protocol;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Modifier {
    Shift = 0,
    Control = 1,
    Alt = 2,
    Meta = 3,
}

impl Serialize for Modifier {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

impl<'de> Deserialize<'de> for Modifier {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let v = u8::deserialize(deserializer)?;
        match v {
            0 => Ok(Self::Shift),
            1 => Ok(Self::Control),
            2 => Ok(Self::Alt),
            3 => Ok(Self::Meta),
            _ => Err(serde::de::Error::custom(format!(
                "Invalid modifier value: {v}"
            ))),
        }
    }
}

impl From<Modifier> for protocol::Modifier {
    fn from(m: Modifier) -> Self {
        match m {
            Modifier::Shift => Self::Shift,
            Modifier::Control => Self::Control,
            Modifier::Alt => Self::Alt,
            Modifier::Meta => Self::Meta,
        }
    }
}

impl From<protocol::Modifier> for Modifier {
    #[allow(clippy::match_same_arms)]
    fn from(m: protocol::Modifier) -> Self {
        match m {
            protocol::Modifier::Shift => Self::Shift,
            protocol::Modifier::Control => Self::Control,
            protocol::Modifier::Alt => Self::Alt,
            protocol::Modifier::Meta => Self::Meta,
            _ => Self::Shift, // Fallback, though shouldn't happen with valid data
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyBinding {
    pub code: u16,
    pub modifiers: Vec<Modifier>,
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
                let modifiers: Vec<protocol::Modifier> =
                    key.modifiers.iter().map(|&m| m.into()).collect();
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
                let modifiers: Vec<protocol::Modifier> =
                    key.modifiers.iter().map(|&m| m.into()).collect();
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
                let modifiers: Vec<protocol::Modifier> =
                    binding.modifiers.iter().map(|&m| m.into()).collect();
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
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
    fn test_ptt_state_default() {
        assert_eq!(PttState::default(), PttState::Idle);
    }

    #[test]
    fn test_current_timestamp() {
        let ts = current_timestamp();
        assert!(ts > 0);
    }

    #[test]
    fn test_ptt_down_flatbuffer() {
        let msg = OutgoingMessage::PttDown {
            ts: 123456789,
            key: KeyBinding {
                code: 1,
                modifiers: vec![Modifier::Shift],
            },
            is_repeat: true,
        };
        let bin = msg.to_flatbuffer();
        let decoded = protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), protocol::MessageBody::PttDown);
        let body = decoded.body_as_ptt_down().expect("Body is PttDown");
        assert_eq!(body.ts(), 123456789);
        assert_eq!(body.is_repeat(), true);
        let key = body.key().expect("Key present");
        assert_eq!(key.code(), 1);
        let mods = key.modifiers().expect("Modifiers present");
        assert_eq!(mods.len(), 1);
        assert_eq!(mods.get(0), protocol::Modifier::Shift);
    }

    #[test]
    fn test_ptt_up_flatbuffer() {
        let msg = OutgoingMessage::PttUp {
            ts: 987654321,
            key: KeyBinding::default(),
        };
        let bin = msg.to_flatbuffer();
        let decoded = protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), protocol::MessageBody::PttUp);
        let body = decoded.body_as_ptt_up().expect("Body is PttUp");
        assert_eq!(body.ts(), 987654321);
    }

    #[test]
    fn test_status_flatbuffer() {
        let msg = OutgoingMessage::Status {
            ts: 111,
            state: "active".to_string(),
            version: "1.2.3".to_string(),
        };
        let bin = msg.to_flatbuffer();
        let decoded = protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), protocol::MessageBody::Status);
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
                modifiers: vec![Modifier::Control, Modifier::Alt],
            },
        };
        let bin = msg.to_flatbuffer();
        let decoded = protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), protocol::MessageBody::BindingInfo);
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
        let decoded = protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), protocol::MessageBody::Pong);
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
        let decoded = protocol::root_as_message(&bin).expect("Valid flatbuffer");
        assert_eq!(decoded.body_type(), protocol::MessageBody::Error);
        let body = decoded.body_as_error().expect("Body is Error");
        assert_eq!(body.ts(), 444);
        assert_eq!(body.message(), Some("Something went wrong"));
    }
}
