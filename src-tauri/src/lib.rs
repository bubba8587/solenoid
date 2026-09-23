// [[C16]] polarsEngine
use tauri::Manager;
#[cfg(not(target_os = "linux"))]
use tauri_plugin_decorum::WebviewWindowExt;

mod engine;
mod ipc;
#[cfg(target_os = "linux")]
mod linux_webview;

/// Needs the `tauri` crate's `devtools` feature (always on in debug, explicit for release).
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// Paints the Windows 11 window border with the app accent (appTheme's apply() calls it on every accent, mode or palette change); a no-op off Windows 11.
#[cfg(windows)]
fn set_border_color(window: &tauri::WebviewWindow, r: u8, g: u8, b: u8) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};
    if let Ok(hwnd) = window.hwnd() {
        // COLORREF is 0x00BBGGRR.
        let colorref: u32 = (r as u32) | ((g as u32) << 8) | ((b as u32) << 16);
        unsafe {
            DwmSetWindowAttribute(
                hwnd.0 as _,
                DWMWA_BORDER_COLOR as u32,
                &colorref as *const u32 as *const core::ffi::c_void,
                core::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[tauri::command]
fn set_window_border(window: tauri::WebviewWindow, r: u8, g: u8, b: u8) {
    #[cfg(windows)]
    set_border_color(&window, r, g, b);
    #[cfg(not(windows))]
    let _ = (window, r, g, b);
}

/// Bound to F11 in the web layer, because the WebView2 shell has no native F11.
#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) {
    let is = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!is);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            // A transparent overlay title bar (custom controls, Windows Snap kept), styled in the web layer.
            let main_window = app.get_webview_window("main").unwrap();
            #[cfg(not(target_os = "linux"))]
            main_window.create_overlay_titlebar().unwrap();
            // linux shim for window controls (tree/specs/canvas/layout-chrome.md)
            #[cfg(target_os = "linux")]
            main_window.set_decorations(false)?;
            #[cfg(target_os = "linux")]
            main_window.with_webview(|wv| linux_webview::keep_nodes_off_gpu_layers(&wv.inner()))?;
            // debug builds wear the bug icon
            #[cfg(debug_assertions)]
            main_window.set_icon(tauri::image::Image::new(
                include_bytes!("../icons/debug/icon.rgba"),
                256,
                256,
            ))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            set_window_border,
            toggle_fullscreen,
            ipc::engine_ping,
            engine::engine_source,
            engine::engine_read_csv,
            engine::engine_read_parquet,
            engine::engine_apply,
            engine::engine_apply_many,
            engine::engine_join,
            engine::engine_append,
            engine::engine_bind_columns,
            engine::engine_preview,
            engine::engine_sample,
            engine::engine_column,
            engine::engine_collect,
            engine::engine_drop,
            engine::engine_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
