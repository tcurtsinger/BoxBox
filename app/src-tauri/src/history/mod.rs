//! The History domain: saved Race Control session snapshots with delete, pin, and
//! a retention policy. `model` is the pure archive logic (save/list/prune); `store`
//! is the on-disk persistence and the Tauri-managed handles.
//!
//! The Tauri commands that consume this (Save session, list, open, delete, pin,
//! set retention) are wired in `telemetry.rs`.

pub mod model;
pub mod store;
