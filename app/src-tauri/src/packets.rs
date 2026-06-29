//! F1 UDP packet parsing, ported from `shared/parser/` (TypeScript) to Rust.
//!
//! `parse_packet` mirrors `index.ts`: it decodes the 29-byte header, then the
//! body for each packet id we support, returning `ParsedPacket { id, header,
//! data }`. The shapes here are intentionally the cleaner, app-facing ones from
//! `types.ts` (sector/delta times folded into whole ms, byte flags -> bools,
//! the 64-bit session UID as a string) so the frontend consumes them directly.
//!
//! Format handling matches the reference exactly: per-car array lengths and a
//! handful of field widths differ between the 2025 and 2026 (season pack)
//! formats; each parser branches on `header.packet_format` where it must.

use serde::Serialize;

pub const HEADER_SIZE: usize = 29;

// ERS energy store capacity (Joules), used for battery-percentage display.
const ERS_MAX_JOULES: f32 = 4_000_000.0;

/// Max cars carried in the per-car arrays. 24 from the 2026 pack, 22 before it.
fn max_cars_for_format(format: u16) -> usize {
    if format >= 2026 {
        24
    } else {
        22
    }
}

// --- Reader -------------------------------------------------------------------
// Cursor-based little-endian reader mirroring `reader.ts`. Reads are bounds-safe:
// a read past the end yields a zero value (and empty string/array) rather than
// panicking, so a truncated or malformed datagram can never crash the listener
// thread. Such a read also trips the `overran` flag, which the dispatcher reads
// to drop a truncated known packet's body rather than let zero-filled tail fields
// masquerade as real data. Reading fields in declaration order lets each parser
// mirror the C struct from the EA spec exactly.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
    /// Set once any read or skip has run past the end of the buffer.
    overran: bool,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self {
            buf,
            pos: 0,
            overran: false,
        }
    }

    fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }

    /// Take `n` bytes, advancing the cursor. Returns `None` (and parks the cursor
    /// at end) if fewer than `n` bytes remain.
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let Some(end) = self.pos.checked_add(n) else {
            self.overran = true;
            return None;
        };
        if end > self.buf.len() {
            self.pos = self.buf.len();
            self.overran = true;
            return None;
        }
        let s = &self.buf[self.pos..end];
        self.pos = end;
        Some(s)
    }

    fn u8(&mut self) -> u8 {
        self.take(1).map_or(0, |b| b[0])
    }

    fn i8(&mut self) -> i8 {
        self.u8() as i8
    }

    fn u16(&mut self) -> u16 {
        self.take(2).map_or(0, |b| u16::from_le_bytes([b[0], b[1]]))
    }

    fn u32(&mut self) -> u32 {
        self.take(4)
            .map_or(0, |b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn u64(&mut self) -> u64 {
        self.take(8).map_or(0, |b| {
            u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
        })
    }

    fn f32(&mut self) -> f32 {
        f32::from_bits(self.u32())
    }

    fn f64(&mut self) -> f64 {
        f64::from_bits(self.u64())
    }

    fn skip(&mut self, n: usize) {
        let end = self.pos.saturating_add(n);
        if end > self.buf.len() {
            self.overran = true;
        }
        self.pos = end.min(self.buf.len());
    }

    /// Fixed-length, null-terminated UTF-8 string. Advances by the full length.
    fn str(&mut self, len: usize) -> String {
        match self.take(len) {
            Some(s) => {
                let end = s.iter().position(|&c| c == 0).unwrap_or(s.len());
                String::from_utf8_lossy(&s[..end]).into_owned()
            }
            None => String::new(),
        }
    }

    fn u8_array(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| self.u8()).collect()
    }

    fn u16_array(&mut self, n: usize) -> Vec<u16> {
        (0..n).map(|_| self.u16()).collect()
    }

    fn f32_array(&mut self, n: usize) -> Vec<f32> {
        (0..n).map(|_| self.f32()).collect()
    }
}

// --- Header -------------------------------------------------------------------

/// The F1 UDP PacketHeader (little-endian), identical across the 2025/2026
/// formats. Mirrors `header.ts`. `session_uid` is carried as a string so the u64
/// survives JSON without precision loss.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketHeader {
    pub packet_format: u16,
    pub game_year: u8,
    pub game_major_version: u8,
    pub game_minor_version: u8,
    pub packet_version: u8,
    pub packet_id: u8,
    pub session_uid: String,
    pub session_time: f32,
    pub frame_identifier: u32,
    pub overall_frame_identifier: u32,
    pub player_car_index: u8,
    pub secondary_player_car_index: u8,
}

fn parse_header(rd: &mut Reader) -> PacketHeader {
    PacketHeader {
        packet_format: rd.u16(),
        game_year: rd.u8(),
        game_major_version: rd.u8(),
        game_minor_version: rd.u8(),
        packet_version: rd.u8(),
        packet_id: rd.u8(),
        session_uid: rd.u64().to_string(),
        session_time: rd.f32(),
        frame_identifier: rd.u32(),
        overall_frame_identifier: rd.u32(),
        player_car_index: rd.u8(),
        secondary_player_car_index: rd.u8(),
    }
}

// --- Session (id 1) -----------------------------------------------------------

/// One active-aero activation zone, as a fraction (0..1) of the lap.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AeroZone {
    pub zone_start: f32,
    pub zone_end: f32,
}

/// One DRS activation zone (same shape as `AeroZone`, kept distinct to match the
/// spec's two struct names and the snapshot field).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrsZone {
    pub zone_start: f32,
    pub zone_end: f32,
}

const MAX_AERO_ZONES: usize = 8; // cs_maxActiveAeroZonesPerLap
const MAX_DRS_ZONES: usize = 4; // cs_maxDRSZonesPerLap

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub weather: u8,
    pub track_temperature: i8,
    pub air_temperature: i8,
    pub total_laps: u8,
    pub track_length: u16,
    pub session_type: u8,
    pub track_id: i8,
    pub formula: u8,
    pub session_time_left: u16,
    pub session_duration: u16,
    pub pit_speed_limit: u8,
    pub game_paused: bool,
    pub is_spectating: bool,
    pub spectator_car_index: u8,
    pub num_marshal_zones: u8,
    pub safety_car_status: u8,
    pub equal_car_performance: Option<u8>,
    /// 2026 Season Pack active-aero / DRS activation zones. `track_status` is None
    /// and the zone lists empty for the 2025 format (or a tail-truncated packet).
    pub active_aero_track_status: Option<u8>,
    pub active_aero_zones_full: Vec<AeroZone>,
    pub active_aero_zones_partial: Vec<AeroZone>,
    pub drs_zones: Vec<DrsZone>,
}

fn parse_session(rd: &mut Reader, header: &PacketHeader) -> SessionData {
    let weather = rd.u8();
    let track_temperature = rd.i8();
    let air_temperature = rd.i8();
    let total_laps = rd.u8();
    let track_length = rd.u16();
    let session_type = rd.u8();
    let track_id = rd.i8();
    let formula = rd.u8();
    let session_time_left = rd.u16();
    let session_duration = rd.u16();
    let pit_speed_limit = rd.u8();
    let game_paused = rd.u8();
    let is_spectating = rd.u8();
    let spectator_car_index = rd.u8();
    rd.u8(); // sliProNativeSupport
    let num_marshal_zones = rd.u8();
    rd.skip(21 * 5); // MarshalZone[21] = { f32 zoneStart, i8 zoneFlag }
    let safety_car_status = rd.u8();

    // Tail fields. equalCarPerformance sits 554 bytes past safetyCarStatus in both
    // the 2025 and 2026 layouts (every 2026 addition lands further on), so it's
    // read for both formats. The 2026 pack then carries the active-aero / DRS
    // activation zones. The whole tail is optional: a session truncated here still
    // delivers the critical early fields (track, type, laps) above.
    let mut equal_car_performance = None;
    let mut active_aero_track_status = None;
    let mut active_aero_zones_full = Vec::new();
    let mut active_aero_zones_partial = Vec::new();
    let mut drs_zones = Vec::new();
    if rd.remaining() >= 555 {
        rd.skip(554); // networkGame .. numRedFlagPeriods
        equal_car_performance = Some(rd.u8());

        // 2026 only: skip the gameplay-settings block (recoveryMode ..
        // sector3LapDistanceStart = 44 bytes), then the activation-zone tail.
        const AERO_TAIL_BYTES: usize =
            44 + 1 + (1 + MAX_AERO_ZONES * 8) * 2 + 1 + MAX_DRS_ZONES * 8;
        if header.packet_format >= 2026 && rd.remaining() >= AERO_TAIL_BYTES {
            rd.skip(44);
            active_aero_track_status = Some(rd.u8());
            active_aero_zones_full = read_aero_zones(rd, MAX_AERO_ZONES);
            active_aero_zones_partial = read_aero_zones(rd, MAX_AERO_ZONES);
            drs_zones = read_drs_zones(rd, MAX_DRS_ZONES);
        }
    }

    SessionData {
        weather,
        track_temperature,
        air_temperature,
        total_laps,
        track_length,
        session_type,
        track_id,
        formula,
        session_time_left,
        session_duration,
        pit_speed_limit,
        game_paused: game_paused == 1,
        is_spectating: is_spectating == 1,
        spectator_car_index,
        num_marshal_zones,
        safety_car_status,
        equal_car_performance,
        active_aero_track_status,
        active_aero_zones_full,
        active_aero_zones_partial,
        drs_zones,
    }
}

/// Read the count byte then the fixed array of `max` `AeroZone`s, keeping the
/// first `num` (the remainder is unused padding in the packet).
fn read_aero_zones(rd: &mut Reader, max: usize) -> Vec<AeroZone> {
    let num = rd.u8() as usize;
    let zones: Vec<AeroZone> = (0..max)
        .map(|_| AeroZone {
            zone_start: rd.f32(),
            zone_end: rd.f32(),
        })
        .collect();
    zones.into_iter().take(num.min(max)).collect()
}

fn read_drs_zones(rd: &mut Reader, max: usize) -> Vec<DrsZone> {
    let num = rd.u8() as usize;
    let zones: Vec<DrsZone> = (0..max)
        .map(|_| DrsZone {
            zone_start: rd.f32(),
            zone_end: rd.f32(),
        })
        .collect();
    zones.into_iter().take(num.min(max)).collect()
}

// --- Participants (id 4) ------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveryColour {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantEntry {
    pub index: usize,
    pub ai_controlled: bool,
    pub driver_id: u16,
    pub network_id: u16,
    pub team_id: u16,
    pub my_team: bool,
    pub race_number: u8,
    pub nationality: u8,
    pub name: String,
    pub telemetry_public: bool,
    pub show_online_names: bool,
    pub tech_level: u16,
    pub platform: u8,
    pub num_colours: u8,
    pub livery_colours: Vec<LiveryColour>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantsData {
    pub num_active_cars: u8,
    pub participants: Vec<ParticipantEntry>,
}

fn parse_participants(rd: &mut Reader, header: &PacketHeader) -> ParticipantsData {
    let wide = header.packet_format >= 2026;
    let max_cars = max_cars_for_format(header.packet_format);
    let num_active_cars = rd.u8();
    let mut participants = Vec::with_capacity(max_cars);

    for i in 0..max_cars {
        let ai_controlled = rd.u8();
        let driver_id = if wide { rd.u16() } else { rd.u8() as u16 };
        let network_id = if wide { rd.u16() } else { rd.u8() as u16 };
        let team_id = if wide { rd.u16() } else { rd.u8() as u16 };
        let my_team = rd.u8();
        let race_number = rd.u8();
        let nationality = rd.u8();
        let name = rd.str(32);
        let telemetry_public = rd.u8();
        let show_online_names = rd.u8();
        let tech_level = rd.u16();
        let platform = rd.u8();
        let num_colours = rd.u8();
        let mut livery_colours = Vec::with_capacity(4);
        for _ in 0..4 {
            livery_colours.push(LiveryColour {
                r: rd.u8(),
                g: rd.u8(),
                b: rd.u8(),
            });
        }

        participants.push(ParticipantEntry {
            index: i,
            ai_controlled: ai_controlled == 1,
            driver_id,
            network_id,
            team_id,
            my_team: my_team == 1,
            race_number,
            nationality,
            name,
            telemetry_public: telemetry_public == 1,
            show_online_names: show_online_names == 1,
            tech_level,
            platform,
            num_colours,
            livery_colours,
        });
    }

    ParticipantsData {
        num_active_cars,
        participants,
    }
}

// --- Car Setups (id 5) --------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarSetupEntry {
    pub index: usize,
    pub front_wing: u8,
    pub rear_wing: u8,
    pub on_throttle: u8,
    pub off_throttle: u8,
    pub front_camber: f32,
    pub rear_camber: f32,
    pub front_toe: f32,
    pub rear_toe: f32,
    pub front_suspension: u8,
    pub rear_suspension: u8,
    pub front_anti_roll_bar: u8,
    pub rear_anti_roll_bar: u8,
    pub front_ride_height: u8,
    pub rear_ride_height: u8,
    pub brake_pressure: u8,
    pub brake_bias: u8,
    pub engine_braking: u8,
    pub rear_left_tyre_pressure: f32,
    pub rear_right_tyre_pressure: f32,
    pub front_left_tyre_pressure: f32,
    pub front_right_tyre_pressure: f32,
    pub ballast: u8,
    pub fuel_load: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarSetupsData {
    pub cars: Vec<CarSetupEntry>,
    pub next_front_wing_value: f32,
}

fn parse_car_setups(rd: &mut Reader, header: &PacketHeader) -> CarSetupsData {
    let max_cars = max_cars_for_format(header.packet_format);
    let mut cars = Vec::with_capacity(max_cars);

    for i in 0..max_cars {
        cars.push(CarSetupEntry {
            index: i,
            front_wing: rd.u8(),
            rear_wing: rd.u8(),
            on_throttle: rd.u8(),
            off_throttle: rd.u8(),
            front_camber: rd.f32(),
            rear_camber: rd.f32(),
            front_toe: rd.f32(),
            rear_toe: rd.f32(),
            front_suspension: rd.u8(),
            rear_suspension: rd.u8(),
            front_anti_roll_bar: rd.u8(),
            rear_anti_roll_bar: rd.u8(),
            front_ride_height: rd.u8(),
            rear_ride_height: rd.u8(),
            brake_pressure: rd.u8(),
            brake_bias: rd.u8(),
            engine_braking: rd.u8(),
            rear_left_tyre_pressure: rd.f32(),
            rear_right_tyre_pressure: rd.f32(),
            front_left_tyre_pressure: rd.f32(),
            front_right_tyre_pressure: rd.f32(),
            ballast: rd.u8(),
            fuel_load: rd.f32(),
        });
    }

    let next_front_wing_value = rd.f32();
    CarSetupsData {
        cars,
        next_front_wing_value,
    }
}

// --- Lap Data (id 2) ----------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LapEntry {
    pub index: usize,
    pub last_lap_time_ms: u32,
    pub current_lap_time_ms: u32,
    pub sector1_ms: u32,
    pub sector2_ms: u32,
    pub delta_to_car_in_front_ms: u32,
    pub delta_to_race_leader_ms: u32,
    pub lap_distance: f32,
    pub total_distance: f32,
    pub safety_car_delta: f32,
    pub car_position: u8,
    pub current_lap_num: u8,
    pub pit_status: u8,
    pub num_pit_stops: u8,
    pub sector: u8,
    pub current_lap_invalid: bool,
    pub penalties: u8,
    pub total_warnings: u8,
    pub corner_cutting_warnings: u8,
    pub num_unserved_drive_through: u8,
    pub num_unserved_stop_go: u8,
    pub grid_position: u8,
    pub driver_status: u8,
    pub result_status: u8,
    pub pit_lane_timer_active: bool,
    pub pit_lane_time_in_lane_ms: u16,
    pub pit_stop_timer_ms: u16,
    pub pit_stop_should_serve_pen: u8,
    pub speed_trap_fastest_speed: f32,
    pub speed_trap_fastest_lap: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LapDataData {
    pub cars: Vec<LapEntry>,
    pub time_trial_pb_car_idx: u8,
    pub time_trial_rival_car_idx: u8,
}

fn parse_lap_data(rd: &mut Reader, header: &PacketHeader) -> LapDataData {
    let max_cars = max_cars_for_format(header.packet_format);
    let mut cars = Vec::with_capacity(max_cars);

    for i in 0..max_cars {
        let last_lap_time_ms = rd.u32();
        let current_lap_time_ms = rd.u32();
        let s1ms = rd.u16();
        let s1min = rd.u8();
        let s2ms = rd.u16();
        let s2min = rd.u8();
        let dcif_ms = rd.u16();
        let dcif_min = rd.u8();
        let drl_ms = rd.u16();
        let drl_min = rd.u8();
        let lap_distance = rd.f32();
        let total_distance = rd.f32();
        let safety_car_delta = rd.f32();
        let car_position = rd.u8();
        let current_lap_num = rd.u8();
        let pit_status = rd.u8();
        let num_pit_stops = rd.u8();
        let sector = rd.u8();
        let current_lap_invalid = rd.u8();
        let penalties = rd.u8();
        let total_warnings = rd.u8();
        let corner_cutting_warnings = rd.u8();
        let num_unserved_drive_through = rd.u8();
        let num_unserved_stop_go = rd.u8();
        let grid_position = rd.u8();
        let driver_status = rd.u8();
        let result_status = rd.u8();
        let pit_lane_timer_active = rd.u8();
        let pit_lane_time_in_lane_ms = rd.u16();
        let pit_stop_timer_ms = rd.u16();
        let pit_stop_should_serve_pen = rd.u8();
        let speed_trap_fastest_speed = rd.f32();
        let speed_trap_fastest_lap = rd.u8();

        cars.push(LapEntry {
            index: i,
            last_lap_time_ms,
            current_lap_time_ms,
            sector1_ms: s1min as u32 * 60000 + s1ms as u32,
            sector2_ms: s2min as u32 * 60000 + s2ms as u32,
            delta_to_car_in_front_ms: dcif_min as u32 * 60000 + dcif_ms as u32,
            delta_to_race_leader_ms: drl_min as u32 * 60000 + drl_ms as u32,
            lap_distance,
            total_distance,
            safety_car_delta,
            car_position,
            current_lap_num,
            pit_status,
            num_pit_stops,
            sector,
            current_lap_invalid: current_lap_invalid == 1,
            penalties,
            total_warnings,
            corner_cutting_warnings,
            num_unserved_drive_through,
            num_unserved_stop_go,
            grid_position,
            driver_status,
            result_status,
            pit_lane_timer_active: pit_lane_timer_active == 1,
            pit_lane_time_in_lane_ms,
            pit_stop_timer_ms,
            pit_stop_should_serve_pen,
            speed_trap_fastest_speed,
            speed_trap_fastest_lap,
        });
    }

    let time_trial_pb_car_idx = rd.u8();
    let time_trial_rival_car_idx = rd.u8();
    LapDataData {
        cars,
        time_trial_pb_car_idx,
        time_trial_rival_car_idx,
    }
}

// --- Car Telemetry (id 6) -----------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarTelemetryEntry {
    pub index: usize,
    pub speed: u16,
    pub throttle: f32,
    pub brake: f32,
    pub steer: f32,
    pub gear: i8,
    pub engine_rpm: u16,
    pub drs: bool,
    pub rev_lights_percent: u8,
    pub brakes_temperature: Vec<u16>,
    pub tyres_surface_temperature: Vec<u8>,
    pub tyres_inner_temperature: Vec<u8>,
    pub engine_temperature: u16,
    pub tyres_pressure: Vec<f32>,
    pub surface_type: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarTelemetryData {
    pub cars: Vec<CarTelemetryEntry>,
    pub mfd_panel_index: u8,
    pub suggested_gear: i8,
}

fn parse_car_telemetry(rd: &mut Reader, header: &PacketHeader) -> CarTelemetryData {
    let engine_temp_wide = header.packet_format < 2026;
    let max_cars = max_cars_for_format(header.packet_format);
    let mut cars = Vec::with_capacity(max_cars);

    for i in 0..max_cars {
        let speed = rd.u16();
        let throttle = rd.f32();
        let steer = rd.f32();
        let brake = rd.f32();
        rd.u8(); // clutch
        let gear = rd.i8();
        let engine_rpm = rd.u16();
        let drs = rd.u8();
        let rev_lights_percent = rd.u8();
        rd.u16(); // revLightsBitValue
        let brakes_temperature = rd.u16_array(4);
        let tyres_surface_temperature = rd.u8_array(4);
        let tyres_inner_temperature = rd.u8_array(4);
        let engine_temperature = if engine_temp_wide {
            rd.u16()
        } else {
            rd.u8() as u16
        };
        let tyres_pressure = rd.f32_array(4);
        let surface_type = rd.u8_array(4);

        cars.push(CarTelemetryEntry {
            index: i,
            speed,
            throttle,
            brake,
            steer,
            gear,
            engine_rpm,
            drs: drs == 1,
            rev_lights_percent,
            brakes_temperature,
            tyres_surface_temperature,
            tyres_inner_temperature,
            engine_temperature,
            tyres_pressure,
            surface_type,
        });
    }

    let mfd_panel_index = rd.u8();
    rd.u8(); // mfdPanelIndexSecondaryPlayer
    let suggested_gear = rd.i8();
    CarTelemetryData {
        cars,
        mfd_panel_index,
        suggested_gear,
    }
}

// --- Car Status (id 7) --------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarStatusEntry {
    pub index: usize,
    pub fuel_mix: u8,
    pub fuel_in_tank: f32,
    pub fuel_capacity: f32,
    pub fuel_remaining_laps: f32,
    pub max_rpm: u16,
    pub drs_allowed: bool,
    pub drs_activation_distance: u16,
    pub actual_tyre_compound: u8,
    pub visual_tyre_compound: u8,
    pub tyres_age_laps: u8,
    pub vehicle_fia_flags: i8,
    pub ers_store_energy: f32,
    pub ers_deploy_mode: u8,
    pub ers_deployed_this_lap: f32,
    pub battery_pct: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarStatusData {
    pub cars: Vec<CarStatusEntry>,
}

fn parse_car_status(rd: &mut Reader, header: &PacketHeader) -> CarStatusData {
    let is_2026 = header.packet_format >= 2026;
    let max_cars = max_cars_for_format(header.packet_format);
    let mut cars = Vec::with_capacity(max_cars);

    for i in 0..max_cars {
        rd.u8(); // tractionControl
        rd.u8(); // antiLockBrakes
        let fuel_mix = rd.u8();
        rd.u8(); // frontBrakeBias
        rd.u8(); // pitLimiterStatus
        let fuel_in_tank = rd.f32();
        let fuel_capacity = rd.f32();
        let fuel_remaining_laps = rd.f32();
        let max_rpm = rd.u16();
        rd.u16(); // idleRPM
        rd.u8(); // maxGears
        let drs_allowed = rd.u8();
        let drs_activation_distance = rd.u16();
        let actual_tyre_compound = rd.u8();
        let visual_tyre_compound = rd.u8();
        let tyres_age_laps = rd.u8();
        let vehicle_fia_flags = rd.i8();
        rd.f32(); // enginePowerICE
        rd.f32(); // enginePowerMGUK
        let ers_store_energy = rd.f32();
        let ers_deploy_mode = rd.u8();
        rd.f32(); // ersHarvestedThisLapMGUK
        rd.f32(); // ersHarvestedThisLapMGUH
        if is_2026 {
            rd.f32(); // ersHarvestLimitPerLap (2026 only)
        }
        let ers_deployed_this_lap = rd.f32();
        rd.u8(); // networkPaused

        let battery_pct = ((ers_store_energy / ERS_MAX_JOULES) * 100.0).clamp(0.0, 100.0);

        cars.push(CarStatusEntry {
            index: i,
            fuel_mix,
            fuel_in_tank,
            fuel_capacity,
            fuel_remaining_laps,
            max_rpm,
            drs_allowed: drs_allowed == 1,
            drs_activation_distance,
            actual_tyre_compound,
            visual_tyre_compound,
            tyres_age_laps,
            vehicle_fia_flags,
            ers_store_energy,
            ers_deploy_mode,
            ers_deployed_this_lap,
            battery_pct,
        });
    }

    CarStatusData { cars }
}

// --- Car Damage (id 10) -------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerUnitWear {
    pub ice: u8,
    pub energy_store: u8,
    pub control_electronics: u8,
    pub mgu_k: u8,
    pub turbo_charger: u8,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarDamageEntry {
    pub index: usize,
    pub tyres_wear: Vec<f32>,
    pub tyres_damage: Vec<u8>,
    pub brakes_damage: Vec<u8>,
    pub front_left_wing_damage: u8,
    pub front_right_wing_damage: u8,
    pub rear_wing_damage: u8,
    pub floor_damage: u8,
    pub diffuser_damage: u8,
    pub sidepod_damage: u8,
    pub gear_box_damage: u8,
    pub engine_damage: u8,
    pub power_unit_wear: PowerUnitWear,
    pub drs_fault: bool,
    pub ers_fault: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarDamageData {
    pub cars: Vec<CarDamageEntry>,
}

fn parse_car_damage(rd: &mut Reader, header: &PacketHeader) -> CarDamageData {
    let max_cars = max_cars_for_format(header.packet_format);
    let mut cars = Vec::with_capacity(max_cars);

    for i in 0..max_cars {
        let tyres_wear = rd.f32_array(4);
        let tyres_damage = rd.u8_array(4);
        let brakes_damage = rd.u8_array(4);
        rd.u8_array(4); // tyreBlisters
        let front_left_wing_damage = rd.u8();
        let front_right_wing_damage = rd.u8();
        let rear_wing_damage = rd.u8();
        let floor_damage = rd.u8();
        let diffuser_damage = rd.u8();
        let sidepod_damage = rd.u8();
        let drs_fault = rd.u8();
        let ers_fault = rd.u8();
        let gear_box_damage = rd.u8();
        let engine_damage = rd.u8();
        rd.u8(); // engineMGUHWear (legacy slot; not shown in the 2026 MFD)
        let engine_es_wear = rd.u8();
        let engine_ce_wear = rd.u8();
        let engine_ice_wear = rd.u8();
        let engine_mguk_wear = rd.u8();
        let engine_tc_wear = rd.u8();
        rd.u8(); // engineBlown
        rd.u8(); // engineSeized

        cars.push(CarDamageEntry {
            index: i,
            tyres_wear,
            tyres_damage,
            brakes_damage,
            front_left_wing_damage,
            front_right_wing_damage,
            rear_wing_damage,
            floor_damage,
            diffuser_damage,
            sidepod_damage,
            gear_box_damage,
            engine_damage,
            power_unit_wear: PowerUnitWear {
                ice: engine_ice_wear,
                energy_store: engine_es_wear,
                control_electronics: engine_ce_wear,
                mgu_k: engine_mguk_wear,
                turbo_charger: engine_tc_wear,
            },
            drs_fault: drs_fault == 1,
            ers_fault: ers_fault == 1,
        });
    }

    CarDamageData { cars }
}

// --- Event (id 3) -------------------------------------------------------------
// A 4-char code followed by a code-specific union. Optional fields are omitted
// from the JSON when absent (matching the TS optional keys).

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventData {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_idx: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_vehicle_idx: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub penalty_type: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub infringement_type: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lap_num: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub places_gained: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safety_car_type: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safety_car_event_type: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lap_time: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_lights: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_time: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overtaking_vehicle_idx: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub being_overtaken_vehicle_idx: Option<u8>,
}

fn parse_event(rd: &mut Reader, header: &PacketHeader) -> EventData {
    let is_2026 = header.packet_format >= 2026;
    let code = rd.str(4);
    let mut e = EventData {
        code: code.clone(),
        ..Default::default()
    };

    match code.as_str() {
        "FTLP" => {
            e.vehicle_idx = Some(rd.u8());
            e.lap_time = Some(rd.f32());
        }
        "RTMT" => {
            e.vehicle_idx = Some(rd.u8());
            e.reason = Some(rd.u8());
        }
        "DRSD" => {
            e.reason = Some(rd.u8());
        }
        "TMPT" | "RCWN" | "DTSV" => {
            e.vehicle_idx = Some(rd.u8());
        }
        "PENA" => {
            e.penalty_type = Some(rd.u8());
            e.infringement_type = Some(rd.u8());
            e.vehicle_idx = Some(rd.u8());
            e.other_vehicle_idx = Some(rd.u8());
            e.time = Some(rd.u8());
            e.lap_num = Some(rd.u8());
            e.places_gained = Some(rd.u8());
        }
        "SPTP" => {
            e.vehicle_idx = Some(rd.u8());
            e.speed = Some(rd.f32());
        }
        "STLG" => {
            e.num_lights = Some(rd.u8());
        }
        "SGSV" => {
            e.vehicle_idx = Some(rd.u8());
            e.stop_time = Some(rd.f32());
        }
        "OVTK" => {
            e.overtaking_vehicle_idx = Some(rd.u8());
            e.being_overtaken_vehicle_idx = Some(rd.u8());
        }
        "SCAR" => {
            e.safety_car_type = Some(rd.u8());
            e.safety_car_event_type = Some(rd.u8());
        }
        "COLL" => {
            e.vehicle_idx = Some(rd.u8());
            e.other_vehicle_idx = Some(rd.u8());
            if is_2026 {
                e.severity = Some(rd.u8());
            }
        }
        // SSTA, SEND, CHQF, DRSE, LGOT, RDFL, FLBK, BUTN: no payload decoded.
        _ => {}
    }

    e
}

// --- Final Classification (id 8) ----------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalClassificationEntry {
    pub index: usize,
    pub position: u8,
    pub num_laps: u8,
    pub grid_position: u8,
    pub points: u8,
    pub num_pit_stops: u8,
    pub result_status: u8,
    pub result_reason: u8,
    pub best_lap_time_in_ms: u32,
    pub total_race_time: f64,
    pub penalties_time: u8,
    pub num_penalties: u8,
    pub num_tyre_stints: u8,
    pub tyre_stints_actual: Vec<u8>,
    pub tyre_stints_visual: Vec<u8>,
    pub tyre_stints_end_laps: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalClassificationData {
    pub num_cars: u8,
    pub classification: Vec<FinalClassificationEntry>,
}

fn parse_final_classification(rd: &mut Reader, header: &PacketHeader) -> FinalClassificationData {
    let max_cars = max_cars_for_format(header.packet_format);
    let num_cars = rd.u8();
    let mut classification = Vec::with_capacity(max_cars);

    for i in 0..max_cars {
        let position = rd.u8();
        let num_laps = rd.u8();
        let grid_position = rd.u8();
        let points = rd.u8();
        let num_pit_stops = rd.u8();
        let result_status = rd.u8();
        let result_reason = rd.u8();
        let best_lap_time_in_ms = rd.u32();
        let total_race_time = rd.f64();
        let penalties_time = rd.u8();
        let num_penalties = rd.u8();
        let num_tyre_stints = rd.u8();
        let tyre_stints_actual = rd.u8_array(8);
        let tyre_stints_visual = rd.u8_array(8);
        let tyre_stints_end_laps = rd.u8_array(8);

        classification.push(FinalClassificationEntry {
            index: i,
            position,
            num_laps,
            grid_position,
            points,
            num_pit_stops,
            result_status,
            result_reason,
            best_lap_time_in_ms,
            total_race_time,
            penalties_time,
            num_penalties,
            num_tyre_stints,
            tyre_stints_actual,
            tyre_stints_visual,
            tyre_stints_end_laps,
        });
    }

    FinalClassificationData {
        num_cars,
        classification,
    }
}

// --- Time Trial (id 14) -------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeTrialDataSet {
    pub car_idx: u8,
    pub team_id: u16,
    pub lap_time_ms: u32,
    pub sector1_ms: u32,
    pub sector2_ms: u32,
    pub sector3_ms: u32,
    pub traction_control: u8,
    pub gearbox_assist: u8,
    pub anti_lock_brakes: u8,
    pub equal_car_performance: u8,
    pub custom_setup: u8,
    pub valid: u8,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeTrialData {
    pub player_session_best: TimeTrialDataSet,
    pub personal_best: TimeTrialDataSet,
    pub rival: TimeTrialDataSet,
}

fn parse_time_trial_set(rd: &mut Reader, wide: bool) -> TimeTrialDataSet {
    TimeTrialDataSet {
        car_idx: rd.u8(),
        team_id: if wide { rd.u16() } else { rd.u8() as u16 },
        lap_time_ms: rd.u32(),
        sector1_ms: rd.u32(),
        sector2_ms: rd.u32(),
        sector3_ms: rd.u32(),
        traction_control: rd.u8(),
        gearbox_assist: rd.u8(),
        anti_lock_brakes: rd.u8(),
        equal_car_performance: rd.u8(),
        custom_setup: rd.u8(),
        valid: rd.u8(),
    }
}

fn parse_time_trial(rd: &mut Reader, header: &PacketHeader) -> TimeTrialData {
    let wide = header.packet_format >= 2026;
    TimeTrialData {
        player_session_best: parse_time_trial_set(rd, wide),
        personal_best: parse_time_trial_set(rd, wide),
        rival: parse_time_trial_set(rd, wide),
    }
}

// --- Motion Ex (id 13) --------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionExData {
    pub wheel_slip_ratio: Vec<f32>,
    pub wheel_slip_angle: Vec<f32>,
    pub wheel_lat_force: Vec<f32>,
    pub wheel_long_force: Vec<f32>,
    pub local_velocity: Vec3,
    pub angular_velocity: Vec3,
    pub front_wheels_angle: f32,
}

fn parse_motion_ex(rd: &mut Reader, _header: &PacketHeader) -> MotionExData {
    rd.skip(64); // suspensionPosition/Velocity/Acceleration[4] + wheelSpeed[4]
    let wheel_slip_ratio = rd.f32_array(4);
    let wheel_slip_angle = rd.f32_array(4);
    let wheel_lat_force = rd.f32_array(4);
    let wheel_long_force = rd.f32_array(4);
    rd.skip(4); // heightOfCOGAboveGround
    let local_velocity = Vec3 {
        x: rd.f32(),
        y: rd.f32(),
        z: rd.f32(),
    };
    let angular_velocity = Vec3 {
        x: rd.f32(),
        y: rd.f32(),
        z: rd.f32(),
    };
    rd.skip(12); // angularAcceleration[3]
    let front_wheels_angle = rd.f32();

    MotionExData {
        wheel_slip_ratio,
        wheel_slip_angle,
        wheel_lat_force,
        wheel_long_force,
        local_velocity,
        angular_velocity,
        front_wheels_angle,
    }
}

// --- Car Telemetry 2 (id 16) --------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarTelemetry2Entry {
    pub index: usize,
    pub active_aero_mode: u8,
    pub active_aero_available: bool,
    pub active_aero_activation_distance: u16,
    pub overtake_available: bool,
    pub overtake_active: bool,
    pub overtake_activation_distance: u16,
    pub is_2026: bool,
    pub driving_wrong_way: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarTelemetry2Data {
    pub cars: Vec<CarTelemetry2Entry>,
}

fn parse_car_telemetry2(rd: &mut Reader, header: &PacketHeader) -> CarTelemetry2Data {
    let max_cars = max_cars_for_format(header.packet_format);
    let mut cars = Vec::with_capacity(max_cars);

    for i in 0..max_cars {
        let active_aero_mode = rd.u8();
        let active_aero_available = rd.u8();
        let active_aero_activation_distance = rd.u16();
        let overtake_available = rd.u8();
        let overtake_active = rd.u8();
        let overtake_activation_distance = rd.u16();
        let is_2026 = rd.u8();
        let driving_wrong_way = rd.u8();

        cars.push(CarTelemetry2Entry {
            index: i,
            active_aero_mode,
            active_aero_available: active_aero_available == 1,
            active_aero_activation_distance,
            overtake_available: overtake_available == 1,
            overtake_active: overtake_active == 1,
            overtake_activation_distance,
            is_2026: is_2026 == 1,
            driving_wrong_way: driving_wrong_way == 1,
        });
    }

    CarTelemetry2Data { cars }
}

// --- Dispatch -----------------------------------------------------------------

/// The decoded body, serialized untagged so `data` is just the body object
/// (the packet `id` sibling field is the discriminant, matching `ParsedPacket`
/// in `types.ts`).
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum Body {
    Session(SessionData),
    LapData(LapDataData),
    Event(EventData),
    Participants(ParticipantsData),
    CarSetups(CarSetupsData),
    CarTelemetry(CarTelemetryData),
    CarStatus(CarStatusData),
    FinalClassification(FinalClassificationData),
    CarDamage(CarDamageData),
    MotionEx(MotionExData),
    TimeTrial(TimeTrialData),
    CarTelemetry2(CarTelemetry2Data),
}

/// One parsed UDP datagram: the header, plus the decoded body (or `None` for a
/// packet id we receive but do not yet decode). Mirrors `ParsedPacket`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPacket {
    pub id: u8,
    pub header: PacketHeader,
    pub data: Option<Body>,
}

/// Parse one UDP datagram. Returns `None` for anything smaller than a header.
/// Packets we don't decode yet come back with `data: None` so callers still get
/// the header (format, session UID, id).
pub fn parse_packet(buf: &[u8]) -> Option<ParsedPacket> {
    if buf.len() < HEADER_SIZE {
        return None;
    }

    let mut rd = Reader::new(buf);
    let header = parse_header(&mut rd);
    let id = header.packet_id;

    let data = match id {
        1 => Some(Body::Session(parse_session(&mut rd, &header))),
        2 => Some(Body::LapData(parse_lap_data(&mut rd, &header))),
        3 => Some(Body::Event(parse_event(&mut rd, &header))),
        4 => Some(Body::Participants(parse_participants(&mut rd, &header))),
        5 => Some(Body::CarSetups(parse_car_setups(&mut rd, &header))),
        6 => Some(Body::CarTelemetry(parse_car_telemetry(&mut rd, &header))),
        7 => Some(Body::CarStatus(parse_car_status(&mut rd, &header))),
        8 => Some(Body::FinalClassification(parse_final_classification(
            &mut rd, &header,
        ))),
        10 => Some(Body::CarDamage(parse_car_damage(&mut rd, &header))),
        13 => Some(Body::MotionEx(parse_motion_ex(&mut rd, &header))),
        14 => Some(Body::TimeTrial(parse_time_trial(&mut rd, &header))),
        16 => Some(Body::CarTelemetry2(parse_car_telemetry2(&mut rd, &header))),
        _ => None,
    };

    // A known packet that read past its end was truncated: its trailing fields are
    // zero-filled placeholders, not real data (e.g. a header-plus-`PENA` datagram
    // would otherwise become a drive-through against car 0). Drop the body so a
    // short datagram can't mutate state — the header still flows, for heartbeat
    // and format detection.
    let data = if rd.overran { None } else { data };

    Some(ParsedPacket { id, header, data })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a valid 29-byte header for the given format and packet id, matching
    /// the layout in `scripts/send-test-packet.mjs`.
    fn header_bytes(format: u16, packet_id: u8) -> Vec<u8> {
        let mut b = vec![0u8; HEADER_SIZE];
        b[0..2].copy_from_slice(&format.to_le_bytes());
        b[2] = (format % 100) as u8; // gameYear
        b[3] = 1; // gameMajorVersion
        b[5] = 1; // packetVersion
        b[6] = packet_id;
        b[7..15].copy_from_slice(&123456789u64.to_le_bytes()); // sessionUID
        b[15..19].copy_from_slice(&1.5f32.to_le_bytes()); // sessionTime
        b[19..23].copy_from_slice(&42u32.to_le_bytes()); // frameIdentifier
        b[23..27].copy_from_slice(&42u32.to_le_bytes()); // overallFrameIdentifier
        b[27] = 0; // playerCarIndex
        b[28] = 255; // secondaryPlayerCarIndex
        b
    }

    #[test]
    fn header_decodes() {
        let buf = header_bytes(2026, 6);
        let mut rd = Reader::new(&buf);
        let h = parse_header(&mut rd);
        assert_eq!(h.packet_format, 2026);
        assert_eq!(h.game_year, 26);
        assert_eq!(h.packet_id, 6);
        assert_eq!(h.session_uid, "123456789");
        assert_eq!(h.session_time, 1.5);
        assert_eq!(h.frame_identifier, 42);
        assert_eq!(h.player_car_index, 0);
        assert_eq!(h.secondary_player_car_index, 255);
        assert_eq!(rd.pos, HEADER_SIZE);
    }

    #[test]
    fn truncated_known_packet_drops_body() {
        // A header-only buffer fed to a body parser must not panic, and must come
        // back with no body: zero-filled tail fields are not real data (P1.2). The
        // header still flows, for heartbeat / format detection.
        let buf = header_bytes(2026, 16);
        let packet = parse_packet(&buf).expect("header parses");
        assert!(
            packet.data.is_none(),
            "truncated CarTelemetry2 body dropped"
        );
        assert_eq!(packet.id, 16);
    }

    #[test]
    fn short_by_one_packet_drops_body() {
        // 2026 CarTelemetry2 is 269 bytes (29 header + 24*10). One byte short, the
        // final field overruns, and the whole body is dropped.
        let mut buf = header_bytes(2026, 16);
        buf.extend_from_slice(&vec![0u8; 24 * 10 - 1]);
        assert_eq!(buf.len(), 269 - 1);
        let packet = parse_packet(&buf).expect("header parses");
        assert!(packet.data.is_none());
    }

    #[test]
    fn header_only_pena_does_not_forge_a_penalty() {
        // The headline P1.2 case: a datagram that is just a header + "PENA" with no
        // payload must NOT decode into a (zero-filled) drive-through against car 0.
        let mut buf = header_bytes(2026, 3);
        buf.extend_from_slice(b"PENA"); // event code, no payload bytes
        let packet = parse_packet(&buf).expect("header parses");
        assert!(packet.data.is_none(), "incomplete PENA payload dropped");
    }

    #[test]
    fn car_telemetry2_decodes_first_car() {
        // 2026 CarTelemetry2: 10-byte per-car stride. Populate just car 0.
        let mut buf = header_bytes(2026, 16);
        let mut car = vec![0u8; 10];
        car[0] = 1; // activeAeroMode
        car[1] = 1; // activeAeroAvailable -> true
        car[2..4].copy_from_slice(&250u16.to_le_bytes()); // activation distance
        car[4] = 1; // overtakeAvailable -> true
        car[5] = 0; // overtakeActive -> false
        car[6..8].copy_from_slice(&120u16.to_le_bytes());
        car[8] = 1; // is2026 -> true
        car[9] = 0; // drivingWrongWay -> false
        buf.extend_from_slice(&car);
        buf.extend_from_slice(&vec![0u8; 10 * 23]); // remaining 23 cars

        let packet = parse_packet(&buf).expect("parses");
        let Some(Body::CarTelemetry2(d)) = packet.data else {
            panic!("expected CarTelemetry2");
        };
        let c0 = &d.cars[0];
        assert_eq!(c0.active_aero_mode, 1);
        assert!(c0.active_aero_available);
        assert_eq!(c0.active_aero_activation_distance, 250);
        assert!(c0.overtake_available);
        assert!(!c0.overtake_active);
        assert_eq!(c0.overtake_activation_distance, 120);
        assert!(c0.is_2026);
        assert!(!c0.driving_wrong_way);
    }

    #[test]
    fn event_pena_decodes() {
        let mut buf = header_bytes(2026, 3);
        buf.extend_from_slice(b"PENA");
        buf.extend_from_slice(&[4, 7, 3, 9, 5, 12, 1]); // type, infr, veh, other, time, lap, places
        let packet = parse_packet(&buf).expect("parses");
        let Some(Body::Event(e)) = packet.data else {
            panic!("expected Event");
        };
        assert_eq!(e.code, "PENA");
        assert_eq!(e.penalty_type, Some(4));
        assert_eq!(e.infringement_type, Some(7));
        assert_eq!(e.vehicle_idx, Some(3));
        assert_eq!(e.other_vehicle_idx, Some(9));
        assert_eq!(e.time, Some(5));
        assert_eq!(e.lap_num, Some(12));
        assert_eq!(e.places_gained, Some(1));
    }

    #[test]
    fn participant_widths_differ_by_format() {
        // 2025 uses u8 ids (one byte each); 2026 uses u16. Confirm the format
        // branch advances the cursor differently by checking the decoded name,
        // which sits right after the three id fields + myTeam/raceNumber/nat.
        let mut buf = header_bytes(2025, 4);
        buf.push(1); // numActiveCars
                     // car 0: aiControlled, driverId(u8), networkId(u8), teamId(u8), myTeam,
                     // raceNumber, nationality, name[32]...
        buf.extend_from_slice(&[0, 10, 20, 30, 1, 44, 5]);
        let mut name = vec![0u8; 32];
        name[..5].copy_from_slice(b"VETTL");
        buf.extend_from_slice(&name);
        buf.extend_from_slice(&[1, 1]); // telemetryPublic, showOnlineNames
        buf.extend_from_slice(&3u16.to_le_bytes()); // techLevel
        buf.push(2); // platform
        buf.push(0); // numColours
        buf.extend_from_slice(&vec![0u8; 12]); // 4 livery colours
                                               // pad remaining cars
        buf.extend_from_slice(&vec![0u8; 4096]);

        let packet = parse_packet(&buf).expect("parses");
        let Some(Body::Participants(p)) = packet.data else {
            panic!("expected Participants");
        };
        assert_eq!(p.num_active_cars, 1);
        assert_eq!(p.participants.len(), 22); // 2025 -> 22 cars
        let c0 = &p.participants[0];
        assert_eq!(c0.driver_id, 10);
        assert_eq!(c0.team_id, 30);
        assert_eq!(c0.race_number, 44);
        assert_eq!(c0.name, "VETTL");
        // Privacy flags parse (P2.9): car 0 published, the padded cars restricted.
        assert!(c0.telemetry_public);
        assert!(c0.show_online_names);
        assert!(!p.participants[1].telemetry_public);
        assert!(!p.participants[1].show_online_names);
    }

    #[test]
    fn session_decodes_equal_perf_and_aero_zones() {
        // Build a full 2026 Session (926 bytes) and confirm equalCarPerformance and
        // the active-aero / DRS activation zones decode at the right offsets.
        let mut buf = header_bytes(2026, 1);
        let mut body = vec![0u8; 897];
        let put_f32 = |b: &mut [u8], off: usize, v: f32| {
            b[off..off + 4].copy_from_slice(&v.to_le_bytes());
        };
        body[679] = 1; // equalCarPerformance = On
        body[724] = 0; // activeAeroTrackStatus = Full
        body[725] = 2; // numActiveAeroZonesFull
        put_f32(&mut body, 726, 0.10);
        put_f32(&mut body, 730, 0.20);
        put_f32(&mut body, 734, 0.50);
        put_f32(&mut body, 738, 0.60);
        body[790] = 1; // numActiveAeroZonesPartial
        put_f32(&mut body, 791, 0.30);
        put_f32(&mut body, 795, 0.40);
        body[855] = 1; // numDRSZones
        put_f32(&mut body, 856, 0.70);
        put_f32(&mut body, 860, 0.80);
        buf.extend_from_slice(&body);
        assert_eq!(buf.len(), 926);

        let packet = parse_packet(&buf).expect("parses");
        let Some(Body::Session(s)) = packet.data else {
            panic!("expected Session");
        };
        assert_eq!(s.equal_car_performance, Some(1));
        assert_eq!(s.active_aero_track_status, Some(0));
        assert_eq!(s.active_aero_zones_full.len(), 2);
        assert_eq!(s.active_aero_zones_full[1].zone_start, 0.50);
        assert_eq!(s.active_aero_zones_full[1].zone_end, 0.60);
        assert_eq!(s.active_aero_zones_partial.len(), 1);
        assert_eq!(s.active_aero_zones_partial[0].zone_start, 0.30);
        assert_eq!(s.drs_zones.len(), 1);
        assert_eq!(s.drs_zones[0].zone_end, 0.80);
    }

    #[test]
    fn session_2025_reads_equal_perf_without_aero() {
        // 2025 Session (753 bytes) carries equalCarPerformance at the same offset
        // but no aero/DRS tail.
        let mut buf = header_bytes(2025, 1);
        let mut body = vec![0u8; 724];
        body[679] = 1; // equalCarPerformance = On
        buf.extend_from_slice(&body);
        assert_eq!(buf.len(), 753);
        let packet = parse_packet(&buf).expect("parses");
        let Some(Body::Session(s)) = packet.data else {
            panic!("expected Session");
        };
        assert_eq!(s.equal_car_performance, Some(1));
        assert!(s.active_aero_track_status.is_none());
        assert!(s.drs_zones.is_empty());
    }
}
