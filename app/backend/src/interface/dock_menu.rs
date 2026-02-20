use std::{
    ffi::c_void,
    mem, ptr,
    sync::{
        Once,
        atomic::{AtomicPtr, Ordering},
    },
};

use muda::{ContextMenu, IconMenuItem, MenuItem, Submenu};
use objc2::{
    MainThreadMarker,
    ffi::class_addMethod,
    runtime::{AnyClass, AnyObject, Imp, ProtocolObject, Sel},
    sel,
};
use objc2_app_kit::{NSApplication, NSApplicationDelegate};
use tauri::{AppHandle, Manager, Runtime};
use tracing::warn;

use super::call_controls_menu;
use crate::{WsState, protocol::CallState};

pub const DOCK_MENU_SHOW_CALL_CONTROLS_ID: &str = "dock-call-controls";

static DOCK_MENU_PTR: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
static DOCK_MENU_INIT: Once = Once::new();

/// Sets up the macOS dock menu integration.
///
/// # Errors
/// Returns any error coming from Tauri's main-thread scheduling.
pub fn setup_dock_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<()> {
    let call_state = app_handle
        .try_state::<WsState>()
        .and_then(|state| state.call_state.read().ok().and_then(|guard| *guard));
    let app_handle = app_handle.clone();
    let mut init_result = Ok(());
    DOCK_MENU_INIT.call_once(|| {
        init_result = app_handle.run_on_main_thread(move || install_dock_menu(call_state));
    });
    init_result
}

/// Updates the macOS dock menu to reflect the latest call state.
///
/// # Errors
/// Returns any error coming from Tauri's main-thread scheduling.
pub fn update_dock_menu<R: Runtime>(
    app_handle: &AppHandle<R>,
    call_state: Option<CallState>,
) -> tauri::Result<()> {
    if DOCK_MENU_PTR.load(Ordering::Acquire).is_null() {
        return Ok(());
    }
    let app_handle = app_handle.clone();
    app_handle.run_on_main_thread(move || update_dock_menu_inner(call_state))
}

fn install_dock_menu(call_state: Option<CallState>) {
    let Some(mtm) = MainThreadMarker::new() else {
        warn!("Dock menu setup skipped: not on main thread.");
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(delegate) = app.delegate() else {
        warn!("Dock menu setup skipped: NSApplication delegate unavailable.");
        return;
    };

    let delegate_ref: &ProtocolObject<dyn NSApplicationDelegate> = &delegate;
    let delegate_obj: &AnyObject = delegate_ref.as_ref();
    let delegate_class = delegate_obj.class();

    let selector = sel!(applicationDockMenu:);
    if delegate_class.instance_method(selector).is_some() {
        warn!("Dock menu setup skipped: delegate already implements applicationDockMenu:.");
        return;
    }

    let ns_menu_ptr = build_dock_menu(call_state);
    if ns_menu_ptr.is_null() {
        warn!("Dock menu setup skipped: failed to build dock menu.");
        return;
    }

    DOCK_MENU_PTR.store(ns_menu_ptr, Ordering::Release);

    // Objective-c type encoding for: `(id)applicationDockMenu:(id)sender`
    //
    // In Objective-C methods always have two hidden arguments:
    // 1. `self` (the receiver object)
    // 2. `_cmd` (the selector for the method)
    //
    // We must passe this string explicitely to `class_addMethod` because we are
    // modifying the class at runtime. Unlike a compiled Objective-Cfile where
    // the compiler generate these signatures, the runtime needs this manual
    // hint to know the stack layout and type sizes for the method's arguments.
    //
    // The encoding string is structured as: [return_type][self][_cmd][arg1]
    // - `@` : object (the returned NSMenu)
    // - `@` : object (the hidden `self` argument)
    // - `:` : selector (the hidden `_cmd` argument)
    // - `@` : object (the `sender` argument)
    // - `\0`: null terminator for C copatibility
    let types = b"@@:@\0";
    #[allow(
        unsafe_code,
        reason = "Objective-C runtime method injection requires FFI call to class_addMethod."
    )]
    unsafe {
        let class_ptr = ptr::from_ref::<AnyClass>(delegate_class).cast_mut();
        let imp = mem::transmute::<
            unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut AnyObject,
            Imp,
        >(application_dock_menu);
        let added = class_addMethod(class_ptr, selector, imp, types.as_ptr().cast());
        if !added.as_bool() {
            warn!("Failed to add applicationDockMenu: to NSApplication delegate.");
        }
    }
}

fn update_dock_menu_inner(call_state: Option<CallState>) {
    let ns_menu_ptr = build_dock_menu(call_state);
    if ns_menu_ptr.is_null() {
        warn!("Dock menu update skipped: failed to build dock menu.");
        return;
    }
    DOCK_MENU_PTR.store(ns_menu_ptr, Ordering::Release);
}

fn build_dock_menu(call_state: Option<CallState>) -> *mut c_void {
    let show_item = MenuItem::with_id(DOCK_MENU_SHOW_CALL_CONTROLS_ID, "Call Controls", true, None);

    let submenu = Submenu::new("Dock", true);
    if let Err(err) = submenu.append(&show_item) {
        warn!("Failed to append dock menu item: {err}");
        return ptr::null_mut();
    }

    if let Some(state) = call_controls_menu::menu_state(call_state) {
        let mute_item = IconMenuItem::with_id_and_native_icon(
            call_controls_menu::CALL_MENU_TOGGLE_MUTE_ID,
            call_controls_menu::mute_label(state.is_mute),
            true,
            Some(call_controls_menu::mute_icon(state.is_mute).into()),
            None,
        );
        if let Err(err) = submenu.append(&mute_item) {
            warn!("Failed to append dock mute item: {err}");
            return ptr::null_mut();
        }

        let deaf_item = IconMenuItem::with_id_and_native_icon(
            call_controls_menu::CALL_MENU_TOGGLE_DEAF_ID,
            call_controls_menu::deaf_label(state.is_deaf),
            true,
            Some(call_controls_menu::deaf_icon(state.is_deaf).into()),
            None,
        );
        if let Err(err) = submenu.append(&deaf_item) {
            warn!("Failed to append dock deafen item: {err}");
            return ptr::null_mut();
        }

        let go_to_call = IconMenuItem::with_id_and_native_icon(
            call_controls_menu::CALL_MENU_GO_TO_CALL_ID,
            call_controls_menu::go_to_call_label(),
            true,
            Some(call_controls_menu::go_to_call_icon().into()),
            None,
        );
        if let Err(err) = submenu.append(&go_to_call) {
            warn!("Failed to append dock go-to-call item: {err}");
            return ptr::null_mut();
        }
    }

    let submenu = Box::new(submenu);
    let submenu = Box::leak(submenu);
    submenu.ns_menu()
}

#[allow(
    unsafe_code,
    reason = "Objective-C runtime callbacks are inherently unsafe extern functions."
)]
unsafe extern "C-unwind" fn application_dock_menu(
    _this: &AnyObject,
    _sel: Sel,
    _sender: *mut AnyObject,
) -> *mut AnyObject {
    DOCK_MENU_PTR.load(Ordering::Acquire).cast()
}
