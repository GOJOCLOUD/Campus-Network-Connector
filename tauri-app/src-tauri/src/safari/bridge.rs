//! Safari 自动化桥：通过 Apple Events 控制 Safari、执行页面 JavaScript。
//!
//! 这是 `src/features/safari-repair/bridge.js` 的 Rust 移植。
//! 四个坑（都是本机实测踩出来的，移植时必须原样保留）：
//!  1. AppleScript 读文件按**系统本地编码**解码（中文区域 = GBK），
//!     注入的 JS 里的中文会变乱码 → 注入内容一律 ASCII 化（非 ASCII 转 \uXXXX）。
//!  2. JS 不要内联进 AppleScript 字符串 → 一律走临时文件。
//!  3. **必须异步**：osascript 启动 + 执行要 50~150ms。
//!  4. 返回值里的中文同样会被本地编码破坏 → 返回也做 ASCII 化。

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

static TMP_SEQ: AtomicU32 = AtomicU32::new(0);

/// 把 JS 源码里的非 ASCII 字符转成 \uXXXX 转义（保证注入内容是纯 ASCII）。
pub fn to_ascii_js(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for ch in source.chars() {
        if (ch as u32) < 0x80 {
            out.push(ch);
        } else {
            out.push_str(&format!("\\u{:04x}", ch as u32));
        }
    }
    out
}

/// 异步执行一段 AppleScript，返回 stdout（trim）。
pub fn osa_async(script: &str, _timeout_secs: u64) -> Result<String, String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("osascript 启动失败: {}", e))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("AppleScript 执行失败（status {:?}）", output.status.code())
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// 在目标位置执行一段 JS（走临时文件，避免 AppleScript 的引号/换行/编码问题）。
pub fn run_js_in(target: &str, js: &str) -> Result<String, String> {
    let seq = TMP_SEQ.fetch_add(1, Ordering::SeqCst);
    let file: PathBuf = std::env::temp_dir().join(format!("cnc-sr-{}-{}.js", std::process::id(), seq));
    std::fs::write(&file, to_ascii_js(js)).map_err(|e| format!("写临时文件失败: {}", e))?;
    let script = format!(
        "tell application \"Safari\"\n  set jsCode to (read POSIX file \"{}\") as «class utf8»\n  do JavaScript jsCode in {}\nend tell",
        file.display(),
        target
    );
    let result = osa_async(&script, 8);
    let _ = std::fs::remove_file(&file);
    result
}

/// Safari 里的目标位置描述。
pub fn target(tab_index: Option<u32>, window_index: Option<u32>) -> String {
    let win = match window_index {
        Some(w) => format!("window {}", w),
        None => "front window".to_string(),
    };
    match tab_index {
        Some(t) => format!("tab {} of {}", t, win),
        None => format!("front tab of {}", win),
    }
}

/// 一轮状态采集：**一次 Apple Event 拿到全部信息**。
///
/// 返回 `{ guard, pending, frames, unrepaired, collect, url }`。
pub fn poll_state(tab_index: Option<u32>, window_index: Option<u32>) -> Result<serde_json::Value, String> {
    let t = target(tab_index, window_index);
    let js = r#"(function(){
      var g = window.__copyRepairGuard;
      var out = {
        guard: !!g,
        pending: null,
        collect: 'none',
        frames: [],
        unrepaired: [],
        url: String(location.href || ''),
      };
      if (g) {
        if (window.__copyRepairCollect) {
          try { out.collect = String(window.__copyRepairCollect()); } catch (e) { out.collect = 'error'; }
        }
        if (g.pending && g.pending.groups && g.pending.groups.length > 0) {
          out.pending = { groups: g.pending.groups };
          g.pending = null;
        }
        if (window.__copyRepairBridge && typeof window.__copyRepairBridge.take === 'function') {
          try {
            var taken = window.__copyRepairBridge.take();
            out.frames = taken.pending || [];
            out.unrepaired = taken.unrepaired || [];
          } catch (e) { out.frames = []; out.unrepaired = []; }
        }
      }
      return JSON.stringify(out).replace(/[^\x00-\x7F]/g, function (c) {
        return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
      });
    })()"#;
    let raw = run_js_in(&t, js)?;
    serde_json::from_str(&raw).map_err(|e| format!("解析 pollState 失败: {}", e))
}

/// 注入页面守卫（幂等：守卫内部有哨兵，重复注入不会叠加监听器）。
pub fn inject_guard(tab_index: Option<u32>, window_index: Option<u32>, guard_js: &str) -> Result<String, String> {
    let t = target(tab_index, window_index);
    run_js_in(&t, guard_js)
}

/// 把映射表写回页面。
pub fn set_mapping(
    tab_index: Option<u32>,
    window_index: Option<u32>,
    scope_key: &str,
    mapping: &serde_json::Value,
) -> Result<String, String> {
    let t = target(tab_index, window_index);
    let js = format!(
        "(function(){{ if(!window.__copyRepairSetMapping) return 'NO-GUARD'; return window.__copyRepairSetMapping({}, {}); }})()",
        serde_json::to_string(scope_key).unwrap_or_else(|_| "\"\"".into()),
        serde_json::to_string(mapping).unwrap_or_else(|_| "{}".into())
    );
    run_js_in(&t, &js)
}

/// 列出所有窗口所有标签的 URL（一次 Apple Event）。
pub fn list_tabs() -> Result<Vec<(u32, u32, String)>, String> {
    let script = r#"tell application "Safari"
      set out to ""
      repeat with wi from 1 to (count of windows)
        repeat with ti from 1 to (count of tabs of window wi)
          try
            set out to out & (wi as text) & tab & (ti as text) & tab & (URL of tab ti of window wi) & linefeed
          end try
        end repeat
      end repeat
      return out
    end tell"#;
    let raw = osa_async(script, 8)?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            if let (Ok(w), Ok(t)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                out.push((w, t, parts[2].to_string()));
            }
        }
    }
    Ok(out)
}

/// Safari 是否在运行。
pub fn safari_running() -> bool {
    osa_async(
        r#"tell application "System Events" to return (name of processes) contains "Safari""#,
        5,
    )
    .map(|s| s == "true")
    .unwrap_or(false)
}
