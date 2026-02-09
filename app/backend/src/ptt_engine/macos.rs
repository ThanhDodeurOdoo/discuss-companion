use std::{
    ffi::c_void,
    ptr,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering},
    },
    time::Duration,
};

use anyhow::{Result, anyhow};
// SAFETY: requires unsafe code for macOS Core Graphics FFI calls.
// The CGEventTap API is inherently unsafe as it involves C callbacks and raw pointers.
use core_foundation::{
    base::TCFType,
    dictionary,
    mach_port::CFMachPortRef,
    runloop::{
        CFRunLoop, CFRunLoopAddSource, CFRunLoopSourceRef, kCFRunLoopCommonModes,
        kCFRunLoopDefaultMode,
    },
};
use core_graphics::event::{CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement};
use crossbeam_channel::Sender;
use tracing::{debug, error, info};

use crate::{
    protocol::{
        KEYCODE_SPACE, KeyBinding, Modifiers, OutgoingMessage, PttState, current_timestamp,
    },
    ptt_engine::PttEngine,
};

type CGEventRef = *mut c_void;
type CGEventTapProxy = *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
#[allow(
    unsafe_code,
    reason = "
    SAFETY: required for macOS Core Graphics FFI.
    The extern declarations match the official Core Graphics header definitions (CGEventTypes.h, CGEvent.h),
    ensuring correct ABI compatibility for the linked framework."
)]
unsafe extern "C" {
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
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);

    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CFMachPortRef,
        order: i64,
    ) -> CFRunLoopSourceRef;
}

#[link(name = "ApplicationServices", kind = "framework")]
#[allow(
    unsafe_code,
    reason = "
    SAFETY: required for macOS ApplicationServices FFI.
    The extern declarations match the official Application Services header definitions (AXUIElement.h),
    ensuring correct ABI compatibility for the linked framework."
)]
unsafe extern "C" {
    fn AXIsProcessTrustedWithOptions(options: dictionary::CFDictionaryRef) -> u8;
}

const K_CG_EVENT_KEY_DOWN: u32 = 10;
const K_CG_EVENT_KEY_UP: u32 = 11;

const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
const K_CG_KEYBOARD_EVENT_AUTOREPEAT: u32 = 8;

const K_CG_EVENT_FLAG_MASK_SHIFT: u64 = 0x0002_0000;
const K_CG_EVENT_FLAG_MASK_CONTROL: u64 = 0x0004_0000;
const K_CG_EVENT_FLAG_MASK_ALTERNATE: u64 = 0x0008_0000; // Option/Alt
const K_CG_EVENT_FLAG_MASK_COMMAND: u64 = 0x0010_0000;

const MOD_MASK_SHIFT: u8 = 1 << 0;
const MOD_MASK_CONTROL: u8 = 1 << 1;
const MOD_MASK_ALT: u8 = 1 << 2;
const MOD_MASK_META: u8 = 1 << 3;

const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const K_CG_EVENT_TAP_DISABLED_BY_USER_INTEREST: u32 = 0xFFFF_FFFF;

#[allow(
    clippy::as_conversions,
    reason = "const packed binding needs a safe widening cast"
)]
const DEFAULT_BINDING_PACKED: u32 = (KEYCODE_SPACE as u32) << 8;

static HELD: AtomicBool = AtomicBool::new(false);
static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static GLOBAL_TAP: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
static BINDING_PACKED: AtomicU32 = AtomicU32::new(DEFAULT_BINDING_PACKED);

static EVENT_SENDER: OnceLock<Sender<OutgoingMessage>> = OnceLock::new();

pub struct MacosEngine;

impl PttEngine for MacosEngine {
    fn set_binding(&self, binding: KeyBinding) {
        BINDING_PACKED.store(pack_binding(binding), Ordering::Release);
    }

    fn set_recording(&self, recording: bool) {
        IS_RECORDING.store(recording, Ordering::Release);
    }

    fn get_binding(&self) -> KeyBinding {
        binding_from_packed(BINDING_PACKED.load(Ordering::Acquire))
    }

    fn force_ptt_up(&self) {
        info!("Forcing PTT UP (Safety Release)");
        set_ptt_held(false);
        PRIMARY_KEY_HELD.store(false, Ordering::Release);

        let binding = self.get_binding();
        let ts = current_timestamp();
        send_event(OutgoingMessage::PttUp { ts, key: binding });
    }

    fn check_accessibility_permission(&self) -> bool {
        use core_foundation::{boolean::CFBoolean, dictionary::CFDictionary, string::CFString};

        #[allow(
            unsafe_code,
            reason = "
            SAFETY: Interacting with macOS ApplicationServices to check accessibility permissions.
            We create valid CFString and CFBoolean objects using safe wrappers (core_foundation crate).
            The CFDictionary is constructed from these valid safe types.
            The raw pointer passed to `AXIsProcessTrustedWithOptions` comes from `as_concrete_TypeRef()`,
            which is guaranteed to be a valid CFDictionaryRef by the type system."
        )]
        unsafe {
            // The actual key string for kAXTrustedCheckOptionPrompt
            let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
            let value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
            let trusted = AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0;
            debug!("Accessibility permission check: {}", trusted);
            trusted
        }
    }

    fn start_engine(
        &self,
        sender: Sender<OutgoingMessage>,
        shutdown: &Arc<AtomicBool>,
    ) -> Result<()> {
        EVENT_SENDER
            .set(sender)
            .map_err(|_sender| anyhow!("Event sender already initialized"))?;

        // We also want to listen for flags changed to update modifiers if needed,
        let event_mask: u64 =
            (1 << K_CG_EVENT_KEY_DOWN) | (1 << K_CG_EVENT_KEY_UP) | (1 << K_CG_EVENT_FLAGS_CHANGED);

        #[allow(
            unsafe_code,
            reason = "
            SAFETY: CGEventTapCreate is called with:
            - Valid numeric constants for location, placement, and options.
            - A valid event mask.
            - `event_callback`: A valid extern 'C' function pointer matching the required signature.
            - `ptr::null_mut()`: Null user_info is explicitly allowed by the API.
            The returned CFMachPortRef is checked for NULL immediately after this block."
        )]
        let tap: CFMachPortRef = unsafe {
            #[allow(
                clippy::as_conversions,
                reason = "The Core Graphics FFI function expects raw u32 values for enum-backed parameters."
            )]
            CGEventTapCreate(
                CGEventTapLocation::AnnotatedSession as u32,
                CGEventTapPlacement::HeadInsertEventTap as u32,
                CGEventTapOptions::ListenOnly as u32,
                event_mask,
                event_callback,
                ptr::null_mut(),
            )
        };

        GLOBAL_TAP.store(tap.cast::<c_void>(), Ordering::Release);

        if tap.is_null() {
            error!("Failed to create event tap - NULL return");
            return Err(anyhow!(
                "Failed to create event tap. Accessibility permission may be missing. \
                 Grant permission in System Settings -> Privacy & Security -> Accessibility."
            ));
        }
        debug!("CGEventTap created successfully");

        #[allow(
            unsafe_code,
            reason = "
            SAFETY: CFMachPortCreateRunLoopSource is called with:
            - `ptr::null()`: Allowed for default allocator.
            - `tap`: Verified to be non-null in the check above.
            - `0`: Valid order parameter.
            The result is checked for NULL immediately after."
        )]
        let source: CFRunLoopSourceRef =
            unsafe { CFMachPortCreateRunLoopSource(ptr::null(), tap, 0) };

        if source.is_null() {
            return Err(anyhow!("Failed to create run loop source"));
        }

        let run_loop = CFRunLoop::get_current();

        #[allow(
            unsafe_code,
            reason = "
            SAFETY: CFRunLoopAddSource is called with:
            - `run_loop`: Obtained securely via `CFRunLoop::get_current()`, guaranteed to be valid.
            - `source`: Verified to be non-null in the check above.
            - `kCFRunLoopCommonModes`: A valid constant from the `core_foundation` crate."
        )]
        unsafe {
            CFRunLoopAddSource(
                run_loop.as_concrete_TypeRef(),
                source,
                kCFRunLoopCommonModes,
            );
        }

        info!("Event tap started, listening for PTT key events");

        while !shutdown.load(Ordering::Relaxed) {
            #[allow(
                unsafe_code,
                reason = "
                SAFETY: kCFRunLoopDefaultMode is a valid extern static provided by core_foundation.
                Accessing it is safe as it is a constant global symbol."
            )]
            let mode = unsafe { kCFRunLoopDefaultMode };
            CFRunLoop::run_in_mode(mode, Duration::from_millis(100), false);
        }

        info!("Event tap stopped");
        Ok(())
    }
}

pub fn get_engine() -> &'static MacosEngine {
    static ENGINE: MacosEngine = MacosEngine;
    &ENGINE
}

fn get_ptt_state() -> PttState {
    if HELD.load(Ordering::Acquire) {
        PttState::Held
    } else {
        PttState::Idle
    }
}

fn set_ptt_held(held: bool) {
    HELD.store(held, Ordering::Release);
}

fn send_event(msg: OutgoingMessage) {
    if let Some(sender) = EVENT_SENDER.get()
        && let Err(e) = sender.send(msg)
    {
        error!("Failed to send event: {}", e);
    }
}

const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;

static PRIMARY_KEY_HELD: AtomicBool = AtomicBool::new(false);

#[allow(clippy::too_many_lines, reason = "cyclomatic complexity is ok though")]
extern "C" fn event_callback(
    _proxy: CGEventTapProxy,
    event_type: u32,
    event: CGEventRef,
    _user_info: *mut c_void,
) -> CGEventRef {
    // Handle disabled tap events
    if event_type == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT
        || event_type == K_CG_EVENT_TAP_DISABLED_BY_USER_INTEREST
    {
        let tap = GLOBAL_TAP.load(Ordering::Acquire);
        if !tap.is_null() {
            info!(
                "Event tap disabled by system (type={}), re-enabling...",
                event_type
            );
            #[allow(
                unsafe_code,
                clippy::as_conversions,
                reason = "
                SAFETY: CGEventTapEnable is called with:
                - `tap`: Loaded from the global atomic. We verified `!tap.is_null()` right above.
                - `true`: Boolean literal.
                The `as` conversion is required to cast the raw pointer from AtomicPtr back to CFMachPortRef."
            )]
            unsafe {
                CGEventTapEnable(tap as CFMachPortRef, true);
            }
        }
        return event;
    }

    if event.is_null() {
        return event;
    }

    #[allow(
        unsafe_code,
        reason = "
        SAFETY: CGEventGetIntegerValueField is called with:
        - `event`: Checked to be non-null at the start of the function.
        - `K_CG_KEYBOARD_EVENT_KEYCODE`: A valid field constant."
    )]
    #[allow(
        clippy::as_conversions,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "The cast to u16 is safe because keycodes are small integers (0-127)"
    )]
    let keycode = unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16 };

    #[allow(
        unsafe_code,
        reason = "
        SAFETY: CGEventGetFlags is called with:
        - `event`: Checked to be non-null at the start of the function."
    )]
    let flags = unsafe { CGEventGetFlags(event) };
    let modifiers_mask = modifiers_mask_from_flags(flags);

    if tracing::enabled!(tracing::Level::DEBUG) {
        let modifiers = modifiers_from_mask(modifiers_mask);
        debug!(
            "CGEvent: type={} keycode={} flags={:?} mods={:?}",
            event_type, keycode, flags, modifiers
        );
    }

    // NOTE on atomicity: These loads are individually atomic but not atomic as a group.
    // If `set_binding()` is called concurrently from another thread, we might read a mix of
    // old and new state. This is acceptable because:
    // 1. Binding changes are rare (user-initiated configuration)
    // 2. The worst case is a single PTT event firing slightly early or late
    // 3. The next event will use consistent state
    let packed_binding = BINDING_PACKED.load(Ordering::Acquire);
    let (binding_code, binding_mask) = unpack_binding(packed_binding);
    let recording = IS_RECORDING.load(Ordering::Acquire);
    let mut is_repeat = false;

    // Track primary key state
    if event_type == K_CG_EVENT_KEY_DOWN {
        if keycode == binding_code {
            PRIMARY_KEY_HELD.store(true, Ordering::Release);
        }
        #[allow(
            unsafe_code,
            reason = "
            SAFETY: CGEventGetIntegerValueField is called with:
            - `event`: Checked to be non-null at the start of the function.
            - `K_CG_KEYBOARD_EVENT_AUTOREPEAT`: A valid field constant."
        )]
        unsafe {
            is_repeat = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_AUTOREPEAT) != 0;
        }
    } else if event_type == K_CG_EVENT_KEY_UP && keycode == binding_code {
        PRIMARY_KEY_HELD.store(false, Ordering::Release);
    }

    let primary_held = PRIMARY_KEY_HELD.load(Ordering::Acquire);
    let current_ptt_state = get_ptt_state();
    debug!(
        "State: primary_held={} target={} recording={}",
        primary_held, binding_code, recording
    );
    let ts = current_timestamp();

    if recording {
        // Simple recording logic: just capture whatever keydown happens
        if event_type == K_CG_EVENT_KEY_DOWN {
            let modifiers = modifiers_from_mask(modifiers_mask);
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

    let modifiers_match = modifiers_mask == binding_mask;
    let should_be_active = primary_held && modifiers_match;

    debug!(
        "Logic: mods_match={} should_active={} current_state={:?}",
        modifiers_match, should_be_active, current_ptt_state
    );

    match current_ptt_state {
        PttState::Idle => {
            if should_be_active {
                info!(
                    "PTT ACTIVATED: keycode={} modifiers={:?}",
                    keycode,
                    modifiers_from_mask(modifiers_mask)
                );
                set_ptt_held(true);
                let binding = binding_from_packed(packed_binding);
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
                    keycode,
                    modifiers_from_mask(modifiers_mask)
                );
                set_ptt_held(false);
                let binding = binding_from_packed(packed_binding);
                send_event(OutgoingMessage::PttUp { ts, key: binding });
            } else if is_repeat && event_type == K_CG_EVENT_KEY_DOWN {
                // Keepalive for Odoo (it un-mutes on every PTT event)
                let binding = binding_from_packed(packed_binding);
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

fn modifiers_mask_from_flags(flags: u64) -> u8 {
    let mut mask = 0;

    if (flags & K_CG_EVENT_FLAG_MASK_SHIFT) != 0 {
        mask |= MOD_MASK_SHIFT;
    }
    if (flags & K_CG_EVENT_FLAG_MASK_CONTROL) != 0 {
        mask |= MOD_MASK_CONTROL;
    }
    if (flags & K_CG_EVENT_FLAG_MASK_ALTERNATE) != 0 {
        mask |= MOD_MASK_ALT;
    }
    if (flags & K_CG_EVENT_FLAG_MASK_COMMAND) != 0 {
        mask |= MOD_MASK_META;
    }

    mask
}

fn modifiers_from_mask(mask: u8) -> Modifiers {
    // The bitmask layout matches Modifiers::from_bits exactly
    Modifiers::from_bits(mask)
}

fn pack_binding(binding: KeyBinding) -> u32 {
    (u32::from(binding.code) << 8) | u32::from(binding.modifiers.bits())
}

fn unpack_binding(packed: u32) -> (u16, u8) {
    let code = u16::try_from(packed >> 8).unwrap_or(KEYCODE_SPACE);
    let mask = u8::try_from(packed & 0xFF).unwrap_or(0);
    (code, mask)
}

fn binding_from_packed(packed: u32) -> KeyBinding {
    let (code, mask) = unpack_binding(packed);
    KeyBinding {
        code,
        modifiers: modifiers_from_mask(mask),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Modifier;

    #[test]
    fn test_binding_storage() {
        let engine = MacosEngine;
        let binding = KeyBinding {
            code: 123,
            modifiers: [Modifier::Meta].into_iter().collect(),
        };
        engine.set_binding(binding);
        let stored = engine.get_binding();
        assert_eq!(stored.code, 123);
        assert!(stored.modifiers.contains(Modifier::Meta));
        assert_eq!(stored.modifiers.iter().count(), 1);
    }

    #[test]
    fn test_recording_toggle() {
        let engine = MacosEngine;
        engine.set_recording(true);
        assert!(IS_RECORDING.load(Ordering::Acquire));
        engine.set_recording(false);
        assert!(!IS_RECORDING.load(Ordering::Acquire));
    }

    #[test]
    fn test_get_modifiers_from_flags() {
        let flags = K_CG_EVENT_FLAG_MASK_SHIFT | K_CG_EVENT_FLAG_MASK_COMMAND;
        let mods = modifiers_from_mask(modifiers_mask_from_flags(flags));
        assert_eq!(mods.iter().count(), 2);
        assert!(mods.contains(Modifier::Shift));
        assert!(mods.contains(Modifier::Meta));

        let flags = K_CG_EVENT_FLAG_MASK_CONTROL | K_CG_EVENT_FLAG_MASK_ALTERNATE;
        let mods = modifiers_from_mask(modifiers_mask_from_flags(flags));
        assert_eq!(mods.iter().count(), 2);
        assert!(mods.contains(Modifier::Control));
        assert!(mods.contains(Modifier::Alt));
    }
}
