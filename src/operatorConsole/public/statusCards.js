/* global document */

function targetLabel(target) {
  if (!target || target.kind === "external") {
    return "external configured rust-mule client";
  }
  return `managed instance ${target.instanceId}`;
}

function describeTarget(target) {
  return `Active diagnostic target: ${targetLabel(target)}`;
}

function sameTarget(left, right) {
  if (!left || !right) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === "external") return true;
  return left.instanceId === right.instanceId;
}

function renderTargetStatusLine(label, value) {
  const row = document.createElement("div");
  const left = document.createElement("span");
  const right = document.createElement("span");
  row.className = "target-status-line";
  left.className = "target-status-label";
  right.className = "target-status-value";
  left.textContent = label;
  right.textContent = value;
  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function formatDurationMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "unknown";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(1)} s`;
}

export function createStatusCards(state, setText) {
  function isUnavailableObservedTarget(target) {
    return (
      sameTarget(target, state.currentObserver?.lastObservedTarget) &&
      typeof state.currentObserver?.lastHealthScore === "number" &&
      state.currentObserver.lastHealthScore <= 0
    );
  }

  function renderTargetStatusCard(errorText) {
    const element = document.getElementById("target-status-card");
    element.dataset.state = "default";
    if (errorText) {
      element.textContent = errorText;
      element.className = "target-status-card muted";
      return;
    }

    if (!state.currentScheduledTarget && !state.currentObserver) {
      element.textContent = "No observer target state loaded yet.";
      element.className = "target-status-card muted";
      return;
    }

    const lines = [];
    lines.push(renderTargetStatusLine("Scheduled", targetLabel(state.currentScheduledTarget)));
    lines.push(
      renderTargetStatusLine(
        "Last observed",
        state.currentObserver?.lastObservedTarget
          ? targetLabel(state.currentObserver.lastObservedTarget)
          : "unknown",
      ),
    );
    lines.push(
      renderTargetStatusLine(
        "Last health",
        typeof state.currentObserver?.lastHealthScore === "number"
          ? String(state.currentObserver.lastHealthScore)
          : "unknown",
      ),
    );
    lines.push(renderTargetStatusLine("Last run", state.currentObserver?.lastRun || "unknown"));
    const schedulerStatus =
      state.currentScheduler == null ? "unknown" : state.currentScheduler.started ? "running" : "stopped";
    lines.push(renderTargetStatusLine("Scheduler", schedulerStatus));
    const cycleStatus =
      state.currentScheduler == null
        ? "unknown"
        : state.currentScheduler.cycleInFlight
          ? "in progress"
          : "idle";
    lines.push(renderTargetStatusLine("Cycle", cycleStatus));
    if (state.currentObserver?.lastTargetFailureReason) {
      lines.push(renderTargetStatusLine("Reason", state.currentObserver.lastTargetFailureReason));
    }
    if (isUnavailableObservedTarget(state.currentScheduledTarget)) {
      lines.push(renderTargetStatusLine("State", "unavailable"));
      element.className = "target-status-card";
      element.dataset.state = "warn";
    } else {
      lines.push(renderTargetStatusLine("State", "active"));
      element.className = "target-status-card";
    }
    element.replaceChildren(...lines);
  }

  function renderSchedulerStatusCard(errorText) {
    const element = document.getElementById("scheduler-status-card");
    element.dataset.state = "default";
    if (errorText) {
      element.textContent = errorText;
      element.className = "target-status-card muted";
      return;
    }

    if (!state.currentScheduler && !state.currentObserver) {
      element.textContent = "No scheduler state loaded yet.";
      element.className = "target-status-card muted";
      return;
    }

    const lines = [];
    const schedulerStatus =
      state.currentScheduler == null ? "unknown" : state.currentScheduler.started ? "running" : "stopped";
    const cycleStatus =
      state.currentScheduler == null
        ? "unknown"
        : state.currentScheduler.cycleInFlight
          ? "in progress"
          : "idle";
    lines.push(renderTargetStatusLine("Scheduler", schedulerStatus));
    lines.push(renderTargetStatusLine("Cycle", cycleStatus));
    lines.push(
      renderTargetStatusLine(
        "Current target",
        state.currentScheduler?.currentCycleTarget
          ? targetLabel(state.currentScheduler.currentCycleTarget)
          : "none",
      ),
    );
    lines.push(
      renderTargetStatusLine(
        "Cycle started",
        state.currentScheduler?.currentCycleStartedAt || "unknown",
      ),
    );
    lines.push(
      renderTargetStatusLine("Last outcome", state.currentScheduler?.lastCycleOutcome || "unknown"),
    );
    lines.push(
      renderTargetStatusLine(
        "Last duration",
        formatDurationMs(state.currentScheduler?.lastCycleDurationMs),
      ),
    );
    lines.push(
      renderTargetStatusLine(
        "Last target",
        state.currentObserver?.lastObservedTarget
          ? targetLabel(state.currentObserver.lastObservedTarget)
          : "unknown",
      ),
    );
    lines.push(
      renderTargetStatusLine("Last started", state.currentScheduler?.lastCycleStartedAt || "unknown"),
    );
    lines.push(
      renderTargetStatusLine(
        "Last completed",
        state.currentScheduler?.lastCycleCompletedAt || "unknown",
      ),
    );

    if (state.currentScheduler?.lastCycleOutcome === "error") {
      element.dataset.state = "error";
    } else if (state.currentScheduler?.lastCycleOutcome === "unavailable") {
      element.dataset.state = "warn";
    }
    element.className = "target-status-card";
    element.replaceChildren(...lines);
  }

  function renderHealth(data) {
    const observerLines = [];
    state.currentObserver = data.observer || null;
    state.currentScheduledTarget = data.observer?.activeDiagnosticTarget || null;
    state.currentScheduler = data.scheduler || null;
    if (data.observer) {
      observerLines.push(describeTarget(data.observer.activeDiagnosticTarget));
      observerLines.push(
        `Last observed target: ${describeTarget(data.observer.lastObservedTarget).replace("Active diagnostic target: ", "")}`,
      );
      observerLines.push(`Last run: ${data.observer.lastRun || "unknown"}`);
      observerLines.push(
        `Last health score: ${
          typeof data.observer.lastHealthScore === "number" ? data.observer.lastHealthScore : "unknown"
        }`,
      );
      if (data.observer.lastTargetFailureReason) {
        observerLines.push(`Last failure reason: ${data.observer.lastTargetFailureReason}`);
      }
    }
    if (data.scheduler) {
      observerLines.push(`Scheduler running: ${data.scheduler.started ? "yes" : "no"}`);
      observerLines.push(`Cycle in progress: ${data.scheduler.cycleInFlight ? "yes" : "no"}`);
      observerLines.push(`Last cycle outcome: ${data.scheduler.lastCycleOutcome || "unknown"}`);
    }

    setText(
      "health",
      [
        `Started at: ${data.startedAt}`,
        `Now: ${data.now}`,
        `Uptime (sec): ${data.uptimeSec}`,
        observerLines.length ? "" : null,
        ...observerLines,
        "",
        JSON.stringify(data.paths, null, 2),
      ]
        .filter((line) => line !== null)
        .join("\n"),
    );
    renderTargetStatusCard();
    renderSchedulerStatusCard();
  }

  return {
    describeTarget,
    targetLabel,
    sameTarget,
    isUnavailableObservedTarget,
    renderHealth,
    renderTargetStatusCard,
    renderSchedulerStatusCard,
  };
}
