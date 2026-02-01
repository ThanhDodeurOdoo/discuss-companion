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
    platform::PttEngine,
    state::{KeyBinding, OutgoingMessage},
};

pub struct LinuxEngine;

impl PttEngine for LinuxEngine {
    fn set_binding(&self, _binding: KeyBinding) {
        warn!("set_binding not implemented for Linux");
    }

    fn set_recording(&self, _recording: bool) {
        warn!("set_recording not implemented for Linux");
    }

    fn get_binding(&self) -> KeyBinding {
        KeyBinding::default()
    }

    fn force_ptt_up(&self) {
        warn!("force_ptt_up not implemented for Linux");
    }

    fn check_accessibility_permission(&self) -> bool {
        true // Not applicable/always granted for now
    }

    fn start_engine(
        &self,
        _sender: Sender<OutgoingMessage>,
        shutdown: &Arc<AtomicBool>,
    ) -> Result<()> {
        warn!("start_engine not implemented for Linux. Waiting for shutdown.");
        while !shutdown.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    }
}

pub fn get_engine() -> &'static LinuxEngine {
    static ENGINE: LinuxEngine = LinuxEngine;
    &ENGINE
}
