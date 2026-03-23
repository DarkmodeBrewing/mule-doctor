/* global document, window */

import {
  INSTANCE_ANALYSIS_PLACEHOLDER,
  INSTANCE_DISCOVERABILITY_PLACEHOLDER,
  INSTANCE_DIAGNOSTICS_PLACEHOLDER,
  INSTANCE_LOGS_PLACEHOLDER,
  INSTANCE_SHARED_PLACEHOLDER,
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

  function renderControlState() {
    views.renderInstanceList(state.currentManagedInstances);
    views.renderInstanceGroups(state.currentManagedInstances);
    views.renderSelectedInstanceTimelineControls();
    renderSelectedControlAvailability();
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

  function renderSurfaceDiagnosticsSummary(diagnostics) {
    const element = document.getElementById("instance-runtime-summary");
    const summary = diagnostics?.summary;
    if (!summary) {
      element.textContent = "No runtime surface summary loaded.";
      element.className = "preset-help muted";
      return;
    }

    const parts = [
      `Observed: ${new Date(diagnostics.observedAt).toLocaleString()}`,
      `Searches: ${summary.searches.totalSearches} total, ${summary.searches.activeSearches} active, ready=${summary.searches.ready ? "yes" : "no"}`,
      `Publish: queued=${summary.sharedLibrary.keywordPublishQueuedCount}, failed=${summary.sharedLibrary.keywordPublishFailedCount}, acked=${summary.sharedLibrary.keywordPublishAckedCount}`,
      `Shared files: ${summary.sharedLibrary.totalFiles}`,
      `Downloads: ${summary.downloads.totalDownloads} total, ${summary.downloads.activeDownloads} active, errors=${summary.downloads.downloadsWithErrors}`,
    ];
    element.textContent = parts.join(" • ");
    element.className = "preset-help";
  }

  function renderSurfaceDiagnosticsHighlights(diagnostics) {
    const element = document.getElementById("instance-runtime-highlights");
    const highlights = diagnostics?.highlights;
    if (!highlights) {
      element.textContent = "No runtime surface highlights loaded.";
      element.className = "preset-help muted";
      return;
    }

    const sections = [
      formatHighlightSection("Searches", highlights.searches),
      formatHighlightSection("Shared actions", highlights.sharedActions),
      formatHighlightSection("Downloads", highlights.downloads),
    ];
    element.textContent = sections.join(" | ");
    element.className = "preset-help";
  }

  function formatHighlightSection(label, items) {
    if (!Array.isArray(items) || items.length === 0) {
      return `${label}: none`;
    }
    return `${label}: ${items.join(" • ")}`;
  }

  function renderSharedSummary(shared) {
    const element = document.getElementById("selected-instance-shared-summary");
    if (!shared) {
      element.textContent = "No shared-content overview loaded.";
      element.className = "preset-help muted";
      return;
    }

    const parts = [
      `Instance: ${shared.instanceId}`,
      `${shared.files?.length ?? 0} shared files`,
      `${shared.actions?.length ?? 0} shared actions`,
      `${shared.downloads?.length ?? 0} downloads`,
    ];
    const firstFile = shared.files?.[0]?.identity?.file_name;
    if (firstFile) {
      parts.push(`Sample file: ${firstFile}`);
    }
    element.textContent = parts.join(" • ");
    element.className = "preset-help";
  }

  function renderDiscoverabilitySummary(result) {
    const element = document.getElementById("selected-instance-discoverability-summary");
    if (!result) {
      element.textContent = "No discoverability result loaded.";
      element.className = "preset-help muted";
      return;
    }

    const parts = [
      `${result.publisherInstanceId} -> ${result.searcherInstanceId}`,
      `Outcome: ${result.outcome}`,
      `Results: ${result.resultCount}`,
      `Search ID: ${result.searchId}`,
    ];
    if (result.fixture?.fileName) {
      parts.push(`Fixture: ${result.fixture.fileName}`);
    }
    element.textContent = parts.join(" • ");
    element.className = "preset-help";
  }

  function renderManualSearchSummary(result) {
    const element = document.getElementById("selected-instance-manual-search-summary");
    const mode = document.getElementById("manual-search-mode").value;
    const selected = getSelectedManagedInstance();
    const activeTargetLabel = statusCards.targetLabel(state.currentScheduledTarget || { kind: "external" });
    if (!result) {
      element.textContent =
        mode === "active_target"
          ? `Manual search will launch against ${activeTargetLabel}.`
          : selected
            ? `Manual search will launch against ${selected.id}.`
            : "Select a managed instance or switch to the active diagnostic target.";
      element.className = "preset-help muted";
      return;
    }

    const parts = [
      `Target: ${result.targetLabel}`,
      `Search ID: ${result.searchId}`,
      `Query: ${result.query}`,
      `Dispatched: ${new Date(result.dispatchedAt).toLocaleString()}`,
    ];
    element.textContent = parts.join(" • ");
    element.className = "preset-help";
  }

  function renderDiscoverabilityOptions(instances) {
    const publisher = document.getElementById("discoverability-publisher");
    const searcher = document.getElementById("discoverability-searcher");
    const previousPublisher = publisher.value;
    const previousSearcher = searcher.value;
    const candidates = instances.filter((instance) => typeof instance.id === "string");

    publisher.replaceChildren();
    searcher.replaceChildren();

    if (!candidates.length) {
      for (const select of [publisher, searcher]) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No managed instances available";
        select.appendChild(option);
        select.disabled = true;
      }
      return;
    }

    publisher.disabled = false;
    searcher.disabled = false;
    for (const instance of candidates) {
      const label = `${instance.id} (${instance.status})`;
      for (const select of [publisher, searcher]) {
        const option = document.createElement("option");
        option.value = instance.id;
        option.textContent = label;
        select.appendChild(option);
      }
    }

    const selectedId = state.selectedInstanceId;
    publisher.value =
      candidates.some((instance) => instance.id === previousPublisher)
        ? previousPublisher
        : selectedId && candidates.some((instance) => instance.id === selectedId)
          ? selectedId
          : candidates[0].id;
    const defaultSearcher = candidates.find((instance) => instance.id !== publisher.value)?.id;
    searcher.value =
      candidates.some((instance) => instance.id === previousSearcher)
        ? previousSearcher
        : defaultSearcher ?? candidates[0].id;
  }

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
      ].filter((part) => Boolean(part));
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
    renderManualSearchSummary(undefined);
  }

  async function loadSelectedInstanceShared(id) {
    const response = await fetchJson(`/api/instances/${encodeURIComponent(id)}/shared`);
    renderSharedSummary(response.shared);
    setText("instance-shared", JSON.stringify(response.shared, null, 2));
    return response.shared;
  }

  async function inspectInstance(id) {
    state.selectedInstanceId = id;
    views.renderSelectedInstanceTimelineControls();
    renderSelectedControlAvailability();
    try {
      const surfaceDiagnostics = await fetchJson(
        `/api/instances/${encodeURIComponent(id)}/surface_diagnostics`,
      );
      renderSurfaceDiagnosticsSummary(surfaceDiagnostics.diagnostics);
      renderSurfaceDiagnosticsHighlights(surfaceDiagnostics.diagnostics);
      setText("instance-runtime-diagnostics", JSON.stringify(surfaceDiagnostics.diagnostics, null, 2));
    } catch (err) {
      const summaryElement = document.getElementById("instance-runtime-summary");
      summaryElement.textContent = `Failed to load runtime surface summary: ${String(err)}`;
      summaryElement.className = "preset-help muted";
      const highlightsElement = document.getElementById("instance-runtime-highlights");
      highlightsElement.textContent = `Failed to load runtime surface highlights: ${String(err)}`;
      highlightsElement.className = "preset-help muted";
      setText("instance-runtime-diagnostics", `Failed to load runtime diagnostics: ${String(err)}`);
    }
    try {
      await loadSelectedInstanceShared(id);
    } catch (err) {
      renderSharedSummary(undefined);
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
    views.renderSelectedInstanceTimelineControls();
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
      renderDiscoverabilitySummary(undefined);
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
    const publisherInstanceId = document.getElementById("discoverability-publisher").value;
    const searcherInstanceId = document.getElementById("discoverability-searcher").value;
    const fixtureId = String(document.getElementById("discoverability-fixture-id").value || "").trim();
    const timeoutMsRaw = String(document.getElementById("discoverability-timeout-ms").value || "").trim();
    const pollIntervalMsRaw = String(document.getElementById("discoverability-poll-ms").value || "").trim();
    const payload = {
      publisherInstanceId,
      searcherInstanceId,
    };
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
      renderDiscoverabilitySummary(result.result);
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
      renderDiscoverabilityOptions(state.currentManagedInstances);
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
      renderManualSearchSummary(result.result);
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
      renderDiscoverabilityOptions(data.instances);
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
          setText("instance-shared", INSTANCE_SHARED_PLACEHOLDER);
          setText("instance-discoverability-result", INSTANCE_DISCOVERABILITY_PLACEHOLDER);
          setText("instance-manual-search-result", "Select a search target and provide a query or keyword ID.");
          renderSharedSummary(undefined);
          renderDiscoverabilitySummary(undefined);
        }
      }
      renderSelectedControlAvailability();
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
      renderDiscoverabilityOptions([]);
      renderSelectedControlAvailability();
      setInstanceFeedback(`instance control unavailable: ${String(err)}`, true);
      statusCards.renderTargetStatusCard();
    }
  }

  return {
    analyzeSelectedInstance,
    analyzeInstance,
    applyInstancePreset,
    createInstance,
    createSelectedInstanceFixture,
    inspectInstance,
    mutateSelectedInstanceShared,
    mutateSelectedInstance,
    refreshInstanceCompare: compare.refreshInstanceCompare,
    refreshDiscoverabilityViews,
    refreshInstancePresets,
    refreshInstances,
    refreshSelectedInstance,
    refreshSelectedInstanceShared,
    renderSelectedControlAvailability,
    renderCompareTimelineControls: compare.renderCompareTimelineControls,
    renderInstancePresets: presets.renderInstancePresets,
    renderSelectedInstanceTimelineControls: views.renderSelectedInstanceTimelineControls,
    renderSelectedPresetHelp: presets.renderSelectedPresetHelp,
    runDiscoverabilityCheck,
    runManualSearch,
    setInstanceFeedback,
    updateObserverTarget,
    useSelectedInstanceAsTarget,
  };
}
