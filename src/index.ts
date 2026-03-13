/**
 * index.ts
 * Entry point for mule-doctor.
 * Reads configuration from environment variables, wires up all components,
 * and starts the observation loop.
 */

import { RustMuleClient } from "./api/rustMuleClient.js";
import { LogWatcher } from "./logs/logWatcher.js";
import { ToolRegistry } from "./tools/toolRegistry.js";
import { Analyzer } from "./llm/analyzer.js";
import { UsageTracker } from "./llm/usageTracker.js";
import { MattermostClient } from "./integrations/mattermost.js";
import { Observer } from "./observer.js";
import { RuntimeStore } from "./storage/runtimeStore.js";
import { installStdoutLogBuffer } from "./operatorConsole/logBuffer.js";
import { OperatorConsoleServer } from "./operatorConsole/server.js";
import { DiscoverabilityLog } from "./operatorConsole/discoverabilityLog.js";
import { OperatorEventLog } from "./operatorConsole/operatorEventLog.js";
import { SearchHealthLog } from "./searchHealth/searchHealthLog.js";
import { InstanceManager } from "./instances/instanceManager.js";
import { ManagedInstanceDiagnosticsService } from "./instances/managedInstanceDiagnostics.js";
import { ManagedInstanceAnalysisService } from "./instances/managedInstanceAnalysis.js";
import { ManagedInstanceSharingService } from "./instances/managedInstanceSharing.js";
import { ManagedInstanceDiscoverabilityService } from "./instances/managedInstanceDiscoverability.js";
import { DiagnosticTargetService } from "./instances/diagnosticTargetService.js";
import { ManagedInstancePresetService } from "./instances/managedInstancePresets.js";
import { ObserverTargetResolver } from "./observerTargetResolver.js";
import { validateStartupReadiness } from "./startup/readiness.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    log("error", "index", `Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function parsePositiveIntEnv(name: string): number | undefined {
  const raw = optionalEnv(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    log("error", "index", `Invalid ${name}: expected a positive integer, got "${raw}"`);
    process.exit(1);
  }
  return parsed;
}

function parseNonNegativeFloatEnv(name: string): number | undefined {
  const raw = optionalEnv(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    log("error", "index", `Invalid ${name}: expected a non-negative number, got "${raw}"`);
    process.exit(1);
  }
  return parsed;
}

function parseBooleanEnv(name: string): boolean | undefined {
  const raw = optionalEnv(name);
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  log("error", "index", `Invalid ${name}: expected boolean, got "${raw}"`);
  process.exit(1);
}

async function main(): Promise<void> {
  const uiEnabled = parseBooleanEnv("MULE_DOCTOR_UI_ENABLED") ?? false;
  const uiLogBufferLines = parsePositiveIntEnv("MULE_DOCTOR_UI_LOG_BUFFER_LINES");
  const appLogBuffer =
    uiEnabled || uiLogBufferLines !== undefined
      ? installStdoutLogBuffer(uiLogBufferLines)
      : undefined;
  log("info", "index", "mule-doctor starting");

  const apiUrl = requireEnv("RUST_MULE_API_URL");
  const logPath = requireEnv("RUST_MULE_LOG_PATH");
  const openaiKey = requireEnv("OPENAI_API_KEY");
  const webhookUrl = requireEnv("MATTERMOST_WEBHOOK_URL");
  const tokenPath = requireEnv("RUST_MULE_TOKEN_PATH");
  const debugTokenPath = optionalEnv("RUST_MULE_DEBUG_TOKEN_FILE");
  const apiPrefix = optionalEnv("RUST_MULE_API_PREFIX") ?? "/api/v1";
  const openaiModel = optionalEnv("OPENAI_MODEL");
  const intervalMs = parsePositiveIntEnv("OBSERVE_INTERVAL_MS");
  const dataDir = optionalEnv("MULE_DOCTOR_DATA_DIR");
  const statePath = optionalEnv("MULE_DOCTOR_STATE_PATH");
  const historyPath = optionalEnv("MULE_DOCTOR_HISTORY_PATH");
  const historyLimit = parsePositiveIntEnv("MULE_DOCTOR_HISTORY_LIMIT");
  const llmLogDir = optionalEnv("MULE_DOCTOR_LLM_LOG_DIR") ?? dataDir;
  const inputCostPer1k = parseNonNegativeFloatEnv("OPENAI_INPUT_COST_PER_1K");
  const outputCostPer1k = parseNonNegativeFloatEnv("OPENAI_OUTPUT_COST_PER_1K");
  const sourcePath = optionalEnv("RUST_MULE_SOURCE_PATH");
  const resolvedDataDir = dataDir ?? "/data/mule-doctor";
  const proposalDir = `${resolvedDataDir}/proposals`;
  const uiHost = optionalEnv("MULE_DOCTOR_UI_HOST") ?? "127.0.0.1";
  const uiPort = parsePositiveIntEnv("MULE_DOCTOR_UI_PORT") ?? 18080;
  const uiAuthToken = uiEnabled ? requireEnv("MULE_DOCTOR_UI_AUTH_TOKEN") : undefined;
  const managedRustMuleBinaryPath =
    optionalEnv("MULE_DOCTOR_MANAGED_RUST_MULE_BINARY_PATH") ??
    optionalEnv("MANAGED_RUST_MULE_BINARY_PATH");
  const managedInstanceRootDir = optionalEnv("MULE_DOCTOR_MANAGED_INSTANCE_ROOT");
  const managedApiPortStart = parsePositiveIntEnv("MULE_DOCTOR_MANAGED_API_PORT_START");
  const managedApiPortEnd = parsePositiveIntEnv("MULE_DOCTOR_MANAGED_API_PORT_END");

  await validateStartupReadiness({
    tokenPath,
    debugTokenPath,
    logPath,
    dataDir: resolvedDataDir,
    statePath,
    historyPath,
    llmLogDir: llmLogDir ?? resolvedDataDir,
    proposalDir,
  });

  // Build components
  const rustMuleClient = new RustMuleClient(apiUrl, tokenPath, apiPrefix, debugTokenPath);
  await rustMuleClient.loadToken();

  const logWatcher = new LogWatcher(logPath);
  await logWatcher.start();

  let runtimeStore: RuntimeStore | undefined;
  const configuredRuntimeStore = new RuntimeStore({
    dataDir,
    statePath,
    historyPath,
    historyLimit,
  });
  try {
    await configuredRuntimeStore.initialize();
    runtimeStore = configuredRuntimeStore;
  } catch (err) {
    log(
      "warn",
      "index",
      `Runtime store unavailable, continuing without persistence: ${String(err)}`,
    );
  }

  const toolRegistry = new ToolRegistry(rustMuleClient, logWatcher, runtimeStore, {
    sourcePath,
    proposalDir,
  });
  const operatorEventLog = new OperatorEventLog(runtimeStore);
  const discoverabilityLog = new DiscoverabilityLog(runtimeStore);
  const searchHealthLog = new SearchHealthLog(runtimeStore);
  const usageTracker = new UsageTracker({
    runtimeStore,
    dataDir: llmLogDir,
    inputCostPer1k,
    outputCostPer1k,
  });
  const analyzer = new Analyzer(openaiKey, toolRegistry, {
    model: openaiModel,
    usageTracker,
  });
  const mattermostClient = new MattermostClient(webhookUrl, analyzer, {
    discoverabilityResults: discoverabilityLog,
    searchHealthResults: searchHealthLog,
  });
  const patchProposalNotifier = async (proposal: {
    artifactPath: string;
    diff: string;
    bytes: number;
    lines: number;
  }) => {
    await mattermostClient.postPatchProposal(proposal);
  };
  toolRegistry.setPatchProposalNotifier(patchProposalNotifier);
  let managedInstances: InstanceManager | undefined;
  const configuredManagedInstances = new InstanceManager({
    dataDir,
    instanceRootDir: managedInstanceRootDir,
    apiPortStart: managedApiPortStart,
    apiPortEnd: managedApiPortEnd,
    rustMuleBinaryPath: managedRustMuleBinaryPath,
  });
  try {
    await configuredManagedInstances.initialize();
    managedInstances = configuredManagedInstances;
  } catch (err) {
    log(
      "warn",
      "index",
      `Managed instance controller unavailable, continuing without instance control: ${String(err)}`,
    );
  }
  const managedInstanceDiagnostics = managedInstances
    ? new ManagedInstanceDiagnosticsService(managedInstances, { apiPrefix })
    : undefined;
  const managedInstanceAnalysis =
    managedInstances && managedInstanceDiagnostics
      ? new ManagedInstanceAnalysisService({
          apiKey: openaiKey,
          instanceManager: managedInstances,
          diagnostics: managedInstanceDiagnostics,
          model: openaiModel,
          usageTracker,
          sourcePath,
          proposalDir,
          patchProposalNotifier,
        })
      : undefined;
  const managedInstanceSharing =
    managedInstanceDiagnostics
      ? new ManagedInstanceSharingService(managedInstanceDiagnostics)
      : undefined;
  const managedInstanceDiscoverability =
    managedInstanceDiagnostics && managedInstanceSharing
      ? new ManagedInstanceDiscoverabilityService(
          managedInstanceDiagnostics,
          managedInstanceSharing,
        )
      : undefined;
  const managedInstancePresets = managedInstances
    ? new ManagedInstancePresetService(managedInstances)
    : undefined;
  const diagnosticTarget = new DiagnosticTargetService({
    runtimeStore,
    instanceManager: managedInstances,
    eventLog: operatorEventLog,
  });
  const observerTargetResolver = new ObserverTargetResolver({
    targetService: diagnosticTarget,
    externalClient: rustMuleClient,
    externalLogSource: logWatcher,
    managedDiagnostics: managedInstanceDiagnostics,
  });
  const observer = new Observer(analyzer, mattermostClient, {
    intervalMs,
    client: rustMuleClient,
    logWatcher,
    runtimeStore,
    targetResolver: observerTargetResolver,
    analyzerFactory: (target) => {
      const targetTools = new ToolRegistry(target.client, target.logSource, runtimeStore, {
        sourcePath,
        proposalDir,
        patchProposalNotifier,
      });
      return new Analyzer(openaiKey, targetTools, {
        model: openaiModel,
        usageTracker,
      });
    },
    eventLog: operatorEventLog,
  });
  let operatorConsole: OperatorConsoleServer | undefined;
  if (uiEnabled) {
    operatorConsole = new OperatorConsoleServer({
      authToken: uiAuthToken,
      host: uiHost,
      port: uiPort,
      rustMuleLogPath: logPath,
      llmLogDir: llmLogDir ?? resolvedDataDir,
      proposalDir,
      getAppLogs: (n) => appLogBuffer?.getRecentLines(n) ?? [],
      getRuntimeState: runtimeStore ? () => runtimeStore.loadState() : undefined,
      subscribeToAppLogs: appLogBuffer ? (listener) => appLogBuffer.subscribe(listener) : undefined,
      managedInstances,
      managedInstanceDiagnostics,
      managedInstanceAnalysis,
      managedInstanceSharing,
      managedInstanceDiscoverability,
      managedInstancePresets,
      diagnosticTarget,
      observerControl: observer,
      operatorEvents: operatorEventLog,
      discoverabilityResults: discoverabilityLog,
      searchHealthResults: searchHealthLog,
    });
    try {
      await operatorConsole.start();
      log("info", "index", `Operator console listening at ${operatorConsole.publicAddress()}`);
    } catch (err) {
      log("warn", "index", `Operator console failed to start, continuing without UI: ${String(err)}`);
      operatorConsole = undefined;
    }
  }

  // Graceful shutdown
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void (async () => {
        log("info", "index", `Received ${signal}, shutting down`);
        observer.stop();
        logWatcher.stop();
        if (operatorConsole) {
          try {
            const shutdownTimeoutMs = 5000;
            await Promise.race([
              operatorConsole.stop(),
              new Promise<void>((resolve) => setTimeout(resolve, shutdownTimeoutMs)),
            ]);
          } catch (err) {
            log("warn", "index", `Operator console shutdown failed: ${String(err)}`);
          }
        }
        appLogBuffer?.restore();
        process.exit(0);
      })().catch((err) => {
        log("error", "index", `Error during shutdown: ${String(err)}`);
        appLogBuffer?.restore();
        process.exit(1);
      });
    });
  }

  observer.start();
  log("info", "index", "mule-doctor running");
}

main().catch((err) => {
  log("error", "index", `Fatal error: ${String(err)}`);
  process.exit(1);
});

function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}
