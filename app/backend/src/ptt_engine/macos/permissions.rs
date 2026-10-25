use std::{ffi::c_void, mem::transmute, sync::OnceLock};

use core_foundation::{
    base::TCFType,
    boolean::CFBoolean,
    bundle::CFBundle,
    dictionary::{CFDictionary, CFDictionaryRef},
    string::CFString,
};

use crate::ptt_engine::permissions::MacosPermission;

#[link(name = "ApplicationServices", kind = "framework")]
#[allow(
    unsafe_code,
    reason = "SAFETY: declarations match Apple's AXUIElement.h ABI"
)]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
}

type InputAccessFn = unsafe extern "C" fn() -> bool;

enum InputAccessApi {
    Legacy,
    Available {
        check: InputAccessFn,
        request: InputAccessFn,
    },
    Unavailable,
}

fn input_access_api() -> &'static InputAccessApi {
    static API: OnceLock<InputAccessApi> = OnceLock::new();
    API.get_or_init(|| {
        let Some(bundle) = CFBundle::bundle_with_identifier(CFString::from_static_string(
            "com.apple.CoreGraphics",
        )) else {
            return InputAccessApi::Unavailable;
        };
        // These symbols were introduced in 10.15. Resolve them at runtime so the
        // app can still start on 10.13/10.14, before Input Monitoring existed.
        let check = bundle.function_pointer_for_name(CFString::from_static_string(
            "CGPreflightListenEventAccess",
        ));
        let request = bundle.function_pointer_for_name(CFString::from_static_string(
            "CGRequestListenEventAccess",
        ));
        if check.is_null() && request.is_null() {
            return InputAccessApi::Legacy;
        }
        if check.is_null() || request.is_null() {
            return InputAccessApi::Unavailable;
        }
        #[allow(
            unsafe_code,
            reason = "SAFETY: non-null CoreGraphics symbols have the bool(void) ABI in CGEvent.h; the linked system framework remains loaded for the process lifetime"
        )]
        unsafe {
            InputAccessApi::Available {
                check: transmute::<*const c_void, InputAccessFn>(check),
                request: transmute::<*const c_void, InputAccessFn>(request),
            }
        }
    })
}

pub(super) fn accessibility_granted() -> bool {
    #[allow(
        unsafe_code,
        reason = "SAFETY: passive system query takes no arguments"
    )]
    unsafe {
        AXIsProcessTrusted() != 0
    }
}

pub(super) fn input_monitoring_granted() -> bool {
    match input_access_api() {
        InputAccessApi::Legacy => true,
        InputAccessApi::Unavailable => false,
        InputAccessApi::Available { check, .. } => {
            #[allow(
                unsafe_code,
                reason = "SAFETY: validated CoreGraphics bool(void) function; only checks access and never prompts"
            )]
            unsafe {
                check()
            }
        }
    }
}

pub(crate) fn request(permission: MacosPermission) -> Result<(), String> {
    match permission {
        MacosPermission::Accessibility => {
            let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
            let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
            #[allow(
                unsafe_code,
                reason = "SAFETY: valid options dictionary is retained for the synchronous, explicitly user-triggered permission request"
            )]
            unsafe {
                AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef());
            }
        }
        MacosPermission::InputMonitoring => match input_access_api() {
            InputAccessApi::Legacy => {}
            InputAccessApi::Unavailable => return Err("Input Monitoring is unavailable".into()),
            InputAccessApi::Available { request, .. } => {
                #[allow(
                    unsafe_code,
                    reason = "SAFETY: validated CoreGraphics bool(void) function, invoked only by an explicit permission request"
                )]
                unsafe {
                    request();
                }
            }
        },
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_system_input_access_api_without_requesting_permission() {
        assert!(!matches!(input_access_api(), InputAccessApi::Unavailable));
    }
}
