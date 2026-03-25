import type { ManagedDiscoverabilitySummary, SearchHealthSummary } from "../types/contracts.js";
import type {
  MattermostAttachment,
  MattermostPayload,
  MattermostReportSources,
  PatchProposalInput,
  PeriodicReportInput,
} from "./mattermostShared.js";
import {
  clampPatchBody,
  DEFAULT_DISCOVERABILITY_REPORT_LIMIT,
  DEFAULT_SEARCH_HEALTH_REPORT_LIMIT,
  escapeCodeFence,
  formatMaybe,
  healthColor,
  healthStatus,
  log,
  MAX_PATCH_BODY_CHARS,
  metricLine,
  usageBucketText,
} from "./mattermostShared.js";
import type { UsageSummary } from "../llm/usageTracker.js";

export async function buildPeriodicReportPayload(
  report: PeriodicReportInput,
  reportSources: MattermostReportSources,
): Promise<MattermostPayload> {
  const color = healthColor(report.healthScore);
  const status = healthStatus(report.healthScore);
  const metricsLines = [
    metricLine("Health score", formatMaybe(report.healthScore, (v) => `${v}/100`)),
    metricLine("Peers", formatMaybe(report.peerCount, (v) => String(v))),
    metricLine("Routing buckets", formatMaybe(report.routingBucketCount, (v) => String(v))),
    metricLine("Lookup success", formatMaybe(report.lookupSuccessPct, (v) => `${v.toFixed(1)}%`)),
    metricLine("Timeout rate", formatMaybe(report.lookupTimeoutPct, (v) => `${v.toFixed(1)}%`)),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const summaryText = report.summary.trim().length > 0 ? report.summary : "(no summary)";
  const targetLine = report.targetLabel ? `Target: ${report.targetLabel}` : undefined;
  const attachments: MattermostAttachment[] = [
    {
      title: "Node Metrics",
      color,
      text: metricsLines || "No metrics available",
    },
    {
      title: "Observations",
      color: "#3498db",
      text: summaryText,
    },
  ];

  const optionalAttachments = await Promise.all([
    buildDiscoverabilityAttachment(reportSources),
    buildSearchHealthAttachment(reportSources),
    buildManagedInstanceSurfaceAttachment(report, reportSources),
  ]);
  attachments.push(...optionalAttachments.filter((attachment): attachment is MattermostAttachment => Boolean(attachment)));

  return {
    text: ["mule-doctor", targetLine, "", `Node status: ${status}`]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    attachments,
  };
}

export function buildDailyUsagePayload(summary: UsageSummary): MattermostPayload {
  return {
    text: "rust-mule spending report",
    attachments: [
      {
        title: "Today's usage",
        color: "#f1c40f",
        text: usageBucketText(summary.today, summary.dateKey),
      },
      {
        title: "Monthly usage",
        color: "#3498db",
        text: usageBucketText(summary.month, summary.monthKey),
      },
    ],
  };
}

export function buildPatchProposalPayload(input: PatchProposalInput): MattermostPayload {
  const { body, truncated } = clampPatchBody(input.diff, MAX_PATCH_BODY_CHARS);
  return {
    text: "rust-mule patch proposal available",
    attachments: [
      {
        title: "Patch Proposal Metadata",
        color: "#3498db",
        text: [
          `Artifact: ${input.artifactPath}`,
          `Bytes: ${input.bytes}`,
          `Lines: ${input.lines}`,
          `Content truncated: ${truncated ? "yes" : "no"}`,
        ].join("\n"),
      },
      {
        title: "Patch Content",
        color: "#f1c40f",
        text: `\`\`\`diff\n${escapeCodeFence(body)}\n\`\`\``,
      },
    ],
  };
}

async function buildDiscoverabilityAttachment(
  reportSources: MattermostReportSources,
): Promise<MattermostAttachment | undefined> {
  if (!reportSources.discoverabilityResults) {
    return undefined;
  }
  let summary: ManagedDiscoverabilitySummary;
  try {
    summary = await reportSources.discoverabilityResults.summarizeRecent(
      DEFAULT_DISCOVERABILITY_REPORT_LIMIT,
    );
  } catch (err) {
    log("warn", "mattermost", `Failed to load discoverability report summary: ${String(err)}`);
    return undefined;
  }
  if (summary.totalChecks === 0) {
    return undefined;
  }
  const lines = [
    `Window: ${summary.windowSize} recent checks`,
    `Found: ${summary.foundCount}`,
    `Completed empty: ${summary.completedEmptyCount}`,
    `Timed out: ${summary.timedOutCount}`,
    summary.successRatePct !== undefined
      ? `Success rate: ${summary.successRatePct.toFixed(1)}%`
      : undefined,
    summary.latestOutcome ? `Latest outcome: ${summary.latestOutcome}` : undefined,
    summary.latestPair
      ? `Latest path: ${summary.latestPair.publisherInstanceId} -> ${summary.latestPair.searcherInstanceId}`
      : undefined,
    summary.latestQuery ? `Latest query: ${summary.latestQuery}` : undefined,
    summary.lastSuccessAt ? `Last success: ${summary.lastSuccessAt}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return {
    title: "Discoverability Summary",
    color: "#8cf0c6",
    text: lines,
  };
}

async function buildSearchHealthAttachment(
  reportSources: MattermostReportSources,
): Promise<MattermostAttachment | undefined> {
  if (!reportSources.searchHealthResults) {
    return undefined;
  }
  let summary: SearchHealthSummary;
  try {
    summary = await reportSources.searchHealthResults.summarizeRecent(
      DEFAULT_SEARCH_HEALTH_REPORT_LIMIT,
    );
  } catch (err) {
    log("warn", "mattermost", `Failed to load search health summary: ${String(err)}`);
    return undefined;
  }
  if (summary.totalSearches === 0) {
    return undefined;
  }
  const lines = [
    `Window: ${summary.windowSize} recent searches`,
    `Found: ${summary.foundCount}`,
    `Completed empty: ${summary.completedEmptyCount}`,
    `Timed out: ${summary.timedOutCount}`,
    `Dispatch-ready: ${summary.dispatchReadyCount}`,
    `Dispatch-not-ready: ${summary.dispatchNotReadyCount}`,
    `Degraded transport: ${summary.degradedTransportCount}`,
    summary.successRatePct !== undefined
      ? `Success rate: ${summary.successRatePct.toFixed(1)}%`
      : undefined,
    summary.latestOutcome ? `Latest outcome: ${summary.latestOutcome}` : undefined,
    summary.latestPair
      ? `Latest path: ${summary.latestPair.publisherInstanceId} -> ${summary.latestPair.searcherInstanceId}`
      : undefined,
    summary.latestQuery ? `Latest query: ${summary.latestQuery}` : undefined,
    summary.lastSuccessAt ? `Last success: ${summary.lastSuccessAt}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return {
    title: "Search Health Summary",
    color: "#7fd1ff",
    text: lines,
  };
}

async function buildManagedInstanceSurfaceAttachment(
  report: PeriodicReportInput,
  reportSources: MattermostReportSources,
): Promise<MattermostAttachment | undefined> {
  if (
    !reportSources.managedInstanceSurfaceDiagnostics ||
    report.target?.kind !== "managed_instance" ||
    !report.target.instanceId
  ) {
    return undefined;
  }

  try {
    const diagnostics = await reportSources.managedInstanceSurfaceDiagnostics.getSummary(
      report.target.instanceId,
    );
    return {
      title: "Managed Surface Diagnostics",
      color: "#9b59b6",
      text: [
        `Instance: ${diagnostics.instanceId}`,
        `Observed: ${diagnostics.observedAt}`,
        `Searches: ${diagnostics.summary.searches.totalSearches} total, ${diagnostics.summary.searches.activeSearches} active, ready=${diagnostics.summary.searches.ready ? "yes" : "no"}`,
        `Shared files: ${diagnostics.summary.sharedLibrary.totalFiles}, keyword queued=${diagnostics.summary.sharedLibrary.keywordPublishQueuedCount}, failed=${diagnostics.summary.sharedLibrary.keywordPublishFailedCount}, acked=${diagnostics.summary.sharedLibrary.keywordPublishAckedCount}`,
        `Downloads: ${diagnostics.summary.downloads.totalDownloads} total, ${diagnostics.summary.downloads.activeDownloads} active, errors=${diagnostics.summary.downloads.downloadsWithErrors}`,
      ].join("\n"),
    };
  } catch (err) {
    log("warn", "mattermost", `Failed to load managed surface diagnostics: ${String(err)}`);
    return undefined;
  }
}
