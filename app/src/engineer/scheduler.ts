/**
 * Turns a stream of candidate callouts into an orderly one-at-a-time speaking
 * queue. It de-dupes (the same `key` won't re-announce while it's cooling down),
 * rate-limits per category so no single family can chatter, and always serves the
 * highest-priority callout first. Safety calls bypass the per-category cooldown.
 *
 * Pure bookkeeping — it holds no timers and does no speaking; the caller drives it
 * with the current time and speaks whatever `take()` returns.
 */
import { PRIORITY, type Callout, type CalloutCategory } from "./callouts";

export interface SchedulerOptions {
  /** The same callout `key` won't repeat within this window. */
  keyCooldownMs: number;
  /** At most one non-safety callout per category within this window. */
  categoryCooldownMs: number;
  /** Cap on the pending queue; lowest-priority items are dropped past it. */
  maxQueue: number;
}

const DEFAULTS: SchedulerOptions = {
  keyCooldownMs: 20_000,
  categoryCooldownMs: 6_000,
  maxQueue: 8,
};

function byPriorityDesc(a: Callout, b: Callout): number {
  return b.priority - a.priority;
}

export class CalloutScheduler {
  private queue: Callout[] = [];
  private lastKeyAt = new Map<string, number>();
  private lastCategoryAt = new Map<CalloutCategory, number>();
  private opts: SchedulerOptions;

  constructor(opts: Partial<SchedulerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Enqueue candidates, dropping any still in key-cooldown or already queued. */
  push(callouts: Callout[], now: number): void {
    for (const c of callouts) {
      const last = this.lastKeyAt.get(c.key);
      if (last != null && now - last < this.opts.keyCooldownMs) continue;
      if (this.queue.some((q) => q.key === c.key)) continue;
      this.queue.push(c);
    }
    if (this.queue.length > this.opts.maxQueue) {
      this.queue.sort(byPriorityDesc);
      this.queue.length = this.opts.maxQueue;
    }
  }

  /** The highest priority currently queued (0 if empty) — lets the caller decide
   *  whether to pre-empt something lower that's already being spoken. */
  topPriority(): number {
    return this.queue.reduce((m, c) => Math.max(m, c.priority), 0);
  }

  /**
   * Remove and return the next callout to speak, or null if nothing is ready.
   * Highest priority wins; a non-safety callout waits out its category cooldown.
   */
  take(now: number): Callout | null {
    if (this.queue.length === 0) return null;
    this.queue.sort(byPriorityDesc);
    for (let i = 0; i < this.queue.length; i++) {
      const c = this.queue[i];
      if (c.priority < PRIORITY.safety) {
        const catLast = this.lastCategoryAt.get(c.category);
        if (catLast != null && now - catLast < this.opts.categoryCooldownMs) continue;
      }
      this.queue.splice(i, 1);
      this.lastKeyAt.set(c.key, now);
      this.lastCategoryAt.set(c.category, now);
      return c;
    }
    return null;
  }

  /** Drop everything pending (e.g. the session ended or the engine was disabled). */
  clear(): void {
    this.queue = [];
  }
}
