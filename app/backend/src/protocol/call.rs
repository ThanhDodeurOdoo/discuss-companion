use serde::{Deserialize, Serialize};

use crate::flatbuffers::ws_protocol_generated::discuss::ws_protocol;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "Call state mirrors the WS/IPC schema for cross-process sync."
)]
pub struct CallState {
    pub has_call: bool,
    pub has_state: bool,
    pub is_mute: bool,
    pub is_deaf: bool,
    pub is_camera_on: bool,
    pub is_screen_on: bool,
}

impl From<ws_protocol::CallState<'_>> for CallState {
    fn from(state: ws_protocol::CallState<'_>) -> Self {
        Self {
            has_call: state.has_call(),
            has_state: state.has_state(),
            is_mute: state.is_mute(),
            is_deaf: state.is_deaf(),
            is_camera_on: state.is_camera_on(),
            is_screen_on: state.is_screen_on(),
        }
    }
}
