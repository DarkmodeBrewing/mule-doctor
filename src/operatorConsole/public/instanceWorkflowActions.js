/* global document */

import { LOG_LINE_LIMIT } from "./constants.js";

export function createInstanceWorkflowActions({
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
  renderSelectedInstanceTimelineControls,
  renderers,
  refreshInstances,
}) {
  async function loadSelectedInstanceShared(id) {
    const response = await fetchJson(`/api/instances/${encodeURIComponent(id)}/shared`);
    renderers.renderSharedSummary(response.shared);
    setText("instance-shared", JSON.stringify(response.shared, null, 2));
    return response.shared;
  }

  async function inspectInstance(id) {
    state.selectedInstanceId = id;
    state.currentManualSearchResult = null;
    renderSelectedInstanceTimelineControls();
    renderSelectedControlAvailability();
    try {
      const runtimeSurface = await fetchJson(`/api/instances/${encodeURIComponent(id)}/runtime_surface`);
      renderers.renderSurfaceDiagnosticsSummary(runtimeSurface.diagnostics);
      renderers.renderSurfaceDiagnosticsHighlights(runtimeSurface.diagnostics);
      renderers.renderRuntimeSurface(runtimeSurface.diagnostics);
      setText("instance-runtime-diagnostics", JSON.stringify(runtimeSurface.diagnostics, null, 2));
    } catch (err) {
      const summaryElement = document.getElementById("instance-runtime-summary");
      summaryElement.textContent = `Failed to load runtime surface summary: ${String(err)}`;
      summaryElement.className = "preset-help muted";
      const highlightsElement = document.getElementById("instance-runtime-highlights");
      highlightsElement.textContent = `Failed to load runtime surface highlights: ${String(err)}`;
      highlightsElement.className = "preset-help muted";
      renderers.renderRuntimeSurface(undefined);
      const runtimeSurfaceElement = document.getElementById("instance-runtime-surface-summary");
      runtimeSurfaceElement.textContent = `Failed to load structured runtime surface: ${String(err)}`;
      runtimeSurfaceElement.className = "preset-help muted";
      setText("instance-runtime-diagnostics", `Failed to load runtime diagnostics: ${String(err)}`);
    }
    try {
      await loadSelectedInstanceShared(id);
    } catch (err) {
      renderers.renderSharedSummary(undefined);
      setText("instance-shared", `Failed to load shared-content overview: ${String(err)}`);
    }
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
    renderSelectedInstanceTimelineControls();
    renderSelectedControlAvailability();
    setControlState("instances", id, {
      message: "Analysis in progress...",
      tone: "pending",
      actionLabel: "Analyze",
      outcome: "pending",
    });
    setText("instance-analysis", "Running analysis...");
    try {
      const result = await postJson(`/api/instances/${encodeURIComponent(id)}/analyze`);
      setText("instance-analysis", result.analysis.summary || "(no analysis summary)");
      setControlState("instances", id, {
        message: "Analysis completed.",
        tone: "success",
        actionLabel: "Analyze",
        outcome: "applied",
      });
      await inspectInstance(id);
    } catch (err) {
      setControlState("instances", id, {
        message: `Analysis failed: ${String(err)}`,
        tone: "error",
        actionLabel: "Analyze",
        outcome: "failed",
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

  async function refreshSelectedInstance() {
    if (!state.selectedInstanceId) {
      setInstanceFeedback("Select an instance first.", true);
      return;
    }
    await inspectInstance(state.selectedInstanceId);
  }

  async function analyzeSelectedInstance() {
    if (!state.selectedInstanceId) {
      setInstanceFeedback("Select an instance first.", true);
      return;
    }
    await analyzeInstance(state.selectedInstanceId);
  }

  async function useSelectedInstanceAsTarget() {
    if (!state.selectedInstanceId) {
      setInstanceFeedback("Select an instance first.", true);
      return;
    }
    await updateObserverTarget({ kind: "managed_instance", instanceId: state.selectedInstanceId });
  }

  async function mutateInstance(id, action) {
    try {
      if (
        action === "restart" &&
        !confirmAction(`Restart managed instance ${id}? This will interrupt its current process.`)
      ) {
        setControlState("instances", id, {
          message: "Restart cancelled.",
          tone: "neutral",
          actionLabel: "Restart",
          outcome: "cancelled",
        });
        return;
      }
      const pendingVerb = action === "stop" ? "Stopping" : action === "start" ? "Starting" : "Restarting";
      const pastTense = action === "stop" ? "stopped" : action === "start" ? "started" : "restarted";
      setControlState("instances", id, {
        message: `${pendingVerb} instance...`,
        tone: "pending",
        pendingAction: action,
        actionLabel: action[0].toUpperCase() + action.slice(1),
        outcome: "pending",
      });
      const data = await postJson(`/api/instances/${encodeURIComponent(id)}/${action}`);
      setControlState("instances", data.instance.id, {
        message: `${pastTense} successfully.`,
        tone: "success",
        actionLabel: action[0].toUpperCase() + action.slice(1),
        outcome: "applied",
      });
      setInstanceFeedback(`${pastTense} instance ${data.instance.id}`);
      await refreshInstances();
      await inspectInstance(data.instance.id);
    } catch (err) {
      setControlState("instances", id, {
        message: `Action failed: ${String(err)}`,
        tone: "error",
        actionLabel: action[0].toUpperCase() + action.slice(1),
        outcome: "failed",
      });
      setInstanceFeedback(String(err), true);
    }
  }

  async function mutateSelectedInstance(action) {
    if (!state.selectedInstanceId) {
      setInstanceFeedback("Select an instance first.", true);
      return;
    }
    await mutateInstance(state.selectedInstanceId, action);
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
        actionLabel: "Create",
        outcome: "applied",
      });
      setInstanceFeedback(`created planned instance ${data.instance.id}`);
      await refreshInstances();
      await inspectInstance(data.instance.id);
    } catch (err) {
      setInstanceFeedback(String(err), true);
    }
  }

  async function refreshSelectedInstanceShared() {
    if (!state.selectedInstanceId) {
      setSelectedSharedFeedback("Select an instance first.", true);
      return;
    }
    try {
      await loadSelectedInstanceShared(state.selectedInstanceId);
      setSelectedSharedFeedback(`loaded shared-content overview for ${state.selectedInstanceId}`);
    } catch (err) {
      setSelectedSharedFeedback(String(err), true);
    }
  }

  async function createSelectedInstanceFixture() {
    if (!state.selectedInstanceId) {
      setSelectedSharedFeedback("Select an instance first.", true);
      return;
    }
    const fixtureInput = document.getElementById("discoverability-fixture-id");
    const fixtureId = String(fixtureInput.value || "").trim();
    try {
      const result = await postJson(
        `/api/instances/${encodeURIComponent(state.selectedInstanceId)}/shared/fixtures`,
        fixtureId ? { fixtureId } : {},
      );
      setSelectedSharedFeedback(
        `created fixture ${result.fixture.fileName} for ${state.selectedInstanceId}`,
      );
      await loadSelectedInstanceShared(state.selectedInstanceId);
      setText("instance-discoverability-result", JSON.stringify(result.fixture, null, 2));
      renderers.renderDiscoverabilitySummary(undefined);
      await refreshOperatorEvents();
    } catch (err) {
      setSelectedSharedFeedback(String(err), true);
    }
  }

  async function mutateSelectedInstanceShared(action) {
    if (!state.selectedInstanceId) {
      setSelectedSharedFeedback("Select an instance first.", true);
      return;
    }
    try {
      const result = await postJson(
        `/api/instances/${encodeURIComponent(state.selectedInstanceId)}/shared/${action}`,
      );
      await loadSelectedInstanceShared(state.selectedInstanceId);
      setText("instance-shared", JSON.stringify(result.shared, null, 2));
      setSelectedSharedFeedback(`${action} completed for ${state.selectedInstanceId}`);
      await refreshOperatorEvents();
    } catch (err) {
      setSelectedSharedFeedback(String(err), true);
    }
  }

  async function refreshDiscoverabilityViews() {
    try {
      await Promise.all([refreshDiscoverabilityResults(), refreshSearchHealthResults()]);
      setSelectedDiscoverabilityFeedback("discoverability and search-health views refreshed");
    } catch (err) {
      setSelectedDiscoverabilityFeedback(String(err), true);
    }
  }

  async function runDiscoverabilityCheck(event) {
    event.preventDefault();
    const runButton = document.getElementById("run-discoverability-check");
    const publisherSelect = document.getElementById("discoverability-publisher");
    const searcherSelect = document.getElementById("discoverability-searcher");
    const publisherInstanceId = publisherSelect.value;
    const searcherInstanceId = searcherSelect.value;
    const fixtureId = String(document.getElementById("discoverability-fixture-id").value || "").trim();
    const timeoutMsRaw = String(document.getElementById("discoverability-timeout-ms").value || "").trim();
    const pollIntervalMsRaw = String(document.getElementById("discoverability-poll-ms").value || "").trim();
    const payload = { publisherInstanceId, searcherInstanceId };
    if (fixtureId) {
      payload.fixtureId = fixtureId;
    }
    if (timeoutMsRaw) {
      payload.timeoutMs = Number(timeoutMsRaw);
    }
    if (pollIntervalMsRaw) {
      payload.pollIntervalMs = Number(pollIntervalMsRaw);
    }

    try {
      runButton.disabled = true;
      publisherSelect.disabled = true;
      searcherSelect.disabled = true;
      setSelectedDiscoverabilityFeedback("running controlled discoverability check...");
      const result = await postJson("/api/discoverability/check", payload);
      renderers.renderDiscoverabilitySummary(result.result);
      setText("instance-discoverability-result", JSON.stringify(result.result, null, 2));
      setSelectedDiscoverabilityFeedback(
        `discoverability outcome ${result.result.outcome} for ${publisherInstanceId} -> ${searcherInstanceId}`,
      );
      await Promise.all([
        refreshDiscoverabilityResults(),
        refreshSearchHealthResults(),
        refreshOperatorEvents(),
      ]);
      if (state.selectedInstanceId === publisherInstanceId || state.selectedInstanceId === searcherInstanceId) {
        await inspectInstance(state.selectedInstanceId);
      }
    } catch (err) {
      setSelectedDiscoverabilityFeedback(String(err), true);
      setText(
        "instance-discoverability-result",
        `Failed to run discoverability check: ${String(err)}`,
      );
    } finally {
      renderers.renderDiscoverabilityOptions(state.currentManagedInstances);
      renderSelectedControlAvailability();
    }
  }

  async function runManualSearch(event) {
    event.preventDefault();
    const runButton = document.getElementById("run-manual-search");
    const modeSelect = document.getElementById("manual-search-mode");
    const queryInput = document.getElementById("manual-search-query");
    const keywordIdInput = document.getElementById("manual-search-keyword-id");
    const mode = modeSelect.value === "active_target" ? "active_target" : "managed_instance";
    const query = String(queryInput.value || "").trim();
    const keywordIdHex = String(keywordIdInput.value || "").trim();

    if (!query && !keywordIdHex) {
      setSelectedManualSearchFeedback("Provide a query or keyword ID.", true);
      return;
    }
    if (mode === "managed_instance" && !state.selectedInstanceId) {
      setSelectedManualSearchFeedback(
        "Select an instance first or switch to the active diagnostic target.",
        true,
      );
      return;
    }

    const payload = { mode };
    if (mode === "managed_instance") {
      payload.instanceId = state.selectedInstanceId;
    }
    if (query) {
      payload.query = query;
    }
    if (keywordIdHex) {
      payload.keywordIdHex = keywordIdHex;
    }

    try {
      runButton.disabled = true;
      modeSelect.disabled = true;
      queryInput.disabled = true;
      keywordIdInput.disabled = true;
      setSelectedManualSearchFeedback("dispatching manual search...");
      const result = await postJson("/api/searches/launch", payload);
      state.currentManualSearchResult = result.result;
      renderers.renderManualSearchSummary(state.currentManualSearchResult);
      setText("instance-manual-search-result", JSON.stringify(result.result, null, 2));
      setSelectedManualSearchFeedback(`manual search dispatched against ${result.result.targetLabel}`);
      await Promise.all([refreshSearchHealthResults(), refreshOperatorEvents()]);
      if (mode === "managed_instance" && state.selectedInstanceId) {
        await inspectInstance(state.selectedInstanceId);
      }
    } catch (err) {
      setSelectedManualSearchFeedback(String(err), true);
      setText("instance-manual-search-result", `Failed to run manual search: ${String(err)}`);
    } finally {
      modeSelect.disabled = false;
      queryInput.disabled = false;
      keywordIdInput.disabled = false;
      renderSelectedControlAvailability();
    }
  }

  function handleManualSearchModeChange() {
    state.currentManualSearchResult = null;
    renderSelectedControlAvailability();
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
          actionLabel: "Create",
          outcome: "applied",
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
          tone: "neutral",
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
          actionLabel: action[0].toUpperCase() + action.slice(1),
          outcome: failureCount > 0 ? "failed" : "applied",
          updatedAt: new Date().toISOString(),
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

  return {
    analyzeInstance,
    analyzeSelectedInstance,
    applyInstancePreset,
    bulkMutatePreset,
    createInstance,
    createSelectedInstanceFixture,
    handleManualSearchModeChange,
    inspectInstance,
    mutateInstance,
    mutateSelectedInstance,
    mutateSelectedInstanceShared,
    refreshDiscoverabilityViews,
    refreshSelectedInstance,
    refreshSelectedInstanceShared,
    runDiscoverabilityCheck,
    runManualSearch,
    updateObserverTarget,
    useSelectedInstanceAsTarget,
  };
}
