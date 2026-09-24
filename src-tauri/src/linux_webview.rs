// [[B10]] reactFlowView
// linux shim for crisp canvas zoom (tree/specs/canvas/layout-chrome.md)
use std::ffi::{c_char, c_int, c_void, CStr};
use webkit2gtk::glib::prelude::*;
use webkit2gtk::glib::translate::ToGlibPtr;
use webkit2gtk::{WebView, WebViewExt};

// The feature API is WebKitGTK 2.42; the bindings stop at 2.40.
extern "C" {
    fn webkit_settings_get_all_features() -> *mut c_void;
    fn webkit_feature_list_get_length(list: *mut c_void) -> usize;
    fn webkit_feature_list_get(list: *mut c_void, index: usize) -> *mut c_void;
    fn webkit_feature_list_unref(list: *mut c_void);
    fn webkit_feature_get_identifier(feature: *mut c_void) -> *const c_char;
    fn webkit_settings_set_feature_enabled(settings: *mut c_void, feature: *mut c_void, enabled: c_int);
}

const FEATURES_OFF: [&str; 1] = ["AsyncOverflowScrolling"];

pub fn keep_nodes_off_gpu_layers(webview: &WebView) {
    let Some(settings) = WebViewExt::settings(webview) else { return };
    if settings.find_property("enable-2d-canvas-acceleration").is_some() {
        settings.set_property("enable-2d-canvas-acceleration", false);
    }
    unsafe {
        let raw: *mut webkit2gtk::ffi::WebKitSettings = settings.to_glib_none().0;
        let list = webkit_settings_get_all_features();
        for i in 0..webkit_feature_list_get_length(list) {
            let feature = webkit_feature_list_get(list, i);
            let id = CStr::from_ptr(webkit_feature_get_identifier(feature)).to_string_lossy();
            if FEATURES_OFF.contains(&id.as_ref()) {
                webkit_settings_set_feature_enabled(raw.cast(), feature, 0);
            }
        }
        webkit_feature_list_unref(list);
    }
}
