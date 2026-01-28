use std::time::SystemTime;

use flatbuffers::FlatBufferBuilder;
use serde::de::Error;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::flatbuffers::ws_protocol_generated::discuss::ws_protocol;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Modifier {
    Shift = 0,
    Control = 1,
    Alt = 2,
    Meta = 3,
}

impl Serialize for Modifier {
    #[allow(
        clippy::as_conversions,
        reason = "Modifier is repr(u8) and can be safely cast to u8 for serialization."
    )]
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
            _ => Err(Error::custom(format!("Invalid modifier value: {v}"))),
        }
    }
}

impl From<Modifier> for ws_protocol::Modifier {
    fn from(m: Modifier) -> Self {
        match m {
            Modifier::Shift => Self::Shift,
            Modifier::Control => Self::Control,
            Modifier::Alt => Self::Alt,
            Modifier::Meta => Self::Meta,
        }
    }
}

impl From<ws_protocol::Modifier> for Modifier {
    #[allow(clippy::match_same_arms, reason = "shift is a valid default")]
    fn from(m: ws_protocol::Modifier) -> Self {
        match m {
            ws_protocol::Modifier::Shift => Self::Shift,
            ws_protocol::Modifier::Control => Self::Control,
            ws_protocol::Modifier::Alt => Self::Alt,
            ws_protocol::Modifier::Meta => Self::Meta,
            _ => Self::Shift,
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
    pub fn to_flatbuffer(&self) -> Vec<u8> {
        let mut builder = FlatBufferBuilder::new();
        let message_offset = match self {
            OutgoingMessage::PttDown { ts, key, is_repeat } => {
                let modifiers: Vec<ws_protocol::Modifier> =
                    key.modifiers.iter().map(|&m| m.into()).collect();
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
                    key.modifiers.iter().map(|&m| m.into()).collect();
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
                    binding.modifiers.iter().map(|&m| m.into()).collect();
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
            ts: 123_456_789,
            key: KeyBinding {
                code: 1,
                modifiers: vec![Modifier::Shift],
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
                modifiers: vec![Modifier::Control, Modifier::Alt],
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
