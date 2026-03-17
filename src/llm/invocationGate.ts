export interface InvocationGuardInput {
  key: string;
  cooldownMs: number;
}

export interface InvocationLease {
  release(options?: { cooldown?: boolean }): void;
}

export interface InvocationRejection {
  ok: false;
  reason: "in_flight" | "cooldown";
  retryAfterMs: number;
  retryAfterSec: number;
}

export interface InvocationAllowed {
  ok: true;
  lease: InvocationLease;
}

export type InvocationDecision = InvocationAllowed | InvocationRejection;

interface GateEntry {
  inFlight: boolean;
  nextAllowedAt: number;
}

export class LlmInvocationGate {
  private readonly entries = new Map<string, GateEntry>();

  tryAcquire(inputs: InvocationGuardInput[]): InvocationDecision {
    const now = Date.now();
    let rejection: InvocationRejection | undefined;

    for (const input of inputs) {
      const entry = this.ensureEntry(input.key);
      if (entry.inFlight) {
        rejection = pickStrongerRejection(rejection, {
          ok: false,
          reason: "in_flight",
          retryAfterMs: input.cooldownMs,
          retryAfterSec: Math.max(1, Math.ceil(input.cooldownMs / 1000)),
        });
        continue;
      }
      if (entry.nextAllowedAt > now) {
        const retryAfterMs = entry.nextAllowedAt - now;
        rejection = pickStrongerRejection(rejection, {
          ok: false,
          reason: "cooldown",
          retryAfterMs,
          retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        });
      }
    }

    if (rejection) {
      return rejection;
    }

    for (const input of inputs) {
      const entry = this.ensureEntry(input.key);
      entry.inFlight = true;
    }

    let released = false;
    return {
      ok: true,
      lease: {
        release: (options = {}) => {
          if (released) {
            return;
          }
          released = true;
          const now = Date.now();
          const applyCooldown = options.cooldown !== false;
          for (const input of inputs) {
            const entry = this.ensureEntry(input.key);
            entry.inFlight = false;
            if (applyCooldown) {
              entry.nextAllowedAt = Math.max(entry.nextAllowedAt, now + input.cooldownMs);
            }
          }
        },
      },
    };
  }

  private ensureEntry(key: string): GateEntry {
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }
    const created: GateEntry = {
      inFlight: false,
      nextAllowedAt: 0,
    };
    this.entries.set(key, created);
    return created;
  }
}

function pickStrongerRejection(
  current: InvocationRejection | undefined,
  next: InvocationRejection,
): InvocationRejection {
  if (!current) {
    return next;
  }
  if (next.reason === "in_flight" && current.reason !== "in_flight") {
    return next;
  }
  if (current.reason === "in_flight" && next.reason !== "in_flight") {
    return current;
  }
  return next.retryAfterMs > current.retryAfterMs ? next : current;
}
