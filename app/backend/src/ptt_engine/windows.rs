use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use anyhow::Result;
use crossbeam_channel::Sender;
use tracing::warn;

use crate::{
    protocol::{KeyBinding, OutgoingMessage},
    ptt_engine::PttEngine,
};

pub struct WindowsEngine;

impl PttEngine for WindowsEngine {
    fn set_binding(&self, _binding: KeyBinding) {
        warn!("set_binding not implemented for Windows");
    }

    fn set_recording(&self, _recording: bool) {
        warn!("set_recording not implemented for Windows");
    }

    fn get_binding(&self) -> KeyBinding {
        KeyBinding::default()
    }

    fn force_ptt_up(&self) {
        warn!("force_ptt_up not implemented for Windows");
    }

    fn check_accessibility_permission(&self) -> bool {
        true
    }

    fn start_engine(
        &self,
        _sender: Sender<OutgoingMessage>,
        shutdown: &Arc<AtomicBool>,
    ) -> Result<()> {
        warn!("start_engine not implemented for Windows. Waiting for shutdown.");
        while !shutdown.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    }
}

pub fn get_engine() -> &'static WindowsEngine {
    static ENGINE: WindowsEngine = WindowsEngine;
    &ENGINE
}
