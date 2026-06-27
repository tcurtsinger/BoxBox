import type { CarSetupEntry } from "../types";

export type SetupKey = Exclude<keyof CarSetupEntry, "index">;

export interface Slider {
  key: SetupKey;
  label: string;
  min: number;
  max: number;
  fmt: (v: number) => string;
}

export interface SetupGroup {
  title: string;
  unit?: string;
  sliders: Slider[];
}

const i = (v: number) => String(Math.round(v));
const p = (v: number) => `${Math.round(v)}%`;
const deg = (v: number) => `${v.toFixed(2)}°`;
const psi = (v: number) => v.toFixed(1);

// The in-game setup screen (F1 25 / 2026 pack), group order, labels, and ranges
// verified against in-game reference screenshots (Tuner/reference/game). Engine
// braking, ballast, and fuel are NOT setup-screen sliders in this title, so they
// are shown as footer context rather than here; fuel is locked in Time Trial.
export const SETUP_GROUPS: SetupGroup[] = [
  {
    title: "Aerodynamics",
    sliders: [
      { key: "frontWing", label: "Front Wing", min: 0, max: 50, fmt: i },
      { key: "rearWing", label: "Rear Wing", min: 0, max: 50, fmt: i },
    ],
  },
  {
    title: "Transmission",
    sliders: [
      { key: "onThrottle", label: "Differential On-Throttle", min: 10, max: 100, fmt: p },
      { key: "offThrottle", label: "Differential Off-Throttle", min: 10, max: 100, fmt: p },
    ],
  },
  {
    title: "Suspension Geometry",
    sliders: [
      { key: "frontCamber", label: "Front Camber", min: -3.5, max: -2.5, fmt: deg },
      { key: "rearCamber", label: "Rear Camber", min: -2.0, max: -1.0, fmt: deg },
      { key: "frontToe", label: "Front Toe-Out", min: 0.0, max: 0.2, fmt: deg },
      { key: "rearToe", label: "Rear Toe-In", min: 0.1, max: 0.25, fmt: deg },
    ],
  },
  {
    title: "Suspension",
    sliders: [
      { key: "frontSuspension", label: "Front Suspension", min: 1, max: 41, fmt: i },
      { key: "rearSuspension", label: "Rear Suspension", min: 1, max: 41, fmt: i },
      { key: "frontAntiRollBar", label: "Front Anti-Roll Bar", min: 1, max: 21, fmt: i },
      { key: "rearAntiRollBar", label: "Rear Anti-Roll Bar", min: 1, max: 21, fmt: i },
      { key: "frontRideHeight", label: "Front Ride Height", min: 15, max: 35, fmt: i },
      { key: "rearRideHeight", label: "Rear Ride Height", min: 40, max: 60, fmt: i },
    ],
  },
  {
    title: "Brakes",
    sliders: [
      { key: "brakeBias", label: "Front Brake Bias", min: 50, max: 70, fmt: p },
      { key: "brakePressure", label: "Brake Pressure", min: 80, max: 100, fmt: p },
    ],
  },
  {
    title: "Tyre Pressures",
    unit: "psi",
    sliders: [
      { key: "frontRightTyrePressure", label: "Front Right", min: 22.5, max: 29.5, fmt: psi },
      { key: "frontLeftTyrePressure", label: "Front Left", min: 22.5, max: 29.5, fmt: psi },
      { key: "rearRightTyrePressure", label: "Rear Right", min: 20.5, max: 26.5, fmt: psi },
      { key: "rearLeftTyrePressure", label: "Rear Left", min: 20.5, max: 26.5, fmt: psi },
    ],
  },
];

/** Where a value sits within its slider range, 0-100 (clamped). */
export function fillPct(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}
