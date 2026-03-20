/* global document */

import {
  INSTANCE_ANALYSIS_PLACEHOLDER,
  INSTANCE_DETAIL_PLACEHOLDER,
  INSTANCE_DISCOVERABILITY_PLACEHOLDER,
  INSTANCE_DIAGNOSTICS_PLACEHOLDER,
  INSTANCE_LOGS_PLACEHOLDER,
  INSTANCE_PRESET_PLACEHOLDER,
  INSTANCE_SHARED_PLACEHOLDER,
  LOG_LINE_LIMIT,
  OBSERVER_TARGET_PLACEHOLDER,
} from "./constants.js";
import { connectStream, fetchJson, postJson } from "./api.js";
import { renderFileList, setText } from "./dom.js";
import { createDiscoverabilityController } from "./discoverability.js";
import { createStatusCards } from "./statusCards.js";
import { createTimelineController } from "./timeline.js";
import { createInstancesController } from "./instances.js";

const state = {
  selectedInstanceId: null,
  currentObserver: null,
  currentScheduledTarget: null,
  currentScheduler: null,
  currentManagedInstances: [],
  currentOperatorEvents: [],
  currentInstancePresets: [],
  instanceControlState: {
    instances: {},
    presets: {},
  },
  expandedOperatorEventGroups: new Set(),
};

const statusCards = createStatusCards(state, setText);
const timeline = createTimelineController(state);
const discoverability = createDiscoverabilityController(fetchJson);
const instances = createInstancesController({
  state,
  timeline,
  statusCards,
  setText,
  fetchJson,
  postJson,
  refreshOperatorEvents,
  refreshDiscoverabilityResults: discoverability.refreshDiscoverabilityResults,
  refreshSearchHealthResults: discoverability.refreshSearchHealthResults,
});

async function refreshHealth() {
  const data = await fetchJson("/api/health");
  statusCards.renderHealth(data);
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
    state.currentOperatorEvents = data.events || [];
    timeline.applyOperatorEventFilters();
  } catch (err) {
    timeline.renderOperatorEvents([], `Failed to load operator events: ${String(err)}`);
  }
}

async function runObserverNow() {
  const button = document.getElementById("run-observer-now");
  button.disabled = true;
  try {
    const result = await postJson("/api/observer/run");
    state.currentScheduler = result.scheduler || state.currentScheduler;
    instances.setInstanceFeedback("scheduled observer cycle triggered");
    await refreshHealth();
    await instances.refreshInstances();
    await refreshOperatorEvents();
  } catch (err) {
    instances.setInstanceFeedback(String(err), true);
    await refreshHealth();
  } finally {
    button.disabled = false;
  }
}

async function refreshAll() {
  try {
    await Promise.all([
      refreshHealth(),
      refreshAppLogs(),
      refreshRustLogs(),
      refreshLlmList(),
      refreshProposalList(),
      instances.refreshInstances(),
      instances.refreshInstancePresets(),
      refreshOperatorEvents(),
      discoverability.refreshDiscoverabilityResults(),
      discoverability.refreshSearchHealthResults(),
      discoverability.refreshLlmInvocationResults(),
    ]);
  } catch (err) {
    setText("health", `Refresh failed: ${String(err)}`);
  }
}

setText("instance-detail", INSTANCE_DETAIL_PLACEHOLDER);
setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
setText("instance-analysis", INSTANCE_ANALYSIS_PLACEHOLDER);
setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);
setText("instance-shared", INSTANCE_SHARED_PLACEHOLDER);
setText("instance-discoverability-result", INSTANCE_DISCOVERABILITY_PLACEHOLDER);
setText("observer-target", OBSERVER_TARGET_PLACEHOLDER);
instances.renderInstancePresets([], INSTANCE_PRESET_PLACEHOLDER);
setText("instance-compare", "Select two managed instances to compare.");
statusCards.renderTargetStatusCard();
statusCards.renderSchedulerStatusCard();
timeline.renderOperatorEvents([]);
timeline.populateOperatorEventFilters();
instances.renderSelectedInstanceTimelineControls();
instances.renderCompareTimelineControls();

document.getElementById("refresh-all").onclick = refreshAll;
document.getElementById("refresh-app").onclick = refreshAppLogs;
document.getElementById("refresh-rust").onclick = refreshRustLogs;
document.getElementById("refresh-llm-list").onclick = refreshLlmList;
document.getElementById("refresh-proposals").onclick = refreshProposalList;
document.getElementById("refresh-discoverability-results").onclick =
  discoverability.refreshDiscoverabilityResults;
document.getElementById("refresh-search-health-results").onclick =
  discoverability.refreshSearchHealthResults;
document.getElementById("refresh-llm-invocations").onclick =
  discoverability.refreshLlmInvocationResults;
document.getElementById("refresh-instances").onclick = instances.refreshInstances;
document.getElementById("refresh-instance-compare").onclick = instances.refreshInstanceCompare;
document.getElementById("compare-left").onchange = instances.renderCompareTimelineControls;
document.getElementById("compare-right").onchange = instances.renderCompareTimelineControls;
document.getElementById("refresh-target-status").onclick = refreshHealth;
document.getElementById("refresh-scheduler-status").onclick = refreshHealth;
document.getElementById("refresh-operator-events").onclick = refreshOperatorEvents;
document.getElementById("view-target-events").onclick = () => {
  timeline.focusOperatorTimelineForTarget(state.currentScheduledTarget, { view: "targeting" });
};
document.getElementById("view-scheduler-runs").onclick = () => {
  timeline.focusOperatorTimeline({ view: "runs" });
};
document.getElementById("view-scheduler-failures").onclick = () => {
  timeline.focusOperatorTimeline({ view: "failures" });
};
document.getElementById("view-selected-instance-events").onclick = () => {
  if (state.selectedInstanceId) {
    timeline.focusOperatorTimelineForInstance(state.selectedInstanceId, { view: "all" });
  }
};
document.getElementById("view-selected-instance-failures").onclick = () => {
  if (state.selectedInstanceId) {
    timeline.focusOperatorTimelineForInstance(state.selectedInstanceId, { view: "failures" });
  }
};
document.getElementById("view-compare-left-events").onclick = () => {
  const leftId = document.getElementById("compare-left").value;
  if (leftId) {
    timeline.focusOperatorTimelineForInstance(leftId, { view: "all" });
  }
};
document.getElementById("view-compare-right-events").onclick = () => {
  const rightId = document.getElementById("compare-right").value;
  if (rightId) {
    timeline.focusOperatorTimelineForInstance(rightId, { view: "all" });
  }
};
document.getElementById("view-compare-left-failures").onclick = () => {
  const leftId = document.getElementById("compare-left").value;
  if (leftId) {
    timeline.focusOperatorTimelineForInstance(leftId, { view: "failures" });
  }
};
document.getElementById("view-compare-right-failures").onclick = () => {
  const rightId = document.getElementById("compare-right").value;
  if (rightId) {
    timeline.focusOperatorTimelineForInstance(rightId, { view: "failures" });
  }
};
document.getElementById("operator-view-all").onclick = () => timeline.applyOperatorEventViewPreset("all");
document.getElementById("operator-view-failures").onclick = () =>
  timeline.applyOperatorEventViewPreset("failures");
document.getElementById("operator-view-targeting").onclick = () =>
  timeline.applyOperatorEventViewPreset("targeting");
document.getElementById("operator-view-runs").onclick = () =>
  timeline.applyOperatorEventViewPreset("runs");
document.getElementById("operator-event-group-filter").onchange = timeline.applyOperatorEventFilters;
document.getElementById("operator-event-instance-filter").onchange = timeline.applyOperatorEventFilters;
document.getElementById("operator-event-type-filter").onchange = timeline.applyOperatorEventFilters;
document.getElementById("operator-event-signal-targets").onchange = timeline.applyOperatorEventFilters;
document.getElementById("operator-event-signal-runs").onchange = timeline.applyOperatorEventFilters;
document.getElementById("operator-event-signal-failures").onchange = timeline.applyOperatorEventFilters;
document.getElementById("operator-event-grouping-toggle").onchange = timeline.applyOperatorEventFilters;
document.getElementById("instance-preset-id").onchange = instances.renderSelectedPresetHelp;
document.getElementById("run-instance-compare").onclick = () => {
  void instances.refreshInstanceCompare();
};
document.getElementById("run-observer-now").onclick = () => {
  void runObserverNow();
};
document.getElementById("instance-create-form").onsubmit = instances.createInstance;
document.getElementById("instance-preset-form").onsubmit = instances.applyInstancePreset;
document.getElementById("instance-discoverability-form").onsubmit = instances.runDiscoverabilityCheck;
document.getElementById("use-external-target").onclick = () => {
  void instances.updateObserverTarget({ kind: "external" });
};
document.getElementById("selected-instance-refresh").onclick = () => {
  void instances.refreshSelectedInstance();
};
document.getElementById("selected-instance-analyze").onclick = () => {
  void instances.analyzeSelectedInstance();
};
document.getElementById("selected-instance-use-target").onclick = () => {
  void instances.useSelectedInstanceAsTarget();
};
document.getElementById("selected-instance-start").onclick = () => {
  void instances.mutateSelectedInstance("start");
};
document.getElementById("selected-instance-stop").onclick = () => {
  void instances.mutateSelectedInstance("stop");
};
document.getElementById("selected-instance-restart").onclick = () => {
  void instances.mutateSelectedInstance("restart");
};
document.getElementById("selected-instance-refresh-shared").onclick = () => {
  void instances.refreshSelectedInstanceShared();
};
document.getElementById("selected-instance-create-fixture").onclick = () => {
  void instances.createSelectedInstanceFixture();
};
document.getElementById("selected-instance-reindex").onclick = () => {
  void instances.mutateSelectedInstanceShared("reindex");
};
document.getElementById("selected-instance-republish-sources").onclick = () => {
  void instances.mutateSelectedInstanceShared("republish_sources");
};
document.getElementById("selected-instance-republish-keywords").onclick = () => {
  void instances.mutateSelectedInstanceShared("republish_keywords");
};
document.getElementById("selected-instance-refresh-discoverability").onclick = () => {
  void instances.refreshDiscoverabilityViews();
};

refreshAll().finally(() => {
  connectStream(`/api/stream/app?lines=${LOG_LINE_LIMIT}`, "app-logs", "app-stream-status");
  connectStream(`/api/stream/rust-mule?lines=${LOG_LINE_LIMIT}`, "rust-logs", "rust-stream-status");
});
