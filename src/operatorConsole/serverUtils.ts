import type { ManagedInstanceRecord, ObserverCycleOutcome, RuntimeState } from "../types/contracts.js";
import type { ConsoleManagedInstanceRecord } from "./types.js";
import { DEFAULT_UI_HOST } from "./constants.js";
import { RequestError } from "./http.js";

export function sanitizeHost(rawHost: string | undefined): string {
  const host = rawHost?.trim();
  if (!host) return DEFAULT_UI_HOST;
  return host;
}

export function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeCycleOutcome(
  value: RuntimeState["lastCycleOutcome"],
): ObserverCycleOutcome | undefined {
  return value === "success" || value === "unavailable" || value === "error" ? value : undefined;
}

export function redactInstanceForConsole(instance: ManagedInstanceRecord): ConsoleManagedInstanceRecord {
  return {
    ...instance,
    runtime: omitLogPath(instance.runtime),
  };
}

function omitLogPath(
  runtime: ManagedInstanceRecord["runtime"],
): Omit<ManagedInstanceRecord["runtime"], "logPath"> {
  const { logPath, ...rest } = runtime;
  void logPath;
  return rest;
}

export function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}

export async function handleManagedInstanceErrors<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    if (err.message.startsWith("Managed instance not found")) {
      throw new RequestError(404, err.message);
    }
    if (err.message.startsWith("Managed instance preset not found")) {
      throw new RequestError(404, err.message);
    }
    if (err.message.startsWith("Managed instance preset group not found")) {
      throw new RequestError(404, err.message);
    }
    if (
      err.message.startsWith("Invalid managed instance") ||
      err.message.startsWith("Invalid managed instance preset") ||
      err.message.startsWith("Unsupported diagnostic target kind") ||
      err.message.includes("requires an instanceId") ||
      err.message.includes("preset prefix already exists") ||
      err.message.includes("already exists") ||
      err.message.includes("already reserved") ||
      err.message.includes("already in use") ||
      err.message.includes("Invalid port") ||
      err.message.includes("outside the allowed range")
    ) {
      throw new RequestError(400, err.message);
    }
    if (err.message.includes("targeting is unavailable")) {
      throw new RequestError(501, err.message);
    }
    throw err;
  }
}
