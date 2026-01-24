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
