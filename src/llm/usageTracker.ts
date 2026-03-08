/**
 * usageTracker.ts
 * Tracks, logs, and aggregates LLM usage/cost telemetry.
 */

import { mkdir, writeFile } from "fs/promises";
import type { RuntimeStore } from "../storage/runtimeStore.js";
import type { RuntimeState, RuntimeUsageState, UsageBucket } from "../types/contracts.js";

const DEFAULT_DATA_DIR = "/data/mule-doctor";
const DEFAULT_INPUT_COST_PER_1K = 0;
const DEFAULT_OUTPUT_COST_PER_1K = 0;

export interface UsageTrackerConfig {
  runtimeStore?: RuntimeStore;
  dataDir?: string;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}

export interface LlmUsageRecordInput {
  timestamp: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface LlmUsageRecord extends LlmUsageRecordInput {
  estimatedCost: number;
}

export interface UsageSummary {
  dateKey: string;
  monthKey: string;
  today: UsageBucket;
  month: UsageBucket;
}

export class UsageTracker {
  private readonly runtimeStore: RuntimeStore | undefined;
  private readonly dataDir: string;
  private readonly inputCostPer1k: number;
  private readonly outputCostPer1k: number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(config: UsageTrackerConfig = {}) {
    this.runtimeStore = config.runtimeStore;
    this.dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
    this.inputCostPer1k = positiveOrDefault(config.inputCostPer1k, DEFAULT_INPUT_COST_PER_1K);
    this.outputCostPer1k = positiveOrDefault(config.outputCostPer1k, DEFAULT_OUTPUT_COST_PER_1K);
  }

  async record(input: LlmUsageRecordInput): Promise<LlmUsageRecord> {
    const record = this.toRecord(input);
    await this.enqueue(async () => {
      await this.writeRecordLog(record);
      await this.updateAggregates(record);
    });
    return record;
  }

  async getSummary(now = new Date()): Promise<UsageSummary> {
    const usageState = await this.readUsageState();
    const dateKey = formatDateKey(now);
    const monthKey = formatMonthKey(now);
    return {
      dateKey,
      monthKey,
      today: usageState.daily[dateKey] ?? emptyBucket(),
      month: usageState.monthly[monthKey] ?? emptyBucket(),
    };
  }

  async consumeDailyReport(now = new Date()): Promise<UsageSummary | null> {
    if (!this.runtimeStore) return null;

    const dateKey = formatDateKey(now);
    const monthKey = formatMonthKey(now);
    return this.enqueue(async () => {
      const state = await this.runtimeStore!.loadState();
      const usage = normalizeUsageState(state.usage);
      const today = usage.daily[dateKey] ?? emptyBucket();

      if (today.calls <= 0) {
        return null;
      }

      if (usage.lastReportDate === dateKey) {
        return null;
      }

      usage.lastReportDate = dateKey;
      await this.runtimeStore!.updateState({ usage });

      return {
        dateKey,
        monthKey,
        today,
        month: usage.monthly[monthKey] ?? emptyBucket(),
      };
    });
  }

  private async updateAggregates(record: LlmUsageRecord): Promise<void> {
    if (!this.runtimeStore) return;

    const dateKey = formatDateKey(new Date(record.timestamp));
    const monthKey = formatMonthKey(new Date(record.timestamp));
    const state = await this.runtimeStore.loadState();
    const usage = normalizeUsageState(state.usage);

    usage.daily[dateKey] = mergeBucket(usage.daily[dateKey], record);
    usage.monthly[monthKey] = mergeBucket(usage.monthly[monthKey], record);

    pruneUsageMaps(usage);

    await this.runtimeStore.updateState({ usage });
  }

  private async writeRecordLog(record: LlmUsageRecord): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const safeTs = record.timestamp.replace(/[.:]/g, "-");
    const path = `${this.dataDir}/LLM_${safeTs}.log`;
    const payload = JSON.stringify(record, null, 2) + "\n";
    await writeFile(path, payload, "utf8");
  }

  private async readUsageState(): Promise<RuntimeUsageState> {
    if (!this.runtimeStore) return normalizeUsageState(undefined);
    const state = await this.runtimeStore.loadState();
    return normalizeUsageState(state.usage);
  }

  private toRecord(input: LlmUsageRecordInput): LlmUsageRecord {
    const tokensIn = Math.max(0, Math.round(input.tokensIn));
    const tokensOut = Math.max(0, Math.round(input.tokensOut));
    const estimatedCost =
      (tokensIn / 1000) * this.inputCostPer1k + (tokensOut / 1000) * this.outputCostPer1k;
    return {
      timestamp: input.timestamp,
      model: input.model,
      tokensIn,
      tokensOut,
      estimatedCost: roundMoney(estimatedCost),
    };
  }

  private async enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(op, op);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function mergeBucket(existing: UsageBucket | undefined, record: LlmUsageRecord): UsageBucket {
  const current = existing ?? emptyBucket();
  return {
    calls: current.calls + 1,
    tokensIn: current.tokensIn + record.tokensIn,
    tokensOut: current.tokensOut + record.tokensOut,
    estimatedCost: roundMoney(current.estimatedCost + record.estimatedCost),
  };
}

function emptyBucket(): UsageBucket {
  return { calls: 0, tokensIn: 0, tokensOut: 0, estimatedCost: 0 };
}

function normalizeUsageState(state: RuntimeState["usage"]): RuntimeUsageState {
  return {
    daily: state?.daily ?? {},
    monthly: state?.monthly ?? {},
    lastReportDate: state?.lastReportDate,
  };
}

function pruneUsageMaps(usage: RuntimeUsageState): void {
  const dailyKeys = Object.keys(usage.daily).sort();
  while (dailyKeys.length > 35) {
    const key = dailyKeys.shift();
    if (!key) break;
    delete usage.daily[key];
  }

  const monthlyKeys = Object.keys(usage.monthly).sort();
  while (monthlyKeys.length > 18) {
    const key = monthlyKeys.shift();
    if (!key) break;
    delete usage.monthly[key];
  }
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}
