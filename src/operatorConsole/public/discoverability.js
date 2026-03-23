/* global document */

function formatRecordedAt(value) {
  if (!value) {
    return "unknown time";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function createBadge(text, className = "") {
  const badge = document.createElement("span");
  badge.className = className ? `event-badge ${className}` : "event-badge";
  badge.textContent = text;
  return badge;
}

function renderDiscoverabilityDetail(result, recordedAt) {
  const detail = document.createElement("div");
  detail.className = "event-detail";
  const fixtureName = result.fixture?.fileName || result.fixture?.fixtureId || "fixture unknown";
  const finalState = result.finalState || "unknown";
  detail.textContent =
    `${result.query} via ${fixtureName} • final state ${finalState} • ` +
    `${result.resultCount} results • recorded ${formatRecordedAt(recordedAt)}`;
  return detail;
}

function renderDiscoverabilitySummary(summary) {
  const element = document.getElementById("discoverability-summary");
  if (!summary || typeof summary.totalChecks !== "number" || summary.totalChecks === 0) {
    element.textContent = "No controlled discoverability summary available yet.";
    return;
  }

  const parts = [
    `Window: ${summary.windowSize} recent checks`,
    `Found ${summary.foundCount}, empty ${summary.completedEmptyCount}, timed out ${summary.timedOutCount}`,
  ];
  if (typeof summary.successRatePct === "number") {
    parts.push(`Success rate: ${summary.successRatePct.toFixed(1)}%`);
  }
  if (summary.latestOutcome) {
    parts.push(`Latest outcome: ${summary.latestOutcome}`);
  }
  if (summary.latestPair) {
    parts.push(
      `Latest path: ${summary.latestPair.publisherInstanceId} -> ${summary.latestPair.searcherInstanceId}`,
    );
  }
  if (summary.lastSuccessAt) {
    parts.push(`Last success: ${formatRecordedAt(summary.lastSuccessAt)}`);
  }
  element.textContent = parts.join(" • ");
}

function renderSearchHealthSummary(summary) {
  const element = document.getElementById("search-health-summary");
  if (!summary || typeof summary.totalSearches !== "number" || summary.totalSearches === 0) {
    element.textContent = "No search health summary available yet.";
    return;
  }

  const parts = [
    `Window: ${summary.windowSize} recent searches`,
    `Active ${summary.activeCount}, found ${summary.foundCount}, empty ${summary.completedEmptyCount}, timed out ${summary.timedOutCount}`,
    `Dispatch-ready ${summary.dispatchReadyCount}, not-ready ${summary.dispatchNotReadyCount}`,
    `Degraded transport: ${summary.degradedTransportCount}`,
  ];
  if (typeof summary.successRatePct === "number") {
    parts.push(`Success rate: ${summary.successRatePct.toFixed(1)}%`);
  }
  if (summary.latestOutcome) {
    parts.push(`Latest outcome: ${summary.latestOutcome}`);
  }
  if (summary.latestPair) {
    parts.push(
      `Latest path: ${summary.latestPair.publisherInstanceId} -> ${summary.latestPair.searcherInstanceId}`,
    );
  } else if (summary.latestTargetLabel) {
    parts.push(`Latest target: ${summary.latestTargetLabel}`);
  } else if (summary.latestInstanceId) {
    parts.push(`Latest instance: ${summary.latestInstanceId}`);
  }
  if (summary.lastSuccessAt) {
    parts.push(`Last success: ${formatRecordedAt(summary.lastSuccessAt)}`);
  }
  element.textContent = parts.join(" • ");
}

function renderLlmInvocationSummary(summary) {
  const element = document.getElementById("llm-invocation-summary");
  if (!summary || typeof summary.totalInvocations !== "number" || summary.totalInvocations === 0) {
    element.textContent = "No LLM invocation audit history available yet.";
    return;
  }

  const parts = [
    `Window: ${summary.windowSize} recent invocations`,
    `Completed ${summary.finishReasonCounts?.completed ?? 0}, failed ${summary.finishReasonCounts?.failed ?? 0}, rate-limited ${summary.rateLimitedCount ?? 0}`,
    `Human ${summary.humanTriggeredCount ?? 0}, scheduled ${summary.scheduledCount ?? 0}`,
  ];
  if (summary.latestSurface) {
    parts.push(`Latest surface: ${summary.latestSurface}`);
  }
  if (summary.latestFinishReason) {
    parts.push(`Latest outcome: ${summary.latestFinishReason}`);
  }
  if (summary.latestRecordedAt) {
    parts.push(`Latest at: ${formatRecordedAt(summary.latestRecordedAt)}`);
  }
  element.textContent = parts.join(" • ");
}

function renderDiscoverabilityItem(record) {
  const item = document.createElement("li");
  const line = document.createElement("div");
  line.className = "event-line";

  const title = document.createElement("strong");
  title.textContent = `${record.result.publisherInstanceId} -> ${record.result.searcherInstanceId}`;
  line.appendChild(title);

  const badges = document.createElement("div");
  badges.className = "event-badges";
  badges.appendChild(
    createBadge(record.result.outcome, record.result.outcome === "found" ? "success" : "warn"),
  );
  badges.appendChild(createBadge(`${record.result.resultCount} hits`));
  if (record.result.readinessAtDispatch?.publisherReady && record.result.readinessAtDispatch?.searcherReady) {
    badges.appendChild(createBadge("ready at dispatch", "instance"));
  }
  line.appendChild(badges);

  item.appendChild(line);
  item.appendChild(renderDiscoverabilityDetail(record.result, record.recordedAt));
  return item;
}

function renderSearchHealthItem(record) {
  const item = document.createElement("li");
  const line = document.createElement("div");
  line.className = "event-line";

  const title = document.createElement("strong");
  title.textContent = record.controlledContext
    ? `${record.controlledContext.publisherInstanceId} -> ${record.controlledContext.searcherInstanceId}`
    : record.observerContext?.label
      ? `${record.observerContext.label}: ${record.query}`
    : record.observedContext?.instanceId
      ? `${record.observedContext.instanceId}: ${record.query}`
    : record.query;
  line.appendChild(title);

  const badges = document.createElement("div");
  badges.className = "event-badges";
  badges.appendChild(createBadge(record.outcome, record.outcome === "found" ? "success" : "warn"));
  badges.appendChild(createBadge(`${record.resultCount} hits`));
  if (
    record.readinessAtDispatch?.publisher?.ready === true &&
    record.readinessAtDispatch?.searcher?.ready === true
  ) {
    badges.appendChild(createBadge("ready at dispatch", "instance"));
  }
  if (
    (record.transportAtDispatch?.publisher?.degradedIndicators?.length ?? 0) > 0 ||
    (record.transportAtDispatch?.searcher?.degradedIndicators?.length ?? 0) > 0
  ) {
    badges.appendChild(createBadge("degraded transport", "warn"));
  }
  if (record.observedContext?.instanceId) {
    badges.appendChild(createBadge("observed", "instance"));
  }
  if (record.observerContext?.label) {
    badges.appendChild(createBadge("observer", "instance"));
  }
  if (record.source === "operator_triggered_search") {
    badges.appendChild(createBadge("manual", "instance"));
  }
  line.appendChild(badges);

  const detail = document.createElement("div");
  detail.className = "event-detail";
  const finalState = record.finalState || "unknown";
  const fixtureName = record.controlledContext?.fixture?.fileName;
  const peerLabel = record.observedContext?.instanceId ? "observed peers" : "searcher peers";
  detail.textContent =
    `${record.query}${fixtureName ? ` via ${fixtureName}` : ""} • final state ${finalState} • ` +
    `${record.transportAtDispatch?.searcher?.peerCount ?? 0} ${peerLabel} • recorded ${formatRecordedAt(record.recordedAt)}`;

  item.appendChild(line);
  item.appendChild(detail);
  return item;
}

function renderLlmInvocationItem(record) {
  const item = document.createElement("li");
  const line = document.createElement("div");
  line.className = "event-line";

  const title = document.createElement("strong");
  title.textContent = record.surface || "unknown surface";
  line.appendChild(title);

  const badges = document.createElement("div");
  badges.className = "event-badges";
  badges.appendChild(createBadge(record.finishReason || "unknown"));
  badges.appendChild(createBadge(record.trigger || "unknown trigger", "instance"));
  if (typeof record.toolCalls === "number") {
    badges.appendChild(createBadge(`${record.toolCalls} tools`));
  }
  line.appendChild(badges);

  const detail = document.createElement("div");
  detail.className = "event-detail";
  const target =
    record.target?.kind === "managed_instance" && record.target?.instanceId
      ? `${record.target.kind}:${record.target.instanceId}`
      : record.target?.kind;
  const extras = [
    record.model ? `model ${record.model}` : undefined,
    typeof record.durationMs === "number" ? `${record.durationMs}ms` : undefined,
    target ? `target ${target}` : undefined,
    record.command ? `command ${record.command}` : undefined,
    record.rateLimitReason ? `rate-limit ${record.rateLimitReason}` : undefined,
    typeof record.retryAfterSec === "number" ? `retry ${record.retryAfterSec}s` : undefined,
    `recorded ${formatRecordedAt(record.recordedAt)}`,
  ]
    .filter((value) => Boolean(value))
    .join(" • ");
  detail.textContent = extras;

  item.appendChild(line);
  item.appendChild(detail);
  return item;
}

export function createDiscoverabilityController(fetchJson) {
  async function refreshDiscoverabilityResults() {
    const list = document.getElementById("discoverability-results");
    list.replaceChildren();
    try {
      const summaryData = await fetchJson("/api/discoverability/summary?limit=8");
      renderDiscoverabilitySummary(summaryData.summary);
    } catch {
      renderDiscoverabilitySummary(undefined);
    }

    try {
      const data = await fetchJson("/api/discoverability/results?limit=8");
      const results = Array.isArray(data.results) ? [...data.results].reverse() : [];
      if (!results.length) {
        const item = document.createElement("li");
        item.className = "muted";
        item.textContent = "No controlled discoverability checks recorded yet.";
        list.appendChild(item);
        return;
      }

      for (const record of results) {
        list.appendChild(renderDiscoverabilityItem(record));
      }
    } catch (err) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = `Failed to load discoverability results: ${String(err)}`;
      list.appendChild(item);
    }
  }

  async function refreshSearchHealthResults() {
    const list = document.getElementById("search-health-results");
    list.replaceChildren();
    try {
      const summaryData = await fetchJson("/api/search-health/summary?limit=8");
      renderSearchHealthSummary(summaryData.summary);
    } catch {
      renderSearchHealthSummary(undefined);
    }

    try {
      const data = await fetchJson("/api/search-health/results?limit=8");
      const results = Array.isArray(data.results) ? [...data.results].reverse() : [];
      if (!results.length) {
        const item = document.createElement("li");
        item.className = "muted";
        item.textContent = "No search health history recorded yet.";
        list.appendChild(item);
        return;
      }

      for (const record of results) {
        list.appendChild(renderSearchHealthItem(record));
      }
    } catch (err) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = `Failed to load search health results: ${String(err)}`;
      list.appendChild(item);
    }
  }

  async function refreshLlmInvocationResults() {
    const list = document.getElementById("llm-invocation-results");
    list.replaceChildren();
    try {
      const summaryData = await fetchJson("/api/llm/invocations/summary?limit=12");
      renderLlmInvocationSummary(summaryData.summary);
    } catch {
      renderLlmInvocationSummary(undefined);
    }

    try {
      const data = await fetchJson("/api/llm/invocations?limit=12");
      const results = Array.isArray(data.results) ? [...data.results].reverse() : [];
      if (!results.length) {
        const item = document.createElement("li");
        item.className = "muted";
        item.textContent = "No LLM invocation history recorded yet.";
        list.appendChild(item);
        return;
      }
      for (const record of results) {
        list.appendChild(renderLlmInvocationItem(record));
      }
    } catch (err) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = `Failed to load LLM invocation history: ${String(err)}`;
      list.appendChild(item);
    }
  }

  return {
    refreshDiscoverabilityResults,
    refreshSearchHealthResults,
    refreshLlmInvocationResults,
  };
}
