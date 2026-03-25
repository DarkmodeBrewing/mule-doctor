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

const ALLOWED_TEMPLATE_TOP_LEVEL_KEYS = [
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

const ALLOWED_TEMPLATE_SECTION_KEYS = {
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

export function parseManagedRustMuleConfigTemplateInput(
  input: unknown,
): ManagedRustMuleConfigTemplate {
  if (input === undefined) {
    return {};
  }
  const source = expectRecord(input, "Managed rust-mule config template must be an object");
  assertOnlyKnownKeys(
    source,
    ALLOWED_TEMPLATE_TOP_LEVEL_KEYS,
    "Managed rust-mule config template contains unsupported top-level keys",
  );

  const template: ManagedRustMuleConfigTemplate = {};

  if (hasOwn(source, "sam")) {
    template.sam = parseSamSection(source.sam);
  }
  if (hasOwn(source, "general")) {
    template.general = parseGeneralSection(source.general);
  }
  if (hasOwn(source, "api")) {
    template.api = parseApiSection(source.api);
  }
  if (hasOwn(source, "sharing")) {
    template.sharing = parseSharingSection(source.sharing);
  }

  if (hasOwn(source, "samHost")) template.samHost = expectString(source.samHost, "samHost");
  if (hasOwn(source, "samPort")) template.samPort = expectNumber(source.samPort, "samPort");
  if (hasOwn(source, "samUdpPort")) template.samUdpPort = expectNumber(source.samUdpPort, "samUdpPort");
  if (hasOwn(source, "samDatagramTransport")) {
    template.samDatagramTransport = expectEnum(
      source.samDatagramTransport,
      ["tcp", "udp_forward"] as const,
      "samDatagramTransport",
    );
  }
  if (hasOwn(source, "samForwardHost")) {
    template.samForwardHost = expectString(source.samForwardHost, "samForwardHost");
  }
  if (hasOwn(source, "samForwardPort")) {
    template.samForwardPort = expectNumber(source.samForwardPort, "samForwardPort");
  }
  if (hasOwn(source, "samControlTimeoutSecs")) {
    template.samControlTimeoutSecs = expectNumber(
      source.samControlTimeoutSecs,
      "samControlTimeoutSecs",
    );
  }
  if (hasOwn(source, "generalLogLevel")) {
    template.generalLogLevel = expectString(source.generalLogLevel, "generalLogLevel");
  }
  if (hasOwn(source, "generalLogToFile")) {
    template.generalLogToFile = expectBoolean(source.generalLogToFile, "generalLogToFile");
  }
  if (hasOwn(source, "generalLogFileName")) {
    template.generalLogFileName = expectString(source.generalLogFileName, "generalLogFileName");
  }
  if (hasOwn(source, "generalLogFileLevel")) {
    template.generalLogFileLevel = expectString(source.generalLogFileLevel, "generalLogFileLevel");
  }
  if (hasOwn(source, "apiEnableDebugEndpoints")) {
    template.apiEnableDebugEndpoints = expectBoolean(
      source.apiEnableDebugEndpoints,
      "apiEnableDebugEndpoints",
    );
  }
  if (hasOwn(source, "apiAuthMode")) {
    template.apiAuthMode = expectEnum(
      source.apiAuthMode,
      ["local_ui", "headless_remote"] as const,
      "apiAuthMode",
    );
  }
  if (hasOwn(source, "samSessionName")) {
    template.samSessionName = true as never;
  }
  if (hasOwn(source, "generalDataDir")) {
    template.generalDataDir = true as never;
  }
  if (hasOwn(source, "generalAutoOpenUi")) {
    template.generalAutoOpenUi = true as never;
  }
  if (hasOwn(source, "apiPort")) {
    template.apiPort = true as never;
  }
  if (hasOwn(source, "sessionNamePrefix")) {
    template.sessionNamePrefix = expectString(source.sessionNamePrefix, "sessionNamePrefix");
  }
  if (hasOwn(source, "sharingShareRoots")) {
    template.sharingShareRoots = expectStringArray(source.sharingShareRoots, "sharingShareRoots");
  }

  assertNoManagedOwnershipConflicts(template);
  return template;
}

export function parseManagedRustMuleConfigTemplateJson(
  raw: string,
  sourceLabel = "managed rust-mule config template JSON",
): ManagedRustMuleConfigTemplate {
  try {
    return parseManagedRustMuleConfigTemplateInput(JSON.parse(raw));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid ${sourceLabel}: ${err.message}`, { cause: err });
    }
    throw err;
  }
}

function assertNoManagedOwnershipConflicts(source: ManagedRustMuleConfigTemplate): void {
  const conflicts = [
    source.sam && hasOwn(source.sam, "sessionName") ? "sam.session_name" : undefined,
    source.general && hasOwn(source.general, "dataDir") ? "general.data_dir" : undefined,
    source.general && hasOwn(source.general, "autoOpenUi") ? "general.auto_open_ui" : undefined,
    source.api && hasOwn(source.api, "port") ? "api.port" : undefined,
    source.sharing && hasOwn(source.sharing, "shareRoots") ? "sharing.share_roots" : undefined,
    hasOwn(source, "samSessionName") ? "sam.session_name" : undefined,
    hasOwn(source, "generalDataDir") ? "general.data_dir" : undefined,
    hasOwn(source, "generalAutoOpenUi") ? "general.auto_open_ui" : undefined,
    hasOwn(source, "apiPort") ? "api.port" : undefined,
  ].filter(Boolean);

  if (conflicts.length === 0) {
    return;
  }

  const uniqueConflicts = [...new Set(conflicts)];
  throw new Error(
    `Managed rust-mule config template may not set mule-doctor-owned keys: ${uniqueConflicts.join(", ")}`,
  );
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

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  message: string,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${message}: ${unknownKeys.join(", ")}`);
  }
}

function parseSamSection(value: unknown): NonNullable<ManagedRustMuleConfigTemplate["sam"]> {
  const sectionValue = expectRecord(
    value,
    "Managed rust-mule config template section 'sam' must be an object",
  );
  assertOnlyKnownKeys(
    sectionValue,
    ALLOWED_TEMPLATE_SECTION_KEYS.sam,
    "Managed rust-mule config template section 'sam' contains unsupported keys",
  );
  const parsed: NonNullable<ManagedRustMuleConfigTemplate["sam"]> = {};
  if (hasOwn(sectionValue, "host")) parsed.host = expectString(sectionValue.host, "sam.host");
  if (hasOwn(sectionValue, "port")) parsed.port = expectNumber(sectionValue.port, "sam.port");
  if (hasOwn(sectionValue, "udpPort")) {
    parsed.udpPort = expectNumber(sectionValue.udpPort, "sam.udpPort");
  }
  if (hasOwn(sectionValue, "datagramTransport")) {
    parsed.datagramTransport = expectEnum(
      sectionValue.datagramTransport,
      ["tcp", "udp_forward"] as const,
      "sam.datagramTransport",
    );
  }
  if (hasOwn(sectionValue, "forwardHost")) {
    parsed.forwardHost = expectString(sectionValue.forwardHost, "sam.forwardHost");
  }
  if (hasOwn(sectionValue, "forwardPort")) {
    parsed.forwardPort = expectNumber(sectionValue.forwardPort, "sam.forwardPort");
  }
  if (hasOwn(sectionValue, "controlTimeoutSecs")) {
    parsed.controlTimeoutSecs = expectNumber(
      sectionValue.controlTimeoutSecs,
      "sam.controlTimeoutSecs",
    );
  }
  if (hasOwn(sectionValue, "sessionName")) {
    parsed.sessionName = true as never;
  }
  return parsed;
}

function parseGeneralSection(
  value: unknown,
): NonNullable<ManagedRustMuleConfigTemplate["general"]> {
  const sectionValue = expectRecord(
    value,
    "Managed rust-mule config template section 'general' must be an object",
  );
  assertOnlyKnownKeys(
    sectionValue,
    ALLOWED_TEMPLATE_SECTION_KEYS.general,
    "Managed rust-mule config template section 'general' contains unsupported keys",
  );
  const parsed: NonNullable<ManagedRustMuleConfigTemplate["general"]> = {};
  if (hasOwn(sectionValue, "logLevel")) {
    parsed.logLevel = expectString(sectionValue.logLevel, "general.logLevel");
  }
  if (hasOwn(sectionValue, "logToFile")) {
    parsed.logToFile = expectBoolean(sectionValue.logToFile, "general.logToFile");
  }
  if (hasOwn(sectionValue, "logFileName")) {
    parsed.logFileName = expectString(sectionValue.logFileName, "general.logFileName");
  }
  if (hasOwn(sectionValue, "logFileLevel")) {
    parsed.logFileLevel = expectString(sectionValue.logFileLevel, "general.logFileLevel");
  }
  if (hasOwn(sectionValue, "dataDir")) {
    parsed.dataDir = true as never;
  }
  if (hasOwn(sectionValue, "autoOpenUi")) {
    parsed.autoOpenUi = true as never;
  }
  return parsed;
}

function parseApiSection(value: unknown): NonNullable<ManagedRustMuleConfigTemplate["api"]> {
  const sectionValue = expectRecord(
    value,
    "Managed rust-mule config template section 'api' must be an object",
  );
  assertOnlyKnownKeys(
    sectionValue,
    ALLOWED_TEMPLATE_SECTION_KEYS.api,
    "Managed rust-mule config template section 'api' contains unsupported keys",
  );
  const parsed: NonNullable<ManagedRustMuleConfigTemplate["api"]> = {};
  if (hasOwn(sectionValue, "enableDebugEndpoints")) {
    parsed.enableDebugEndpoints = expectBoolean(
      sectionValue.enableDebugEndpoints,
      "api.enableDebugEndpoints",
    );
  }
  if (hasOwn(sectionValue, "authMode")) {
    parsed.authMode = expectEnum(
      sectionValue.authMode,
      ["local_ui", "headless_remote"] as const,
      "api.authMode",
    );
  }
  if (hasOwn(sectionValue, "port")) {
    parsed.port = true as never;
  }
  return parsed;
}

function parseSharingSection(
  value: unknown,
): NonNullable<ManagedRustMuleConfigTemplate["sharing"]> {
  const sectionValue = expectRecord(
    value,
    "Managed rust-mule config template section 'sharing' must be an object",
  );
  assertOnlyKnownKeys(
    sectionValue,
    ALLOWED_TEMPLATE_SECTION_KEYS.sharing,
    "Managed rust-mule config template section 'sharing' contains unsupported keys",
  );
  const parsed: NonNullable<ManagedRustMuleConfigTemplate["sharing"]> = {};
  if (hasOwn(sectionValue, "extraShareRoots")) {
    parsed.extraShareRoots = expectStringArray(
      sectionValue.extraShareRoots,
      "sharing.extraShareRoots",
    );
  }
  if (hasOwn(sectionValue, "shareRoots")) {
    parsed.shareRoots = true as never;
  }
  return parsed;
}

function expectString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new Error(`Managed rust-mule config template field '${key}' must be a string`);
  }
  return value;
}

function expectNumber(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Managed rust-mule config template field '${key}' must be a finite number`);
  }
  return value;
}

function expectBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Managed rust-mule config template field '${key}' must be a boolean`);
  }
  return value;
}

function expectStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Managed rust-mule config template field '${key}' must be a string array`);
  }
  return value;
}

function expectEnum<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(
      `Managed rust-mule config template field '${key}' must be one of: ${allowed.join(", ")}`,
    );
  }
  return value as T;
}
