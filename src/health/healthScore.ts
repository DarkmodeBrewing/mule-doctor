/**
 * healthScore.ts
 * Deterministic network health scoring for mule-doctor.
 */

import type { RoutingBucket } from "../api/rustMuleClient.js";

const PEER_COUNT_TARGET = 128;
const IDEAL_HOPS = 4;
const MAX_HOPS = 20;

export interface NetworkHealthComponents {
  peer_count: number;
  bucket_balance: number;
  lookup_success: number;
  lookup_efficiency: number;
  error_rate: number;
}

export interface NetworkHealthResult {
  score: number;
  components: NetworkHealthComponents;
}

export interface NetworkHealthInput {
  peerCount: number;
  routingBuckets: RoutingBucket[];
  lookupStats: Record<string, unknown>;
  avgHops?: number;
}

export function getNetworkHealth(input: NetworkHealthInput): NetworkHealthResult {
  const peerCountScore = scorePeerCount(input.peerCount);
  const bucketBalanceScore = scoreBucketBalance(input.routingBuckets);
  const lookupSuccessScore = scoreLookupSuccess(input.lookupStats);
  const lookupEfficiencyScore = scoreLookupEfficiency(
    input.avgHops ?? readNumber(input.lookupStats, ["avgHops", "avg_hops"])
  );
  const errorRateScore = scoreErrorRate(input.lookupStats, lookupSuccessScore);

  const score = clamp(
    Math.round(
      0.25 * peerCountScore +
        0.2 * bucketBalanceScore +
        0.25 * lookupSuccessScore +
        0.15 * lookupEfficiencyScore +
        0.15 * errorRateScore
    )
  );

  return {
    score,
    components: {
      peer_count: peerCountScore,
      bucket_balance: bucketBalanceScore,
      lookup_success: lookupSuccessScore,
      lookup_efficiency: lookupEfficiencyScore,
      error_rate: errorRateScore,
    },
  };
}

function scorePeerCount(peerCount: number): number {
  if (!Number.isFinite(peerCount) || peerCount <= 0) return 0;
  return clamp(Math.round((peerCount / PEER_COUNT_TARGET) * 100));
}

function scoreBucketBalance(buckets: RoutingBucket[]): number {
  if (!buckets.length) return 0;
  const sizes = buckets.map((b) => {
    if (typeof b.size === "number") return Math.max(0, b.size);
    if (typeof b.count === "number") return Math.max(0, b.count);
    return 0;
  });
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;

  const mean = total / sizes.length;
  const variance =
    sizes.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sizes.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDev / mean : 1;
  const balanceScore = clamp(Math.round(100 - coefficientOfVariation * 100));

  const nonZeroBuckets = sizes.filter((v) => v > 0).length;
  const occupancyScore = clamp(Math.round((nonZeroBuckets / sizes.length) * 100));

  return clamp(Math.round(0.6 * balanceScore + 0.4 * occupancyScore));
}

function scoreLookupSuccess(lookupStats: Record<string, unknown>): number {
  const total = readNumber(lookupStats, ["total", "sent_reqs_total"]);
  const successful = readNumber(lookupStats, ["successful", "tracked_out_matched_total"]);
  const matchedCounter = readNumber(lookupStats, ["tracked_out_matched_total"]);
  const matchPerSent = readNumber(lookupStats, ["matchPerSent", "match_per_sent"]);
  if (typeof matchPerSent === "number") {
    if (
      matchPerSent <= 0 &&
      typeof matchedCounter !== "number" &&
      typeof total === "number" &&
      total > 0 &&
      typeof successful === "number"
    ) {
      return clamp(Math.round((successful / total) * 100));
    }
    return clamp(Math.round(matchPerSent * 100));
  }

  if (typeof total === "number" && total > 0 && typeof successful === "number") {
    return clamp(Math.round((successful / total) * 100));
  }

  return 0;
}

function scoreLookupEfficiency(avgHops: number | undefined): number {
  if (typeof avgHops !== "number" || !Number.isFinite(avgHops) || avgHops <= 0) {
    return 50;
  }
  if (avgHops <= IDEAL_HOPS) return 100;
  if (avgHops >= MAX_HOPS) return 0;
  const normalized = (avgHops - IDEAL_HOPS) / (MAX_HOPS - IDEAL_HOPS);
  return clamp(Math.round((1 - normalized) * 100));
}

function scoreErrorRate(
  lookupStats: Record<string, unknown>,
  lookupSuccessScore: number
): number {
  const total = readNumber(lookupStats, ["total", "sent_reqs_total"]);
  const timeoutsPerSent = readNumber(lookupStats, ["timeoutsPerSent", "timeouts_per_sent"]);
  const failed = readNumber(lookupStats, ["failed"]);
  const outboundShaperDelayed = readNumber(lookupStats, ["outboundShaperDelayedTotal"]);

  const baseErrorRate =
    typeof timeoutsPerSent === "number" && typeof total === "number" && total > 0
      ? clampRatio(timeoutsPerSent)
      : typeof total === "number" && total > 0 && typeof failed === "number"
        ? clampRatio(failed / total)
        : clampRatio(1 - lookupSuccessScore / 100);

  const shaperPenalty =
    typeof total === "number" && total > 0 && typeof outboundShaperDelayed === "number"
      ? clampRatio((outboundShaperDelayed / total) * 0.5)
      : 0;

  return clamp(Math.round((1 - clampRatio(baseErrorRate + shaperPenalty)) * 100));
}

function readNumber(
  payload: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
