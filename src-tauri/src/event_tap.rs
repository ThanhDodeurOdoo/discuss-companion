// SAFETY: requires unsafe code for macOS Core Graphics FFI calls.
// The CGEventTap API is inherently unsafe as it involves C callbacks and raw pointers.

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
use tracing::{debug, error, info};

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

static HELD: AtomicBool = AtomicBool::new(false);
static TARGET_KEYCODE: AtomicU16 = AtomicU16::new(49); // Default: Space
static IS_RECORDING: AtomicBool = AtomicBool::new(false);

static EVENT_SENDER: OnceLock<Sender<OutgoingMessage>> = OnceLock::new();
static CURRENT_BINDING: OnceLock<RwLock<KeyBinding>> = OnceLock::new();

pub fn set_binding(binding: KeyBinding) {
    TARGET_KEYCODE.store(binding.code, Ordering::SeqCst);
    let lock = CURRENT_BINDING.get_or_init(|| RwLock::new(KeyBinding::default()));
    if let Ok(mut guard) = lock.write() {
        *guard = binding;
    }
}

pub fn set_recording(recording: bool) {
    IS_RECORDING.store(recording, Ordering::SeqCst);
}

pub fn get_binding() -> KeyBinding {
    CURRENT_BINDING
        .get_or_init(|| RwLock::new(KeyBinding::default()))
        .read()
        .map(|g| g.clone())
        .unwrap_or_default()
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
    let target = TARGET_KEYCODE.load(Ordering::SeqCst);
    let recording = IS_RECORDING.load(Ordering::SeqCst);

    if !recording && keycode != target {
        return event;
    }

    // SAFETY: Reading autorepeat field from valid event
    #[allow(unsafe_code)]
    let is_repeat =
        unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_AUTOREPEAT) != 0 };

    let current_state = get_ptt_state();
    let binding = get_binding();
    let ts = current_timestamp();

    match event_type {
        K_CG_EVENT_KEY_DOWN => {
            // We send PttDown for both the initial press and all subsequent repeat events.
            // This is required because Odoo resets its PTT timeout on every event.
            if recording {
                info!("PTT down matched (recording): keycode={}", keycode);
            } else if current_state == PttState::Idle {
                info!("PTT down matched (initial): keycode={}", keycode);
                set_ptt_held(true);
            } else if is_repeat {
                debug!("PTT down matched (repeat): keycode={}", keycode);
            }

            send_event(OutgoingMessage::PttDown {
                ts,
                key: if recording {
                    KeyBinding {
                        code: keycode,
                        modifiers: vec![],
                    }
                } else {
                    binding
                },
                is_repeat,
            });
        }
        K_CG_EVENT_KEY_UP => {
            if recording || current_state == PttState::Held {
                info!("PTT up matched: keycode={}", keycode);
                set_ptt_held(false);
                send_event(OutgoingMessage::PttUp {
                    ts,
                    key: if recording {
                        KeyBinding {
                            code: keycode,
                            modifiers: vec![],
                        }
                    } else {
                        binding
                    },
                });
            }
        }
        _ => {}
    }

    event
}

pub fn check_accessibility_permission() -> bool {
    use core_foundation::base::TCFType;
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

pub fn start_event_tap(sender: Sender<OutgoingMessage>, shutdown: &Arc<AtomicBool>) -> Result<()> {
    EVENT_SENDER
        .set(sender)
        .map_err(|_| anyhow!("Event sender already initialized"))?;

    let event_mask: u64 = (1 << K_CG_EVENT_KEY_DOWN) | (1 << K_CG_EVENT_KEY_UP);

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
    let source: CFRunLoopSourceRef = unsafe { CFMachPortCreateRunLoopSource(ptr::null(), tap, 0) };

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_binding_storage() {
        let binding = KeyBinding {
            code: 123,
            modifiers: vec!["cmd".to_string()],
        };
        set_binding(binding.clone());
        let stored = get_binding();
        assert_eq!(stored.code, 123);
        assert_eq!(stored.modifiers, vec!["cmd".to_string()]);
    }

    #[test]
    fn test_recording_toggle() {
        set_recording(true);
        assert!(IS_RECORDING.load(Ordering::SeqCst));
        set_recording(false);
        assert!(!IS_RECORDING.load(Ordering::SeqCst));
    }
}
