import type { ManagedInstanceRuntimePaths } from "../types/contracts.js";

export const MANAGED_INSTANCE_MULE_DOCTOR_OWNED_CONFIG_KEYS = [
  "sam.session_name",
  "general.data_dir",
  "general.auto_open_ui",
  "api.port",
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

export interface ManagedRustMuleConfigTemplate {
  sam?: {
    host?: string;
    port?: number;
    udpPort?: number;
    datagramTransport?: "tcp" | "udp_forward";
    forwardHost?: string;
    forwardPort?: number;
    controlTimeoutSecs?: number;
  };
  general?: {
    logLevel?: string;
    logToFile?: boolean;
    logFileName?: string;
    logFileLevel?: string;
  };
  api?: {
    enableDebugEndpoints?: boolean;
    authMode?: "local_ui" | "headless_remote";
  };
  sharing?: {
    extraShareRoots?: string[];
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
  sessionNamePrefix?: string;
  sharingShareRoots?: string[];
}

export interface RenderManagedRustMuleConfigInput {
  instanceId: string;
  apiPort: number;
  runtime: ManagedInstanceRuntimePaths;
  template?: ManagedRustMuleConfigTemplate;
}

export function renderManagedRustMuleConfig(
  input: RenderManagedRustMuleConfigInput,
): string {
  const template = normalizeTemplate(input.template);
  const sessionNamePrefix = template.sessionNamePrefix?.trim() || "rust-mule";
  const lines = [
    "# Managed by mule-doctor.",
    "# mule-doctor-owned keys are generated per instance:",
    `#   ${MANAGED_INSTANCE_MULE_DOCTOR_OWNED_CONFIG_KEYS.join(", ")}`,
    "# externally supplied template keys may set shared rust-mule defaults:",
    `#   ${MANAGED_INSTANCE_TEMPLATE_MANAGED_CONFIG_KEYS.join(", ")}`,
    "# sharing.share_roots always includes the mule-doctor-managed shared directory first.",
    "",
    "[sam]",
    `session_name = ${tomlString(`${sessionNamePrefix}-${input.instanceId}`)}`,
  ];

  appendMaybeString(lines, "host", template.sam.host);
  appendMaybeNumber(lines, "port", template.sam.port);
  appendMaybeNumber(lines, "udp_port", template.sam.udpPort);
  appendMaybeString(lines, "datagram_transport", template.sam.datagramTransport);
  appendMaybeString(lines, "forward_host", template.sam.forwardHost);
  appendMaybeNumber(lines, "forward_port", template.sam.forwardPort);
  appendMaybeNumber(lines, "control_timeout_secs", template.sam.controlTimeoutSecs);

  lines.push("", "[general]");
  lines.push(`data_dir = ${tomlString(input.runtime.stateDir)}`);
  lines.push("auto_open_ui = false");
  appendMaybeString(lines, "log_level", template.general.logLevel);
  appendMaybeBoolean(lines, "log_to_file", template.general.logToFile);
  appendMaybeString(lines, "log_file_name", template.general.logFileName);
  appendMaybeString(lines, "log_file_level", template.general.logFileLevel);

  lines.push("", "[api]");
  lines.push(`port = ${input.apiPort}`);
  appendMaybeBoolean(lines, "enable_debug_endpoints", template.api.enableDebugEndpoints);
  appendMaybeString(lines, "auth_mode", template.api.authMode);

  lines.push("", "[sharing]");
  lines.push(
    `share_roots = ${tomlStringArray(buildShareRoots(input.runtime.sharedDir, template.sharing.extraShareRoots))}`,
  );

  lines.push("");
  return lines.join("\n");
}

function buildShareRoots(sharedDir: string, extraShareRoots: string[] | undefined): string[] {
  const roots = [sharedDir];
  if (Array.isArray(extraShareRoots)) {
    for (const root of extraShareRoots) {
      if (typeof root !== "string") continue;
      const trimmed = root.trim();
      if (!trimmed || roots.includes(trimmed)) continue;
      roots.push(trimmed);
    }
  }
  return roots;
}

function normalizeTemplate(
  template: ManagedRustMuleConfigTemplate | undefined,
): Required<
  Pick<ManagedRustMuleConfigTemplate, "sam" | "general" | "api" | "sharing">
> &
  Pick<ManagedRustMuleConfigTemplate, "sessionNamePrefix"> {
  const source = template ?? {};
  return {
    sessionNamePrefix: source.sessionNamePrefix,
    sam: {
      host: source.sam?.host ?? source.samHost,
      port: source.sam?.port ?? source.samPort,
      udpPort: source.sam?.udpPort ?? source.samUdpPort,
      datagramTransport: source.sam?.datagramTransport ?? source.samDatagramTransport,
      forwardHost: source.sam?.forwardHost ?? source.samForwardHost,
      forwardPort: source.sam?.forwardPort ?? source.samForwardPort,
      controlTimeoutSecs: source.sam?.controlTimeoutSecs ?? source.samControlTimeoutSecs,
    },
    general: {
      logLevel: source.general?.logLevel ?? source.generalLogLevel,
      logToFile: source.general?.logToFile ?? source.generalLogToFile,
      logFileName: source.general?.logFileName ?? source.generalLogFileName,
      logFileLevel: source.general?.logFileLevel ?? source.generalLogFileLevel,
    },
    api: {
      enableDebugEndpoints:
        source.api?.enableDebugEndpoints ?? source.apiEnableDebugEndpoints,
      authMode: source.api?.authMode ?? source.apiAuthMode,
    },
    sharing: {
      extraShareRoots: source.sharing?.extraShareRoots ?? source.sharingShareRoots,
    },
  };
}

function appendMaybeString(lines: string[], key: string, value: string | undefined): void {
  if (value === undefined) return;
  lines.push(`${key} = ${tomlString(value)}`);
}

function appendMaybeNumber(lines: string[], key: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${key}: ${value}`);
  }
  lines.push(`${key} = ${value}`);
}

function appendMaybeBoolean(lines: string[], key: string, value: boolean | undefined): void {
  if (value === undefined) return;
  lines.push(`${key} = ${value ? "true" : "false"}`);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}
