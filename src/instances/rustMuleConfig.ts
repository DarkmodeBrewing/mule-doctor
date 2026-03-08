import type { ManagedInstanceRuntimePaths } from "../types/contracts.js";

export interface ManagedRustMuleConfigTemplate {
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
  const template = input.template ?? {};
  const sessionNamePrefix = template.sessionNamePrefix?.trim() || "rust-mule";
  const lines = [
    "# Managed by mule-doctor.",
    "# Keep per-instance runtime artifacts under the generated data_dir.",
    "",
    "[sam]",
    `session_name = ${tomlString(`${sessionNamePrefix}-${input.instanceId}`)}`,
  ];

  appendMaybeString(lines, "host", template.samHost);
  appendMaybeNumber(lines, "port", template.samPort);
  appendMaybeNumber(lines, "udp_port", template.samUdpPort);
  appendMaybeString(lines, "datagram_transport", template.samDatagramTransport);
  appendMaybeString(lines, "forward_host", template.samForwardHost);
  appendMaybeNumber(lines, "forward_port", template.samForwardPort);
  appendMaybeNumber(lines, "control_timeout_secs", template.samControlTimeoutSecs);

  lines.push("", "[general]");
  lines.push(`data_dir = ${tomlString(input.runtime.stateDir)}`);
  lines.push("auto_open_ui = false");
  appendMaybeString(lines, "log_level", template.generalLogLevel);
  appendMaybeBoolean(lines, "log_to_file", template.generalLogToFile);
  appendMaybeString(lines, "log_file_name", template.generalLogFileName);
  appendMaybeString(lines, "log_file_level", template.generalLogFileLevel);

  lines.push("", "[api]");
  lines.push(`port = ${input.apiPort}`);
  appendMaybeBoolean(lines, "enable_debug_endpoints", template.apiEnableDebugEndpoints);
  appendMaybeString(lines, "auth_mode", template.apiAuthMode);

  lines.push("");
  return lines.join("\n");
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
