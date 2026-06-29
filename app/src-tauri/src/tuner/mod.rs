//! The Tuner domain, ported from `Tuner/server/src/` (TypeScript) to Rust. Pure
//! analysis modules (segmentation, diagnosis, suggest, the online estimators,
//! runstats, trim, wear) plus the `TunerState` orchestrator that accumulates the
//! live packet stream into a driver-facing snapshot.

pub mod diagnosis;
pub mod estimator;
pub mod labels;
pub mod profile;
pub mod runstats;
pub mod segmentation;
pub mod state;
pub mod suggest;
pub mod trim;
pub mod wear;
pub mod wear_estimator;

pub use profile::TunerProfile;
pub use state::{Snapshot, TunerState};
