use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;

mod engine;
mod ipc;

/// Open the webview devtools for the calling window. Reachable from the F12 /
/// Ctrl+Shift+I hotkey in the web layer. Available because the `tauri` crate is
/// built with the `devtools` feature (always on in debug, explicit for release).
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// Paint the Windows 11 window border (the focused-frame accent Windows draws) with
/// an explicit color, so it matches the app accent instead of the system accent. The
/// web layer calls this from appTheme's apply() with the resolved accent RGB, and
/// again whenever the accent / mode / palette changes. No-op off Windows 11.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            // Replace the native title bar with a transparent overlay one (custom
            // controls + Windows Snap retained). The bar is styled in the web layer
            // (themed to the accent); see TopBar / decorum CSS.
            let main_window = app.get_webview_window("main").unwrap();
            main_window.create_overlay_titlebar().unwrap();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            set_window_border,
            ipc::engine_ping,
            engine::engine_source,
            engine::engine_apply,
            engine::engine_join,
            engine::engine_append,
            engine::engine_preview,
            engine::engine_column,
            engine::engine_collect,
            engine::engine_drop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
