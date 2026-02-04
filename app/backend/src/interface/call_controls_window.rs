use std::path::PathBuf;

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, Position, Runtime, WebviewUrl};
use tracing::warn;

pub const CALL_CONTROLS_WINDOW_LABEL: &str = "call-controls";
const CALL_CONTROLS_WINDOW_TITLE: &str = "Call Controls";
const CALL_CONTROLS_WINDOW_WIDTH: f64 = 300.0;
const CALL_CONTROLS_WINDOW_HEIGHT: f64 = 120.0;
const CALL_CONTROLS_WINDOW_MARGIN: i32 = 8;

pub fn toggle_at_point<R: Runtime>(app_handle: &AppHandle<R>, anchor_x: f64, anchor_y: f64) {
    if let Some(window) = app_handle.get_webview_window(CALL_CONTROLS_WINDOW_LABEL)
        && window.is_visible().unwrap_or(false)
    {
        let _ = window.hide();
        return;
    }

    show_at_point(app_handle, anchor_x, anchor_y);
}

pub fn show_at_point<R: Runtime>(app_handle: &AppHandle<R>, anchor_x: f64, anchor_y: f64) {
    let Some(window) = ensure_call_controls_window(app_handle) else {
        return;
    };

    position_call_controls_window(app_handle, &window, anchor_x, anchor_y);
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn show_at_cursor<R: Runtime>(app_handle: &AppHandle<R>) {
    if let Ok(position) = app_handle.cursor_position() {
        show_at_point(app_handle, position.x, position.y);
        return;
    }

    if let Ok(Some(monitor)) = app_handle.primary_monitor() {
        let work_area = monitor.work_area();
        let anchor_x = f64::from(work_area.position.x) + f64::from(work_area.size.width) / 2.0;
        let anchor_y = f64::from(work_area.position.y) + f64::from(work_area.size.height) / 2.0;
        show_at_point(app_handle, anchor_x, anchor_y);
        return;
    }

    show_at_point(app_handle, 0.0, 0.0);
}

fn ensure_call_controls_window<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Option<tauri::WebviewWindow<R>> {
    if let Some(window) = app_handle.get_webview_window(CALL_CONTROLS_WINDOW_LABEL) {
        return Some(window);
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
        Ok(window) => Some(window),
        Err(err) => {
            warn!("Failed to open call controls window: {err}");
            None
        }
    }
}

fn position_call_controls_window<R: Runtime>(
    app_handle: &AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
    anchor_x: f64,
    anchor_y: f64,
) {
    let monitor = app_handle
        .monitor_from_point(anchor_x, anchor_y)
        .ok()
        .flatten()
        .or_else(|| app_handle.primary_monitor().ok().flatten());
    let scale_factor = monitor.as_ref().map_or(1.0, tauri::Monitor::scale_factor);
    let logical_size = LogicalSize::new(CALL_CONTROLS_WINDOW_WIDTH, CALL_CONTROLS_WINDOW_HEIGHT);
    let physical_size = logical_size.to_physical::<i32>(scale_factor);

    #[allow(
        clippy::cast_possible_truncation,
        clippy::as_conversions,
        reason = "pixel coordinates fit in i32"
    )]
    let anchor = PhysicalPosition::new(anchor_x as i32, anchor_y as i32);

    let mut x = anchor.x - physical_size.width / 2;
    let mut y = anchor.y + CALL_CONTROLS_WINDOW_MARGIN;

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let work_width = i32::try_from(work_area.size.width).unwrap_or(i32::MAX);
        let work_height = i32::try_from(work_area.size.height).unwrap_or(i32::MAX);

        let min_x = work_area.position.x;
        let min_y = work_area.position.y;
        let mut max_x = min_x + work_width - physical_size.width;
        let mut max_y = min_y + work_height - physical_size.height;

        if max_x < min_x {
            max_x = min_x;
        }
        if max_y < min_y {
            max_y = min_y;
        }

        if y + physical_size.height > min_y + work_height {
            y = anchor.y - physical_size.height - CALL_CONTROLS_WINDOW_MARGIN;
        }

        x = x.clamp(min_x, max_x);
        y = y.clamp(min_y, max_y);
    }

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}
