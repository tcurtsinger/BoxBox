//! File-export helper for Race Control reports. The save dialog itself is driven
//! from the frontend (`@tauri-apps/plugin-dialog`); this command just writes the
//! UTF-8 text the frontend already built (CSV or JSON) to the path the user
//! picked. Writing through a dedicated command — rather than the fs plugin —
//! keeps it scope-free: the destination is one the user just chose in a native
//! save dialog, so there is no arbitrary-path concern to gate.

/// Write `contents` to `path` as UTF-8.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("write {path}: {e}"))
}
