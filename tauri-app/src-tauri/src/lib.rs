//! 模拟输入 · Tauri 版
//!
//! 与 Electron 版（仓库根目录）**并存**：这是同一产品的第二套实现，
//! 目标是把安装包从 231MB 压到个位数 MB。
//!
//! 字形引擎（`glyph`）是 TS 版的逐行移植，阈值与口径**必须两边同步**。
//! 用 `tauri-app/verify-engine.sh` 对拍验证过：与 TS 引擎映射表逐条一致。

pub mod commands;
pub mod glyph;
pub mod safari;

use commands::app as appcmd;
use commands::native as nativecmd;
use tauri::Manager;

#[tauri::command]
fn window_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn window_minimize(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
}

#[tauri::command]
fn window_maximize(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.maximize();
    }
}

#[tauri::command]
fn safari_repair_check_now() -> Result<serde_json::Value, String> {
    safari::repair::check_now()
}

#[tauri::command]
fn safari_repair_set_enabled(enabled: bool) -> bool {
    safari::repair::set_enabled(enabled);
    true
}

#[tauri::command]
fn safari_repair_get_status() -> serde_json::Value {
    serde_json::json!({
        "enabled": safari::repair::is_enabled(),
        "injected": safari::repair::is_injected(),
        "supported": cfg!(target_os = "macos"),
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            window_quit,
            window_minimize,
            window_maximize,
            appcmd::get_activation_snapshot,
            appcmd::start_trial,
            appcmd::save_license,
            appcmd::clear_license,
            appcmd::migrate_legacy_activation,
            appcmd::get_settings,
            appcmd::set_settings,
            appcmd::list_files,
            appcmd::save_file,
            appcmd::rename_file,
            appcmd::delete_file,
            appcmd::read_file,
            appcmd::get_features,
            appcmd::get_feature_status,
            appcmd::set_feature_enabled,
            appcmd::get_native_status,
            nativecmd::mouse_click,
            nativecmd::mouse_get_position,
            nativecmd::send_text,
            nativecmd::send_key,
            nativecmd::get_current_input_source,
            nativecmd::select_input_source,
            safari_repair_check_now,
            safari_repair_set_enabled,
            safari_repair_get_status,
        ])
        .setup(|app| {
            safari::repair::spawn_poller();
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
