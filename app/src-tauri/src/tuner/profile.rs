//! The persisted Tuner profile: the driver's balance preference and the loops'
//! learned observation arrays, so hard-won tuning knowledge survives an app
//! restart instead of living only in memory. A faithful port of the old server's
//! `Tuner/server/src/profile.ts` — plain JSON, the raw arrays only (the mean and
//! confidence are recomputed from them on restore, so there is one source of
//! truth). The on-disk wiring (path, read/write) lives in `crate::persist`.
//!
//! The gain maps are stored with **string** keys, not the typed lever enums, so a
//! future or unknown lever can't fail the whole profile load (which would also
//! discard the balance preference). Unknown keys are simply dropped on the way
//! back into the typed maps (P3.4).

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
    /// Per-lever balance observation magnitudes (clicks/rad), keyed by lever name.
    #[serde(default)]
    pub gains: HashMap<String, Vec<f64>>,
    /// Per-lever wear sensitivities (signed), keyed by lever name.
    #[serde(default)]
    pub wear_gains: HashMap<String, Vec<f64>>,
}

impl TunerProfile {
    /// Build a persistable profile from the engine's typed gain maps.
    pub fn from_state(
        balance_preference: f64,
        gains: &HashMap<SuggestKey, Vec<f64>>,
        wear_gains: &HashMap<WearLever, Vec<f64>>,
    ) -> Self {
        TunerProfile {
            version: PROFILE_VERSION,
            balance_preference,
            gains: gains
                .iter()
                .map(|(k, v)| (k.key().to_string(), v.clone()))
                .collect(),
            wear_gains: wear_gains
                .iter()
                .map(|(k, v)| (k.key().to_string(), v.clone()))
                .collect(),
        }
    }

    /// The balance gains as a typed map, keeping only levers this build knows.
    pub fn gains_typed(&self) -> HashMap<SuggestKey, Vec<f64>> {
        self.gains
            .iter()
            .filter_map(|(k, v)| SuggestKey::from_key(k).map(|key| (key, v.clone())))
            .collect()
    }

    /// The wear gains as a typed map, keeping only levers this build knows.
    pub fn wear_typed(&self) -> HashMap<WearLever, Vec<f64>> {
        self.wear_gains
            .iter()
            .filter_map(|(k, v)| WearLever::from_key(k).map(|key| (key, v.clone())))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_keys_are_dropped_not_fatal() {
        let mut gains: HashMap<String, Vec<f64>> = HashMap::new();
        gains.insert("frontWing".into(), vec![1.0, 2.0]);
        gains.insert("futureLever".into(), vec![9.0]); // unknown to this build
        let p = TunerProfile {
            version: 1,
            balance_preference: 0.5,
            gains,
            wear_gains: HashMap::new(),
        };
        let typed = p.gains_typed();
        assert_eq!(typed.len(), 1, "only the known lever survives");
        assert!(typed.contains_key(&SuggestKey::FrontWing));
    }

    #[test]
    fn json_with_unknown_key_still_loads() {
        // The whole point of P3.4: an unknown gain key must not fail the load and
        // discard the balance preference along with it.
        let json = r#"{"version":1,"balancePreference":0.3,
            "gains":{"frontWing":[1.5],"mysteryLever":[2.0]},"wearGains":{}}"#;
        let p: TunerProfile = serde_json::from_str(json).expect("unknown key must not fail");
        assert_eq!(p.balance_preference, 0.3);
        assert_eq!(p.gains_typed().len(), 1);
    }

    #[test]
    fn round_trips_through_typed_maps() {
        let mut gains: HashMap<SuggestKey, Vec<f64>> = HashMap::new();
        gains.insert(SuggestKey::BrakeBias, vec![3.0]);
        let mut wear: HashMap<WearLever, Vec<f64>> = HashMap::new();
        wear.insert(WearLever::FrontToe, vec![0.5]);
        let p = TunerProfile::from_state(-0.25, &gains, &wear);
        assert_eq!(p.gains.get("brakeBias"), Some(&vec![3.0]));
        assert_eq!(p.gains_typed(), gains);
        assert_eq!(p.wear_typed(), wear);
    }
}
