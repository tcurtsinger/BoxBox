import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { profilePath, readProfile, writeProfile, PROFILE_VERSION } from "../src/profile.ts";

test("writes and reads a profile round-trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tuner-prof-"));
  try {
    const file = profilePath(dir, "alice");
    const p = { version: PROFILE_VERSION, driver: "alice", balancePreference: -0.5, gains: { frontWing: [100, 110] } };
    writeProfile(file, p);
    assert.deepEqual(readProfile(file), p);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing or corrupt profile reads as null", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tuner-prof-"));
  try {
    assert.equal(readProfile(path.join(dir, "nope.json")), null);
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{not valid json");
    assert.equal(readProfile(bad), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the driver name is sanitized to a safe filename (no traversal)", () => {
  const file = profilePath(path.join(os.tmpdir(), "x"), "../../etc/passwd");
  assert.ok(!file.includes(".."), "path traversal stripped from the driver name");
  assert.ok(file.endsWith(".json"));
});
