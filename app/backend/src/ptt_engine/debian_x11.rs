use std::{
    ffi::c_char,
    ptr,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread,
    time::Duration,
};

use anyhow::{Result, anyhow};
use crossbeam_channel::Sender;
use tracing::{debug, error, info, warn};
use x11::{
    xlib::{self, Display, KeyPress, KeyRelease, XCloseDisplay, XFree, XOpenDisplay},
    xrecord::{
        self, XRecordAllocRange, XRecordClientSpec, XRecordCreateContext, XRecordDisableContext,
        XRecordEnableContext, XRecordFreeContext, XRecordFreeData, XRecordFromServer,
        XRecordQueryVersion,
    },
};

use crate::{
    protocol::{
        KEYCODE_SPACE, KeyBinding, Modifiers, OutgoingMessage, PttState, current_timestamp,
    },
    ptt_engine::PttEngine,
};

static HELD: AtomicBool = AtomicBool::new(false);
static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static BINDING_PACKED: AtomicU32 = AtomicU32::new(DEFAULT_BINDING_PACKED);
static EVENT_SENDER: OnceLock<Sender<OutgoingMessage>> = OnceLock::new();

#[derive(Clone, Copy)]
pub struct DebianX11Engine;

#[allow(
    clippy::as_conversions,
    reason = "const packed binding needs a safe widening cast"
)]
const DEFAULT_BINDING_PACKED: u32 = (KEYCODE_SPACE as u32) << 8;

// X11 Key masks (from X.h / Xlib.h)
const SHIFT_MASK: u32 = 1 << 0;
const _LOCK_MASK: u32 = 1 << 1;
const CONTROL_MASK: u32 = 1 << 2;
const MOD1_MASK: u32 = 1 << 3; // Alt
const _MOD2_MASK: u32 = 1 << 4;
const _MOD3_MASK: u32 = 1 << 5;
const MOD4_MASK: u32 = 1 << 6; // Meta / Super
const _MOD5_MASK: u32 = 1 << 7;

impl PttEngine for DebianX11Engine {
    fn set_binding(&self, binding: KeyBinding) {
        let packed = pack_binding(binding);
        debug!("Setting binding: {:?} (packed: {})", binding, packed);
        BINDING_PACKED.store(packed, Ordering::SeqCst);
    }

    fn set_recording(&self, recording: bool) {
        IS_RECORDING.store(recording, Ordering::SeqCst);
    }

    fn get_binding(&self) -> KeyBinding {
        binding_from_packed(BINDING_PACKED.load(Ordering::SeqCst))
    }

    fn force_ptt_up(&self) {
        debug!("Forcing PTT UP (Safety Release)");
        set_ptt_held(false);
        let binding = self.get_binding();
        let ts = current_timestamp();
        send_event(OutgoingMessage::PttUp { ts, key: binding });
    }

    fn check_accessibility_permission(&self) -> bool {
        #[allow(
            unsafe_code,
            reason = "
            SAFETY: XOpenDisplay/XCloseDisplay are Xlib FFI calls.
            We pass NULL to request the default DISPLAY, verify the returned pointer for null,
            and only pass a non-null Display* to XCloseDisplay."
        )]
        unsafe {
            let dpy = XOpenDisplay(ptr::null());
            if dpy.is_null() {
                warn!("XOpenDisplay failed in permission check");
                return false;
            }
            XCloseDisplay(dpy);
        }
        true
    }

    fn start_engine(
        &self,
        sender: Sender<OutgoingMessage>,
        shutdown: &Arc<AtomicBool>,
    ) -> Result<()> {
        EVENT_SENDER
            .set(sender)
            .map_err(|_sender| anyhow!("Event sender already initialized"))?;
        info!("Starting X11 PTT engine");
        let shutdown_signal = Arc::clone(shutdown);

        thread::spawn(move || {
            if let Err(e) = run_xrecord_loop(&shutdown_signal) {
                error!("XRecord loop failed: {}", e);
            }
        });

        Ok(())
    }
}

pub fn get_engine() -> &'static DebianX11Engine {
    static ENGINE: DebianX11Engine = DebianX11Engine;
    &ENGINE
}

fn set_ptt_held(held: bool) {
    HELD.store(held, Ordering::SeqCst);
}

fn get_ptt_state() -> PttState {
    if HELD.load(Ordering::SeqCst) {
        PttState::Held
    } else {
        PttState::Idle
    }
}

fn send_event(msg: OutgoingMessage) {
    if let Some(sender) = EVENT_SENDER.get()
        && let Err(e) = sender.send(msg)
    {
        error!("Failed to send event: {}", e);
    }
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

#[allow(
    unsafe_code,
    reason = "
    SAFETY: XRecordEnableContext requires an extern C callback with this signature.
    The XRecord server provides the data pointer; we validate it for null before dereferencing
    and always release it with XRecordFreeData."
)]
unsafe extern "C" fn record_callback(
    _null_closure: *mut c_char,
    raw_datum: *mut xrecord::XRecordInterceptData,
) {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: `raw_datum` comes from the XRecord callback.
        We check for null before dereferencing, bound the byte length from `data_len`,
        read only within that slice, and free non-null data with XRecordFreeData."
    )]
    unsafe {
        if raw_datum.is_null() {
            return;
        }

        let datum = *raw_datum;
        debug!(
            "XRecord callback: category={}, len={}",
            datum.category, datum.data_len
        );

        if datum.category != XRecordFromServer {
            XRecordFreeData(raw_datum);
            return;
        }

        // data_len is in 4-byte units (8 units = 32 bytes)
        if datum.data_len >= 8 {
            let Ok(len_bytes) = usize::try_from(datum.data_len * 4) else {
                XRecordFreeData(raw_datum);
                return;
            };

            #[allow(
                clippy::absolute_paths,
                reason = "slice::from_raw_parts requires explicit path or import, std is fine"
            )]
            let data = std::slice::from_raw_parts(datum.data.cast_const().cast::<u8>(), len_bytes);

            let Some(&type_code) = data.first() else {
                XRecordFreeData(raw_datum);
                return;
            };

            // KeyPress=2, KeyRelease=3
            if type_code == 2 || type_code == 3 {
                let Some(&keycode) = data.get(1) else {
                    XRecordFreeData(raw_datum);
                    return;
                };

                // State is at offset 28 (u16)
                let (Some(&byte28), Some(&byte29)) = (data.get(28), data.get(29)) else {
                    XRecordFreeData(raw_datum);
                    return;
                };
                let state = u16::from_ne_bytes([byte28, byte29]);

                debug!(
                    "XRecord Parsed: type={}, keycode={}, state={}",
                    type_code, keycode, state
                );

                handle_key_event(i32::from(type_code), keycode, u32::from(state));
            }
        }

        XRecordFreeData(raw_datum);
    }
}

#[allow(
    unsafe_code,
    reason = "
    SAFETY: This helper is only called after the XRecord payload has been validated
    (type, length, and keycode bytes), so inputs are derived from checked X11 data."
)]
unsafe fn handle_key_event(type_code: i32, keycode: u8, state: u32) {
    let x11_keycode = keycode;
    let keycode = x11_to_macos_keycode(u16::from(x11_keycode));

    if is_modifier_key(keycode) {
        debug!(
            "Ignoring modifier key event: code={} (x11={})",
            keycode, x11_keycode
        );
        return;
    }

    let modifiers_mask = map_x11_modifiers(state);
    let modifiers = modifiers_from_mask(modifiers_mask);

    debug!(
        "Handle Key: x11_code={}, macos_code={}, state={}, mod_mask={}, modifiers={:?}",
        x11_keycode, keycode, state, modifiers_mask, modifiers
    );

    let packed_binding = BINDING_PACKED.load(Ordering::SeqCst);
    let (binding_code, binding_mask) = unpack_binding(packed_binding);
    let recording = IS_RECORDING.load(Ordering::SeqCst);

    let ts = current_timestamp();

    if recording {
        if type_code == KeyPress {
            debug!(
                "PTT down matched (recording): keycode={} modifiers={:?}",
                keycode, modifiers
            );
            send_event(OutgoingMessage::PttDown {
                ts,
                key: KeyBinding {
                    code: keycode,
                    modifiers,
                },
                is_repeat: false,
            });
        }
        return;
    }

    let modifiers_match = modifiers_mask == binding_mask;
    debug!(
        "Checking match: keycode {}=={}, mask {}=={}, type {}==KeyPress",
        keycode, binding_code, modifiers_mask, binding_mask, type_code
    );

    let should_be_active = (keycode == binding_code) && modifiers_match && (type_code == KeyPress);
    debug!("Should be active: {}", should_be_active);
    let current_ptt_state = get_ptt_state();

    if type_code == KeyPress {
        if should_be_active && matches!(current_ptt_state, PttState::Idle) {
            debug!(
                "PTT ACTIVATED: keycode={} modifiers={:?}",
                keycode, modifiers
            );
            set_ptt_held(true);
            let binding = binding_from_packed(packed_binding);
            send_event(OutgoingMessage::PttDown {
                ts,
                key: binding,
                is_repeat: false,
            });
        } else if should_be_active && matches!(current_ptt_state, PttState::Held) {
            let binding = binding_from_packed(packed_binding);
            send_event(OutgoingMessage::PttDown {
                ts,
                key: binding,
                is_repeat: true,
            });
        }
    } else if type_code == KeyRelease
        && keycode == binding_code
        && matches!(current_ptt_state, PttState::Held)
    {
        debug!(
            "PTT DEACTIVATED: keycode={} modifiers={:?}",
            keycode, modifiers
        );
        set_ptt_held(false);
        let binding = binding_from_packed(packed_binding);
        send_event(OutgoingMessage::PttUp { ts, key: binding });
    }
}

fn map_x11_modifiers(state: u32) -> u8 {
    let mut mask = 0;
    if (state & SHIFT_MASK) != 0 {
        mask |= MOD_MASK_SHIFT;
    }
    if (state & CONTROL_MASK) != 0 {
        mask |= MOD_MASK_CONTROL;
    }
    if (state & MOD1_MASK) != 0 {
        mask |= MOD_MASK_ALT;
    } // Alt
    if (state & MOD4_MASK) != 0 {
        mask |= MOD_MASK_META;
    } // Meta/Super
    debug!("Map modifiers: state={} -> mask={}", state, mask);
    mask
}

/// X11 keycode (evdev+8) to macOS virtual keycode (US layout)
fn x11_to_macos_keycode(x11_code: u16) -> u16 {
    match x11_code {
        9 => 53,         // Esc
        67 => 122,       // F1
        68 => 120,       // F2
        69 => 99,        // F3
        70 => 118,       // F4
        71 => 96,        // F5
        72 => 97,        // F6
        73 => 98,        // F7
        74 => 100,       // F8
        75 => 101,       // F9
        76 => 109,       // F10
        95 => 103,       // F11
        96 => 111,       // F12
        49 => 50,        // `~
        10 => 18,        // 1
        11 => 19,        // 2
        12 => 20,        // 3
        13 => 21,        // 4
        14 => 23,        // 5
        15 => 22,        // 6
        16 => 26,        // 7
        17 => 28,        // 8
        18 => 25,        // 9
        19 => 29,        // 0
        20 => 27,        // -_
        21 => 24,        // =+
        22 => 51,        // Backspace
        23 => 48,        // Tab
        24 => 12,        // Q
        25 => 13,        // W
        26 => 14,        // E
        27 => 15,        // R
        28 => 17,        // T
        29 => 16,        // Y
        30 => 32,        // U
        31 => 34,        // I
        32 => 31,        // O
        33 => 35,        // P
        34 => 33,        // [{
        35 => 30,        // ]}
        36 => 36,        // Return
        38 => 0,         // A
        39 => 1,         // S
        40 => 2,         // D
        41 => 3,         // F
        42 => 5,         // G
        43 => 4,         // H
        44 => 38,        // J
        45 => 40,        // K
        46 => 37,        // L
        47 => 41,        // ;:
        48 => 39,        // '"
        51 => 42,        // \|
        50 | 62 => 56,   // Shift
        52 => 6,         // Z
        53 => 7,         // X
        54 => 8,         // C
        55 => 9,         // V
        56 => 11,        // B
        57 => 45,        // N
        58 => 46,        // M
        59 => 43,        // ,<
        60 => 47,        // .>
        61 => 44,        // /?
        37 | 105 => 59,  // Ctrl
        64 | 108 => 58,  // Alt
        65 => 49,        // Space
        133 | 134 => 55, // Super
        111 => 126,      // Up
        116 => 125,      // Down
        113 => 123,      // Left
        114 => 124,      // Right
        _ => x11_code,
    }
}

fn is_modifier_key(macos_keycode: u16) -> bool {
    matches!(macos_keycode, 55 | 56 | 58 | 59)
}

const MOD_MASK_SHIFT: u8 = 1 << 0;
const MOD_MASK_CONTROL: u8 = 1 << 1;
const MOD_MASK_ALT: u8 = 1 << 2;
const MOD_MASK_META: u8 = 1 << 3;

fn modifiers_from_mask(mask: u8) -> Modifiers {
    Modifiers::from_bits(mask)
}

fn run_xrecord_loop(shutdown: &Arc<AtomicBool>) -> Result<()> {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: This block performs X11/XRecord FFI calls.
        We validate all returned pointers (Display*, XRecordRange) before dereferencing,
        and we release resources with XFree/XRecordFreeContext/XCloseDisplay on all exit paths."
    )]
    unsafe {
        let dpy_data = XOpenDisplay(ptr::null());
        if dpy_data.is_null() {
            return Err(anyhow::anyhow!("Failed to open X display for data"));
        }

        // Separate control connection needed: XRecordEnableContext blocks, so we
        // call XRecordDisableContext from another connection to unblock it.
        let dpy_ctrl = XOpenDisplay(ptr::null());
        if dpy_ctrl.is_null() {
            XCloseDisplay(dpy_data);
            return Err(anyhow::anyhow!("Failed to open X display for control"));
        }

        let mut major = 0;
        let mut minor = 0;
        #[allow(
            clippy::borrow_as_ptr,
            reason = "FFI requires passing raw pointers to mutable stack variables"
        )]
        if XRecordQueryVersion(dpy_data, &mut major, &mut minor) == 0 {
            XCloseDisplay(dpy_data);
            XCloseDisplay(dpy_ctrl);
            return Err(anyhow::anyhow!("XRecord extension not available"));
        }

        let mut record_range = XRecordAllocRange();
        if record_range.is_null() {
            XCloseDisplay(dpy_data);
            XCloseDisplay(dpy_ctrl);
            return Err(anyhow::anyhow!("Failed to alloc XRecordRange"));
        }

        (*record_range).device_events.first = u8::try_from(KeyPress)?;
        (*record_range).device_events.last = u8::try_from(KeyRelease)?;

        let context = XRecordCreateContext(
            dpy_data,
            0,
            &mut XRecordClientSpec::from(xrecord::XRecordAllClients),
            1,
            #[allow(
                clippy::borrow_as_ptr,
                reason = "FFI requires passing raw pointer to XRecordRange"
            )]
            &mut record_range,
            1,
        );
        XFree(record_range.cast());

        if context == 0 {
            XCloseDisplay(dpy_data);
            XCloseDisplay(dpy_ctrl);
            return Err(anyhow::anyhow!("Failed to create XRecordContext"));
        }

        xlib::XSync(dpy_data, 0);

        let shutdown_check = Arc::clone(shutdown);
        let context_handle = context;

        // SAFETY: dpy_ctrl passed as usize because *mut Display is !Send.
        // The pointer remains valid because XRecordEnableContext blocks until
        // the shutdown thread calls XRecordDisableContext, after which we clean up.
        #[allow(
            clippy::as_conversions,
            reason = "usize to pointer cast required for FFI thread boundary"
        )]
        let dpy_ctrl_usize = dpy_ctrl as usize;

        thread::spawn(move || {
            #[allow(
                clippy::as_conversions,
                reason = "Restoring pointer from usize for FFI"
            )]
            let dpy = dpy_ctrl_usize as *mut Display;
            while !shutdown_check.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(500));
            }
            debug!("Shutting down XRecord context");
            XRecordDisableContext(dpy, context_handle);
            xlib::XSync(dpy, 0);
        });

        debug!("Starting XRecord loop");
        if XRecordEnableContext(dpy_data, context, Some(record_callback), ptr::null_mut()) == 0 {
            error!("XRecordEnableContext returned 0 (error)");
        }

        debug!("XRecord loop exited");

        XRecordFreeContext(dpy_data, context);
        XCloseDisplay(dpy_data);
        XCloseDisplay(dpy_ctrl);
    }
    Ok(())
}
