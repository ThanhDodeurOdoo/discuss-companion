use std::path::PathBuf;

#[cfg(not(target_os = "linux"))]
use tauri::tray::MouseButtonState;
use tauri::{
    AppHandle, Manager, Runtime, WebviewUrl,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
};
#[cfg(not(target_os = "linux"))]
use tauri_plugin_positioner::{Position, WindowExt};
use tracing::{info, warn};

pub const TRAY_ID: &str = "main-tray";

pub const CALL_CONTROLS_WINDOW_LABEL: &str = "call-controls";
const CALL_CONTROLS_WINDOW_WIDTH: f64 = 300.0;
const CALL_CONTROLS_WINDOW_HEIGHT: f64 = 120.0;

/// Sets up the tray icon. Clicking it toggles the call controls window.
///
/// # Errors
/// Returns an error if the tray icon cannot be created.
pub fn setup_tray<R: Runtime>(app: &tauri::App<R>, tray_icon: Image<'static>) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::<R>::with_id(TRAY_ID)
        .icon(tray_icon)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            "show_call" => toggle_call_controls_window(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Let the positioner plugin track tray icon position (not available on Linux/Wayland)
            #[cfg(not(target_os = "linux"))]
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

            match event {
                #[cfg(not(target_os = "linux"))]
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    toggle_call_controls_window(tray.app_handle());
                }
                #[cfg(target_os = "linux")]
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    ..
                } => {
                    toggle_call_controls_window(tray.app_handle());
                }
                _ => {}
            }
        });

    let menu = {
        let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        #[cfg(target_os = "linux")]
        {
            let show_i = MenuItem::with_id(app, "show_call", "Call", true, None::<&str>)?;
            Menu::with_items(app, &[&show_i, &quit_i])?
        }
        #[cfg(not(target_os = "linux"))]
        {
            Menu::with_items(app, &[&quit_i])?
        }
    };
    builder = builder.menu(&menu);

    #[cfg(not(target_os = "linux"))]
    {
        builder = builder.show_menu_on_left_click(false);
    }

    builder.build(app)?;
    info!("Tray icon created successfully");
    Ok(())
}

fn toggle_call_controls_window<R: Runtime>(app_handle: &AppHandle<R>) {
    let window = if let Some(window) = app_handle.get_webview_window(CALL_CONTROLS_WINDOW_LABEL) {
        window
    } else {
        let mut window_builder = tauri::webview::WebviewWindowBuilder::new(
            app_handle,
            CALL_CONTROLS_WINDOW_LABEL,
            WebviewUrl::App(PathBuf::from("index.html")),
        )
        .inner_size(CALL_CONTROLS_WINDOW_WIDTH, CALL_CONTROLS_WINDOW_HEIGHT)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false);

        // On Linux/Wayland, keep decorations so user can drag the window manually
        #[cfg(not(target_os = "linux"))]
        {
            window_builder = window_builder.decorations(false).accept_first_mouse(true);
        }

        match window_builder.build() {
            Ok(window) => window,
            Err(err) => {
                warn!("Failed to create call controls window: {err}");
                return;
            }
        }
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        // Position the window
        // On Linux/Wayland, the positioner plugin panics, so just center the window
        #[cfg(target_os = "linux")]
        {
            let _ = window.center();
        }
        #[cfg(not(target_os = "linux"))]
        {
            if let Err(e) = window.move_window(Position::TrayBottomCenter) {
                warn!("Failed to position window near tray: {e}");
                let _ = window.move_window(Position::TopRight);
            }
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

