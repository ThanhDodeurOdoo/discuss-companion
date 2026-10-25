use std::{
    ffi::c_void,
    process, ptr,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread::sleep,
    time::{Duration, Instant},
};

use anyhow::{Result, anyhow};
// SAFETY: requires unsafe code for macOS Core Graphics FFI calls.
// The CGEventTap API is inherently unsafe as it involves C callbacks and raw pointers.
use core_foundation::{
    base::{CFRelease, TCFType},
    mach_port::{CFMachPortInvalidate, CFMachPortRef},
    runloop::{
        CFRunLoop, CFRunLoopAddSource, CFRunLoopRemoveSource, CFRunLoopSourceRef,
        kCFRunLoopCommonModes, kCFRunLoopDefaultMode,
    },
};
use core_graphics::event::{CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement};
use crossbeam_channel::Sender;
use tracing::{debug, error, info};

pub(crate) mod permissions;
mod recovery;

use crate::{
    protocol::{KeyBinding, Modifiers, PttState, current_timestamp, keyboard as kb},
    ptt_engine::{PttEngine, PttEvent, permissions::MacosPermissionStatus},
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
    fn CGEventTapIsEnabled(tap: CFMachPortRef) -> bool;
    fn CGGetEventTapList(max_taps: u32, taps: *mut EventTapInformation, count: *mut u32) -> i32;

    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CFMachPortRef,
        order: i64,
    ) -> CFRunLoopSourceRef;
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
const DEFAULT_BINDING_PACKED: u32 = (kb::KEY_SPACE as u32) << 8;

static HELD: AtomicBool = AtomicBool::new(false);
static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static LISTENER_RUNNING: AtomicBool = AtomicBool::new(false);
static RETRY_REQUESTED: AtomicBool = AtomicBool::new(false);
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const RUN_LOOP_INTERVAL: Duration = Duration::from_millis(100);
const KEYBOARD_EVENT_MASK: u64 = (1 << K_CG_EVENT_KEY_DOWN) | (1 << K_CG_EVENT_KEY_UP);
static BINDING_PACKED: AtomicU32 = AtomicU32::new(DEFAULT_BINDING_PACKED);

static EVENT_SENDER: OnceLock<Sender<PttEvent>> = OnceLock::new();

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
        send_event(PttEvent::PttUp { ts, key: binding });
    }

    fn check_accessibility_permission(&self) -> bool {
        permissions::accessibility_granted()
    }

    fn start_engine(&self, sender: Sender<PttEvent>, shutdown: &Arc<AtomicBool>) -> Result<()> {
        EVENT_SENDER
            .set(sender)
            .map_err(|_sender| anyhow!("Event sender already initialized"))?;

        let mut listener: Option<EventTap> = None;
        let mut next_check = Instant::now();
        while !shutdown.load(Ordering::Relaxed) {
            let retry = RETRY_REQUESTED.swap(false, Ordering::AcqRel);
            if retry || Instant::now() >= next_check {
                let status = permission_status();
                let running = recovery::reconcile(
                    &mut listener,
                    status.accessibility && status.input_monitoring,
                    retry,
                    EventTap::healthy,
                    EventTap::new,
                    reset_capture,
                )
                .unwrap_or_else(|error| {
                    error!("Cannot start global keyboard listener: {error}");
                    false
                });
                LISTENER_RUNNING.store(running, Ordering::Release);
                next_check = Instant::now() + HEALTH_CHECK_INTERVAL;
            }
            if listener.is_some() {
                #[allow(
                    unsafe_code,
                    reason = "SAFETY: kCFRunLoopDefaultMode is a system constant; the worker owns and services the tap's run loop"
                )]
                let mode = unsafe { kCFRunLoopDefaultMode };
                CFRunLoop::run_in_mode(mode, RUN_LOOP_INTERVAL, false);
            } else {
                sleep(RUN_LOOP_INTERVAL);
            }
        }
        LISTENER_RUNNING.store(false, Ordering::Release);
        reset_capture();
        drop(listener);
        Ok(())
    }
}

pub(crate) fn permission_status() -> MacosPermissionStatus {
    MacosPermissionStatus {
        accessibility: permissions::accessibility_granted(),
        input_monitoring: permissions::input_monitoring_granted(),
        listener_running: LISTENER_RUNNING.load(Ordering::Acquire),
    }
}

pub(crate) fn retry_listener() {
    LISTENER_RUNNING.store(false, Ordering::Release);
    RETRY_REQUESTED.store(true, Ordering::Release);
}

fn reset_capture() {
    IS_RECORDING.store(false, Ordering::Release);
    get_engine().force_ptt_up();
}

// ABI layout from CGEventTypes.h. This contains listener metadata, not key events.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct EventTapInformation {
    id: u32,
    location: u32,
    options: u32,
    events: u64,
    process: i32,
    target_process: i32,
    enabled: bool,
    min_latency: f32,
    avg_latency: f32,
    max_latency: f32,
}

fn captures_keyboard(tap: &EventTapInformation, process: u32) -> bool {
    u32::try_from(tap.process).ok() == Some(process)
        && tap.target_process == 0
        && tap.enabled
        && tap.events & KEYBOARD_EVENT_MASK == KEYBOARD_EVENT_MASK
}

fn has_keyboard_listener() -> bool {
    let mut count = 0;
    #[allow(
        unsafe_code,
        reason = "SAFETY: null buffer requests only the event-tap count; count is writable"
    )]
    let result = unsafe { CGGetEventTapList(0, ptr::null_mut(), &raw mut count) };
    if result != 0 || count == 0 {
        return false;
    }
    let Ok(size) = usize::try_from(count) else {
        return false;
    };
    let mut taps = vec![EventTapInformation::default(); size];
    #[allow(
        unsafe_code,
        reason = "SAFETY: buffer holds count ABI-compatible structures; CoreGraphics never writes beyond the supplied capacity"
    )]
    let result = unsafe { CGGetEventTapList(count, taps.as_mut_ptr(), &raw mut count) };
    result == 0 && taps.iter().any(|tap| captures_keyboard(tap, process::id()))
}

struct EventTap {
    port: CFMachPortRef,
    source: CFRunLoopSourceRef,
    run_loop: CFRunLoop,
}

impl EventTap {
    fn new() -> Result<Self> {
        #[allow(
            unsafe_code,
            clippy::as_conversions,
            reason = "SAFETY: CoreGraphics enum values and callback match CGEvent.h; the returned port is checked and owned by this worker"
        )]
        let port = unsafe {
            CGEventTapCreate(
                CGEventTapLocation::AnnotatedSession as u32,
                CGEventTapPlacement::HeadInsertEventTap as u32,
                CGEventTapOptions::ListenOnly as u32,
                KEYBOARD_EVENT_MASK | (1 << K_CG_EVENT_FLAGS_CHANGED),
                event_callback,
                ptr::null_mut(),
            )
        };
        if port.is_null() {
            return Err(anyhow!("macOS refused keyboard capture"));
        }
        #[allow(
            unsafe_code,
            reason = "SAFETY: port is live; null allocator selects the default allocator"
        )]
        let source = unsafe { CFMachPortCreateRunLoopSource(ptr::null(), port, 0) };
        if source.is_null() {
            #[allow(
                unsafe_code,
                reason = "SAFETY: release the create-rule port on this failure path; no source or callbacks were installed"
            )]
            unsafe {
                CFMachPortInvalidate(port);
                CFRelease(port.cast());
            }
            return Err(anyhow!("Cannot create keyboard capture run loop"));
        }
        let run_loop = CFRunLoop::get_current();
        #[allow(
            unsafe_code,
            reason = "SAFETY: the worker owns the valid source and run loop for the lifetime of EventTap"
        )]
        unsafe {
            CFRunLoopAddSource(
                run_loop.as_concrete_TypeRef(),
                source,
                kCFRunLoopCommonModes,
            );
        }
        Ok(Self {
            port,
            source,
            run_loop,
        })
    }

    fn healthy(&self) -> bool {
        #[allow(
            unsafe_code,
            reason = "SAFETY: only the owner thread queries the live port, before Drop"
        )]
        let enabled = unsafe { CGEventTapIsEnabled(self.port) };
        // macOS can return a non-null tap with keyboard bits silently removed.
        // This app has one global keyboard worker, so verify its process's mask too.
        enabled && has_keyboard_listener()
    }
}

impl Drop for EventTap {
    fn drop(&mut self) {
        #[allow(
            unsafe_code,
            reason = "SAFETY: teardown runs on the owning run-loop thread; remove and invalidate before releasing each create-rule reference exactly once"
        )]
        unsafe {
            CFRunLoopRemoveSource(
                self.run_loop.as_concrete_TypeRef(),
                self.source,
                kCFRunLoopCommonModes,
            );
            CFMachPortInvalidate(self.port);
            CFRelease(self.source.cast());
            CFRelease(self.port.cast());
        }
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

fn send_event(msg: PttEvent) {
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
        // Recreate on the owner thread, rather than re-enabling a tap whose
        // permissions or keyboard mask may no longer be valid.
        retry_listener();
        reset_capture();
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
        if event_type == K_CG_EVENT_KEY_DOWN {
            let modifiers = modifiers_from_mask(modifiers_mask);
            info!(
                "PTT binding captured: keycode={} modifiers={:?}",
                keycode, modifiers
            );
            send_event(PttEvent::CapturedBinding {
                ts,
                key: KeyBinding {
                    code: keycode,
                    modifiers,
                },
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
                send_event(PttEvent::PttDown {
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
                send_event(PttEvent::PttUp { ts, key: binding });
            } else if is_repeat && event_type == K_CG_EVENT_KEY_DOWN {
                // Keepalive for Odoo (it un-mutes on every PTT event)
                let binding = binding_from_packed(packed_binding);
                send_event(PttEvent::PttDown {
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
    let code = u16::try_from(packed >> 8).unwrap_or(kb::KEY_SPACE);
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
    fn keyboard_health_requires_enabled_global_capture_for_this_process() {
        let valid = EventTapInformation {
            process: 42,
            enabled: true,
            events: KEYBOARD_EVENT_MASK,
            ..EventTapInformation::default()
        };
        assert!(captures_keyboard(&valid, 42));
        assert!(!captures_keyboard(&valid, 43));
        assert!(!captures_keyboard(
            &EventTapInformation {
                enabled: false,
                ..valid
            },
            42
        ));
        assert!(!captures_keyboard(
            &EventTapInformation {
                target_process: 7,
                ..valid
            },
            42
        ));
        assert!(!captures_keyboard(
            &EventTapInformation {
                events: 1 << K_CG_EVENT_FLAGS_CHANGED,
                ..valid
            },
            42
        ));
        assert!(!captures_keyboard(
            &EventTapInformation {
                events: 1 << K_CG_EVENT_KEY_DOWN,
                ..valid
            },
            42
        ));
    }

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
