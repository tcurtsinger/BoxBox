//! The Tunes domain: a saved-setup library plus the Time Trial / Practice lap
//! times recorded against each setup. `model` is the pure data + collection logic
//! (identity matching, save/update, lap recording); `store` is the on-disk
//! persistence and the Tauri-managed handles.
//!
//! The Tauri commands and the listener-side lap recording that consume this are
//! wired in `telemetry.rs`.

pub mod model;
pub mod store;
