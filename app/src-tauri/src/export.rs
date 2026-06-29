//! File-export helper for Race Control reports. The save dialog itself is driven
//! from the frontend (`@tauri-apps/plugin-dialog`); this command writes the UTF-8
//! text the frontend already built (CSV or JSON) to the path the user picked.
//!
//! Even though the path comes from a native save dialog, the command constrains
//! what it will write — a report file (.csv/.json) within a sane size — so a
//! compromised webview can't turn it into an arbitrary-file write primitive
//! (P2.3). The production CSP (tauri.conf.json) is the first line of defence; this
//! is defence in depth.

/// Largest report we'll write (50 MB) — orders of magnitude above any real race
/// report, but a bound nonetheless.
const MAX_REPORT_BYTES: usize = 50 * 1024 * 1024;

/// Write `contents` to `path` as UTF-8, if it's a report file of a sane size.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let lower = path.to_lowercase();
    if !(lower.ends_with(".csv") || lower.ends_with(".json")) {
        return Err("refusing to write a non-report file (expected .csv or .json)".to_string());
    }
    if contents.len() > MAX_REPORT_BYTES {
        return Err("report is implausibly large; refusing to write".to_string());
    }
    std::fs::write(&path, contents).map_err(|e| format!("write {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_report_extensions() {
        // The extension guard rejects before touching the filesystem.
        assert!(write_text_file("C:/Windows/evil.exe".into(), "x".into()).is_err());
        assert!(write_text_file("notes.txt".into(), "x".into()).is_err());
        assert!(write_text_file("no-extension".into(), "x".into()).is_err());
    }

    #[test]
    fn rejects_oversize_contents() {
        let huge = "a".repeat(MAX_REPORT_BYTES + 1);
        assert!(write_text_file("report.csv".into(), huge).is_err());
    }
}
