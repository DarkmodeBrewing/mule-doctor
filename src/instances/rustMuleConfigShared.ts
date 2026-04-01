import type { ManagedInstanceRuntimePaths } from "../types/contracts.js";

export const MANAGED_INSTANCE_MULE_DOCTOR_OWNED_CONFIG_KEYS = [
  "sam.session_name",
  "general.data_dir",
  "general.auto_open_ui",
  "api.port",
] as const;

export const MANAGED_INSTANCE_REJECTED_TEMPLATE_KEYS = [
  ...MANAGED_INSTANCE_MULE_DOCTOR_OWNED_CONFIG_KEYS,
  "sharing.share_roots",
] as const;

export const MANAGED_INSTANCE_TEMPLATE_MANAGED_CONFIG_KEYS = [
  "sam.host",
  "sam.port",
  "sam.udp_port",
  "sam.datagram_transport",
  "sam.forward_host",
  "sam.forward_port",
  "sam.control_timeout_secs",
  "general.log_level",
  "general.log_to_file",
  "general.log_file_name",
  "general.log_file_level",
  "api.enable_debug_endpoints",
  "api.auth_mode",
  "sharing.share_roots (additional roots only)",
] as const;

export const ALLOWED_TEMPLATE_TOP_LEVEL_KEYS = [
  "sam",
  "general",
  "api",
  "sharing",
  "samHost",
  "samPort",
  "samUdpPort",
  "samDatagramTransport",
  "samForwardHost",
  "samForwardPort",
  "samControlTimeoutSecs",
  "generalLogLevel",
  "generalLogToFile",
  "generalLogFileName",
  "generalLogFileLevel",
  "apiEnableDebugEndpoints",
  "apiAuthMode",
  "samSessionName",
  "generalDataDir",
  "generalAutoOpenUi",
  "apiPort",
  "sessionNamePrefix",
  "sharingShareRoots",
] as const;

export const ALLOWED_TEMPLATE_SECTION_KEYS = {
  sam: [
    "host",
    "port",
    "udpPort",
    "datagramTransport",
    "forwardHost",
    "forwardPort",
    "controlTimeoutSecs",
    "sessionName",
  ] as const,
  general: [
    "logLevel",
    "logToFile",
    "logFileName",
    "logFileLevel",
    "dataDir",
    "autoOpenUi",
  ] as const,
  api: [
    "enableDebugEndpoints",
    "authMode",
    "port",
  ] as const,
  sharing: [
    "extraShareRoots",
    "shareRoots",
  ] as const,
} as const;

export interface ManagedRustMuleConfigTemplate {
  sam?: {
    host?: string;
    port?: number;
    udpPort?: number;
    datagramTransport?: "tcp" | "udp_forward";
    forwardHost?: string;
    forwardPort?: number;
    controlTimeoutSecs?: number;
    sessionName?: never;
  };
  general?: {
    logLevel?: string;
    logToFile?: boolean;
    logFileName?: string;
    logFileLevel?: string;
    dataDir?: never;
    autoOpenUi?: never;
  };
  api?: {
    enableDebugEndpoints?: boolean;
    authMode?: "local_ui" | "headless_remote";
    port?: never;
  };
  sharing?: {
    extraShareRoots?: string[];
    shareRoots?: never;
  };
  samHost?: string;
  samPort?: number;
  samUdpPort?: number;
  samDatagramTransport?: "tcp" | "udp_forward";
  samForwardHost?: string;
  samForwardPort?: number;
  samControlTimeoutSecs?: number;
  generalLogLevel?: string;
  generalLogToFile?: boolean;
  generalLogFileName?: string;
  generalLogFileLevel?: string;
  apiEnableDebugEndpoints?: boolean;
  apiAuthMode?: "local_ui" | "headless_remote";
  samSessionName?: never;
  generalDataDir?: never;
  generalAutoOpenUi?: never;
  apiPort?: never;
  sessionNamePrefix?: string;
  sharingShareRoots?: string[];
}

export interface RenderManagedRustMuleConfigInput {
  instanceId: string;
  apiPort: number;
  runtime: ManagedInstanceRuntimePaths;
  template?: ManagedRustMuleConfigTemplate;
}

export function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

export function assertOnlyKnownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  message: string,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${message}: ${unknownKeys.join(", ")}`);
  }
}

export function expectString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new Error(`Managed rust-mule config template field '${key}' must be a string`);
  }
  return value;
}

export function expectNumber(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Managed rust-mule config template field '${key}' must be a finite number`);
  }
  return value;
}

export function expectBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Managed rust-mule config template field '${key}' must be a boolean`);
  }
  return value;
}

export function expectStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Managed rust-mule config template field '${key}' must be a string array`);
  }
  return value;
}

export function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  key: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(
      `Managed rust-mule config template field '${key}' must be one of: ${allowed.join(", ")}`,
    );
  }
  return value as T;
}
