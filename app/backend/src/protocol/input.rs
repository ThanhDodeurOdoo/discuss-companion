use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use tracing::warn;

use super::keyboard;
use crate::flatbuffers::ipc_protocol_generated::discuss::ipc_protocol;

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
    const VALID_BITS: u8 = Self::SHIFT_BIT | Self::CONTROL_BIT | Self::ALT_BIT | Self::META_BIT;

    #[must_use]
    pub const fn empty() -> Self {
        Self(0)
    }

    #[must_use]
    pub const fn from_bits(bits: u8) -> Self {
        Self(bits & Self::VALID_BITS)
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
            code: keyboard::KEY_SPACE,
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

#[cfg(test)]
mod tests {
    use super::{Modifier, Modifiers};

    #[test]
    fn from_bits_masks_unsupported_bits() {
        let modifiers = Modifiers::from_bits(0xFF);
        assert!(modifiers.contains(Modifier::Shift));
        assert!(modifiers.contains(Modifier::Control));
        assert!(modifiers.contains(Modifier::Alt));
        assert!(modifiers.contains(Modifier::Meta));
        assert_eq!(modifiers.bits(), 0b1111);
    }
}
