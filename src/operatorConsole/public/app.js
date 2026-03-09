/* global document, EventSource, window */

const LOG_LINE_LIMIT = 250;
const INSTANCE_DETAIL_PLACEHOLDER = "Select an instance to inspect details.";
const INSTANCE_DIAGNOSTICS_PLACEHOLDER =
  "Select an instance to inspect diagnostics for that managed rust-mule node.";
const INSTANCE_ANALYSIS_PLACEHOLDER =
  "Run on-demand analysis for the selected managed instance.";
const INSTANCE_LOGS_PLACEHOLDER = "Select an instance to inspect per-instance rust-mule logs.";
const OBSERVER_TARGET_PLACEHOLDER = "Loading active diagnostic target...";
let selectedInstanceId = null;
let currentObserver = null;
let currentScheduledTarget = null;
let currentScheduler = null;

async function fetchJson(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("authentication required");
  }
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function appendLine(id, line) {
  const element = document.getElementById(id);
  const lines = element.textContent ? element.textContent.split("\n") : [];
  lines.push(line);
  element.textContent = lines.slice(-LOG_LINE_LIMIT).join("\n");
  element.scrollTop = element.scrollHeight;
}

function setStreamStatus(id, isLive, text) {
  const element = document.getElementById(id);
  element.textContent = text;
  element.className = isLive ? "status live" : "status";
}

function renderFileList(targetId, files, onClick) {
  const ul = document.getElementById(targetId);
  ul.replaceChildren();
  if (!files.length) {
    const li = document.createElement("li");
    li.textContent = "No files found.";
    li.className = "muted";
    ul.appendChild(li);
    return;
  }

  for (const file of files) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const updated = file.updatedAt ? new Date(file.updatedAt).toLocaleString() : "unknown";
    title.textContent = file.name;
    meta.className = "file-meta";
    meta.textContent = `${file.sizeBytes} bytes • ${updated}`;
    button.appendChild(title);
    button.appendChild(meta);
    button.onclick = () => onClick(file.name);
    li.appendChild(button);
    ul.appendChild(li);
  }
}

function renderOperatorEvents(events, errorText) {
  const list = document.getElementById("operator-events");
  list.replaceChildren();

  if (errorText) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = errorText;
    list.appendChild(item);
    return;
  }

  if (!events.length) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = "No operator events recorded yet.";
    list.appendChild(item);
    return;
  }

  for (const event of events.slice().reverse()) {
    const item = document.createElement("li");
    const header = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const body = document.createElement("div");
    header.className = "event-line";
    body.className = "file-meta";
    title.textContent = event.type;
    meta.className = "event-meta";
    meta.textContent = new Date(event.timestamp).toLocaleString();
    body.textContent = event.message;
    header.appendChild(title);
    header.appendChild(meta);
    item.appendChild(header);
    item.appendChild(body);
    list.appendChild(item);
  }
}

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

function isUnavailableObservedTarget(target) {
  return (
    sameTarget(target, currentObserver?.lastObservedTarget) &&
    typeof currentObserver?.lastHealthScore === "number" &&
    currentObserver.lastHealthScore <= 0
  );
}

function renderInstanceList(instances) {
  renderComparisonSelectors(instances);
  const ul = document.getElementById("instance-list");
  ul.replaceChildren();
  if (!instances.length) {
    const li = document.createElement("li");
    li.textContent = "No managed instances.";
    li.className = "muted";
    ul.appendChild(li);
    return;
  }

  for (const instance of instances) {
    const li = document.createElement("li");
    const wrapper = document.createElement("div");
    const header = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const controls = document.createElement("div");
    const start = document.createElement("button");
    const stop = document.createElement("button");
    const restart = document.createElement("button");
    const inspect = document.createElement("button");
    const analyze = document.createElement("button");
    const useAsTarget = document.createElement("button");

    wrapper.className = "instance-entry";
    header.className = "instance-header";
    controls.className = "controls";
    title.textContent = `${instance.id} (${instance.status})`;
    meta.className = "file-meta";
    meta.textContent = `${instance.apiHost}:${instance.apiPort}${instance.currentProcess ? ` • pid ${instance.currentProcess.pid}` : ""}`;

    inspect.textContent = "Inspect";
    analyze.textContent = "Analyze";
    useAsTarget.textContent = "Use as target";
    start.textContent = "Start";
    stop.textContent = "Stop";
    restart.textContent = "Restart";

    inspect.onclick = () => inspectInstance(instance.id);
    analyze.onclick = () => analyzeInstance(instance.id);
    useAsTarget.onclick = () =>
      updateObserverTarget({ kind: "managed_instance", instanceId: instance.id });
    start.onclick = () => mutateInstance(instance.id, "start");
    stop.onclick = () => mutateInstance(instance.id, "stop");
    restart.onclick = () => mutateInstance(instance.id, "restart");

    const scheduledTarget =
      currentScheduledTarget?.kind === "managed_instance" ? currentScheduledTarget : undefined;
    const instanceTarget = { kind: "managed_instance", instanceId: instance.id };
    const isScheduledTarget = sameTarget(scheduledTarget, instanceTarget);
    const isUnavailableTarget = isScheduledTarget && isUnavailableObservedTarget(instanceTarget);

    if (instance.status === "running") {
      start.disabled = true;
    } else {
      stop.disabled = true;
    }
    if (isScheduledTarget) {
      useAsTarget.disabled = true;
    }

    header.appendChild(title);
    if (isScheduledTarget) {
      const targetPill = document.createElement("span");
      targetPill.className = "pill target";
      targetPill.textContent = "scheduled target";
      header.appendChild(targetPill);
    }
    if (isUnavailableTarget) {
      const degradedPill = document.createElement("span");
      degradedPill.className = "pill degraded";
      degradedPill.textContent = "unavailable";
      header.appendChild(degradedPill);
    }
    controls.appendChild(inspect);
    controls.appendChild(analyze);
    controls.appendChild(useAsTarget);
    controls.appendChild(start);
    controls.appendChild(stop);
    controls.appendChild(restart);
    wrapper.appendChild(header);
    wrapper.appendChild(meta);
    wrapper.appendChild(controls);
    li.appendChild(wrapper);
    ul.appendChild(li);
  }
}

function renderComparisonSelectors(instances) {
  const left = document.getElementById("compare-left");
  const right = document.getElementById("compare-right");
  const previousLeft = left.value;
  const previousRight = right.value;
  left.replaceChildren();
  right.replaceChildren();

  const placeholderLeft = document.createElement("option");
  placeholderLeft.value = "";
  placeholderLeft.textContent = "Select left instance";
  left.appendChild(placeholderLeft);

  const placeholderRight = document.createElement("option");
  placeholderRight.value = "";
  placeholderRight.textContent = "Select right instance";
  right.appendChild(placeholderRight);

  for (const instance of instances) {
    const optionLeft = document.createElement("option");
    optionLeft.value = instance.id;
    optionLeft.textContent = `${instance.id} (${instance.status})`;
    left.appendChild(optionLeft);

    const optionRight = document.createElement("option");
    optionRight.value = instance.id;
    optionRight.textContent = `${instance.id} (${instance.status})`;
    right.appendChild(optionRight);
  }

  if (instances.some((instance) => instance.id === previousLeft)) {
    left.value = previousLeft;
  }
  if (instances.some((instance) => instance.id === previousRight)) {
    right.value = previousRight;
  }
}

function summarizeComparisonSide(side) {
  const snapshot = side.snapshot;
  const instance = side.instance;
  return {
    id: instance.id,
    status: instance.status,
    api: `${instance.apiHost}:${instance.apiPort}`,
    pid: instance.currentProcess?.pid ?? null,
    available: snapshot.available,
    reason: snapshot.reason || null,
    observedAt: snapshot.observedAt,
    peerCount: snapshot.peerCount ?? null,
    routingBucketCount: snapshot.routingBucketCount ?? null,
    healthScore: snapshot.networkHealth?.score ?? null,
    lookup: snapshot.lookupStats || null,
    lastError: instance.lastError || null,
    lastExit: instance.lastExit || null,
  };
}

function setInstanceFeedback(text, isError = false) {
  const element = document.getElementById("instance-feedback");
  element.textContent = text;
  element.className = isError ? "status" : "muted";
}

function renderHealth(data) {
  const observerLines = [];
  currentObserver = data.observer || null;
  currentScheduledTarget = data.observer?.activeDiagnosticTarget || null;
  currentScheduler = data.scheduler || null;
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
    observerLines.push(
      `Last cycle outcome: ${data.scheduler.lastCycleOutcome || "unknown"}`,
    );
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

async function refreshHealth() {
  const data = await fetchJson("/api/health");
  renderHealth(data);
}

async function refreshAppLogs() {
  const data = await fetchJson(`/api/logs/app?lines=${LOG_LINE_LIMIT}`);
  setText("app-logs", data.lines.join("\n") || "No captured lines yet.");
}

async function refreshRustLogs() {
  const data = await fetchJson(`/api/logs/rust-mule?lines=${LOG_LINE_LIMIT}`);
  setText("rust-logs", data.lines.join("\n") || "No rust-mule lines available.");
}

async function refreshLlmList() {
  const data = await fetchJson("/api/llm/logs");
  renderFileList("llm-files", data.files, async (name) => {
    const detail = await fetchJson(`/api/llm/logs/${encodeURIComponent(name)}`);
    const suffix = detail.truncated ? "\n\n[truncated]" : "";
    setText("llm-content", detail.content + suffix);
  });
}

async function refreshProposalList() {
  const data = await fetchJson("/api/proposals");
  renderFileList("proposal-files", data.files, async (name) => {
    const detail = await fetchJson(`/api/proposals/${encodeURIComponent(name)}`);
    const suffix = detail.truncated ? "\n\n[truncated]" : "";
    setText("proposal-content", detail.content + suffix);
  });
}

async function refreshOperatorEvents() {
  try {
    const data = await fetchJson("/api/operator/events?limit=30");
    renderOperatorEvents(data.events || []);
  } catch (err) {
    renderOperatorEvents([], `Failed to load operator events: ${String(err)}`);
  }
}

async function postJson(url, payload = {}) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("authentication required");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `${url} failed: ${res.status}`);
  }
  return data;
}

async function refreshInstances() {
  try {
    const data = await fetchJson("/api/instances");
    renderInstanceList(data.instances);
    renderTargetStatusCard();
    if (selectedInstanceId) {
      const exists = data.instances.some((instance) => instance.id === selectedInstanceId);
      if (!exists) {
        selectedInstanceId = null;
        setText("instance-detail", "Selected instance no longer exists.");
        setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
        setText("instance-analysis", INSTANCE_ANALYSIS_PLACEHOLDER);
        setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);
      }
    }
  } catch (err) {
    renderInstanceList([]);
    setInstanceFeedback(`instance control unavailable: ${String(err)}`, true);
    renderTargetStatusCard();
  }
}

async function refreshInstanceCompare() {
  const left = document.getElementById("compare-left").value;
  const right = document.getElementById("compare-right").value;
  if (!left || !right) {
    setText("instance-compare", "Select two managed instances to compare.");
    return;
  }
  try {
    const data = await fetchJson(
      `/api/instances/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
    );
    setText(
      "instance-compare",
      JSON.stringify(
        {
          comparedAt: new Date().toISOString(),
          left: summarizeComparisonSide(data.comparison.left),
          right: summarizeComparisonSide(data.comparison.right),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    setText("instance-compare", `Failed to compare instances: ${String(err)}`);
  }
}

async function updateObserverTarget(target) {
  try {
    const data = await postJson("/api/observer/target", target);
    currentScheduledTarget = data.target;
    setText("observer-target", describeTarget(data.target));
    renderTargetStatusCard();
    setInstanceFeedback(
      `diagnostic target updated to ${describeTarget(data.target).replace("Active diagnostic target: ", "")}`,
    );
    await refreshInstances();
    await refreshOperatorEvents();
  } catch (err) {
    setInstanceFeedback(String(err), true);
  }
}

function renderTargetStatusCard(errorText) {
  const element = document.getElementById("target-status-card");
  element.dataset.state = "default";
  if (errorText) {
    element.textContent = errorText;
    element.className = "target-status-card muted";
    return;
  }

  if (!currentScheduledTarget && !currentObserver) {
    element.textContent = "No observer target state loaded yet.";
    element.className = "target-status-card muted";
    return;
  }

  const lines = [];
  lines.push(renderTargetStatusLine("Scheduled", targetLabel(currentScheduledTarget)));
  lines.push(
    renderTargetStatusLine(
      "Last observed",
      currentObserver?.lastObservedTarget
        ? targetLabel(currentObserver.lastObservedTarget)
        : "unknown",
    ),
  );
  lines.push(
    renderTargetStatusLine(
      "Last health",
      typeof currentObserver?.lastHealthScore === "number"
        ? String(currentObserver.lastHealthScore)
        : "unknown",
    ),
  );
  lines.push(renderTargetStatusLine("Last run", currentObserver?.lastRun || "unknown"));
  const schedulerStatus =
    currentScheduler == null ? "unknown" : currentScheduler.started ? "running" : "stopped";
  lines.push(renderTargetStatusLine("Scheduler", schedulerStatus));
  const cycleStatus =
    currentScheduler == null
      ? "unknown"
      : currentScheduler.cycleInFlight
        ? "in progress"
        : "idle";
  lines.push(renderTargetStatusLine("Cycle", cycleStatus));
  if (currentObserver?.lastTargetFailureReason) {
    lines.push(renderTargetStatusLine("Reason", currentObserver.lastTargetFailureReason));
  }
  if (isUnavailableObservedTarget(currentScheduledTarget)) {
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

  if (!currentScheduler && !currentObserver) {
    element.textContent = "No scheduler state loaded yet.";
    element.className = "target-status-card muted";
    return;
  }

  const lines = [];
  const schedulerStatus =
    currentScheduler == null ? "unknown" : currentScheduler.started ? "running" : "stopped";
  const cycleStatus =
    currentScheduler == null
      ? "unknown"
      : currentScheduler.cycleInFlight
        ? "in progress"
        : "idle";
  lines.push(renderTargetStatusLine("Scheduler", schedulerStatus));
  lines.push(renderTargetStatusLine("Cycle", cycleStatus));
  lines.push(
    renderTargetStatusLine(
      "Current target",
      currentScheduler?.currentCycleTarget ? targetLabel(currentScheduler.currentCycleTarget) : "none",
    ),
  );
  lines.push(
    renderTargetStatusLine(
      "Cycle started",
      currentScheduler?.currentCycleStartedAt || "unknown",
    ),
  );
  lines.push(
    renderTargetStatusLine(
      "Last outcome",
      currentScheduler?.lastCycleOutcome || "unknown",
    ),
  );
  lines.push(
    renderTargetStatusLine(
      "Last duration",
      formatDurationMs(currentScheduler?.lastCycleDurationMs),
    ),
  );
  lines.push(
    renderTargetStatusLine(
      "Last target",
      currentObserver?.lastObservedTarget ? targetLabel(currentObserver.lastObservedTarget) : "unknown",
    ),
  );
  lines.push(
    renderTargetStatusLine(
      "Last started",
      currentScheduler?.lastCycleStartedAt || "unknown",
    ),
  );
  lines.push(
    renderTargetStatusLine(
      "Last completed",
      currentScheduler?.lastCycleCompletedAt || "unknown",
    ),
  );

  if (currentScheduler?.lastCycleOutcome === "error") {
    element.dataset.state = "error";
  } else if (currentScheduler?.lastCycleOutcome === "unavailable") {
    element.dataset.state = "warn";
  }
  element.className = "target-status-card";
  element.replaceChildren(...lines);
}

async function runObserverNow() {
  const button = document.getElementById("run-observer-now");
  button.disabled = true;
  try {
    const result = await postJson("/api/observer/run");
    currentScheduler = result.scheduler || currentScheduler;
    setInstanceFeedback("scheduled observer cycle triggered");
    await refreshHealth();
    await refreshInstances();
    await refreshOperatorEvents();
  } catch (err) {
    setInstanceFeedback(String(err), true);
    await refreshHealth();
  } finally {
    button.disabled = false;
  }
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

async function mutateInstance(id, action) {
  try {
    const data = await postJson(`/api/instances/${encodeURIComponent(id)}/${action}`);
    setInstanceFeedback(`${action} succeeded for ${data.instance.id}`);
    await refreshInstances();
    await inspectInstance(data.instance.id);
  } catch (err) {
    setInstanceFeedback(String(err), true);
  }
}

async function createInstance(event) {
  event.preventDefault();
  const form = document.getElementById("instance-create-form");
  const formData = new FormData(form);
  const id = String(formData.get("id") || "").trim();
  const apiPortRaw = String(formData.get("apiPort") || "").trim();
  const payload = { id };
  if (apiPortRaw) {
    payload.apiPort = Number(apiPortRaw);
  }

  try {
    const data = await postJson("/api/instances", payload);
    form.reset();
    setInstanceFeedback(`created planned instance ${data.instance.id}`);
    await refreshInstances();
    await inspectInstance(data.instance.id);
  } catch (err) {
    setInstanceFeedback(String(err), true);
  }
}

async function inspectInstance(id) {
  selectedInstanceId = id;
  try {
    const [detail, diagnostics, logs] = await Promise.all([
      fetchJson(`/api/instances/${encodeURIComponent(id)}`),
      fetchJson(`/api/instances/${encodeURIComponent(id)}/diagnostics`),
      fetchJson(`/api/instances/${encodeURIComponent(id)}/logs?lines=${LOG_LINE_LIMIT}`),
    ]);
    setText("instance-detail", JSON.stringify(detail.instance, null, 2));
    setText("instance-diagnostics", JSON.stringify(diagnostics.snapshot, null, 2));
    setText("instance-logs", logs.lines.join("\n") || "No per-instance rust-mule lines available.");
  } catch (err) {
    setText("instance-detail", `Failed to load instance detail: ${String(err)}`);
    setText("instance-diagnostics", `Failed to load diagnostics: ${String(err)}`);
    setText("instance-logs", `Failed to load instance logs: ${String(err)}`);
  }
}

async function analyzeInstance(id) {
  selectedInstanceId = id;
  setText("instance-analysis", "Running analysis...");
  try {
    const result = await postJson(`/api/instances/${encodeURIComponent(id)}/analyze`);
    setText("instance-analysis", result.analysis.summary || "(no analysis summary)");
    await inspectInstance(id);
  } catch (err) {
    setText("instance-analysis", `Failed to analyze instance: ${String(err)}`);
  }
}

setText("instance-detail", INSTANCE_DETAIL_PLACEHOLDER);
setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
setText("instance-analysis", INSTANCE_ANALYSIS_PLACEHOLDER);
setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);
setText("observer-target", OBSERVER_TARGET_PLACEHOLDER);
setText("instance-compare", "Select two managed instances to compare.");
renderTargetStatusCard();
renderSchedulerStatusCard();
renderOperatorEvents([]);

function connectStream(url, targetId, statusId) {
  const stream = new EventSource(url, { withCredentials: true });
  stream.addEventListener("open", () => setStreamStatus(statusId, true, "live"));
  stream.addEventListener("snapshot", (event) => {
    const payload = JSON.parse(event.data);
    setText(targetId, payload.lines.join("\n"));
  });
  stream.addEventListener("line", (event) => {
    const payload = JSON.parse(event.data);
    appendLine(targetId, payload.line);
  });
  stream.addEventListener("error", () => {
    setStreamStatus(statusId, false, "reconnecting");
  });
  return stream;
}

async function refreshAll() {
  try {
    await Promise.all([
      refreshHealth(),
      refreshAppLogs(),
      refreshRustLogs(),
      refreshLlmList(),
      refreshProposalList(),
      refreshInstances(),
      refreshOperatorEvents(),
    ]);
  } catch (err) {
    setText("health", `Refresh failed: ${String(err)}`);
  }
}

document.getElementById("refresh-all").onclick = refreshAll;
document.getElementById("refresh-app").onclick = refreshAppLogs;
document.getElementById("refresh-rust").onclick = refreshRustLogs;
document.getElementById("refresh-llm-list").onclick = refreshLlmList;
document.getElementById("refresh-proposals").onclick = refreshProposalList;
document.getElementById("refresh-instances").onclick = refreshInstances;
document.getElementById("refresh-instance-compare").onclick = refreshInstanceCompare;
document.getElementById("refresh-target-status").onclick = refreshHealth;
document.getElementById("refresh-scheduler-status").onclick = refreshHealth;
document.getElementById("refresh-operator-events").onclick = refreshOperatorEvents;
document.getElementById("run-instance-compare").onclick = () => {
  void refreshInstanceCompare();
};
document.getElementById("run-observer-now").onclick = () => {
  void runObserverNow();
};
document.getElementById("instance-create-form").onsubmit = createInstance;
document.getElementById("use-external-target").onclick = () => {
  void updateObserverTarget({ kind: "external" });
};

refreshAll().finally(() => {
  connectStream(`/api/stream/app?lines=${LOG_LINE_LIMIT}`, "app-logs", "app-stream-status");
  connectStream(`/api/stream/rust-mule?lines=${LOG_LINE_LIMIT}`, "rust-logs", "rust-stream-status");
});
