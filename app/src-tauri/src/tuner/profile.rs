//! The persisted Tuner profile: the driver's balance preference and the loops'
//! learned observation arrays, so hard-won tuning knowledge survives an app
//! restart instead of living only in memory. A faithful port of the old server's
//! `Tuner/server/src/profile.ts` — plain JSON, the raw arrays only (the mean and
//! confidence are recomputed from them on restore, so there is one source of
//! truth). The on-disk wiring (path, read/write) lives in `crate::persist`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::suggest::SuggestKey;
use super::wear_estimator::WearLever;

pub const PROFILE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunerProfile {
    pub version: u32,
    /// -1 loose .. 0 neutral .. +1 stable.
    pub balance_preference: f64,
    /// Per-lever balance observation magnitudes (clicks/rad).
    #[serde(default)]
    pub gains: HashMap<SuggestKey, Vec<f64>>,
    /// Per-lever wear sensitivities (signed). Optional for back-compat.
    #[serde(default)]
    pub wear_gains: HashMap<WearLever, Vec<f64>>,
}
