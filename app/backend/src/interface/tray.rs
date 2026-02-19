#[cfg(target_os = "macos")]
use tauri::menu::IconMenuItem;
use tauri::{
    AppHandle, Manager, Monitor, PhysicalPosition, Position, Rect, Runtime, Size,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use super::{call_controls_menu, call_controls_window};
use crate::{WsState, api, protocol::CallState};

pub const TRAY_ID: &str = "main-tray";
const TRAY_OPEN_MAIN_WINDOW_ID: &str = "open-main-window";
const ICON_ACTIVE_ONLINE: &[u8] = include_bytes!("../../../../assets/icons/active_online_icon.png");
const ICON_INACTIVE_ONLINE: &[u8] =
    include_bytes!("../../../../assets/icons/inactive_online_icon.png");
const ICON_INACTIVE_OFFLINE: &[u8] =
    include_bytes!("../../../../assets/icons/inactive_offline_icon.png");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrayIconState {
    InactiveOffline,
    InactiveOnline,
    ActiveOnline,
}

pub struct TrayIconController {
    active_online_icon: Option<Image<'static>>,
    inactive_online_icon: Option<Image<'static>>,
    inactive_offline_icon: Option<Image<'static>>,
    last_state: Option<TrayIconState>,
}

impl Default for TrayIconController {
    fn default() -> Self {
        Self::new()
    }
}

impl TrayIconController {
    #[must_use]
    pub fn new() -> Self {
        Self {
            active_online_icon: Image::from_bytes(ICON_ACTIVE_ONLINE).ok(),
            inactive_online_icon: Image::from_bytes(ICON_INACTIVE_ONLINE).ok(),
            inactive_offline_icon: Image::from_bytes(ICON_INACTIVE_OFFLINE).ok(),
            last_state: None,
        }
    }

    pub fn update<R: Runtime>(
        &mut self,
        app_handle: &AppHandle<R>,
        is_connected: bool,
        is_active: bool,
    ) {
        let Some(tray_icon) = app_handle.tray_by_id(TRAY_ID) else {
            return;
        };

        let state = Self::state_for_connection(is_connected, is_active);
        if self.last_state == Some(state) {
            return;
        }

        if let Some(icon) = self.icon_for_state(state) {
            let _ = tray_icon.set_icon(Some(icon));
            self.last_state = Some(state);
        }
    }

    fn state_for_connection(is_connected: bool, is_active: bool) -> TrayIconState {
        if !is_connected {
            TrayIconState::InactiveOffline
        } else if is_active {
            TrayIconState::ActiveOnline
        } else {
            TrayIconState::InactiveOnline
        }
    }

    fn icon_for_state(&self, state: TrayIconState) -> Option<Image<'_>> {
        let icon = match state {
            TrayIconState::InactiveOffline => self.inactive_offline_icon.as_ref(),
            TrayIconState::InactiveOnline => self.inactive_online_icon.as_ref(),
            TrayIconState::ActiveOnline => self.active_online_icon.as_ref(),
        }?;
        Some(Image::new(icon.rgba(), icon.width(), icon.height()))
    }
}

fn tray_anchor_from_rect<R: Runtime>(
    app_handle: &AppHandle<R>,
    position: PhysicalPosition<f64>,
    rect: Rect,
) -> (f64, f64, Option<Monitor>) {
    let Ok(mut monitors) = app_handle.available_monitors() else {
        return (
            position.x,
            position.y,
            app_handle.primary_monitor().ok().flatten(),
        );
    };

    if monitors.is_empty() {
        return (
            position.x,
            position.y,
            app_handle.primary_monitor().ok().flatten(),
        );
    }

    let mut best_rect_index = None;
    let mut best_rect_overlap = -1.0;
    let mut best_rect_distance = f64::INFINITY;

    let mut best_point_index = None;
    let mut best_point_distance = f64::INFINITY;

    for (index, monitor) in monitors.iter().enumerate() {
        let (monitor_min_x, monitor_min_y, monitor_max_x, monitor_max_y) = monitor_bounds(monitor);

        let point_distance = distance_to_bounds(
            position.x,
            position.y,
            monitor_min_x,
            monitor_min_y,
            monitor_max_x,
            monitor_max_y,
        );
        if point_distance < best_point_distance {
            best_point_distance = point_distance;
            best_point_index = Some(index);
        }

        let (rect_position, rect_size) = rect_physical_for_monitor(rect, monitor);
        if rect_size.width <= 0.0 || rect_size.height <= 0.0 {
            continue;
        }

        let rect_max_x = rect_position.x + rect_size.width;
        let rect_max_y = rect_position.y + rect_size.height;
        let overlap_width =
            (monitor_max_x.min(rect_max_x) - monitor_min_x.max(rect_position.x)).max(0.0);
        let overlap_height =
            (monitor_max_y.min(rect_max_y) - monitor_min_y.max(rect_position.y)).max(0.0);
        let overlap_area = overlap_width * overlap_height;

        let rect_center_x = rect_position.x + rect_size.width / 2.0;
        let rect_center_y = rect_position.y + rect_size.height / 2.0;
        let rect_distance = distance_to_bounds(
            rect_center_x,
            rect_center_y,
            monitor_min_x,
            monitor_min_y,
            monitor_max_x,
            monitor_max_y,
        );

        if overlap_area > best_rect_overlap
            || (overlap_area - best_rect_overlap).abs() < f64::EPSILON
                && rect_distance < best_rect_distance
        {
            best_rect_overlap = overlap_area;
            best_rect_distance = rect_distance;
            best_rect_index = Some(index);
        }
    }

    if let Some(index) = best_rect_index {
        let monitor = monitors.swap_remove(index);
        let (rect_position, rect_size) = rect_physical_for_monitor(rect, &monitor);
        let anchor_x = rect_position.x + rect_size.width / 2.0;
        let anchor_y = rect_position.y + rect_size.height;
        return (anchor_x, anchor_y, Some(monitor));
    }

    if let Some(index) = best_point_index {
        let monitor = monitors.swap_remove(index);
        return (position.x, position.y, Some(monitor));
    }

    (
        position.x,
        position.y,
        app_handle.primary_monitor().ok().flatten(),
    )
}

fn rect_physical_for_monitor(
    rect: Rect,
    monitor: &Monitor,
) -> (PhysicalPosition<f64>, tauri::PhysicalSize<f64>) {
    if let (Position::Physical(position), Size::Physical(size)) = (rect.position, rect.size) {
        return (position.cast::<f64>(), size.cast::<f64>());
    }

    let scale_factor = monitor.scale_factor();
    (
        rect.position.to_physical::<f64>(scale_factor),
        rect.size.to_physical::<f64>(scale_factor),
    )
}

fn monitor_bounds(monitor: &Monitor) -> (f64, f64, f64, f64) {
    let position = monitor.position();
    let size = monitor.size();
    let min_x = f64::from(position.x);
    let min_y = f64::from(position.y);
    let max_x = min_x + f64::from(size.width);
    let max_y = min_y + f64::from(size.height);
    (min_x, min_y, max_x, max_y)
}

fn distance_to_bounds(x: f64, y: f64, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> f64 {
    let dx = if x < min_x {
        min_x - x
    } else if x > max_x {
        x - max_x
    } else {
        0.0
    };
    let dy = if y < min_y {
        min_y - y
    } else if y > max_y {
        y - max_y
    } else {
        0.0
    };
    dx * dx + dy * dy
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
pub fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let call_state = app
        .try_state::<WsState>()
        .and_then(|state| state.call_state.read().ok().and_then(|guard| *guard));
    let menu = build_tray_menu(app, call_state)?;
    let tray_icon = Image::from_bytes(ICON_INACTIVE_OFFLINE)?;

    let builder = TrayIconBuilder::<R>::with_id(TRAY_ID)
        .icon(tray_icon)
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id() == TRAY_OPEN_MAIN_WINDOW_ID {
                api::commands::show_main_window_with_handle(app);
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
                rect,
                ..
            } = event
            {
                let rect = tray.rect().ok().flatten().unwrap_or(rect);
                let (anchor_x, anchor_y, monitor_hint) =
                    tray_anchor_from_rect(tray.app_handle(), position, rect);
                call_controls_window::toggle_at_point_on_monitor(
                    tray.app_handle(),
                    anchor_x,
                    anchor_y,
                    monitor_hint,
                );
            }
        });

    #[cfg(target_os = "macos")]
    let builder = builder.show_menu_on_left_click(false);

    builder.build(app)?;
    Ok(())
}
