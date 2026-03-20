use std::sync::{Arc, atomic::AtomicBool};

use anyhow::Result;
use crossbeam_channel::Sender;
use serde::Serialize;

use crate::protocol::KeyBinding;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PttEvent {
    #[serde(rename_all = "snake_case")]
    PttDown {
        ts: u64,
        key: KeyBinding,
        is_repeat: bool,
    },
    #[serde(rename_all = "snake_case")]
    PttUp { ts: u64, key: KeyBinding },
    #[serde(rename_all = "snake_case")]
    CapturedBinding { ts: u64, key: KeyBinding },
}

#[cfg(all(target_os = "linux", feature = "x11"))]
mod linux_x11;
#[cfg(all(target_os = "linux", not(feature = "x11")))]
mod linux_xdg;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// The `PttEngine` trait defines the interface for platform-specific
/// Push-to-Talk engines. Each platform (macOS, Linux, etc.) must
/// implement this trait to handle global key event capturing.
pub trait PttEngine: Send + Sync {
    /// Update the active key binding that triggers the PTT state.
    fn set_binding(&self, binding: KeyBinding);

    /// Toggle recording mode. In recording mode, the engine should
    /// capture and relay all key down events to the provided sender
    /// without processing them as PTT triggers.
    fn set_recording(&self, recording: bool);

    /// Returns the current active key binding.
    fn get_binding(&self) -> KeyBinding;

    /// Safety mechanism to force the PTT state to "Up" (released).
    /// This should be called when the app is quitting or in case of emergency.
    fn force_ptt_up(&self);

    /// Checks if the application has the necessary OS-level permissions
    /// to capture global keyboard events.
    fn check_accessibility_permission(&self) -> bool;

    /// Starts the main event monitoring loop. This call typically blocks
    /// or runs a run-loop indefinitely until the `shutdown` flag is set.
    ///
    /// # Errors
    /// Returns an error if the engine fails to initialize (e.g., missing permissions).
    fn start_engine(&self, sender: Sender<PttEvent>, shutdown: &Arc<AtomicBool>) -> Result<()>;
}

#[cfg(target_os = "macos")]
pub type Engine = macos::MacosEngine;

#[cfg(all(target_os = "linux", feature = "x11"))]
pub type Engine = linux_x11::LinuxX11Engine;

#[cfg(all(target_os = "linux", not(feature = "x11")))]
pub type Engine = linux_xdg::LinuxXdgEngine;

#[cfg(target_os = "windows")]
pub type Engine = windows::WindowsEngine;

/// Returns a reference to the global `PttEngine` implementation for the current platform.
#[must_use]
pub fn get_engine() -> &'static Engine {
    #[cfg(target_os = "macos")]
    return macos::get_engine();

    #[cfg(all(target_os = "linux", feature = "x11"))]
    return linux_x11::get_engine();

    #[cfg(all(target_os = "linux", not(feature = "x11")))]
    return linux_xdg::get_engine();

    #[cfg(target_os = "windows")]
    return windows::get_engine();
}

// Shorthand functions for convenience, delegating to the global engine.

pub fn set_binding(binding: KeyBinding) {
    get_engine().set_binding(binding);
}

pub fn set_recording(recording: bool) {
    get_engine().set_recording(recording);
}

#[must_use]
pub fn get_binding() -> KeyBinding {
    get_engine().get_binding()
}

pub fn force_ptt_up() {
    get_engine().force_ptt_up();
}

#[must_use]
pub fn check_accessibility_permission() -> bool {
    get_engine().check_accessibility_permission()
}

/// # Errors
/// Returns an error if the engine fails to initialize.
pub fn start_engine(sender: Sender<PttEvent>, shutdown: &Arc<AtomicBool>) -> Result<()> {
    get_engine().start_engine(sender, shutdown)
}
