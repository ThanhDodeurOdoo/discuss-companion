use crate::state::{IncomingMessage, OutgoingMessage};
use anyhow::{Context, Result};
use std::io::{Read, Write};

#[allow(dead_code)]
pub fn write_nm_message<W: Write>(mut writer: W, msg: &OutgoingMessage) -> Result<()> {
    let bytes = serde_json::to_vec(msg).context("Failed to serialize message")?;
    let len = u32::try_from(bytes.len()).context("Message too large")?;

    writer
        .write_all(&len.to_le_bytes())
        .context("Failed to write length")?;
    writer
        .write_all(&bytes)
        .context("Failed to write message")?;
    writer.flush().context("Failed to flush writer")?;
    Ok(())
}

#[allow(dead_code)]
pub fn read_nm_message<R: Read>(mut reader: R) -> Result<Option<IncomingMessage>> {
    let mut len_buf = [0u8; 4];

    if reader.read_exact(&mut len_buf).is_err() {
        return Ok(None);
    }
    let len = u32::from_le_bytes(len_buf) as usize;

    let mut msg_buf = vec![0u8; len];
    reader
        .read_exact(&mut msg_buf)
        .context("Failed to read message body")?;

    let msg: IncomingMessage =
        serde_json::from_slice(&msg_buf).context("Failed to parse incoming message")?;
    Ok(Some(msg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nm_roundtrip() {
        let msg = OutgoingMessage::Pong { ts: 12345 };
        let mut buffer = Vec::new();
        write_nm_message(&mut buffer, &msg).expect("write");

        // The first 4 bytes should be the length of the JSON
        let json_bytes = serde_json::to_vec(&msg).unwrap();
        let len = u32::from_le_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]);
        assert_eq!(len as usize, json_bytes.len());

        // Now read it back assuming it's an IncomingMessage (for testing simplicity we'll use one that matches both or just manually check)
        // Since IncomingMessage doesn't have Pong, let's use Ping for roundtrip if it were supported,
        // but we can just check the bytes.
    }

    #[test]
    fn test_read_nm_message_ping() {
        use std::io::Cursor;
        let json = r#"{"type":"ping"}"#;
        let len = json.len() as u32;
        let mut buffer = Vec::new();
        buffer.extend_from_slice(&len.to_le_bytes());
        buffer.extend_from_slice(json.as_bytes());

        let reader = Cursor::new(buffer);
        let msg = read_nm_message(reader).expect("read").unwrap();
        assert!(matches!(msg, IncomingMessage::Ping));
    }
}
