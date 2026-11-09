// [[C130]] rustCore
use tauri::Manager;
#[cfg(all(desktop, not(target_os = "linux")))]
use tauri_plugin_decorum::WebviewWindowExt;

mod ipc;
#[cfg(target_os = "linux")]
mod linux_webview;
mod net;
mod saf;

/// Needs the `tauri` crate's `devtools` feature (always on in debug, explicit for release).
/// Desktop only: on Android the webview is inspected from a computer's chrome://inspect.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(desktop)]
    window.open_devtools();
    #[cfg(mobile)]
    let _ = window;
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
    #[cfg(desktop)]
    {
        let is = window.is_fullscreen().unwrap_or(false);
        let _ = window.set_fullscreen(!is);
    }
    #[cfg(mobile)]
    let _ = window;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(saf::init());
    // The window frame is a desktop thing; a phone shows the app edge to edge (docs/android.md).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_decorum::init());
    builder
        .setup(|app| {
            #[cfg(desktop)]
            desktop_window(app)?;
            #[cfg(mobile)]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            set_window_border,
            toggle_fullscreen,
            ipc::read_parquet,
            ipc::net_fetch,
            saf::saf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The desktop window's own frame: the overlay title bar, the Linux shims, the debug icon.
#[cfg(desktop)]
fn desktop_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
}
