use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use tracing::warn;

use crate::flatbuffers::{
    ipc_protocol_generated::discuss::ipc_protocol, ws_protocol_generated::discuss::ws_protocol,
};

/// macOS virtual keycode for the Space key.
/// Used as the default PTT binding.
pub const KEYCODE_SPACE: u16 = 49;

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
    #[allow(
        clippy::match_same_arms,
        reason = "shift is a valid default for unknown variants"
    )]
    fn from(m: ws_protocol::Modifier) -> Self {
        match m {
            ws_protocol::Modifier::Shift => Self::Shift,
            ws_protocol::Modifier::Control => Self::Control,
            ws_protocol::Modifier::Alt => Self::Alt,
            ws_protocol::Modifier::Meta => Self::Meta,
            other => {
                warn!(
                    "Unknown ws_protocol::Modifier variant {:?}, defaulting to Shift",
                    other
                );
                Self::Shift
            }
        }
    }
}

impl From<ipc_protocol::Modifier> for Modifier {
    #[allow(
        clippy::match_same_arms,
        reason = "shift is a valid default for unknown variants"
    )]
    fn from(m: ipc_protocol::Modifier) -> Self {
        match m {
            ipc_protocol::Modifier::Shift => Self::Shift,
            ipc_protocol::Modifier::Control => Self::Control,
            ipc_protocol::Modifier::Alt => Self::Alt,
            ipc_protocol::Modifier::Meta => Self::Meta,
            other => {
                warn!(
                    "Unknown ipc_protocol::Modifier variant {:?}, defaulting to Shift",
                    other
                );
                Self::Shift
            }
        }
    }
}

impl From<Modifier> for ipc_protocol::Modifier {
    fn from(m: Modifier) -> Self {
        match m {
            Modifier::Shift => Self::Shift,
            Modifier::Control => Self::Control,
            Modifier::Alt => Self::Alt,
            Modifier::Meta => Self::Meta,
        }
    }
}

/// A compact, stack-allocated set of keyboard modifiers.
///
/// Internally uses a bitmask (`u8`) to avoid heap allocations while supporting
/// up to 4 modifiers. Serializes as an array of `Modifier` for JSON compatibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Modifiers(u8);

impl Modifiers {
    const SHIFT_BIT: u8 = 1 << 0;
    const CONTROL_BIT: u8 = 1 << 1;
    const ALT_BIT: u8 = 1 << 2;
    const META_BIT: u8 = 1 << 3;

    #[must_use]
    pub const fn empty() -> Self {
        Self(0)
    }

    #[must_use]
    pub const fn from_bits(bits: u8) -> Self {
        Self(bits)
    }

    #[must_use]
    pub const fn bits(self) -> u8 {
        self.0
    }

    #[must_use]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    #[must_use]
    pub const fn contains(self, m: Modifier) -> bool {
        (self.0 & Self::bit_for(m)) != 0
    }

    pub fn insert(&mut self, m: Modifier) {
        self.0 |= Self::bit_for(m);
    }

    pub fn iter(self) -> impl Iterator<Item = Modifier> {
        [
            Modifier::Shift,
            Modifier::Control,
            Modifier::Alt,
            Modifier::Meta,
        ]
        .into_iter()
        .filter(move |&m| self.contains(m))
    }

    const fn bit_for(m: Modifier) -> u8 {
        match m {
            Modifier::Shift => Self::SHIFT_BIT,
            Modifier::Control => Self::CONTROL_BIT,
            Modifier::Alt => Self::ALT_BIT,
            Modifier::Meta => Self::META_BIT,
        }
    }
}

impl FromIterator<Modifier> for Modifiers {
    fn from_iter<T: IntoIterator<Item = Modifier>>(iter: T) -> Self {
        let mut mods = Self::empty();
        for m in iter {
            mods.insert(m);
        }
        mods
    }
}

impl Serialize for Modifiers {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeSeq;
        let items: Vec<Modifier> = self.iter().collect();
        let mut seq = serializer.serialize_seq(Some(items.len()))?;
        for m in items {
            seq.serialize_element(&m)?;
        }
        seq.end()
    }
}

impl<'de> Deserialize<'de> for Modifiers {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let items: Vec<Modifier> = Vec::deserialize(deserializer)?;
        Ok(items.into_iter().collect())
    }
}

impl<'a> From<ipc_protocol::PttBinding<'a>> for KeyBinding {
    fn from(binding: ipc_protocol::PttBinding<'a>) -> Self {
        Self {
            code: binding.code(),
            modifiers: binding
                .modifiers()
                .map(|mods| mods.iter().map(Modifier::from).collect())
                .unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyBinding {
    pub code: u16,
    pub modifiers: Modifiers,
}

impl Default for KeyBinding {
    fn default() -> Self {
        Self {
            code: KEYCODE_SPACE,
            modifiers: Modifiers::empty(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PttState {
    #[default]
    Idle,
    Held,
}

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AppVisibilityMode {
    #[default]
    TrayAndDockWhenWindowOpen,
    TrayAndDockAlways,
    DockOnly,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    pub ptt: bool,
    pub call_controls_tray: bool,
}

#[cfg(target_os = "macos")]
pub const FEATURES: Features = Features {
    ptt: true,
    call_controls_tray: true,
};

#[cfg(all(target_os = "linux", feature = "x11"))]
pub const FEATURES: Features = Features {
    ptt: true,
    call_controls_tray: false,
};

#[cfg(all(target_os = "linux", not(feature = "x11")))]
pub const FEATURES: Features = Features {
    ptt: false,
    call_controls_tray: false,
};

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub const FEATURES: Features = Features {
    ptt: false,
    call_controls_tray: false,
};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ptt_state_default() {
        assert_eq!(PttState::default(), PttState::Idle);
    }

    #[test]
    fn test_features_serde_roundtrip() {
        let json = serde_json::to_string(&FEATURES).expect("serialize features");
        let decoded: Features = serde_json::from_str(&json).expect("deserialize features");
        assert_eq!(decoded, FEATURES);
    }

    #[test]
    fn test_app_visibility_mode_serde_roundtrip() {
        let json = serde_json::to_string(&AppVisibilityMode::DockOnly)
            .expect("serialize app visibility mode");
        let decoded: AppVisibilityMode =
            serde_json::from_str(&json).expect("deserialize app visibility mode");
        assert_eq!(decoded, AppVisibilityMode::DockOnly);
    }
}
