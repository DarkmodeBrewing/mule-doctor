import {
  ALLOWED_TEMPLATE_SECTION_KEYS,
  ALLOWED_TEMPLATE_TOP_LEVEL_KEYS,
  assertOnlyKnownKeys,
  expectBoolean,
  expectEnum,
  expectNumber,
  expectRecord,
  expectString,
  expectStringArray,
  hasOwn,
  MANAGED_INSTANCE_REJECTED_TEMPLATE_KEYS,
  type ManagedRustMuleConfigTemplate,
} from "./rustMuleConfigShared.js";

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
  if (hasOwn(source, "samUdpPort")) {
    template.samUdpPort = expectNumber(source.samUdpPort, "samUdpPort");
  }
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

  const uniqueConflicts = [...new Set(conflicts)].filter((conflict) =>
    MANAGED_INSTANCE_REJECTED_TEMPLATE_KEYS.includes(
      conflict as (typeof MANAGED_INSTANCE_REJECTED_TEMPLATE_KEYS)[number],
    ),
  );
  throw new Error(
    `Managed rust-mule config template may not set mule-doctor-owned keys: ${uniqueConflicts.join(", ")}`,
  );
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
