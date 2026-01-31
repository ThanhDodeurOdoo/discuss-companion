use std::path::PathBuf;

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, Position, Runtime, WebviewUrl,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tracing::warn;

pub const TRAY_ID: &str = "main-tray";

pub const CALL_CONTROLS_WINDOW_LABEL: &str = "call-controls";
const CALL_CONTROLS_WINDOW_TITLE: &str = "Call Controls";
const CALL_CONTROLS_WINDOW_WIDTH: f64 = 300.0;
const CALL_CONTROLS_WINDOW_HEIGHT: f64 = 120.0;
const CALL_CONTROLS_WINDOW_MARGIN: i32 = 8;

/// Sets up the tray icon. Clicking it toggles the call controls window.
///
/// # Errors
/// Returns an error if the tray icon cannot be created.
pub fn setup_tray<R: Runtime>(app: &tauri::App<R>, tray_icon: Image<'static>) -> tauri::Result<()> {
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit_i])?;

    let mut builder = TrayIconBuilder::<R>::with_id(TRAY_ID)
        .icon(tray_icon)
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
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
                toggle_call_controls_window(tray.app_handle(), position.x, position.y);
            }
        });

    #[cfg(target_os = "macos")]
    {
        builder = builder.show_menu_on_left_click(false);
    }

    builder.build(app)?;
    Ok(())
}

fn toggle_call_controls_window<R: Runtime>(
    app_handle: &AppHandle<R>,
    tray_center_x: f64,
    tray_bottom_y: f64,
) {
    if let Some(window) = app_handle.get_webview_window(CALL_CONTROLS_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position_call_controls_window(app_handle, &window, tray_center_x, tray_bottom_y);
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    let window = tauri::webview::WebviewWindowBuilder::new(
        app_handle,
        CALL_CONTROLS_WINDOW_LABEL,
        WebviewUrl::App(PathBuf::from("index.html")),
    )
    .title(CALL_CONTROLS_WINDOW_TITLE)
    .inner_size(CALL_CONTROLS_WINDOW_WIDTH, CALL_CONTROLS_WINDOW_HEIGHT)
    .min_inner_size(CALL_CONTROLS_WINDOW_WIDTH, CALL_CONTROLS_WINDOW_HEIGHT)
    .max_inner_size(CALL_CONTROLS_WINDOW_WIDTH, CALL_CONTROLS_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .accept_first_mouse(true)
    .skip_taskbar(true)
    .visible(false)
    .build();

    match window {
        Ok(window) => {
            position_call_controls_window(app_handle, &window, tray_center_x, tray_bottom_y);
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(err) => {
            warn!("Failed to open call controls window: {err}");
        }
    }
}

fn position_call_controls_window<R: Runtime>(
    app_handle: &AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
    click_x: f64,
    click_y: f64,
) {
    let scale_factor = app_handle
        .primary_monitor()
        .ok()
        .flatten()
        .map_or(1.0, |m| m.scale_factor());
    let logical_size = LogicalSize::new(CALL_CONTROLS_WINDOW_WIDTH, CALL_CONTROLS_WINDOW_HEIGHT);
    let physical_size = logical_size.to_physical::<i32>(scale_factor);

    #[allow(
        clippy::cast_possible_truncation,
        clippy::as_conversions,
        reason = "pixel coordinates fit in i32"
    )]
    let x = (click_x as i32) - physical_size.width / 2;
    #[allow(
        clippy::cast_possible_truncation,
        clippy::as_conversions,
        reason = "pixel coordinates fit in i32"
    )]
    let y = (click_y as i32) + CALL_CONTROLS_WINDOW_MARGIN;

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}
