use crate::state::{IncomingMessage, OutgoingMessage};
use anyhow::{Context, Result};
use std::io::{Read, Write};

#[allow(dead_code)]
pub fn write_nm_message(msg: &OutgoingMessage) -> Result<()> {
    let mut stdout = std::io::stdout().lock();
    let bytes = serde_json::to_vec(msg).context("Failed to serialize message")?;
    let len = u32::try_from(bytes.len()).context("Message too large")?;

    stdout
        .write_all(&len.to_le_bytes())
        .context("Failed to write length")?;
    stdout
        .write_all(&bytes)
        .context("Failed to write message")?;
    stdout.flush().context("Failed to flush stdout")?;
    Ok(())
}

#[allow(dead_code)]
pub fn read_nm_message() -> Result<Option<IncomingMessage>> {
    let mut stdin = std::io::stdin().lock();
    let mut len_buf = [0u8; 4];

    if stdin.read_exact(&mut len_buf).is_err() {
        return Ok(None);
    }
    let len = u32::from_le_bytes(len_buf) as usize;

    let mut msg_buf = vec![0u8; len];
    stdin
        .read_exact(&mut msg_buf)
        .context("Failed to read message body")?;

    let msg: IncomingMessage =
        serde_json::from_slice(&msg_buf).context("Failed to parse incoming message")?;
    Ok(Some(msg))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::KeyBinding;

    #[test]
    fn test_outgoing_message_serialization() {
        let msg = OutgoingMessage::PttDown {
            ts: 1234567890,
            key: KeyBinding::default(),
            is_repeat: false,
        };
        let json = serde_json::to_string(&msg).expect("serialize");
        assert!(json.contains("\"type\":\"ptt_down\""));
        assert!(json.contains("\"ts\":1234567890"));
    }

    #[test]
    fn test_incoming_message_deserialization() {
        let json = r#"{"type":"ping"}"#;
        let msg: IncomingMessage = serde_json::from_str(json).expect("deserialize");
        assert!(matches!(msg, IncomingMessage::Ping));
    }
}
