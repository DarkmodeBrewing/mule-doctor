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
import { MattermostClient } from "./integrations/mattermost.js";
import { Observer } from "./observer.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    log("error", "index", `Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  log("info", "index", "mule-doctor starting");

  const apiUrl = requireEnv("RUST_MULE_API_URL");
  const logPath = requireEnv("RUST_MULE_LOG_PATH");
  const openaiKey = requireEnv("OPENAI_API_KEY");
  const webhookUrl = requireEnv("MATTERMOST_WEBHOOK_URL");
  const tokenPath = process.env["RUST_MULE_TOKEN_PATH"];
  const rawApiPrefix = process.env["RUST_MULE_API_PREFIX"];
  const apiPrefix =
    rawApiPrefix && rawApiPrefix.trim().length > 0
      ? rawApiPrefix.trim()
      : "/api/v1";
  const intervalMs = process.env["OBSERVE_INTERVAL_MS"]
    ? parseInt(process.env["OBSERVE_INTERVAL_MS"], 10)
    : undefined;

  // Build components
  const rustMuleClient = new RustMuleClient(apiUrl, tokenPath, apiPrefix);
  await rustMuleClient.loadToken();

  const logWatcher = new LogWatcher(logPath);
  await logWatcher.start();

  const toolRegistry = new ToolRegistry(rustMuleClient, logWatcher);
  const analyzer = new Analyzer(openaiKey, toolRegistry);
  const mattermostClient = new MattermostClient(webhookUrl, analyzer);
  const observer = new Observer(analyzer, mattermostClient, { intervalMs });

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
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
