use crate::state::{KeyBinding, OutgoingMessage};
use anyhow::{anyhow, Result};
use crossbeam_channel::Sender;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tracing::warn;

pub fn set_binding(_binding: KeyBinding) {
    warn!("set_binding not implemented for Linux");
}

pub fn set_recording(_recording: bool) {
    warn!("set_recording not implemented for Linux");
}

pub fn get_binding() -> KeyBinding {
    KeyBinding::default()
}

pub fn force_ptt_up() {
    warn!("force_ptt_up not implemented for Linux");
}

pub fn check_accessibility_permission() -> bool {
    true // Not applicable/always granted for now
}

pub fn start_engine(_sender: Sender<OutgoingMessage>, shutdown: &Arc<AtomicBool>) -> Result<()> {
    warn!("start_engine not implemented for Linux. Waiting for shutdown.");
    while !shutdown.load(std::sync::atomic::Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(())
}
