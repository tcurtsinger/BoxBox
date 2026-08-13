//! Penalty / infringement / incident labels, ported from `shared/parser/
//! constants.ts` and `Race Control/server/src/state.ts`. Used to turn Event
//! packets into the steward-facing incident log.

/// Event codes promoted into the incident log (the rest are tallied only).
/// SCAR, PENA and COLL are handled separately (sub-type / severity labels).
pub fn incident_label(code: &str) -> Option<&'static str> {
    Some(match code {
        "RTMT" => "Retirement",
        "RDFL" => "Red Flag",
        "DRSD" => "DRS Disabled",
        "FTLP" => "Fastest Lap",
        "RCWN" => "Race Winner",
        "CHQF" => "Chequered Flag",
        // Surfaced so a steward can explain rewound telemetry: incidents logged
        // before the rewind describe a timeline that no longer exists, and this
        // row is the on-the-record reason why. Deliberately NOT deleted/undone —
        // stewarding evidence is append-only.
        "FLBK" => "Flashback",
        _ => return None,
    })
}

/// Collision label graded by the COLL event's severity byte (2026 format only;
/// the 2025 format carries no severity, so it lands on the plain middle grade).
/// Ordering inferred from the encoding: higher = heavier contact.
pub fn collision_label(severity: Option<u8>) -> &'static str {
    match severity {
        Some(0) => "Light contact",
        Some(2) => "Heavy contact",
        _ => "Contact",
    }
}

/// Short sanction text for a penaltyType ("+10s", "Drive-through"), or None
/// when the type carries no headline sanction. `time` is the seconds byte,
/// meaningful for time penalties (type 4).
pub fn sanction_text(penalty_type: u8, time: Option<u8>) -> Option<String> {
    Some(match penalty_type {
        0 => "Drive-through".to_string(),
        1 => "Stop-go".to_string(),
        2 => "Grid penalty".to_string(),
        4 => match time {
            Some(t) if t > 0 => format!("+{t}s"),
            _ => "Time penalty".to_string(),
        },
        6 => "Disqualified".to_string(),
        17 => "Black flag".to_string(),
        _ => return None,
    })
}

/// penaltyType values that are real sporting penalties. Warnings (5) and lap
/// invalidations (10–15) are logged separately under the TLIM code; reminders
/// and the rest stay out of the feed (tallied only).
pub fn is_real_penalty(penalty_type: u8) -> bool {
    matches!(penalty_type, 0 | 1 | 2 | 4 | 6 | 17)
}

/// m_penaltyType (0-17) labels, from the EA "Data Output from F1 25 v3" appendix.
pub fn penalty_type(t: u8) -> Option<&'static str> {
    Some(match t {
        0 => "Drive-through",
        1 => "Stop-go",
        2 => "Grid penalty",
        3 => "Penalty reminder",
        4 => "Time penalty",
        5 => "Warning",
        6 => "Disqualified",
        7 => "Removed from formation lap",
        8 => "Parked too long timer",
        9 => "Tyre regulations",
        10 => "This lap invalidated",
        11 => "This and next lap invalidated",
        12 => "This lap invalidated without reason",
        13 => "This and next lap invalidated without reason",
        14 => "This and previous lap invalidated",
        15 => "This and previous lap invalidated without reason",
        16 => "Retired",
        17 => "Black flag timer",
        _ => return None,
    })
}

/// m_infringementType (0-54) labels, from the same EA appendix.
pub fn infringement_type(t: u8) -> Option<&'static str> {
    Some(match t {
        0 => "Blocking by slow driving",
        1 => "Blocking by wrong way driving",
        2 => "Reversing off the start line",
        3 => "Big collision",
        4 => "Small collision",
        5 => "Collision, failed to hand back position (single)",
        6 => "Collision, failed to hand back position (multiple)",
        7 => "Corner cutting, gained time",
        8 => "Corner cutting overtake (single)",
        9 => "Corner cutting overtake (multiple)",
        10 => "Crossed pit exit lane",
        11 => "Ignoring blue flags",
        12 => "Ignoring yellow flags",
        13 => "Ignoring drive-through",
        14 => "Too many drive-throughs",
        15 => "Drive-through reminder, serve within n laps",
        16 => "Drive-through reminder, serve this lap",
        17 => "Pit lane speeding",
        18 => "Parked for too long",
        19 => "Ignoring tyre regulations",
        20 => "Too many penalties",
        21 => "Multiple warnings",
        22 => "Approaching disqualification",
        23 => "Tyre regulations (single)",
        24 => "Tyre regulations (multiple)",
        25 => "Lap invalidated, corner cutting",
        26 => "Lap invalidated, running wide",
        27 => "Corner cutting, ran wide gained time (minor)",
        28 => "Corner cutting, ran wide gained time (significant)",
        29 => "Corner cutting, ran wide gained time (extreme)",
        30 => "Lap invalidated, wall riding",
        31 => "Lap invalidated, flashback used",
        32 => "Lap invalidated, reset to track",
        33 => "Blocking the pit lane",
        34 => "Jump start",
        35 => "Safety car to car collision",
        36 => "Safety car illegal overtake",
        37 => "Safety car exceeding allowed pace",
        38 => "Virtual safety car exceeding allowed pace",
        39 => "Formation lap below allowed speed",
        40 => "Formation lap parking",
        41 => "Retired, mechanical failure",
        42 => "Retired, terminally damaged",
        43 => "Safety car falling too far back",
        44 => "Black flag timer",
        45 => "Unserved stop-go penalty",
        46 => "Unserved drive-through penalty",
        47 => "Engine component change",
        48 => "Gearbox change",
        49 => "Parc Ferme change",
        50 => "League grid penalty",
        51 => "Retry penalty",
        52 => "Illegal time gain",
        53 => "Mandatory pitstop",
        54 => "Attribute assigned",
        _ => return None,
    })
}
