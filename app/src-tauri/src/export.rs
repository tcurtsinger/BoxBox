//! File-export for Race Control reports. The save dialog AND the write both happen
//! inside this one Rust command, so the webview never receives a writable path — it
//! can't be turned into an arbitrary-file write primitive even if the renderer is
//! compromised (the prior `write_text_file` exposed exactly that). The native
//! dialog scopes the write to the file the user picked; the extension + size limits
//! stay as defence in depth (P2.4). The production CSP is the first line.

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Largest report we'll write (50 MB) — orders of magnitude above any real race
/// report, but a bound nonetheless.
const MAX_REPORT_BYTES: usize = 50 * 1024 * 1024;

/// The file extension for a report format, or an error for anything else.
fn report_ext(format: &str) -> Result<&'static str, String> {
    match format {
        "csv" => Ok("csv"),
        "json" => Ok("json"),
        _ => Err("unknown report format (expected csv or json)".to_string()),
    }
}

fn check_size(contents: &str) -> Result<(), String> {
    if contents.len() > MAX_REPORT_BYTES {
        return Err("report is implausibly large; refusing to write".to_string());
    }
    Ok(())
}

/// Open a native save dialog for a `.csv`/`.json` report and write `contents` to the
/// chosen file, entirely within Rust. Returns `Ok(true)` if written, `Ok(false)` if
/// the user cancelled. The dialog filter plus a defence-in-depth extension check
/// keep the write scoped to a report file (P2.4).
#[tauri::command]
pub async fn export_report(
    app: AppHandle,
    format: String,
    contents: String,
    default_name: String,
) -> Result<bool, String> {
    let ext = report_ext(&format)?;
    check_size(&contents)?;

    // blocking_save_file is the documented pattern inside an async command: it runs
    // the dialog off the main thread and blocks until the user chooses.
    let picked = app
        .dialog()
        .file()
        .add_filter(ext.to_uppercase(), &[ext])
        .set_file_name(default_name)
        .blocking_save_file();
    let Some(file_path) = picked else {
        return Ok(false); // user cancelled
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;

    // Defence in depth behind the dialog: only ever write a .csv/.json file.
    let lower = path.to_string_lossy().to_lowercase();
    if !(lower.ends_with(".csv") || lower.ends_with(".json")) {
        return Err("refusing to write a non-report file (expected .csv or .json)".to_string());
    }
    std::fs::write(&path, contents).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_format_is_rejected() {
        assert!(report_ext("exe").is_err());
        assert!(report_ext("txt").is_err());
        assert_eq!(report_ext("csv").unwrap(), "csv");
        assert_eq!(report_ext("json").unwrap(), "json");
    }

    #[test]
    fn oversize_contents_rejected() {
        let huge = "a".repeat(MAX_REPORT_BYTES + 1);
        assert!(check_size(&huge).is_err());
        assert!(check_size("a small report").is_ok());
    }
}
