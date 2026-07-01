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

  it("de-dupes a key while it's within cooldown", () => {
    const s = new CalloutScheduler({ keyCooldownMs: 1000, categoryCooldownMs: 0, maxQueue: 8 });
    s.push([c({ key: "k" })], 0);
    expect(s.take(0)!.key).toBe("k");
    s.push([c({ key: "k" })], 500); // still cooling → dropped
    expect(s.take(500)).toBeNull();
    s.push([c({ key: "k" })], 1500); // cooldown elapsed → allowed
    expect(s.take(1500)!.key).toBe("k");
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
