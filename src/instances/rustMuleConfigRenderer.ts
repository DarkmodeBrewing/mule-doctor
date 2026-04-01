import {
  MANAGED_INSTANCE_MULE_DOCTOR_OWNED_CONFIG_KEYS,
  MANAGED_INSTANCE_REJECTED_TEMPLATE_KEYS,
  MANAGED_INSTANCE_TEMPLATE_MANAGED_CONFIG_KEYS,
  type ManagedRustMuleConfigTemplate,
  type RenderManagedRustMuleConfigInput,
} from "./rustMuleConfigShared.js";
import { parseManagedRustMuleConfigTemplateInput } from "./rustMuleConfigParser.js";

type NormalizedManagedRustMuleConfigTemplate = Required<
  Pick<ManagedRustMuleConfigTemplate, "sam" | "general" | "api" | "sharing">
> &
  Pick<ManagedRustMuleConfigTemplate, "sessionNamePrefix">;

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
    "# rejected template keys that would conflict with mule-doctor-owned runtime isolation:",
    `#   ${MANAGED_INSTANCE_REJECTED_TEMPLATE_KEYS.join(", ")}`,
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

function normalizeTemplate(
  template: ManagedRustMuleConfigTemplate | undefined,
): NormalizedManagedRustMuleConfigTemplate {
  const source = parseManagedRustMuleConfigTemplateInput(template);
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
