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

async function main(): Promise<void> {
  log("info", "index", "mule-doctor starting");

  const apiUrl = requireEnv("RUST_MULE_API_URL");
  const logPath = requireEnv("RUST_MULE_LOG_PATH");
  const openaiKey = requireEnv("OPENAI_API_KEY");
  const webhookUrl = requireEnv("MATTERMOST_WEBHOOK_URL");
  const tokenPath = optionalEnv("RUST_MULE_TOKEN_PATH");
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
  const mattermostClient = new MattermostClient(webhookUrl, analyzer);
  toolRegistry.setPatchProposalNotifier(async (proposal) => {
    await mattermostClient.postPatchProposal(proposal);
  });
  const observer = new Observer(analyzer, mattermostClient, {
    intervalMs,
    client: rustMuleClient,
    logWatcher,
    runtimeStore,
  });

  // Graceful shutdown
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log("info", "index", `Received ${signal}, shutting down`);
      observer.stop();
      logWatcher.stop();
      process.exit(0);
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
