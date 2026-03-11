/* global document, window */

import {
  INSTANCE_ANALYSIS_PLACEHOLDER,
  INSTANCE_DIAGNOSTICS_PLACEHOLDER,
  INSTANCE_LOGS_PLACEHOLDER,
  LOG_LINE_LIMIT,
} from "./constants.js";
import { createInstanceCompareController } from "./instanceCompare.js";
import { createInstancePresetsController } from "./instancePresets.js";
import { createInstanceViewsController } from "./instanceViews.js";

export function createInstancesController({
  state,
  timeline,
  statusCards,
  setText,
  fetchJson,
  postJson,
  refreshOperatorEvents,
}) {
  const compare = createInstanceCompareController({ fetchJson, setText });
  const presets = createInstancePresetsController({ state });

  function confirmAction(message) {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(message);
    }
    return true;
  }

  function renderControlState() {
    views.renderInstanceList(state.currentManagedInstances);
    views.renderInstanceGroups(state.currentManagedInstances);
    views.renderSelectedInstanceTimelineControls();
  }

  function setControlState(collection, key, entry) {
    state.instanceControlState[collection][key] = entry;
    renderControlState();
  }

  function clearStaleControlState(instances) {
    const validIds = new Set(instances.map((instance) => instance.id));
    for (const id of Object.keys(state.instanceControlState.instances)) {
      if (!validIds.has(id)) {
        delete state.instanceControlState.instances[id];
      }
    }
    const validPrefixes = new Set(
      instances
        .map((instance) => instance.preset?.prefix)
        .filter((prefix) => typeof prefix === "string" && prefix.length > 0),
    );
    for (const prefix of Object.keys(state.instanceControlState.presets)) {
      if (!validPrefixes.has(prefix)) {
        delete state.instanceControlState.presets[prefix];
      }
    }
  }

  function setInstanceFeedback(text, isError = false) {
    const element = document.getElementById("instance-feedback");
    element.textContent = text;
    element.className = isError ? "status" : "muted";
  }

  async function inspectInstance(id) {
    state.selectedInstanceId = id;
    views.renderSelectedInstanceTimelineControls();
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
    state.selectedInstanceId = id;
    views.renderSelectedInstanceTimelineControls();
    setControlState("instances", id, {
      message: "Analysis in progress...",
      tone: "pending",
    });
    setText("instance-analysis", "Running analysis...");
    try {
      const result = await postJson(`/api/instances/${encodeURIComponent(id)}/analyze`);
      setText("instance-analysis", result.analysis.summary || "(no analysis summary)");
      setControlState("instances", id, {
        message: "Analysis completed.",
        tone: "success",
      });
      await inspectInstance(id);
    } catch (err) {
      setControlState("instances", id, {
        message: `Analysis failed: ${String(err)}`,
        tone: "error",
      });
      setText("instance-analysis", `Failed to analyze instance: ${String(err)}`);
    }
  }

  async function updateObserverTarget(target) {
    try {
      const data = await postJson("/api/observer/target", target);
      state.currentScheduledTarget = data.target;
      setText("observer-target", statusCards.describeTarget(data.target));
      statusCards.renderTargetStatusCard();
      setInstanceFeedback(`diagnostic target updated to ${statusCards.targetLabel(data.target)}`);
      await refreshInstances();
      await refreshOperatorEvents();
    } catch (err) {
      setInstanceFeedback(String(err), true);
    }
  }

  async function mutateInstance(id, action) {
    try {
      if (
        action === "restart" &&
        !confirmAction(`Restart managed instance ${id}? This will interrupt its current process.`)
      ) {
        setControlState("instances", id, {
          message: "Restart cancelled.",
          tone: "error",
        });
        return;
      }
      const pendingVerb = action === "stop" ? "Stopping" : action === "start" ? "Starting" : "Restarting";
      const pastTense = action === "stop" ? "stopped" : action === "start" ? "started" : "restarted";
      setControlState("instances", id, {
        message: `${pendingVerb} instance...`,
        tone: "pending",
        pendingAction: action,
      });
      const data = await postJson(`/api/instances/${encodeURIComponent(id)}/${action}`);
      setControlState("instances", data.instance.id, {
        message: `${pastTense} successfully.`,
        tone: "success",
      });
      setInstanceFeedback(`${pastTense} instance ${data.instance.id}`);
      await refreshInstances();
      await inspectInstance(data.instance.id);
    } catch (err) {
      setControlState("instances", id, {
        message: `Action failed: ${String(err)}`,
        tone: "error",
      });
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
      setControlState("instances", data.instance.id, {
        message: "Created as planned instance.",
        tone: "success",
      });
      setInstanceFeedback(`created planned instance ${data.instance.id}`);
      await refreshInstances();
      await inspectInstance(data.instance.id);
    } catch (err) {
      setInstanceFeedback(String(err), true);
    }
  }

  async function applyInstancePreset(event) {
    event.preventDefault();
    const form = document.getElementById("instance-preset-form");
    const formData = new FormData(form);
    const presetId = String(formData.get("presetId") || "").trim();
    const prefix = String(formData.get("prefix") || "").trim();

    try {
      setControlState("presets", prefix, {
        message: `Applying preset ${presetId}...`,
        tone: "pending",
        pendingAction: "apply",
      });
      const data = await postJson("/api/instance-presets/apply", { presetId, prefix });
      setControlState("presets", prefix, {
        message: `Preset ${data.applied.presetId} applied.`,
        tone: "success",
      });
      for (const instance of data.applied.instances) {
        setControlState("instances", instance.id, {
          message: `Created from preset ${data.applied.presetId}.`,
          tone: "success",
        });
      }
      setInstanceFeedback(
        `applied preset ${data.applied.presetId}: ${data.applied.instances.map((instance) => instance.id).join(", ")}`,
      );
      await refreshInstances();
    } catch (err) {
      setControlState("presets", prefix, {
        message: `Apply failed: ${String(err)}`,
        tone: "error",
      });
      setInstanceFeedback(String(err), true);
    }
  }

  async function bulkMutatePreset(prefix, action) {
    try {
      if (action !== "start" && action !== "stop" && action !== "restart") {
        throw new Error(`unsupported preset action: ${action}`);
      }
      if (
        (action === "stop" || action === "restart") &&
        !confirmAction(
          `${action === "stop" ? "Stop" : "Restart"} all managed instances in preset group ${prefix}?`,
        )
      ) {
        setControlState("presets", prefix, {
          message: `${action === "stop" ? "Stop" : "Restart"} cancelled.`,
          tone: "error",
        });
        return;
      }
      const pendingVerb = action === "stop" ? "Stopping" : action === "start" ? "Starting" : "Restarting";
      setControlState("presets", prefix, {
        message: `${pendingVerb} preset...`,
        tone: "pending",
        pendingAction: action,
      });
      const data = await postJson(`/api/instance-presets/${encodeURIComponent(prefix)}/${action}`);
      const changedIds = data.result.instances.map((instance) => instance.id);
      const failureCount = data.result.failures.length;
      const pastTense = action === "stop" ? "stopped" : action === "start" ? "started" : "restarted";
      setControlState("presets", prefix, {
        message:
          failureCount > 0
            ? `${pastTense} ${changedIds.length} instances with ${failureCount} failures.`
            : `${pastTense} ${changedIds.length} instances successfully.`,
        tone: failureCount > 0 ? "error" : "success",
      });
      for (const instance of data.result.instances) {
        state.instanceControlState.instances[instance.id] = {
          message: `${pastTense} via preset ${prefix}.`,
          tone: failureCount > 0 ? "error" : "success",
        };
      }
      setInstanceFeedback(
        failureCount > 0
          ? `${pastTense} preset ${prefix}: ${changedIds.join(", ")} (${failureCount} failures)`
          : `${pastTense} preset ${prefix}: ${changedIds.join(", ")}`,
        failureCount > 0,
      );
      await refreshInstances();
      await refreshOperatorEvents();
    } catch (err) {
      setControlState("presets", prefix, {
        message: `Action failed: ${String(err)}`,
        tone: "error",
      });
      setInstanceFeedback(String(err), true);
    }
  }

  const views = createInstanceViewsController({
    state,
    timeline,
    statusCards,
    instancePresets: presets,
    compare,
    actions: {
      analyzeInstance,
      bulkMutatePreset,
      inspectInstance,
      mutateInstance,
      updateObserverTarget,
    },
  });

  async function refreshInstancePresets() {
    try {
      const data = await fetchJson("/api/instance-presets");
      presets.renderInstancePresets(data.presets || []);
      views.renderInstanceGroups(state.currentManagedInstances);
    } catch (err) {
      presets.renderInstancePresets([], `presets unavailable: ${String(err)}`);
      views.renderInstanceGroups(state.currentManagedInstances);
    }
  }

  async function refreshInstances() {
    try {
      const data = await fetchJson("/api/instances");
      state.currentManagedInstances = data.instances;
      clearStaleControlState(data.instances);
      views.renderInstanceList(data.instances);
      views.renderInstanceGroups(data.instances);
      timeline.populateOperatorEventFilters();
      timeline.applyOperatorEventFilters();
      statusCards.renderTargetStatusCard();
      if (state.selectedInstanceId) {
        const exists = data.instances.some((instance) => instance.id === state.selectedInstanceId);
        if (!exists) {
          state.selectedInstanceId = null;
          views.renderSelectedInstanceTimelineControls();
          setText("instance-detail", "Selected instance no longer exists.");
          setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
          setText("instance-analysis", INSTANCE_ANALYSIS_PLACEHOLDER);
          setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);
        }
      }
    } catch (err) {
      state.currentManagedInstances = [];
      state.selectedInstanceId = null;
      state.instanceControlState.instances = {};
      state.instanceControlState.presets = {};
      timeline.populateOperatorEventFilters();
      timeline.applyOperatorEventFilters();
      views.renderInstanceGroups([]);
      views.renderInstanceList([]);
      views.renderSelectedInstanceTimelineControls();
      setInstanceFeedback(`instance control unavailable: ${String(err)}`, true);
      statusCards.renderTargetStatusCard();
    }
  }

  return {
    analyzeInstance,
    applyInstancePreset,
    createInstance,
    inspectInstance,
    refreshInstanceCompare: compare.refreshInstanceCompare,
    refreshInstancePresets,
    refreshInstances,
    renderCompareTimelineControls: compare.renderCompareTimelineControls,
    renderInstancePresets: presets.renderInstancePresets,
    renderSelectedInstanceTimelineControls: views.renderSelectedInstanceTimelineControls,
    renderSelectedPresetHelp: presets.renderSelectedPresetHelp,
    setInstanceFeedback,
    updateObserverTarget,
  };
}
