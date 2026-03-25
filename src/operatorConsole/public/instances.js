/* global document, window */

import {
  INSTANCE_ANALYSIS_PLACEHOLDER,
  INSTANCE_DISCOVERABILITY_PLACEHOLDER,
  INSTANCE_DIAGNOSTICS_PLACEHOLDER,
  INSTANCE_LOGS_PLACEHOLDER,
  INSTANCE_SHARED_PLACEHOLDER,
} from "./constants.js";
import { createInstanceCompareController } from "./instanceCompare.js";
import { createInstancePresetsController } from "./instancePresets.js";
import { createInstanceSurfaceView } from "./instanceSurfaceView.js";
import { createInstanceViewsController } from "./instanceViews.js";
import { createInstanceWorkflowActions } from "./instanceWorkflowActions.js";

export function createInstancesController({
  state,
  timeline,
  statusCards,
  setText,
  fetchJson,
  postJson,
  refreshOperatorEvents,
  refreshDiscoverabilityResults,
  refreshSearchHealthResults,
}) {
  const compare = createInstanceCompareController({ fetchJson, setText });
  const presets = createInstancePresetsController({ state });

  function confirmAction(message) {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(message);
    }
    return true;
  }

  function getSelectedManagedInstance() {
    if (!state.selectedInstanceId) {
      return undefined;
    }
    return state.currentManagedInstances.find((instance) => instance.id === state.selectedInstanceId);
  }

  function buildControlState(entry) {
    return {
      ...entry,
      updatedAt: entry.updatedAt || new Date().toISOString(),
    };
  }

  function setControlState(collection, key, entry) {
    state.instanceControlState[collection][key] = buildControlState(entry);
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

  function setSelectedSharedFeedback(text, isError = false) {
    const element = document.getElementById("selected-instance-shared-feedback");
    element.textContent = text;
    element.className = isError ? "status" : "muted";
  }

  function setSelectedDiscoverabilityFeedback(text, isError = false) {
    const element = document.getElementById("selected-instance-discoverability-feedback");
    element.textContent = text;
    element.className = isError ? "status" : "muted";
  }

  function setSelectedManualSearchFeedback(text, isError = false) {
    const element = document.getElementById("selected-instance-manual-search-feedback");
    element.textContent = text;
    element.className = isError ? "status" : "muted";
  }

  const renderers = createInstanceSurfaceView({
    state,
    statusCards,
    setText,
    getSelectedManagedInstance,
  });

  function renderSelectedControlAvailability() {
    const selected = getSelectedManagedInstance();
    const hasSelection = Boolean(selected);
    const pendingAction = selected
      ? state.instanceControlState.instances[selected.id]?.pendingAction
      : undefined;
    const disabled = !hasSelection || Boolean(pendingAction);
    const isScheduledTarget =
      selected &&
      state.currentScheduledTarget?.kind === "managed_instance" &&
      state.currentScheduledTarget.instanceId === selected.id;
    const meta = document.getElementById("selected-instance-meta");
    if (!selected) {
      meta.textContent = "Select a managed instance to inspect and operate it from this control pane.";
      meta.className = "preset-help muted";
    } else {
      const parts = [
        `${selected.id} (${selected.status})`,
        `${selected.apiHost}:${selected.apiPort}`,
        selected.currentProcess ? `pid ${selected.currentProcess.pid}` : "",
        selected.preset ? `preset ${selected.preset.prefix}/${selected.preset.presetId}` : "",
        isScheduledTarget ? "scheduled target" : "",
        selected.lastExit?.reason ? `last exit ${selected.lastExit.reason}` : "",
      ].filter(Boolean);
      meta.textContent = parts.join(" • ");
      meta.className = "preset-help";
    }
    document.getElementById("selected-instance-refresh").disabled = !hasSelection;
    document.getElementById("selected-instance-analyze").disabled = disabled;
    document.getElementById("selected-instance-use-target").disabled = disabled || Boolean(isScheduledTarget);
    document.getElementById("selected-instance-start").disabled = disabled || selected?.status === "running";
    document.getElementById("selected-instance-stop").disabled = disabled || selected?.status !== "running";
    document.getElementById("selected-instance-restart").disabled = disabled || selected?.status !== "running";

    const manualSearchMode = document.getElementById("manual-search-mode").value;
    const manualSearchDisabled =
      manualSearchMode === "managed_instance" ? !hasSelection || Boolean(pendingAction) : false;
    for (const id of [
      "selected-instance-refresh-shared",
      "selected-instance-create-fixture",
      "selected-instance-reindex",
      "selected-instance-republish-sources",
      "selected-instance-republish-keywords",
      "run-discoverability-check",
    ]) {
      document.getElementById(id).disabled = disabled;
    }
    document.getElementById("run-manual-search").disabled = manualSearchDisabled;
    renderers.renderManualSearchSummary(state.currentManualSearchResult);
  }

  let actions = null;
  async function refreshInstances() {
    try {
      const data = await fetchJson("/api/instances");
      state.currentManagedInstances = data.instances;
      clearStaleControlState(data.instances);
      renderers.renderDiscoverabilityOptions(data.instances);
      views.renderInstanceList(data.instances);
      views.renderInstanceGroups(data.instances);
      timeline.populateOperatorEventFilters();
      timeline.applyOperatorEventFilters();
      statusCards.renderTargetStatusCard();
      if (state.selectedInstanceId) {
        const exists = data.instances.some((instance) => instance.id === state.selectedInstanceId);
        if (!exists) {
          state.selectedInstanceId = null;
          state.currentManualSearchResult = null;
          views.renderSelectedInstanceTimelineControls();
          renderers.resetSelectedInstanceOutputs({
            analysis: INSTANCE_ANALYSIS_PLACEHOLDER,
            detail: "Selected instance no longer exists.",
            diagnostics: INSTANCE_DIAGNOSTICS_PLACEHOLDER,
            discoverability: INSTANCE_DISCOVERABILITY_PLACEHOLDER,
            logs: INSTANCE_LOGS_PLACEHOLDER,
            manualSearch: "Select a search target and provide a query or keyword ID.",
            runtimeDiagnostics: "No runtime diagnostics loaded.",
            shared: INSTANCE_SHARED_PLACEHOLDER,
          });
        }
      }
      renderSelectedControlAvailability();
    } catch (err) {
      state.currentManagedInstances = [];
      state.selectedInstanceId = null;
      state.currentManualSearchResult = null;
      state.instanceControlState.instances = {};
      state.instanceControlState.presets = {};
      timeline.populateOperatorEventFilters();
      timeline.applyOperatorEventFilters();
      views.renderInstanceGroups([]);
      views.renderInstanceList([]);
      views.renderSelectedInstanceTimelineControls();
      renderers.renderDiscoverabilityOptions([]);
      renderers.renderRuntimeSurface(undefined);
      renderSelectedControlAvailability();
      setInstanceFeedback(`instance control unavailable: ${String(err)}`, true);
      statusCards.renderTargetStatusCard();
    }
  }

  const views = createInstanceViewsController({
    state,
    timeline,
    statusCards,
    instancePresets: presets,
    compare,
    actions: {
      analyzeInstance: (...args) => actions.analyzeInstance(...args),
      bulkMutatePreset: (...args) => actions.bulkMutatePreset(...args),
      inspectInstance: (...args) => actions.inspectInstance(...args),
      mutateInstance: (...args) => actions.mutateInstance(...args),
      updateObserverTarget: (...args) => actions.updateObserverTarget(...args),
    },
  });

  actions = createInstanceWorkflowActions({
    state,
    statusCards,
    setText,
    fetchJson,
    postJson,
    refreshOperatorEvents,
    refreshDiscoverabilityResults,
    refreshSearchHealthResults,
    setControlState,
    setInstanceFeedback,
    setSelectedSharedFeedback,
    setSelectedDiscoverabilityFeedback,
    setSelectedManualSearchFeedback,
    confirmAction,
    renderSelectedControlAvailability,
    renderSelectedInstanceTimelineControls: views.renderSelectedInstanceTimelineControls,
    renderers,
    refreshInstances,
  });

  function renderControlState() {
    views.renderInstanceList(state.currentManagedInstances);
    views.renderInstanceGroups(state.currentManagedInstances);
    views.renderSelectedInstanceTimelineControls();
    renderSelectedControlAvailability();
  }

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

  return {
    ...actions,
    refreshInstanceCompare: compare.refreshInstanceCompare,
    renderCachedComparison: compare.renderCachedComparison,
    refreshInstancePresets,
    refreshInstances,
    renderSelectedControlAvailability,
    renderCompareTimelineControls: compare.renderCompareTimelineControls,
    renderInstancePresets: presets.renderInstancePresets,
    renderSelectedInstanceTimelineControls: views.renderSelectedInstanceTimelineControls,
    renderSelectedPresetHelp: presets.renderSelectedPresetHelp,
    setInstanceFeedback,
  };
}
