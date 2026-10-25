use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MacosPermission {
    Accessibility,
    InputMonitoring,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacosPermissionStatus {
    pub accessibility: bool,
    pub input_monitoring: bool,
    pub listener_running: bool,
}

#[must_use]
pub fn status() -> Option<MacosPermissionStatus> {
    #[cfg(target_os = "macos")]
    return Some(super::macos::permission_status());

    #[cfg(not(target_os = "macos"))]
    None
}

/// # Errors
/// Returns an error if macOS permission requests are unavailable on this platform.
pub fn request(permission: MacosPermission) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return super::macos::permissions::request(permission);

    #[cfg(not(target_os = "macos"))]
    {
        let _ = permission;
        Err("macOS permissions are not required on this platform".into())
    }
}

pub fn retry_listener() {
    #[cfg(target_os = "macos")]
    super::macos::retry_listener();
}
