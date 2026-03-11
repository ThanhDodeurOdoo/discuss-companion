use std::{
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
use windows_sys::Win32::{
    Foundation::{GetLastError, LPARAM, LRESULT, WPARAM},
    System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
    UI::{
        Input::KeyboardAndMouse as key,
        WindowsAndMessaging::{
            CallNextHookEx, DispatchMessageW, GetMessageW, HHOOK, KBDLLHOOKSTRUCT, LLKHF_INJECTED,
            LLKHF_LOWER_IL_INJECTED, MSG, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
            UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN,
            WM_SYSKEYUP,
        },
    },
};

use crate::{
    protocol::{KeyBinding, Modifiers, PttState, current_timestamp, universal::keyboard as kb},
    ptt_engine::{PttEngine, PttEvent},
};

static HELD: AtomicBool = AtomicBool::new(false);
static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static BINDING_PACKED: AtomicU32 = AtomicU32::new(DEFAULT_BINDING_PACKED);
static EVENT_SENDER: OnceLock<Sender<PttEvent>> = OnceLock::new();
static PRIMARY_KEY_HELD: AtomicBool = AtomicBool::new(false);

#[allow(
    clippy::as_conversions,
    reason = "const packed binding needs a safe widening cast"
)]
const DEFAULT_BINDING_PACKED: u32 = (kb::KEY_SPACE as u32) << 8;

const MOD_MASK_SHIFT: u8 = 1 << 0;
const MOD_MASK_CONTROL: u8 = 1 << 1;
const MOD_MASK_ALT: u8 = 1 << 2;
const MOD_MASK_META: u8 = 1 << 3;

pub struct WindowsEngine;

impl PttEngine for WindowsEngine {
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
        info!("Forcing PTT UP (Safety Release)");
        set_ptt_held(false);
        PRIMARY_KEY_HELD.store(false, Ordering::Release);
        let binding = self.get_binding();
        let ts = current_timestamp();
        send_event(PttEvent::PttUp { ts, key: binding });
    }

    fn check_accessibility_permission(&self) -> bool {
        true
    }

    fn start_engine(&self, sender: Sender<PttEvent>, shutdown: &Arc<AtomicBool>) -> Result<()> {
        EVENT_SENDER
            .set(sender)
            .map_err(|_sender| anyhow!("Event sender already initialized"))?;
        run_keyboard_hook_loop(shutdown)
    }
}

pub fn get_engine() -> &'static WindowsEngine {
    static ENGINE: WindowsEngine = WindowsEngine;
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

fn modifiers_from_mask(mask: u8) -> Modifiers {
    Modifiers::from_bits(mask)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PttTransition {
    Down { is_repeat: bool },
    Up,
}

fn is_modifier_key(universal_keycode: u16) -> bool {
    matches!(
        universal_keycode,
        kb::KEY_META | kb::KEY_SHIFT | kb::KEY_ALT | kb::KEY_CONTROL
    )
}

fn should_record_key_event(keycode: u16, is_key_down: bool) -> bool {
    is_key_down && !is_modifier_key(keycode)
}

fn next_primary_key_state(
    current_primary_held: bool,
    keycode: u16,
    binding_code: u16,
    is_key_down: bool,
    is_key_up: bool,
) -> bool {
    if keycode != binding_code {
        return current_primary_held;
    }
    if is_key_down {
        return true;
    }
    if is_key_up {
        return false;
    }
    current_primary_held
}

fn next_ptt_transition(
    current_state: PttState,
    primary_held: bool,
    modifiers_match: bool,
    keycode: u16,
    binding_code: u16,
    is_key_down: bool,
) -> Option<PttTransition> {
    let should_be_active = primary_held && modifiers_match;
    match current_state {
        PttState::Idle if should_be_active => Some(PttTransition::Down { is_repeat: false }),
        PttState::Held if !should_be_active => Some(PttTransition::Up),
        PttState::Held if keycode == binding_code && is_key_down => {
            Some(PttTransition::Down { is_repeat: true })
        }
        PttState::Idle | PttState::Held => None,
    }
}

fn map_windows_modifiers_from_states(states: &[(bool, u8)]) -> u8 {
    states.iter().fold(0, |mask, (is_pressed, modifier_mask)| {
        if *is_pressed {
            mask | *modifier_mask
        } else {
            mask
        }
    })
}

fn is_windows_vk_down(vk: i32) -> bool {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: key::GetAsyncKeyState is a Win32 API call with a valid virtual-key integer."
    )]
    let state = unsafe { key::GetAsyncKeyState(vk) };
    state < 0
}

fn map_windows_modifiers() -> u8 {
    let shift = is_windows_vk_down(i32::from(key::VK_SHIFT));
    let control = is_windows_vk_down(i32::from(key::VK_CONTROL));
    let alt = is_windows_vk_down(i32::from(key::VK_MENU));
    let meta =
        is_windows_vk_down(i32::from(key::VK_LWIN)) || is_windows_vk_down(i32::from(key::VK_RWIN));

    let mask = map_windows_modifiers_from_states(&[
        (shift, MOD_MASK_SHIFT),
        (control, MOD_MASK_CONTROL),
        (alt, MOD_MASK_ALT),
        (meta, MOD_MASK_META),
    ]);
    debug!(
        "Map modifiers: shift={} control={} alt={} meta={} -> mask={}",
        shift, control, alt, meta, mask
    );
    mask
}

fn windows_vk_to_universal_keycode(vk: u16) -> Option<u16> {
    Some(match vk {
        key::VK_ESCAPE => kb::KEY_ESCAPE,
        key::VK_F1 => kb::KEY_F1,
        key::VK_F2 => kb::KEY_F2,
        key::VK_F3 => kb::KEY_F3,
        key::VK_F4 => kb::KEY_F4,
        key::VK_F5 => kb::KEY_F5,
        key::VK_F6 => kb::KEY_F6,
        key::VK_F7 => kb::KEY_F7,
        key::VK_F8 => kb::KEY_F8,
        key::VK_F9 => kb::KEY_F9,
        key::VK_F10 => kb::KEY_F10,
        key::VK_F11 => kb::KEY_F11,
        key::VK_F12 => kb::KEY_F12,
        key::VK_OEM_3 => kb::KEY_GRAVE,
        key::VK_1 => kb::KEY_1,
        key::VK_2 => kb::KEY_2,
        key::VK_3 => kb::KEY_3,
        key::VK_4 => kb::KEY_4,
        key::VK_5 => kb::KEY_5,
        key::VK_6 => kb::KEY_6,
        key::VK_7 => kb::KEY_7,
        key::VK_8 => kb::KEY_8,
        key::VK_9 => kb::KEY_9,
        key::VK_0 => kb::KEY_0,
        key::VK_OEM_MINUS => kb::KEY_MINUS,
        key::VK_OEM_PLUS => kb::KEY_EQUAL,
        key::VK_BACK => kb::KEY_BACKSPACE,
        key::VK_TAB => kb::KEY_TAB,
        key::VK_Q => kb::KEY_Q,
        key::VK_W => kb::KEY_W,
        key::VK_E => kb::KEY_E,
        key::VK_R => kb::KEY_R,
        key::VK_T => kb::KEY_T,
        key::VK_Y => kb::KEY_Y,
        key::VK_U => kb::KEY_U,
        key::VK_I => kb::KEY_I,
        key::VK_O => kb::KEY_O,
        key::VK_P => kb::KEY_P,
        key::VK_OEM_4 => kb::KEY_LEFT_BRACKET,
        key::VK_OEM_6 => kb::KEY_RIGHT_BRACKET,
        key::VK_RETURN => kb::KEY_RETURN,
        key::VK_A => kb::KEY_A,
        key::VK_S => kb::KEY_S,
        key::VK_D => kb::KEY_D,
        key::VK_F => kb::KEY_F,
        key::VK_G => kb::KEY_G,
        key::VK_H => kb::KEY_H,
        key::VK_J => kb::KEY_J,
        key::VK_K => kb::KEY_K,
        key::VK_L => kb::KEY_L,
        key::VK_OEM_1 => kb::KEY_SEMICOLON,
        key::VK_OEM_7 => kb::KEY_QUOTE,
        key::VK_OEM_5 => kb::KEY_BACKSLASH,
        key::VK_SHIFT | key::VK_LSHIFT | key::VK_RSHIFT => kb::KEY_SHIFT,
        key::VK_Z => kb::KEY_Z,
        key::VK_X => kb::KEY_X,
        key::VK_C => kb::KEY_C,
        key::VK_V => kb::KEY_V,
        key::VK_B => kb::KEY_B,
        key::VK_N => kb::KEY_N,
        key::VK_M => kb::KEY_M,
        key::VK_OEM_COMMA => kb::KEY_COMMA,
        key::VK_OEM_PERIOD => kb::KEY_PERIOD,
        key::VK_OEM_2 => kb::KEY_SLASH,
        key::VK_CONTROL | key::VK_LCONTROL | key::VK_RCONTROL => kb::KEY_CONTROL,
        key::VK_MENU | key::VK_LMENU | key::VK_RMENU => kb::KEY_ALT,
        key::VK_SPACE => kb::KEY_SPACE,
        key::VK_LWIN | key::VK_RWIN => kb::KEY_META,
        key::VK_UP => kb::KEY_UP,
        key::VK_DOWN => kb::KEY_DOWN,
        key::VK_LEFT => kb::KEY_LEFT,
        key::VK_RIGHT => kb::KEY_RIGHT,
        key::VK_NUMPAD0 => kb::KEY_KEYPAD_0,
        key::VK_NUMPAD1 => kb::KEY_KEYPAD_1,
        key::VK_NUMPAD2 => kb::KEY_KEYPAD_2,
        key::VK_NUMPAD3 => kb::KEY_KEYPAD_3,
        key::VK_NUMPAD4 => kb::KEY_KEYPAD_4,
        key::VK_NUMPAD5 => kb::KEY_KEYPAD_5,
        key::VK_NUMPAD6 => kb::KEY_KEYPAD_6,
        key::VK_NUMPAD7 => kb::KEY_KEYPAD_7,
        key::VK_NUMPAD8 => kb::KEY_KEYPAD_8,
        key::VK_NUMPAD9 => kb::KEY_KEYPAD_9,
        key::VK_DECIMAL => kb::KEY_KEYPAD_DECIMAL,
        key::VK_MULTIPLY => kb::KEY_KEYPAD_MULTIPLY,
        key::VK_ADD => kb::KEY_KEYPAD_ADD,
        key::VK_SUBTRACT => kb::KEY_KEYPAD_SUBTRACT,
        key::VK_DIVIDE => kb::KEY_KEYPAD_DIVIDE,
        _ => return None,
    })
}

fn should_process_message(message: u32) -> bool {
    matches!(message, WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP)
}

fn handle_key_event(message: u32, vk: u16) {
    let Some(keycode) = windows_vk_to_universal_keycode(vk) else {
        debug!("Ignoring unmapped Windows key event: vk={}", vk);
        return;
    };

    let is_key_down = matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN);
    let is_key_up = matches!(message, WM_KEYUP | WM_SYSKEYUP);
    let packed_binding = BINDING_PACKED.load(Ordering::Acquire);
    let (binding_code, binding_mask) = unpack_binding(packed_binding);
    let recording = IS_RECORDING.load(Ordering::Acquire);

    if recording {
        if should_record_key_event(keycode, is_key_down) {
            let modifiers_mask = map_windows_modifiers();
            let modifiers = modifiers_from_mask(modifiers_mask);
            let ts = current_timestamp();
            send_event(PttEvent::PttDown {
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

    if is_modifier_key(keycode) && keycode == binding_code {
        debug!(
            "Ignoring modifier-only binding event: code={} (vk={})",
            keycode, vk
        );
        return;
    }

    let is_modifier_event = is_modifier_key(keycode);
    if keycode != binding_code && !is_modifier_event {
        return;
    }

    let current_primary_held = PRIMARY_KEY_HELD.load(Ordering::Acquire);
    let primary_held = next_primary_key_state(
        current_primary_held,
        keycode,
        binding_code,
        is_key_down,
        is_key_up,
    );
    if primary_held != current_primary_held {
        PRIMARY_KEY_HELD.store(primary_held, Ordering::Release);
    }

    let modifiers_mask = map_windows_modifiers();
    let modifiers_match = modifiers_mask == binding_mask;
    let current_ptt_state = get_ptt_state();
    debug!(
        "Checking match: keycode {}=={}, primary_held={}, mask {}=={}, message={} current_state={:?}",
        keycode,
        binding_code,
        primary_held,
        modifiers_mask,
        binding_mask,
        message,
        current_ptt_state
    );

    let ts = current_timestamp();
    match next_ptt_transition(
        current_ptt_state,
        primary_held,
        modifiers_match,
        keycode,
        binding_code,
        is_key_down,
    ) {
        Some(PttTransition::Down { is_repeat }) => {
            if !is_repeat {
                set_ptt_held(true);
            }
            let binding = binding_from_packed(packed_binding);
            send_event(PttEvent::PttDown {
                ts,
                key: binding,
                is_repeat,
            });
        }
        Some(PttTransition::Up) => {
            set_ptt_held(false);
            let binding = binding_from_packed(packed_binding);
            send_event(PttEvent::PttUp { ts, key: binding });
        }
        None => {}
    }
}

fn call_next_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: This forwards the keyboard hook event to the next hook in the chain.
        The parameters are forwarded unchanged from the OS callback."
    )]
    unsafe {
        CallNextHookEx(ptr::null_mut(), code, wparam, lparam)
    }
}

#[allow(
    unsafe_code,
    reason = "
    SAFETY: Win32 low-level hook callback signature requires unsafe extern.
    Pointer arguments are validated before dereferencing."
)]
unsafe extern "system" fn keyboard_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code < 0 {
        return call_next_hook(code, wparam, lparam);
    }

    let Ok(message) = u32::try_from(wparam) else {
        return call_next_hook(code, wparam, lparam);
    };
    if !should_process_message(message) {
        return call_next_hook(code, wparam, lparam);
    }

    if lparam == 0 {
        return call_next_hook(code, wparam, lparam);
    }

    #[allow(
        clippy::as_conversions,
        reason = "Win32 callback passes KBDLLHOOKSTRUCT as LPARAM and requires pointer cast."
    )]
    #[allow(
        unsafe_code,
        reason = "
        SAFETY: lparam is provided by the hook callback for keyboard events and points to a
        valid KBDLLHOOKSTRUCT for the duration of this callback."
    )]
    let hook_struct = unsafe { (lparam as *const KBDLLHOOKSTRUCT).as_ref() };
    let Some(hook_struct) = hook_struct else {
        return call_next_hook(code, wparam, lparam);
    };

    let is_injected = (hook_struct.flags & LLKHF_INJECTED) != 0
        || (hook_struct.flags & LLKHF_LOWER_IL_INJECTED) != 0;
    if is_injected {
        return call_next_hook(code, wparam, lparam);
    }

    let Ok(vk) = u16::try_from(hook_struct.vkCode) else {
        return call_next_hook(code, wparam, lparam);
    };

    handle_key_event(message, vk);
    call_next_hook(code, wparam, lparam)
}

fn spawn_shutdown_thread(shutdown: Arc<AtomicBool>) {
    thread::spawn(move || {
        while !shutdown.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(100));
        }

        let thread_id = HOOK_THREAD_ID.load(Ordering::Acquire);
        if thread_id == 0 {
            return;
        }

        #[allow(
            unsafe_code,
            reason = "
            SAFETY: Posting WM_QUIT to a valid hook thread id to terminate its message loop."
        )]
        let posted = unsafe { PostThreadMessageW(thread_id, WM_QUIT, 0, 0) };
        if posted == 0 {
            #[allow(
                unsafe_code,
                reason = "SAFETY: GetLastError reads Win32 thread-local error state."
            )]
            let err = unsafe { GetLastError() };
            warn!("PostThreadMessageW(WM_QUIT) failed: {}", err);
        }
    });
}

fn run_keyboard_hook_loop(shutdown: &Arc<AtomicBool>) -> Result<()> {
    info!("Starting Windows low-level keyboard hook");

    #[allow(
        unsafe_code,
        reason = "
        SAFETY: GetModuleHandleW(NULL) requests the current process module handle."
    )]
    let module_handle = unsafe { GetModuleHandleW(ptr::null()) };

    #[allow(
        unsafe_code,
        reason = "
        SAFETY: Installs a low-level keyboard hook in the current process with a valid callback."
    )]
    let hook: HHOOK =
        unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), module_handle, 0) };

    if hook.is_null() {
        #[allow(
            unsafe_code,
            reason = "SAFETY: GetLastError reads Win32 thread-local error state."
        )]
        let err = unsafe { GetLastError() };
        return Err(anyhow!("SetWindowsHookExW failed with error {err}"));
    }

    #[allow(
        unsafe_code,
        reason = "SAFETY: GetCurrentThreadId reads current thread id without side effects."
    )]
    let hook_thread_id = unsafe { GetCurrentThreadId() };
    HOOK_THREAD_ID.store(hook_thread_id, Ordering::Release);
    spawn_shutdown_thread(Arc::clone(shutdown));

    let mut msg = MSG::default();
    loop {
        #[allow(
            unsafe_code,
            reason = "
            SAFETY: GetMessageW is called with a valid MSG pointer.
            Null HWND and zero filter values are valid to receive all thread messages."
        )]
        let get_result = unsafe { GetMessageW(&raw mut msg, ptr::null_mut(), 0, 0) };
        if get_result == -1 {
            #[allow(
                unsafe_code,
                reason = "SAFETY: GetLastError reads Win32 thread-local error state."
            )]
            let err = unsafe { GetLastError() };
            #[allow(
                unsafe_code,
                reason = "
                SAFETY: `hook` was created by SetWindowsHookExW and must be released once."
            )]
            unsafe {
                UnhookWindowsHookEx(hook);
            }
            HOOK_THREAD_ID.store(0, Ordering::Release);
            return Err(anyhow!("GetMessageW failed with error {err}"));
        }
        if get_result == 0 {
            break;
        }

        #[allow(
            unsafe_code,
            reason = "
            SAFETY: MSG was initialized by GetMessageW and is valid for translation/dispatch."
        )]
        unsafe {
            TranslateMessage(&raw const msg);
            DispatchMessageW(&raw const msg);
        }
    }

    #[allow(
        unsafe_code,
        reason = "
        SAFETY: `hook` was created by SetWindowsHookExW and must be released once."
    )]
    unsafe {
        UnhookWindowsHookEx(hook);
    }
    HOOK_THREAD_ID.store(0, Ordering::Release);
    info!("Windows keyboard hook stopped");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Modifier;

    #[test]
    fn test_binding_storage() {
        let engine = WindowsEngine;
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
    fn test_pack_unpack_binding_roundtrip() {
        let binding = KeyBinding {
            code: 49,
            modifiers: [Modifier::Shift, Modifier::Control].into_iter().collect(),
        };
        let packed = pack_binding(binding);
        let unpacked = binding_from_packed(packed);
        assert_eq!(unpacked, binding);
    }

    #[test]
    fn test_windows_keycode_conversion() {
        assert_eq!(
            windows_vk_to_universal_keycode(key::VK_SPACE),
            Some(kb::KEY_SPACE)
        );
        assert_eq!(windows_vk_to_universal_keycode(key::VK_A), Some(kb::KEY_A));
        assert_eq!(
            windows_vk_to_universal_keycode(key::VK_LEFT),
            Some(kb::KEY_LEFT)
        );
        assert_eq!(
            windows_vk_to_universal_keycode(key::VK_F12),
            Some(kb::KEY_F12)
        );
        assert_eq!(
            windows_vk_to_universal_keycode(key::VK_LWIN),
            Some(kb::KEY_META)
        );
        assert_eq!(windows_vk_to_universal_keycode(key::VK_DELETE), None);
    }

    #[test]
    fn test_modifiers_mask_from_states() {
        let mask = map_windows_modifiers_from_states(&[
            (true, MOD_MASK_SHIFT),
            (false, MOD_MASK_CONTROL),
            (true, MOD_MASK_ALT),
            (true, MOD_MASK_META),
        ]);
        let mods = modifiers_from_mask(mask);
        assert!(mods.contains(Modifier::Shift));
        assert!(mods.contains(Modifier::Alt));
        assert!(mods.contains(Modifier::Meta));
        assert!(!mods.contains(Modifier::Control));
    }

    #[test]
    fn test_primary_key_state_tracks_binding_key() {
        assert!(next_primary_key_state(
            true,
            kb::KEY_SPACE,
            kb::KEY_SPACE,
            true,
            false
        ));
        assert!(next_primary_key_state(
            false,
            kb::KEY_SPACE,
            kb::KEY_SPACE,
            true,
            false
        ));
        assert!(!next_primary_key_state(
            true,
            kb::KEY_SPACE,
            kb::KEY_SPACE,
            false,
            true
        ));
        assert!(next_primary_key_state(
            true,
            kb::KEY_CONTROL,
            kb::KEY_SPACE,
            false,
            true
        ));
    }

    #[test]
    fn test_modifier_release_deactivates_active_chord() {
        assert_eq!(
            next_ptt_transition(
                PttState::Held,
                true,
                false,
                kb::KEY_CONTROL,
                kb::KEY_SPACE,
                false
            ),
            Some(PttTransition::Up)
        );
    }

    #[test]
    fn test_modifier_press_activates_when_primary_is_already_held() {
        assert_eq!(
            next_ptt_transition(
                PttState::Idle,
                true,
                true,
                kb::KEY_CONTROL,
                kb::KEY_SPACE,
                true
            ),
            Some(PttTransition::Down { is_repeat: false })
        );
    }

    #[test]
    fn test_recording_ignores_modifier_only_keydown() {
        assert!(!should_record_key_event(kb::KEY_CONTROL, true));
        assert!(!should_record_key_event(kb::KEY_ALT, true));
        assert!(!should_record_key_event(kb::KEY_T, false));
        assert!(should_record_key_event(kb::KEY_T, true));
    }
}
