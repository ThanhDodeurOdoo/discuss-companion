// SAFETY: requires unsafe code for macOS Core Graphics FFI calls.
// The CGEventTap API is inherently unsafe as it involves C callbacks and raw pointers.

use crate::platform::PttEngine;
use crate::state::{current_timestamp, KeyBinding, OutgoingMessage, PttState};
use anyhow::{anyhow, Result};
use core_foundation::base::TCFType;
use core_foundation::mach_port::CFMachPortRef;
use core_foundation::runloop::{
    kCFRunLoopCommonModes, CFRunLoop, CFRunLoopAddSource, CFRunLoopSourceRef,
};
use core_graphics::event::{CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement};
use crossbeam_channel::Sender;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;
use tracing::{error, info};

type CGEventRef = *mut c_void;
type CGEventTapProxy = *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef,
        user_info: *mut c_void,
    ) -> CFMachPortRef;

    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CGEventRef) -> u64;

    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CFMachPortRef,
        order: i64,
    ) -> CFRunLoopSourceRef;
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrustedWithOptions(options: core_foundation::dictionary::CFDictionaryRef) -> u8;
}

const K_CG_EVENT_KEY_DOWN: u32 = 10;
const K_CG_EVENT_KEY_UP: u32 = 11;

const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
const K_CG_KEYBOARD_EVENT_AUTOREPEAT: u32 = 8;

const K_CG_EVENT_FLAG_MASK_SHIFT: u64 = 0x0002_0000;
const K_CG_EVENT_FLAG_MASK_CONTROL: u64 = 0x0004_0000;
const K_CG_EVENT_FLAG_MASK_ALTERNATE: u64 = 0x0008_0000; // Option/Alt
const K_CG_EVENT_FLAG_MASK_COMMAND: u64 = 0x0010_0000;

static HELD: AtomicBool = AtomicBool::new(false);
static TARGET_KEYCODE: AtomicU16 = AtomicU16::new(49); // Default: Space
static IS_RECORDING: AtomicBool = AtomicBool::new(false);

static EVENT_SENDER: OnceLock<Sender<OutgoingMessage>> = OnceLock::new();
static CURRENT_BINDING: OnceLock<RwLock<KeyBinding>> = OnceLock::new();

pub struct MacosEngine;

impl PttEngine for MacosEngine {
    fn set_binding(&self, binding: KeyBinding) {
        TARGET_KEYCODE.store(binding.code, Ordering::SeqCst);
        let lock = CURRENT_BINDING.get_or_init(|| RwLock::new(KeyBinding::default()));
        if let Ok(mut guard) = lock.write() {
            *guard = binding;
        }
    }

    fn set_recording(&self, recording: bool) {
        IS_RECORDING.store(recording, Ordering::SeqCst);
    }

    fn get_binding(&self) -> KeyBinding {
        CURRENT_BINDING
            .get_or_init(|| RwLock::new(KeyBinding::default()))
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    fn force_ptt_up(&self) {
        info!("Forcing PTT UP (Safety Release)");
        set_ptt_held(false);
        PRIMARY_KEY_HELD.store(false, Ordering::SeqCst);

        let binding = self.get_binding();
        let ts = current_timestamp();
        send_event(OutgoingMessage::PttUp { ts, key: binding });
    }

    fn check_accessibility_permission(&self) -> bool {
        use core_foundation::boolean::CFBoolean;
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::CFString;

        // SAFETY: Interacting with macOS ApplicationServices to check/request accessibility logs.
        #[allow(unsafe_code)]
        unsafe {
            // The actual key string for kAXTrustedCheckOptionPrompt
            let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
            let value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0
        }
    }

    fn start_engine(
        &self,
        sender: Sender<OutgoingMessage>,
        shutdown: &Arc<AtomicBool>,
    ) -> Result<()> {
        EVENT_SENDER
            .set(sender)
            .map_err(|_| anyhow!("Event sender already initialized"))?;

        // We also want to listen for flags changed to update modifiers if needed,
        let event_mask: u64 =
            (1 << K_CG_EVENT_KEY_DOWN) | (1 << K_CG_EVENT_KEY_UP) | (1 << K_CG_EVENT_FLAGS_CHANGED);

        // SAFETY: CGEventTapCreate is safe when we provide a valid callback and handle NULL return
        #[allow(unsafe_code)]
        let tap: CFMachPortRef = unsafe {
            CGEventTapCreate(
                CGEventTapLocation::AnnotatedSession as u32,
                CGEventTapPlacement::HeadInsertEventTap as u32,
                CGEventTapOptions::ListenOnly as u32,
                event_mask,
                event_callback,
                ptr::null_mut(),
            )
        };

        if tap.is_null() {
            return Err(anyhow!(
                "Failed to create event tap. Accessibility permission may be missing. \
                 Grant permission in System Settings → Privacy & Security → Accessibility."
            ));
        }

        // SAFETY: CFMachPortCreateRunLoopSource requires a valid CFMachPort
        #[allow(unsafe_code)]
        let source: CFRunLoopSourceRef =
            unsafe { CFMachPortCreateRunLoopSource(ptr::null(), tap, 0) };

        if source.is_null() {
            return Err(anyhow!("Failed to create run loop source"));
        }

        let run_loop = CFRunLoop::get_current();

        // SAFETY: Adding a valid source to the run loop with a valid extern static
        #[allow(unsafe_code)]
        unsafe {
            CFRunLoopAddSource(
                run_loop.as_concrete_TypeRef(),
                source,
                kCFRunLoopCommonModes,
            );
        }

        info!("Event tap started, listening for PTT key events");

        while !shutdown.load(Ordering::SeqCst) {
            // SAFETY: kCFRunLoopDefaultMode is a valid extern static
            #[allow(unsafe_code)]
            let mode = unsafe { core_foundation::runloop::kCFRunLoopDefaultMode };
            CFRunLoop::run_in_mode(mode, Duration::from_millis(100), false);
        }

        info!("Event tap stopped");
        Ok(())
    }
}

pub fn get_engine() -> &'static dyn PttEngine {
    static ENGINE: MacosEngine = MacosEngine;
    &ENGINE
}

fn get_ptt_state() -> PttState {
    if HELD.load(Ordering::SeqCst) {
        PttState::Held
    } else {
        PttState::Idle
    }
}

fn set_ptt_held(held: bool) {
    HELD.store(held, Ordering::SeqCst);
}

fn send_event(msg: OutgoingMessage) {
    if let Some(sender) = EVENT_SENDER.get() {
        if let Err(e) = sender.send(msg) {
            error!("Failed to send event: {}", e);
        }
    }
}

const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;

static PRIMARY_KEY_HELD: AtomicBool = AtomicBool::new(false);

extern "C" fn event_callback(
    _proxy: CGEventTapProxy,
    event_type: u32,
    event: CGEventRef,
    _user_info: *mut c_void,
) -> CGEventRef {
    // SAFETY: CGEventGetIntegerValueField is safe with a valid event pointer.
    // Key codes are always small positive integers (0-127), so truncation is intentional.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    #[allow(unsafe_code)]
    let keycode = unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16 };

    // SAFETY: CGEventGetFlags is safe with a valid event pointer.
    #[allow(unsafe_code)]
    let flags = unsafe { CGEventGetFlags(event) };
    let modifiers = get_modifiers_from_flags(flags);

    let target_code = TARGET_KEYCODE.load(Ordering::SeqCst);
    let recording = IS_RECORDING.load(Ordering::SeqCst);
    let mut is_repeat = false;

    // Track primary key state
    if event_type == K_CG_EVENT_KEY_DOWN {
        if keycode == target_code {
            PRIMARY_KEY_HELD.store(true, Ordering::SeqCst);
        }
        // SAFETY: Reading autorepeat field from valid event
        #[allow(unsafe_code)]
        unsafe {
            is_repeat = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_AUTOREPEAT) != 0;
        }
    } else if event_type == K_CG_EVENT_KEY_UP && keycode == target_code {
        PRIMARY_KEY_HELD.store(false, Ordering::SeqCst);
    }

    let primary_held = PRIMARY_KEY_HELD.load(Ordering::SeqCst);
    let current_ptt_state = get_ptt_state();
    let engine = get_engine();
    let binding = engine.get_binding();
    let ts = current_timestamp();

    if recording {
        // Simple recording logic: just capture whatever keydown happens
        if event_type == K_CG_EVENT_KEY_DOWN {
            info!(
                "PTT down matched (recording): keycode={} modifiers={:?}",
                keycode, modifiers
            );
            send_event(OutgoingMessage::PttDown {
                ts,
                key: KeyBinding {
                    code: keycode,
                    modifiers,
                },
                is_repeat,
            });
        }
        return event;
    }

    // Check if we should be active based on current state
    let mut binding_mods = binding.modifiers.clone();
    let mut current_mods = modifiers.clone();
    binding_mods.sort();
    current_mods.sort();

    let modifiers_match = binding_mods == current_mods;
    let should_be_active = primary_held && modifiers_match;

    match current_ptt_state {
        PttState::Idle => {
            if should_be_active {
                info!(
                    "PTT ACTIVATED: keycode={} modifiers={:?}",
                    keycode, modifiers
                );
                set_ptt_held(true);
                send_event(OutgoingMessage::PttDown {
                    ts,
                    key: binding,
                    is_repeat: false,
                });
            }
        }
        PttState::Held => {
            if !should_be_active {
                info!(
                    "PTT DEACTIVATED: keycode={} modifiers={:?}",
                    keycode, modifiers
                );
                set_ptt_held(false);
                send_event(OutgoingMessage::PttUp { ts, key: binding });
            } else if is_repeat && event_type == K_CG_EVENT_KEY_DOWN {
                // Keepalive for Odoo (it un-mutes on every PTT event)
                send_event(OutgoingMessage::PttDown {
                    ts,
                    key: binding,
                    is_repeat: true,
                });
            }
        }
    }

    event
}

fn get_modifiers_from_flags(flags: u64) -> Vec<String> {
    let mut mods = Vec::new();

    if (flags & K_CG_EVENT_FLAG_MASK_SHIFT) != 0 {
        mods.push("shift".to_string());
    }
    if (flags & K_CG_EVENT_FLAG_MASK_CONTROL) != 0 {
        mods.push("ctrl".to_string());
    }
    if (flags & K_CG_EVENT_FLAG_MASK_ALTERNATE) != 0 {
        mods.push("alt".to_string());
    }
    if (flags & K_CG_EVENT_FLAG_MASK_COMMAND) != 0 {
        mods.push("meta".to_string());
    }

    mods
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_binding_storage() {
        let engine = MacosEngine;
        let binding = KeyBinding {
            code: 123,
            modifiers: vec!["cmd".to_string()],
        };
        engine.set_binding(binding.clone());
        let stored = engine.get_binding();
        assert_eq!(stored.code, 123);
        assert_eq!(stored.modifiers, vec!["cmd".to_string()]);
    }

    #[test]
    fn test_recording_toggle() {
        let engine = MacosEngine;
        engine.set_recording(true);
        assert!(IS_RECORDING.load(Ordering::SeqCst));
        engine.set_recording(false);
        assert!(!IS_RECORDING.load(Ordering::SeqCst));
    }

    #[test]
    fn test_get_modifiers_from_flags() {
        let flags = K_CG_EVENT_FLAG_MASK_SHIFT | K_CG_EVENT_FLAG_MASK_COMMAND;
        let mods = get_modifiers_from_flags(flags);
        assert_eq!(mods.len(), 2);
        assert!(mods.contains(&"shift".to_string()));
        assert!(mods.contains(&"meta".to_string()));

        let flags = K_CG_EVENT_FLAG_MASK_CONTROL | K_CG_EVENT_FLAG_MASK_ALTERNATE;
        let mods = get_modifiers_from_flags(flags);
        assert_eq!(mods.len(), 2);
        assert!(mods.contains(&"ctrl".to_string()));
        assert!(mods.contains(&"alt".to_string()));
    }
}
