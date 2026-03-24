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
    protocol::{KeyBinding, Modifiers, PttState, current_timestamp, keyboard as kb},
    ptt_engine::{PttEngine, PttEvent},
};

static HELD: AtomicBool = AtomicBool::new(false);
static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static BINDING_PACKED: AtomicU32 = AtomicU32::new(DEFAULT_BINDING_PACKED);
static EVENT_SENDER: OnceLock<Sender<PttEvent>> = OnceLock::new();

#[derive(Clone, Copy)]
pub struct LinuxX11Engine;

#[allow(
    clippy::as_conversions,
    reason = "const packed binding needs a safe widening cast"
)]
const DEFAULT_BINDING_PACKED: u32 = (kb::KEY_SPACE as u32) << 8;

// X11 Key masks (from X.h / Xlib.h)
const SHIFT_MASK: u32 = 1 << 0;
const _LOCK_MASK: u32 = 1 << 1;
const CONTROL_MASK: u32 = 1 << 2;
const MOD1_MASK: u32 = 1 << 3; // Alt
const _MOD2_MASK: u32 = 1 << 4;
const _MOD3_MASK: u32 = 1 << 5;
const MOD4_MASK: u32 = 1 << 6; // Meta / Super
const _MOD5_MASK: u32 = 1 << 7;

impl PttEngine for LinuxX11Engine {
    fn set_binding(&self, binding: KeyBinding) {
        let packed = pack_binding(binding);
        debug!("Setting binding: {:?} (packed: {})", binding, packed);
        BINDING_PACKED.store(packed, Ordering::Release);
    }

    fn set_recording(&self, recording: bool) {
        IS_RECORDING.store(recording, Ordering::Release);
    }

    fn get_binding(&self) -> KeyBinding {
        binding_from_packed(BINDING_PACKED.load(Ordering::Acquire))
    }

    fn force_ptt_up(&self) {
        debug!("Forcing PTT UP (Safety Release)");
        set_ptt_held(false);
        let binding = self.get_binding();
        let ts = current_timestamp();
        send_event(PttEvent::PttUp { ts, key: binding });
    }

    fn check_accessibility_permission(&self) -> bool {
        #[allow(
            unsafe_code,
            reason = "
            SAFETY: XOpenDisplay is an Xlib FFI call. We pass NULL to request the default DISPLAY
            and verify the returned pointer for null before use."
        )]
        let dpy = unsafe { XOpenDisplay(ptr::null()) };
        if dpy.is_null() {
            warn!("XOpenDisplay failed in permission check");
            return false;
        }
        #[allow(
            unsafe_code,
            reason = "
            SAFETY: dpy was returned from XOpenDisplay and checked for null."
        )]
        unsafe {
            XCloseDisplay(dpy);
        }
        true
    }

    fn start_engine(&self, sender: Sender<PttEvent>, shutdown: &Arc<AtomicBool>) -> Result<()> {
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

pub fn get_engine() -> &'static LinuxX11Engine {
    static ENGINE: LinuxX11Engine = LinuxX11Engine;
    &ENGINE
}

fn set_ptt_held(held: bool) {
    HELD.store(held, Ordering::Release);
}

fn get_ptt_state() -> PttState {
    if HELD.load(Ordering::Acquire) {
        PttState::Held
    } else {
        PttState::Idle
    }
}

fn send_event(msg: PttEvent) {
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

fn free_record_data(raw_datum: *mut xrecord::XRecordInterceptData) {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: raw_datum is a non-null pointer provided by XRecord that must be released."
    )]
    unsafe {
        XRecordFreeData(raw_datum);
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
    if raw_datum.is_null() {
        return;
    }

    // SAFETY: raw_datum is non-null and provided by XRecord for the callback lifetime.
    let datum = unsafe { *raw_datum };
    debug!(
        "XRecord callback: category={}, len={}",
        datum.category, datum.data_len
    );

    if datum.category != XRecordFromServer {
        free_record_data(raw_datum);
        return;
    }

    // data_len is in 4-byte units (8 units = 32 bytes)
    if datum.data_len >= 8 {
        let Ok(len_bytes) = usize::try_from(datum.data_len * 4) else {
            free_record_data(raw_datum);
            return;
        };

        if datum.data.is_null() {
            free_record_data(raw_datum);
            return;
        }

        #[allow(
            clippy::absolute_paths,
            reason = "slice::from_raw_parts requires explicit path or import, std is fine"
        )]
        // SAFETY: datum.data is non-null and len_bytes is derived from the XRecord payload size.
        let data =
            unsafe { std::slice::from_raw_parts(datum.data.cast_const().cast::<u8>(), len_bytes) };

        let Some(&type_code) = data.first() else {
            free_record_data(raw_datum);
            return;
        };

        // KeyPress=2, KeyRelease=3
        if type_code == 2 || type_code == 3 {
            let Some(&keycode) = data.get(1) else {
                free_record_data(raw_datum);
                return;
            };

            // State is at offset 28 (u16)
            let (Some(&byte28), Some(&byte29)) = (data.get(28), data.get(29)) else {
                free_record_data(raw_datum);
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

    free_record_data(raw_datum);
}

fn handle_key_event(type_code: i32, keycode: u8, state: u32) {
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

    let packed_binding = BINDING_PACKED.load(Ordering::Acquire);
    let (binding_code, binding_mask) = unpack_binding(packed_binding);
    let recording = IS_RECORDING.load(Ordering::Acquire);

    let ts = current_timestamp();

    if recording {
        if type_code == KeyPress {
            debug!(
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
            send_event(PttEvent::PttDown {
                ts,
                key: binding,
                is_repeat: false,
            });
        } else if should_be_active && matches!(current_ptt_state, PttState::Held) {
            let binding = binding_from_packed(packed_binding);
            send_event(PttEvent::PttDown {
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
        send_event(PttEvent::PttUp { ts, key: binding });
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
        9 => kb::KEY_ESCAPE,
        67 => kb::KEY_F1,
        68 => kb::KEY_F2,
        69 => kb::KEY_F3,
        70 => kb::KEY_F4,
        71 => kb::KEY_F5,
        72 => kb::KEY_F6,
        73 => kb::KEY_F7,
        74 => kb::KEY_F8,
        75 => kb::KEY_F9,
        76 => kb::KEY_F10,
        95 => kb::KEY_F11,
        96 => kb::KEY_F12,
        49 => kb::KEY_GRAVE,
        10 => kb::KEY_1,
        11 => kb::KEY_2,
        12 => kb::KEY_3,
        13 => kb::KEY_4,
        14 => kb::KEY_5,
        15 => kb::KEY_6,
        16 => kb::KEY_7,
        17 => kb::KEY_8,
        18 => kb::KEY_9,
        19 => kb::KEY_0,
        20 => kb::KEY_MINUS,
        21 => kb::KEY_EQUAL,
        22 => kb::KEY_BACKSPACE,
        23 => kb::KEY_TAB,
        24 => kb::KEY_Q,
        25 => kb::KEY_W,
        26 => kb::KEY_E,
        27 => kb::KEY_R,
        28 => kb::KEY_T,
        29 => kb::KEY_Y,
        30 => kb::KEY_U,
        31 => kb::KEY_I,
        32 => kb::KEY_O,
        33 => kb::KEY_P,
        34 => kb::KEY_LEFT_BRACKET,
        35 => kb::KEY_RIGHT_BRACKET,
        36 => kb::KEY_RETURN,
        38 => kb::KEY_A,
        39 => kb::KEY_S,
        40 => kb::KEY_D,
        41 => kb::KEY_F,
        42 => kb::KEY_G,
        43 => kb::KEY_H,
        44 => kb::KEY_J,
        45 => kb::KEY_K,
        46 => kb::KEY_L,
        47 => kb::KEY_SEMICOLON,
        48 => kb::KEY_QUOTE,
        51 => kb::KEY_BACKSLASH,
        50 | 62 => kb::KEY_SHIFT,
        52 => kb::KEY_Z,
        53 => kb::KEY_X,
        54 => kb::KEY_C,
        55 => kb::KEY_V,
        56 => kb::KEY_B,
        57 => kb::KEY_N,
        58 => kb::KEY_M,
        59 => kb::KEY_COMMA,
        60 => kb::KEY_PERIOD,
        61 => kb::KEY_SLASH,
        37 | 105 => kb::KEY_CONTROL,
        64 | 108 => kb::KEY_ALT,
        65 => kb::KEY_SPACE,
        133 | 134 => kb::KEY_META,
        111 => kb::KEY_UP,
        116 => kb::KEY_DOWN,
        113 => kb::KEY_LEFT,
        114 => kb::KEY_RIGHT,
        _ => x11_code,
    }
}

fn is_modifier_key(macos_keycode: u16) -> bool {
    matches!(
        macos_keycode,
        kb::KEY_META | kb::KEY_SHIFT | kb::KEY_ALT | kb::KEY_CONTROL
    )
}

const MOD_MASK_SHIFT: u8 = 1 << 0;
const MOD_MASK_CONTROL: u8 = 1 << 1;
const MOD_MASK_ALT: u8 = 1 << 2;
const MOD_MASK_META: u8 = 1 << 3;

fn modifiers_from_mask(mask: u8) -> Modifiers {
    Modifiers::from_bits(mask)
}

fn open_display(label: &str) -> Result<*mut Display> {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: XOpenDisplay is an Xlib FFI call. We pass NULL to request the default DISPLAY
        and validate the returned pointer."
    )]
    let dpy = unsafe { XOpenDisplay(ptr::null()) };
    if dpy.is_null() {
        return Err(anyhow::anyhow!("Failed to open X display for {label}"));
    }
    Ok(dpy)
}

fn close_display(dpy: *mut Display) {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: dpy was returned by XOpenDisplay and must be closed exactly once."
    )]
    unsafe {
        XCloseDisplay(dpy);
    }
}

fn close_displays(dpy_data: *mut Display, dpy_ctrl: *mut Display) {
    close_display(dpy_data);
    close_display(dpy_ctrl);
}

fn query_record_version(dpy: *mut Display) -> Result<()> {
    let mut major = 0;
    let mut minor = 0;
    #[allow(
        clippy::borrow_as_ptr,
        reason = "FFI requires passing raw pointers to mutable stack variables"
    )]
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: XRecordQueryVersion is an XRecord FFI call; dpy is a valid Display*."
    )]
    let has_record = unsafe { XRecordQueryVersion(dpy, &mut major, &mut minor) };
    if has_record == 0 {
        return Err(anyhow::anyhow!("XRecord extension not available"));
    }
    Ok(())
}

fn alloc_record_range() -> Result<*mut xrecord::XRecordRange> {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: XRecordAllocRange is an XRecord FFI call; we check for null."
    )]
    let record_range = unsafe { XRecordAllocRange() };
    if record_range.is_null() {
        return Err(anyhow::anyhow!("Failed to alloc XRecordRange"));
    }
    Ok(record_range)
}

fn init_record_range(record_range: *mut xrecord::XRecordRange, first: u8, last: u8) {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: record_range is non-null from XRecordAllocRange."
    )]
    unsafe {
        (*record_range).device_events.first = first;
        (*record_range).device_events.last = last;
    }
}

fn create_record_context(
    dpy: *mut Display,
    record_range: *mut xrecord::XRecordRange,
) -> xrecord::XRecordContext {
    let mut record_range = record_range;
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: XRecordCreateContext is an XRecord FFI call with valid pointers."
    )]
    unsafe {
        XRecordCreateContext(
            dpy,
            0,
            &mut XRecordClientSpec::from(xrecord::XRecordAllClients),
            1,
            #[allow(
                clippy::borrow_as_ptr,
                reason = "FFI requires passing raw pointer to XRecordRange"
            )]
            &mut record_range,
            1,
        )
    }
}

fn free_record_range(record_range: *mut xrecord::XRecordRange) {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: record_range was allocated by XRecordAllocRange and must be freed."
    )]
    unsafe {
        XFree(record_range.cast());
    }
}

fn sync_display(dpy: *mut Display) {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: XSync is an Xlib FFI call; dpy is valid."
    )]
    unsafe {
        xlib::XSync(dpy, 0);
    }
}

fn spawn_shutdown_thread(
    dpy_ctrl: *mut Display,
    shutdown: Arc<AtomicBool>,
    context: xrecord::XRecordContext,
) {
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
        while !shutdown.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(500));
        }
        debug!("Shutting down XRecord context");
        #[allow(
            unsafe_code,
            reason = "
            SAFETY: dpy is the control Display* and context is a valid XRecordContext."
        )]
        unsafe {
            XRecordDisableContext(dpy, context);
        }
        sync_display(dpy);
    });
}

fn enable_record_context(dpy: *mut Display, context: xrecord::XRecordContext) -> i32 {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: XRecordEnableContext is an XRecord FFI call with valid pointers."
    )]
    unsafe {
        XRecordEnableContext(dpy, context, Some(record_callback), ptr::null_mut())
    }
}

fn free_record_context(dpy: *mut Display, context: xrecord::XRecordContext) {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: context was created successfully and must be released."
    )]
    unsafe {
        XRecordFreeContext(dpy, context);
    }
}

fn run_xrecord_loop(shutdown: &Arc<AtomicBool>) -> Result<()> {
    let dpy_data = open_display("data")?;

    // Separate control connection needed: XRecordEnableContext blocks, so we
    // call XRecordDisableContext from another connection to unblock it.
    let dpy_ctrl = match open_display("control") {
        Ok(dpy_ctrl) => dpy_ctrl,
        Err(err) => {
            close_display(dpy_data);
            return Err(err);
        }
    };

    if let Err(err) = query_record_version(dpy_data) {
        close_displays(dpy_data, dpy_ctrl);
        return Err(err);
    }

    let record_range = match alloc_record_range() {
        Ok(record_range) => record_range,
        Err(err) => {
            close_displays(dpy_data, dpy_ctrl);
            return Err(err);
        }
    };

    let first = u8::try_from(KeyPress)?;
    let last = u8::try_from(KeyRelease)?;
    init_record_range(record_range, first, last);

    let context = create_record_context(dpy_data, record_range);
    free_record_range(record_range);

    if context == 0 {
        close_displays(dpy_data, dpy_ctrl);
        return Err(anyhow::anyhow!("Failed to create XRecordContext"));
    }

    sync_display(dpy_data);
    spawn_shutdown_thread(dpy_ctrl, Arc::clone(shutdown), context);

    debug!("Starting XRecord loop");
    let enable_ok = enable_record_context(dpy_data, context);
    if enable_ok == 0 {
        error!("XRecordEnableContext returned 0 (error)");
    }

    debug!("XRecord loop exited");

    free_record_context(dpy_data, context);
    close_displays(dpy_data, dpy_ctrl);
    Ok(())
}
