import { describe, it, expect } from "vitest";
import { CalloutScheduler } from "./scheduler";
import { PRIORITY, type Callout } from "./callouts";

const c = (over: Partial<Callout>): Callout => ({
  category: "gapsPosition",
  priority: PRIORITY.position,
  text: "x",
  key: "k",
  ...over,
});

describe("CalloutScheduler", () => {
  it("serves the highest priority first", () => {
    const s = new CalloutScheduler();
    s.push(
      [
        c({ key: "info", priority: PRIORITY.info, category: "lapTimes" }),
        c({ key: "safe", priority: PRIORITY.safety, category: "flagsIncidents" }),
      ],
      0,
    );
    expect(s.take(0)!.key).toBe("safe");
    expect(s.take(0)!.key).toBe("info");
    expect(s.take(0)).toBeNull();
  });

  it("coalesces queued position callouts to the newest", () => {
    // A launch gaining six places: while "P8" is being spoken, P7..P3 arrive.
    // Only the latest position should remain queued — never a read-out chain.
    const s = new CalloutScheduler({ keyCooldownMs: 20_000, categoryCooldownMs: 0, maxQueue: 8 });
    s.push([c({ key: "pos-8", text: "P8 now — nice work." })], 0);
    expect(s.take(0)!.key).toBe("pos-8");
    s.push([c({ key: "pos-7" })], 100);
    s.push([c({ key: "pos-6" }), c({ key: "pos-5" })], 200);
    s.push([c({ key: "pos-4" }), c({ key: "pos-3", text: "P3 now — nice work." })], 300);
    expect(s.take(400)!.key).toBe("pos-3");
    expect(s.take(500)).toBeNull();
    // Non-position callouts never coalesce with each other.
    s.push([c({ key: "drs-range", category: "drs" }), c({ key: "fuel-tight", category: "fuelTyres", priority: PRIORITY.strategy })], 600);
    expect(s.take(600)).not.toBeNull();
    expect(s.take(600)).not.toBeNull();
  });

  it("returning to a cooling-down position still clears the stale queued one", () => {
    // P8 spoken, P7 queued, driver falls back to P8 within the key cooldown:
    // the suppressed "P8" must still invalidate the now-wrong queued "P7".
    const s = new CalloutScheduler({ keyCooldownMs: 20_000, categoryCooldownMs: 0, maxQueue: 8 });
    s.push([c({ key: "pos-8" })], 0);
    expect(s.take(0)!.key).toBe("pos-8");
    s.push([c({ key: "pos-7" })], 1_000);
    s.push([c({ key: "pos-8" })], 2_000); // cooling down — not re-spoken
    expect(s.take(3_000)).toBeNull();
  });

  it("de-dupes a key while it's within cooldown", () => {
    const s = new CalloutScheduler({ keyCooldownMs: 1000, categoryCooldownMs: 0, maxQueue: 8 });
    s.push([c({ key: "k" })], 0);
    expect(s.take(0)!.key).toBe("k");
    s.push([c({ key: "k" })], 500); // still cooling → dropped
    expect(s.take(500)).toBeNull();
    s.push([c({ key: "k" })], 1500); // cooldown elapsed → allowed
    expect(s.take(1500)!.key).toBe("k");
  });

  it("safety callouts skip the key cooldown (a second yellow must speak)", () => {
    const s = new CalloutScheduler({ keyCooldownMs: 20_000, categoryCooldownMs: 0, maxQueue: 8 });
    const yellow = c({ key: "flag-yellow", priority: PRIORITY.safety, category: "flagsIncidents" });
    s.push([yellow], 0);
    expect(s.take(0)!.key).toBe("flag-yellow");
    // A NEW yellow 5s later (the detector only emits on real transitions).
    s.push([yellow], 5_000);
    expect(s.take(5_000)!.key).toBe("flag-yellow");
  });

  it("clear() forgets cooldown history (new session, ids restart at 1)", () => {
    const s = new CalloutScheduler({ keyCooldownMs: 20_000, categoryCooldownMs: 0, maxQueue: 8 });
    s.push([c({ key: "ev-1" })], 0);
    expect(s.take(0)!.key).toBe("ev-1");
    s.clear(); // session change
    s.push([c({ key: "ev-1" })], 5_000); // the NEW session's first incident
    expect(s.take(5_000)!.key).toBe("ev-1");
  });

  it("rate-limits a category, but safety bypasses it", () => {
    const s = new CalloutScheduler({ keyCooldownMs: 0, categoryCooldownMs: 1000, maxQueue: 8 });
    s.push([c({ key: "a", category: "gapsPosition" })], 0);
    expect(s.take(0)!.key).toBe("a");
    s.push([c({ key: "b", category: "gapsPosition" })], 100);
    expect(s.take(100)).toBeNull(); // category still cooling
    expect(s.take(1000)!.key).toBe("b"); // cooldown elapsed

    const safe = new CalloutScheduler({ keyCooldownMs: 0, categoryCooldownMs: 1000, maxQueue: 8 });
    safe.push([c({ key: "a", category: "flagsIncidents", priority: PRIORITY.safety })], 0);
    expect(safe.take(0)!.key).toBe("a");
    safe.push([c({ key: "b", category: "flagsIncidents", priority: PRIORITY.safety })], 100);
    expect(safe.take(100)!.key).toBe("b"); // safety ignores the cooldown
  });
});
