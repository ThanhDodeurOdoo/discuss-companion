use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use tracing::warn;

use crate::flatbuffers::{
    ipc_protocol_generated::discuss::ipc_protocol, ws_protocol_generated::discuss::ws_protocol,
};

/// Namespace for the values that should be universal across all platforms
pub mod universal {
    /// Keyboard codes as used in the app, all platforms should map their key codes to these values
    pub mod keyboard {
        pub const KEY_ESCAPE: u16 = 53;

        pub const KEY_F1: u16 = 122;
        pub const KEY_F2: u16 = 120;
        pub const KEY_F3: u16 = 99;
        pub const KEY_F4: u16 = 118;
        pub const KEY_F5: u16 = 96;
        pub const KEY_F6: u16 = 97;
        pub const KEY_F7: u16 = 98;
        pub const KEY_F8: u16 = 100;
        pub const KEY_F9: u16 = 101;
        pub const KEY_F10: u16 = 109;
        pub const KEY_F11: u16 = 103;
        pub const KEY_F12: u16 = 111;
        /// ~ \`
        pub const KEY_GRAVE: u16 = 50;
        pub const KEY_1: u16 = 18;
        pub const KEY_2: u16 = 19;
        pub const KEY_3: u16 = 20;
        pub const KEY_4: u16 = 21;
        pub const KEY_5: u16 = 23;
        pub const KEY_6: u16 = 22;
        pub const KEY_7: u16 = 26;
        pub const KEY_8: u16 = 28;
        pub const KEY_9: u16 = 25;
        pub const KEY_0: u16 = 29;
        pub const KEY_MINUS: u16 = 27;
        pub const KEY_EQUAL: u16 = 24;
        pub const KEY_BACKSPACE: u16 = 51;

        pub const KEY_TAB: u16 = 48;
        pub const KEY_Q: u16 = 12;
        pub const KEY_W: u16 = 13;
        pub const KEY_E: u16 = 14;
        pub const KEY_R: u16 = 15;
        pub const KEY_T: u16 = 17;
        pub const KEY_Y: u16 = 16;
        pub const KEY_U: u16 = 32;
        pub const KEY_I: u16 = 34;
        pub const KEY_O: u16 = 31;
        pub const KEY_P: u16 = 35;
        /// [{
        pub const KEY_LEFT_BRACKET: u16 = 33;
        /// ]}
        pub const KEY_RIGHT_BRACKET: u16 = 30;
        pub const KEY_RETURN: u16 = 36;

        pub const KEY_A: u16 = 0;
        pub const KEY_S: u16 = 1;
        pub const KEY_D: u16 = 2;
        pub const KEY_F: u16 = 3;
        pub const KEY_G: u16 = 5;
        pub const KEY_H: u16 = 4;
        pub const KEY_J: u16 = 38;
        pub const KEY_K: u16 = 40;
        pub const KEY_L: u16 = 37;
        /// ;:
        pub const KEY_SEMICOLON: u16 = 41;
        /// '"
        pub const KEY_QUOTE: u16 = 39;
        /// \|
        pub const KEY_BACKSLASH: u16 = 42;

        pub const KEY_SHIFT: u16 = 56;
        pub const KEY_Z: u16 = 6;
        pub const KEY_X: u16 = 7;
        pub const KEY_C: u16 = 8;
        pub const KEY_V: u16 = 9;
        pub const KEY_B: u16 = 11;
        pub const KEY_N: u16 = 45;
        pub const KEY_M: u16 = 46;
        /// ,<
        pub const KEY_COMMA: u16 = 43;
        /// .>
        pub const KEY_PERIOD: u16 = 47;
        /// /?
        pub const KEY_SLASH: u16 = 44;

        pub const KEY_CONTROL: u16 = 59;
        pub const KEY_ALT: u16 = 58;
        pub const KEY_SPACE: u16 = 49;
        pub const KEY_META: u16 = 55;

        pub const KEY_UP: u16 = 126;
        pub const KEY_DOWN: u16 = 125;
        pub const KEY_LEFT: u16 = 123;
        pub const KEY_RIGHT: u16 = 124;

        pub const KEY_KEYPAD_0: u16 = 82;
        pub const KEY_KEYPAD_1: u16 = 83;
        pub const KEY_KEYPAD_2: u16 = 84;
        pub const KEY_KEYPAD_3: u16 = 85;
        pub const KEY_KEYPAD_4: u16 = 86;
        pub const KEY_KEYPAD_5: u16 = 87;
        pub const KEY_KEYPAD_6: u16 = 88;
        pub const KEY_KEYPAD_7: u16 = 89;
        pub const KEY_KEYPAD_8: u16 = 91;
        pub const KEY_KEYPAD_9: u16 = 92;
        /// .
        pub const KEY_KEYPAD_DECIMAL: u16 = 65;
        /// *
        pub const KEY_KEYPAD_MULTIPLY: u16 = 67;
        /// +
        pub const KEY_KEYPAD_ADD: u16 = 69;
        /// -
        pub const KEY_KEYPAD_SUBTRACT: u16 = 78;
        /// /
        pub const KEY_KEYPAD_DIVIDE: u16 = 75;
    }
}

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
            code: universal::keyboard::KEY_SPACE,
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
    /// Enables the full Push-to-Talk capability in the companion.
    ///
    /// This controls whether the frontend PTT UI is visible, whether the backend starts
    /// global keyboard capture, and whether PTT key down/up events are emitted through
    /// IPC/WS for call mute state synchronization. If false, PTT behavior is disabled.
    pub ptt: bool,
    /// Enables native call controls integration from the system tray or dock area.
    ///
    /// When true, the backend exposes platform-specific call actions (mute, deafen,
    /// camera, and screen-share toggles) driven by live call state in native menus.
    /// When false, call controls remain available only in the app UI.
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

#[cfg(target_os = "windows")]
pub const FEATURES: Features = Features {
    ptt: true,
    call_controls_tray: false,
};

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
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
