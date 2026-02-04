use tauri::{AppHandle, Manager, Runtime};

#[cfg(target_os = "macos")]
use tauri::menu::NativeIcon;

use crate::{WsState, commands, state::CallState};

pub const CALL_MENU_TOGGLE_MUTE_ID: &str = "call-controls-toggle-mute";
pub const CALL_MENU_TOGGLE_DEAF_ID: &str = "call-controls-toggle-deaf";
pub const CALL_MENU_GO_TO_CALL_ID: &str = "call-controls-go-to-call";

#[derive(Clone, Copy, Debug)]
enum CallCommand {
    ToggleMicrophone,
    ToggleDeafen,
    SetMute,
    SetDeaf,
    FocusCallTab,
}

impl CallCommand {
    fn as_str(self) -> &'static str {
        match self {
            Self::ToggleMicrophone => "toggle-microphone",
            Self::ToggleDeafen => "toggle-deafen",
            Self::SetMute => "set-mute",
            Self::SetDeaf => "set-deaf",
            Self::FocusCallTab => "focus-call-tab",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CallMenuState {
    pub is_mute: bool,
    pub is_deaf: bool,
}

#[must_use]
pub fn menu_state(call_state: Option<CallState>) -> Option<CallMenuState> {
    call_state
        .filter(|state| state.has_call)
        .map(|state| CallMenuState {
            is_mute: state.is_mute,
            is_deaf: state.is_deaf,
        })
}

#[must_use]
pub fn mute_label(is_mute: bool) -> &'static str {
    if is_mute { "Unmute Mic" } else { "Mute Mic" }
}

#[must_use]
pub fn deaf_label(is_deaf: bool) -> &'static str {
    if is_deaf { "Undeafen" } else { "Deafen" }
}

#[must_use]
pub fn go_to_call_label() -> &'static str {
    "Go to Call"
}

#[cfg(target_os = "macos")]
#[must_use]
pub fn mute_icon(is_mute: bool) -> NativeIcon {
    if is_mute {
        NativeIcon::StatusUnavailable
    } else {
        NativeIcon::StatusAvailable
    }
}

#[cfg(target_os = "macos")]
#[must_use]
pub fn deaf_icon(is_deaf: bool) -> NativeIcon {
    if is_deaf {
        NativeIcon::LockLocked
    } else {
        NativeIcon::LockUnlocked
    }
}

#[cfg(target_os = "macos")]
#[must_use]
pub fn go_to_call_icon() -> NativeIcon {
    NativeIcon::GoRight
}

pub fn handle_menu_action<R: Runtime>(app_handle: &AppHandle<R>, id: &str) -> bool {
    let Some(state) = app_handle.try_state::<WsState>() else {
        return false;
    };

    match id {
        CALL_MENU_TOGGLE_MUTE_ID => {
            toggle_with_state(
                &state,
                |state| state.is_mute,
                CallCommand::SetMute,
                CallCommand::ToggleMicrophone,
            );
            true
        }
        CALL_MENU_TOGGLE_DEAF_ID => {
            toggle_with_state(
                &state,
                |state| state.is_deaf,
                CallCommand::SetDeaf,
                CallCommand::ToggleDeafen,
            );
            true
        }
        CALL_MENU_GO_TO_CALL_ID => {
            let _ =
                commands::dispatch_call_command(&state, CallCommand::FocusCallTab.as_str(), None);
            true
        }
        _ => false,
    }
}

fn toggle_with_state(
    state: &WsState,
    flag: impl Fn(CallState) -> bool,
    set_command: CallCommand,
    toggle_command: CallCommand,
) {
    let call_state = state.call_state.read().ok().and_then(|guard| *guard);
    if let Some(call_state) = call_state {
        let new_value = !flag(call_state);
        let _ = commands::dispatch_call_command(state, set_command.as_str(), Some(new_value));
    } else {
        let _ = commands::dispatch_call_command(state, toggle_command.as_str(), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call_state(has_call: bool, is_mute: bool, is_deaf: bool) -> CallState {
        CallState {
            has_call,
            has_state: true,
            is_mute,
            is_deaf,
            is_camera_on: false,
            is_screen_on: false,
        }
    }

    #[test]
    fn menu_state_filters_inactive_calls() {
        let state = call_state(false, false, false);
        assert!(menu_state(Some(state)).is_none());
    }

    #[test]
    fn menu_state_maps_flags() {
        let state = call_state(true, true, false);
        let menu = menu_state(Some(state)).expect("state should be active");
        assert!(menu.is_mute);
        assert!(!menu.is_deaf);
    }

    #[test]
    fn labels_reflect_state() {
        assert_eq!(mute_label(false), "Mute Mic");
        assert_eq!(mute_label(true), "Unmute Mic");
        assert_eq!(deaf_label(false), "Deafen");
        assert_eq!(deaf_label(true), "Undeafen");
        assert_eq!(go_to_call_label(), "Go to Call");
    }
}
