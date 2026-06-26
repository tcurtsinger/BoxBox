import type { CarSetupEntry } from "../types";

interface Props {
  setup: CarSetupEntry;
  nextFrontWing: number;
}

interface Group {
  title: string;
  unit?: string;
  rows: [string, string][];
}

const int = (v: number) => String(Math.round(v));
const pct = (v: number) => `${Math.round(v)}%`;
const deg = (v: number) => `${v.toFixed(2)}°`;
const psi = (v: number) => v.toFixed(1);
const kg = (v: number) => `${v.toFixed(1)} kg`;

// Grouped to mirror the in-game setup screen. Values are auto-detected from the
// Car Setups packet; the signed suggestion + confidence colour will slot in beside
// each value once the diagnosis engine lands. (Layout to be refined against real
// in-game reference screenshots.)
export function SetupPanel({ setup, nextFrontWing }: Props) {
  const groups: Group[] = [
    {
      title: "Aerodynamics",
      rows: [
        ["Front Wing", int(setup.frontWing)],
        ["Rear Wing", int(setup.rearWing)],
      ],
    },
    {
      title: "Transmission",
      rows: [
        ["Differential On-Throttle", pct(setup.onThrottle)],
        ["Differential Off-Throttle", pct(setup.offThrottle)],
        ["Engine Braking", pct(setup.engineBraking)],
      ],
    },
    {
      title: "Suspension Geometry",
      rows: [
        ["Front Camber", deg(setup.frontCamber)],
        ["Rear Camber", deg(setup.rearCamber)],
        ["Front Toe", deg(setup.frontToe)],
        ["Rear Toe", deg(setup.rearToe)],
      ],
    },
    {
      title: "Suspension",
      rows: [
        ["Front Suspension", int(setup.frontSuspension)],
        ["Rear Suspension", int(setup.rearSuspension)],
        ["Front Anti-Roll Bar", int(setup.frontAntiRollBar)],
        ["Rear Anti-Roll Bar", int(setup.rearAntiRollBar)],
        ["Front Ride Height", int(setup.frontRideHeight)],
        ["Rear Ride Height", int(setup.rearRideHeight)],
      ],
    },
    {
      title: "Brakes",
      rows: [
        ["Brake Pressure", pct(setup.brakePressure)],
        ["Brake Bias", pct(setup.brakeBias)],
      ],
    },
    {
      title: "Tyre Pressures",
      unit: "psi",
      rows: [
        ["Front Left", psi(setup.frontLeftTyrePressure)],
        ["Front Right", psi(setup.frontRightTyrePressure)],
        ["Rear Left", psi(setup.rearLeftTyrePressure)],
        ["Rear Right", psi(setup.rearRightTyrePressure)],
      ],
    },
  ];

  return (
    <div className="setup">
      <div className="setup-grid">
        {groups.map((g) => (
          <section className="setup-card" key={g.title}>
            <h2 className="setup-card-title">
              {g.title}
              {g.unit && <span className="setup-card-unit">{g.unit}</span>}
            </h2>
            <div className="setup-rows">
              {g.rows.map(([label, value]) => (
                <div className="setup-row" key={label}>
                  <span className="setup-label">{label}</span>
                  <span className="setup-value">{value}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="setup-foot">
        <span>
          Ballast {int(setup.ballast)} &middot; Fuel {kg(setup.fuelLoad)} &middot; Next front wing{" "}
          {int(nextFrontWing)}
        </span>
        <span className="setup-note">
          Auto-detected from the live feed. Setup-change suggestions arrive with the diagnosis engine.
        </span>
      </p>
    </div>
  );
}
