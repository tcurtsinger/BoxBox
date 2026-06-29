//! Circuit and session-type display labels, ported from the relevant maps in
//! `shared/parser/constants.ts`. Used to resolve the snapshot's `track` and
//! `session` strings for the driver-facing UI.

/// Resolve a track id to its circuit name. `None` for an unknown id (incl. -1).
pub fn track_name(id: i32) -> Option<&'static str> {
    Some(match id {
        0 => "Melbourne",
        1 => "Paul Ricard",
        2 => "Shanghai",
        3 => "Sakhir",
        4 => "Catalunya",
        5 => "Monaco",
        6 => "Montreal",
        7 => "Silverstone",
        8 => "Hockenheim",
        9 => "Hungaroring",
        10 => "Spa",
        11 => "Monza",
        12 => "Singapore",
        13 => "Suzuka",
        14 => "Abu Dhabi",
        15 => "Texas",
        16 => "Brazil",
        17 => "Austria",
        18 => "Sochi",
        19 => "Mexico",
        20 => "Baku",
        21 => "Sakhir Short",
        22 => "Silverstone Short",
        23 => "Texas Short",
        24 => "Suzuka Short",
        25 => "Hanoi",
        26 => "Zandvoort",
        27 => "Imola",
        28 => "Portimão",
        29 => "Jeddah",
        30 => "Miami",
        31 => "Las Vegas",
        32 => "Losail",
        39 => "Silverstone (Reverse)",
        40 => "Austria (Reverse)",
        41 => "Zandvoort (Reverse)",
        42 => "Madrid",
        _ => return None,
    })
}

/// Resolve a session-type code to its label. Falls back to "Unknown".
pub fn session_label(t: u8) -> &'static str {
    match t {
        1 => "P1",
        2 => "P2",
        3 => "P3",
        4 => "Short Practice",
        5 => "Q1",
        6 => "Q2",
        7 => "Q3",
        8 => "Short Qualifying",
        9 => "One-Shot Qualifying",
        10 => "Sprint Shootout 1",
        11 => "Sprint Shootout 2",
        12 => "Sprint Shootout 3",
        13 => "Short Sprint Shootout",
        14 => "One-Shot Sprint Shootout",
        15 => "Race",
        16 => "Race 2",
        17 => "Race 3",
        18 => "Time Trial",
        _ => "Unknown",
    }
}
