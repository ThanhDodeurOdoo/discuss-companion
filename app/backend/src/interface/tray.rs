use std::{collections::HashMap, sync::Mutex};

#[cfg(target_os = "macos")]
use tauri::menu::IconMenuItem;
use tauri::{
    AppHandle, Manager, Monitor, PhysicalPosition, Position, Rect, Runtime, Size,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use super::{call_controls_menu, call_controls_window};
use crate::{WsState, api, protocol::CallState, utils::path::assets};

pub const TRAY_ID: &str = "main-tray";
const TRAY_OPEN_MAIN_WINDOW_ID: &str = "open-main-window";
const MASK_DEAF: &[u8] = include_bytes!(assets!("masks/deaf_w.png"));
const MASK_MUTE: &[u8] = include_bytes!(assets!("masks/mute_w.png"));
const MASK_NOT_TALKING: &[u8] = include_bytes!(assets!("masks/not_talking.png"));
const MASK_OFFLINE: &[u8] = include_bytes!(assets!("masks/offline.png"));
const MASK_ONLINE: &[u8] = include_bytes!(assets!("masks/online.png"));
const MASK_TALKING: &[u8] = include_bytes!(assets!("masks/talking.png"));

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
enum TrayForegroundMask {
    #[default]
    NotTalking,
    Talking,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum TrayConnectionMask {
    Offline,
    Online,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct TrayVisualState {
    connection: TrayConnectionState,
    talking: TrayTalkingState,
    audio: TrayAudioState,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct TrayIconVariant {
    foreground: TrayForegroundMask,
    audio_overlay: TrayAudioOverlay,
    connection: TrayConnectionMask,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum TrayAudioState {
    #[default]
    Normal,
    Muted,
    Deafened,
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
enum TrayAudioOverlay {
    #[default]
    None,
    Mute,
    Deaf,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum TrayConnectionState {
    #[default]
    Offline,
    Online,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum TrayTalkingState {
    #[default]
    NotTalking,
    Talking,
}

impl TrayVisualState {
    fn icon_variant(self) -> TrayIconVariant {
        let foreground = if self.talking == TrayTalkingState::Talking {
            TrayForegroundMask::Talking
        } else {
            TrayForegroundMask::NotTalking
        };
        let audio_overlay = if foreground == TrayForegroundMask::Talking {
            TrayAudioOverlay::None
        } else {
            match self.audio {
                TrayAudioState::Deafened => TrayAudioOverlay::Deaf,
                TrayAudioState::Muted => TrayAudioOverlay::Mute,
                TrayAudioState::Normal => TrayAudioOverlay::None,
            }
        };
        let connection = match self.connection {
            TrayConnectionState::Offline => TrayConnectionMask::Offline,
            TrayConnectionState::Online => TrayConnectionMask::Online,
        };
        TrayIconVariant {
            foreground,
            audio_overlay,
            connection,
        }
    }
}

struct MaskImage {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

impl MaskImage {
    fn from_png(bytes: &[u8]) -> tauri::Result<Self> {
        let image = Image::from_bytes(bytes)?;
        Ok(Self {
            rgba: image.rgba().to_vec(),
            width: image.width(),
            height: image.height(),
        })
    }
}

struct TrayMasks {
    deaf: MaskImage,
    mute: MaskImage,
    not_talking: MaskImage,
    offline: MaskImage,
    online: MaskImage,
    talking: MaskImage,
}

impl TrayMasks {
    fn load() -> tauri::Result<Self> {
        // TODO: maybe later use some kind of oncecell/lazycell to act as static and lazyload if not initialized
        Ok(Self {
            deaf: MaskImage::from_png(MASK_DEAF)?,
            mute: MaskImage::from_png(MASK_MUTE)?,
            not_talking: MaskImage::from_png(MASK_NOT_TALKING)?,
            offline: MaskImage::from_png(MASK_OFFLINE)?,
            online: MaskImage::from_png(MASK_ONLINE)?,
            talking: MaskImage::from_png(MASK_TALKING)?,
        })
    }

    fn foreground_mask(&self, foreground: TrayForegroundMask) -> &MaskImage {
        match foreground {
            TrayForegroundMask::NotTalking => &self.not_talking,
            TrayForegroundMask::Talking => &self.talking,
        }
    }

    fn audio_overlay_mask(&self, audio_overlay: TrayAudioOverlay) -> Option<&MaskImage> {
        match audio_overlay {
            TrayAudioOverlay::None => None,
            TrayAudioOverlay::Mute => Some(&self.mute),
            TrayAudioOverlay::Deaf => Some(&self.deaf),
        }
    }

    fn connection_mask(&self, connection: TrayConnectionMask) -> &MaskImage {
        match connection {
            TrayConnectionMask::Offline => &self.offline,
            TrayConnectionMask::Online => &self.online,
        }
    }

    fn dimensions(&self) -> (u32, u32) {
        (self.not_talking.width, self.not_talking.height)
    }
}

struct TrayIconController {
    // Pre-rendered icons keyed by tray variant to avoid recomposing RGBA layers on updates.
    icons: HashMap<TrayIconVariant, Image<'static>>,
    visual_state: TrayVisualState,
    last_applied_variant: Option<TrayIconVariant>,
}

impl TrayIconController {
    fn new() -> tauri::Result<Self> {
        let masks = TrayMasks::load()?;
        Ok(Self {
            icons: render_icon_variants(&masks),
            visual_state: TrayVisualState::default(),
            last_applied_variant: None,
        })
    }

    fn set_connection_state(&mut self, is_connected: bool) {
        self.visual_state.connection = if is_connected {
            TrayConnectionState::Online
        } else {
            TrayConnectionState::Offline
        };
    }

    fn set_talking_state(&mut self, is_talking: bool) {
        self.visual_state.talking = if is_talking {
            TrayTalkingState::Talking
        } else {
            TrayTalkingState::NotTalking
        };
    }

    fn set_call_state(&mut self, call_state: Option<CallState>) {
        let call_state = call_controls_menu::menu_state(call_state);
        self.visual_state.audio = match call_state {
            Some(state) if state.is_deaf => TrayAudioState::Deafened,
            Some(state) if state.is_mute => TrayAudioState::Muted,
            _ => TrayAudioState::Normal,
        };
    }

    fn current_icon(&self) -> Option<Image<'static>> {
        self.icons.get(&self.visual_state.icon_variant()).cloned()
    }

    fn apply<R: Runtime>(&mut self, app_handle: &AppHandle<R>) {
        let Some(tray_icon) = app_handle.tray_by_id(TRAY_ID) else {
            return;
        };
        let variant = self.visual_state.icon_variant();
        if self.last_applied_variant == Some(variant) {
            return;
        }
        if let Some(icon) = self.icons.get(&variant) {
            let _ = tray_icon.set_icon(Some(icon.clone()));
            self.last_applied_variant = Some(variant);
        }
    }
}

struct TrayIconState {
    controller: Mutex<TrayIconController>,
}

pub fn set_connection_state<R: Runtime>(app_handle: &AppHandle<R>, is_connected: bool) {
    update_tray_icon_state(app_handle, |controller| {
        controller.set_connection_state(is_connected);
    });
}

pub fn set_talking_state<R: Runtime>(app_handle: &AppHandle<R>, is_talking: bool) {
    update_tray_icon_state(app_handle, |controller| {
        controller.set_talking_state(is_talking);
    });
}

pub fn set_call_state<R: Runtime>(app_handle: &AppHandle<R>, call_state: Option<CallState>) {
    update_tray_icon_state(app_handle, |controller| {
        controller.set_call_state(call_state);
    });
}

fn update_tray_icon_state<R: Runtime>(
    app_handle: &AppHandle<R>,
    update: impl FnOnce(&mut TrayIconController),
) {
    let Some(tray_icon_state) = app_handle.try_state::<TrayIconState>() else {
        return;
    };
    let Ok(mut controller) = tray_icon_state.controller.lock() else {
        return;
    };
    update(&mut controller);
    controller.apply(app_handle);
}

fn render_icon_variants(masks: &TrayMasks) -> HashMap<TrayIconVariant, Image<'static>> {
    let (width, height) = masks.dimensions();
    let mut icons = HashMap::new();
    let foreground_masks = [TrayForegroundMask::NotTalking, TrayForegroundMask::Talking];
    let audio_overlays = [
        TrayAudioOverlay::None,
        TrayAudioOverlay::Mute,
        TrayAudioOverlay::Deaf,
    ];
    let connection_masks = [TrayConnectionMask::Offline, TrayConnectionMask::Online];
    for foreground in foreground_masks {
        for audio_overlay in audio_overlays {
            if foreground == TrayForegroundMask::Talking && audio_overlay != TrayAudioOverlay::None
            {
                continue;
            }
            let foreground_mask = masks.foreground_mask(foreground);
            let audio_overlay_mask = masks.audio_overlay_mask(audio_overlay);
            for connection in connection_masks {
                let variant = TrayIconVariant {
                    foreground,
                    audio_overlay,
                    connection,
                };
                let icon = compose_icon(
                    width,
                    height,
                    foreground_mask,
                    audio_overlay_mask,
                    masks.connection_mask(connection),
                );
                icons.insert(variant, icon);
            }
        }
    }
    icons
}

fn compose_icon(
    width: u32,
    height: u32,
    foreground_mask: &MaskImage,
    audio_overlay_mask: Option<&MaskImage>,
    status_mask: &MaskImage,
) -> Image<'static> {
    let mut rgba = foreground_mask.rgba.clone();
    blend_overlay_if_matching(foreground_mask, &mut rgba, audio_overlay_mask);
    blend_overlay_if_matching(foreground_mask, &mut rgba, Some(status_mask));
    Image::new_owned(rgba, width, height)
}

fn blend_overlay_if_matching(base: &MaskImage, canvas: &mut [u8], overlay: Option<&MaskImage>) {
    let Some(overlay) = overlay else {
        return;
    };
    if base.width != overlay.width || base.height != overlay.height {
        return;
    }
    blend_overlay(canvas, &overlay.rgba);
}

fn blend_overlay(canvas: &mut [u8], overlay: &[u8]) {
    for (dst_pixel, src_pixel) in canvas.chunks_exact_mut(4).zip(overlay.chunks_exact(4)) {
        blend_pixel(dst_pixel, src_pixel);
    }
}

fn blend_pixel(dst: &mut [u8], src: &[u8]) {
    let [dst_r, dst_g, dst_b, dst_alpha] = dst else {
        return;
    };
    let [src_r, src_g, src_b, src_alpha] = src else {
        return;
    };
    let src_alpha = u32::from(*src_alpha);
    if src_alpha == 0 {
        return;
    }
    let inv_alpha = 255 - src_alpha;
    let blend_channel = |src_channel: u8, dst_channel: u8| {
        let src = u32::from(src_channel) * src_alpha;
        let dst = u32::from(dst_channel) * inv_alpha;
        to_u8((src + dst + 127) / 255)
    };
    *dst_r = blend_channel(*src_r, *dst_r);
    *dst_g = blend_channel(*src_g, *dst_g);
    *dst_b = blend_channel(*src_b, *dst_b);
    let dst_alpha_u32 = u32::from(*dst_alpha) * inv_alpha;
    *dst_alpha = to_u8(src_alpha + (dst_alpha_u32 + 127) / 255);
}

fn to_u8(value: u32) -> u8 {
    u8::try_from(value).unwrap_or(u8::MAX)
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
    let mut tray_icon_controller = TrayIconController::new()?;
    tray_icon_controller.set_call_state(call_state);
    let tray_icon = if let Some(icon) = tray_icon_controller.current_icon() {
        icon
    } else {
        Image::from_bytes(MASK_NOT_TALKING)?
    };

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
    app.manage(TrayIconState {
        controller: Mutex::new(tray_icon_controller),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_variant_prioritizes_talking() {
        let state = TrayVisualState {
            connection: TrayConnectionState::Online,
            talking: TrayTalkingState::Talking,
            audio: TrayAudioState::Deafened,
        };
        assert_eq!(
            state.icon_variant(),
            TrayIconVariant {
                foreground: TrayForegroundMask::Talking,
                audio_overlay: TrayAudioOverlay::None,
                connection: TrayConnectionMask::Online,
            }
        );
    }

    #[test]
    fn icon_variant_prioritizes_deaf_over_mute() {
        let state = TrayVisualState {
            connection: TrayConnectionState::Offline,
            talking: TrayTalkingState::NotTalking,
            audio: TrayAudioState::Deafened,
        };
        assert_eq!(
            state.icon_variant(),
            TrayIconVariant {
                foreground: TrayForegroundMask::NotTalking,
                audio_overlay: TrayAudioOverlay::Deaf,
                connection: TrayConnectionMask::Offline,
            }
        );
    }

    #[test]
    fn icon_variant_uses_default_when_not_talking_or_call_flagged() {
        let state = TrayVisualState {
            connection: TrayConnectionState::Online,
            talking: TrayTalkingState::NotTalking,
            audio: TrayAudioState::Normal,
        };
        assert_eq!(
            state.icon_variant(),
            TrayIconVariant {
                foreground: TrayForegroundMask::NotTalking,
                audio_overlay: TrayAudioOverlay::None,
                connection: TrayConnectionMask::Online,
            }
        );
    }

    #[test]
    fn icon_variant_ignores_audio_overlay_while_talking() {
        let state = TrayVisualState {
            connection: TrayConnectionState::Offline,
            talking: TrayTalkingState::Talking,
            audio: TrayAudioState::Muted,
        };
        assert_eq!(
            state.icon_variant(),
            TrayIconVariant {
                foreground: TrayForegroundMask::Talking,
                audio_overlay: TrayAudioOverlay::None,
                connection: TrayConnectionMask::Offline,
            }
        );
    }

    #[test]
    fn compositor_prebuilds_all_icon_variants() -> tauri::Result<()> {
        let masks = TrayMasks::load()?;
        let icons = render_icon_variants(&masks);
        assert_eq!(icons.len(), 8);
        Ok(())
    }
}
