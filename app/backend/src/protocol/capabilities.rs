use serde::{Deserialize, Serialize};

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
