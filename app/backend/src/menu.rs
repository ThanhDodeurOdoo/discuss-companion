#[cfg(target_os = "macos")]
use tauri::menu::IconMenuItem;
use tauri::{
    Manager, Runtime,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::{WsState, call_controls_menu, call_controls_window, state::CallState};

pub const TRAY_ID: &str = "main-tray";
const TRAY_OPEN_MAIN_WINDOW_ID: &str = "open-main-window";

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray_menu<R: Runtime, M: Manager<R>>(
    manager: &M,
    call_state: Option<CallState>,
) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(manager)?;

    let open_item = MenuItem::with_id(
        manager,
        TRAY_OPEN_MAIN_WINDOW_ID,
        "Open",
        true,
        None::<&str>,
    )?;
    menu.append(&open_item)?;

    if let Some(state) = call_controls_menu::menu_state(call_state) {
        #[cfg(target_os = "macos")]
        {
            let mute_item = IconMenuItem::with_id_and_native_icon(
                manager,
                call_controls_menu::CALL_MENU_TOGGLE_MUTE_ID,
                call_controls_menu::mute_label(state.is_mute),
                true,
                Some(call_controls_menu::mute_icon(state.is_mute)),
                None::<&str>,
            )?;
            menu.append(&mute_item)?;

            let deaf_item = IconMenuItem::with_id_and_native_icon(
                manager,
                call_controls_menu::CALL_MENU_TOGGLE_DEAF_ID,
                call_controls_menu::deaf_label(state.is_deaf),
                true,
                Some(call_controls_menu::deaf_icon(state.is_deaf)),
                None::<&str>,
            )?;
            menu.append(&deaf_item)?;

            let go_to_call = IconMenuItem::with_id_and_native_icon(
                manager,
                call_controls_menu::CALL_MENU_GO_TO_CALL_ID,
                call_controls_menu::go_to_call_label(),
                true,
                Some(call_controls_menu::go_to_call_icon()),
                None::<&str>,
            )?;
            menu.append(&go_to_call)?;
        }

        #[cfg(not(target_os = "macos"))]
        {
            let mute_item = MenuItem::with_id(
                manager,
                call_controls_menu::CALL_MENU_TOGGLE_MUTE_ID,
                call_controls_menu::mute_label(state.is_mute),
                true,
                None::<&str>,
            )?;
            menu.append(&mute_item)?;

            let deaf_item = MenuItem::with_id(
                manager,
                call_controls_menu::CALL_MENU_TOGGLE_DEAF_ID,
                call_controls_menu::deaf_label(state.is_deaf),
                true,
                None::<&str>,
            )?;
            menu.append(&deaf_item)?;

            let go_to_call = MenuItem::with_id(
                manager,
                call_controls_menu::CALL_MENU_GO_TO_CALL_ID,
                call_controls_menu::go_to_call_label(),
                true,
                None::<&str>,
            )?;
            menu.append(&go_to_call)?;
        }
    }

    let quit_i = MenuItem::with_id(manager, "quit", "Quit", true, None::<&str>)?;
    menu.append(&quit_i)?;

    Ok(menu)
}

/// Updates the tray menu to reflect the latest call state.
///
/// # Errors
/// Returns an error if the menu cannot be rebuilt or assigned to the tray icon.
pub fn update_tray_menu<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    call_state: Option<CallState>,
) -> tauri::Result<()> {
    let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let menu = build_tray_menu(app_handle, call_state)?;
    tray.set_menu(Some(menu))?;
    Ok(())
}

/// Sets up the tray icon. Clicking it toggles the call controls window.
///
/// # Errors
/// Returns an error if the tray icon cannot be created.
pub fn setup_tray<R: Runtime>(app: &tauri::App<R>, tray_icon: Image<'static>) -> tauri::Result<()> {
    let call_state = app
        .try_state::<WsState>()
        .and_then(|state| state.call_state.read().ok().and_then(|guard| *guard));
    let menu = build_tray_menu(app, call_state)?;

    let builder = TrayIconBuilder::<R>::with_id(TRAY_ID)
        .icon(tray_icon)
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id() == TRAY_OPEN_MAIN_WINDOW_ID {
                show_main_window(app);
            }
            if event.id() == "quit" {
                if let Some(window) =
                    app.get_webview_window(call_controls_window::CALL_CONTROLS_WINDOW_LABEL)
                {
                    let _ = window.hide();
                }
                crate::profiling_drop!();
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                call_controls_window::toggle_at_point(tray.app_handle(), position.x, position.y);
            }
        });

    #[cfg(target_os = "macos")]
    let builder = builder.show_menu_on_left_click(false);

    builder.build(app)?;
    Ok(())
}
