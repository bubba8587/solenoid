// [[B2]] webTryDesktopFull: Android's granted folders (docs/android.md § Folders on Android). The work is in
// `android/SafPlugin.kt`; this registers it and forwards the web side's calls (`src/graph/androidFolders.ts`).
// The calls go Rust to Kotlin, so they need no plugin permission, and `saf` is an app command like the others.

/// Registers the Kotlin plugin on Android; elsewhere there is nothing to register.
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("saf")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = api.register_android_plugin("com.solenoid.app", "SafPlugin")?;
                app.manage(Saf(handle));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
struct Saf(tauri::plugin::PluginHandle<tauri::Wry>);

/// One of the plugin's commands (`pickFolder`, `list`, `walk`, `readText`, …) with its arguments.
#[tauri::command]
pub async fn saf(
    app: tauri::AppHandle,
    cmd: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<Saf>()
            .0
            .run_mobile_plugin_async::<serde_json::Value>(cmd, args)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, cmd, args);
        Err("Granted folders are Android's".into())
    }
}
