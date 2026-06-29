//! The Race Control domain, ported from `Race Control/server/src/` to Rust. The
//! multi-car observer state: a live timing view keyed by car index plus an
//! incident log derived from Event packets, with steward actions on top.

pub mod labels;
pub mod state;

pub use state::{SessionSnapshot, SessionState};
