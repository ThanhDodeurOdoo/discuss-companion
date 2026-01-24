use crate::event_tap::{check_accessibility_permission, get_binding, set_binding, set_recording};
use crate::state::{KeyBinding, VERSION};
use tauri_plugin_store::StoreExt;

#[tauri::command]
pub fn get_version() -> String {
    VERSION.to_string()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn update_binding(app_handle: tauri::AppHandle, binding: KeyBinding) {
    set_binding(binding.clone());

    // Save to store
    if let Ok(store) = app_handle.store("settings.json") {
        store.set(
            "ptt_binding",
            serde_json::to_value(binding).unwrap_or_default(),
        );
        let _ = store.save();
    }
}

#[tauri::command]
pub fn set_recording_mode(recording: bool) {
    set_recording(recording);
}

#[tauri::command]
pub fn get_current_binding() -> KeyBinding {
    get_binding()
}

#[tauri::command]
pub fn is_accessibility_granted() -> bool {
    check_accessibility_permission()
}
