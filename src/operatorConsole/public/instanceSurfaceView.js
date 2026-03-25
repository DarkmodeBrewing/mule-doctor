/* global document */

const UNLOADED_PUBLISH_NOTE =
  "Publish status is inferred from shared-file fields such as <code>keyword_publish_*</code>. A dedicated upstream publish-job API is not available.";
const LOADED_PUBLISH_NOTE =
  "Publish status is inferred from shared-file <code>keyword_publish_*</code> fields. Treat queued, failed, and acked values as file-level publish signals, not a complete active publish-job queue.";

export function createInstanceSurfaceView({
  state,
  statusCards,
  setText,
  getSelectedManagedInstance,
}) {
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

  function renderRuntimeSurface(snapshot) {
    const summaryElement = document.getElementById("instance-runtime-surface-summary");
    const publishNoteElement = document.getElementById("instance-runtime-publish-note");
    if (!snapshot?.detail) {
      summaryElement.textContent = "No structured runtime surface loaded.";
      summaryElement.className = "preset-help muted";
      publishNoteElement.innerHTML = UNLOADED_PUBLISH_NOTE;
      publishNoteElement.className = "preset-help muted";
      renderSurfaceList("instance-runtime-search-threads", [], () => "", "Runtime surface not loaded.");
      renderSurfaceList("instance-runtime-publish-files", [], () => "", "Runtime surface not loaded.");
      renderSurfaceList("instance-runtime-shared-actions", [], () => "", "Runtime surface not loaded.");
      renderSurfaceList("instance-runtime-downloads", [], () => "", "Runtime surface not loaded.");
      return;
    }

    const detail = snapshot.detail;
    const parts = [
      `Observed: ${new Date(snapshot.observedAt).toLocaleString()}`,
      `${detail.searches.length} search threads`,
      `${detail.sharedFiles.length} shared files`,
      `${detail.sharedActions.length} shared actions`,
      `${detail.downloads.length} downloads`,
    ];
    summaryElement.textContent = parts.join(" • ");
    summaryElement.className = "preset-help";
    publishNoteElement.innerHTML = LOADED_PUBLISH_NOTE;
    publishNoteElement.className = "preset-help";

    renderSurfaceList("instance-runtime-search-threads", detail.searches, (search) => ({
      title: search.label,
      meta: [
        `state ${search.state}`,
        typeof search.ageSecs === "number" ? `age ${formatAgeSeconds(search.ageSecs)}` : "",
        `${search.hits} hits`,
        search.wantSearch ? "wanted" : "",
        search.publishEnabled ? "publish enabled" : "",
        search.publishAcked ? "publish acked" : "",
        search.keywordIdHex ? `keyword ${search.keywordIdHex}` : "",
        search.searchId ? `search ${search.searchId}` : "",
      ].filter(Boolean),
    }));
    renderSurfaceList("instance-runtime-publish-files", detail.sharedFiles, (file) => ({
      title: file.fileName,
      meta: [
        file.localSourceCached ? "source cached" : "",
        file.keywordPublishQueued ? "publish queued" : "",
        file.keywordPublishFailed ? "publish failed" : "",
        file.keywordPublishAckedCount > 0 ? `${file.keywordPublishAckedCount} publish acks` : "",
        file.sourcePublishResponseReceived ? "source response received" : "",
        file.queuedDownloads > 0 ? `${file.queuedDownloads} queued downloads` : "",
        file.inflightDownloads > 0 ? `${file.inflightDownloads} inflight downloads` : "",
        file.queuedUploads > 0 ? `${file.queuedUploads} queued uploads` : "",
        file.inflightUploads > 0 ? `${file.inflightUploads} inflight uploads` : "",
        typeof file.sizeBytes === "number" ? `${file.sizeBytes} bytes` : "",
        file.fileIdHex ? `file ${file.fileIdHex}` : "",
      ].filter(Boolean),
    }));
    renderSurfaceList("instance-runtime-shared-actions", detail.sharedActions, (action) => ({
      title: action.kind,
      meta: [
        `state ${action.state}`,
        action.fileName ? `file ${action.fileName}` : "",
        action.fileIdHex ? `id ${action.fileIdHex}` : "",
        action.error ? `error ${action.error}` : "",
      ].filter(Boolean),
    }));
    renderSurfaceList("instance-runtime-downloads", detail.downloads, (download) => ({
      title: download.fileName,
      meta: [
        `state ${download.state}`,
        typeof download.progressPct === "number" ? `${download.progressPct}%` : "",
        download.sourceCount > 0 ? `${download.sourceCount} sources` : "0 sources",
        download.lastError ? `error ${download.lastError}` : "",
        download.fileHashMd4Hex ? `hash ${download.fileHashMd4Hex}` : "",
      ].filter(Boolean),
    }));
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

  function resetSelectedInstanceOutputs(placeholders) {
    setText("instance-detail", placeholders.detail);
    setText("instance-diagnostics", placeholders.diagnostics);
    setText("instance-analysis", placeholders.analysis);
    setText("instance-logs", placeholders.logs);
    setText("instance-shared", placeholders.shared);
    setText("instance-discoverability-result", placeholders.discoverability);
    setText("instance-manual-search-result", placeholders.manualSearch);
    setText("instance-runtime-diagnostics", placeholders.runtimeDiagnostics);
    renderSharedSummary(undefined);
    renderDiscoverabilitySummary(undefined);
    renderRuntimeSurface(undefined);
    renderManualSearchSummary(undefined);
  }

  return {
    renderDiscoverabilityOptions,
    renderDiscoverabilitySummary,
    renderManualSearchSummary,
    renderRuntimeSurface,
    renderSharedSummary,
    renderSurfaceDiagnosticsHighlights,
    renderSurfaceDiagnosticsSummary,
    resetSelectedInstanceOutputs,
  };
}

function renderSurfaceList(elementId, items, formatter, emptyMessage = "None observed.") {
  const element = document.getElementById(elementId);
  element.replaceChildren();
  if (!Array.isArray(items) || items.length === 0) {
    element.textContent = emptyMessage;
    element.className = "surface-list muted";
    return;
  }
  element.className = "surface-list";
  for (const item of items) {
    const entry = formatter(item);
    const wrapper = document.createElement("div");
    wrapper.className = "surface-entry";
    const title = document.createElement("div");
    title.className = "surface-entry-title";
    title.textContent = entry.title;
    const meta = document.createElement("div");
    meta.className = "surface-entry-meta";
    meta.textContent = entry.meta.join(" • ");
    wrapper.append(title, meta);
    element.appendChild(wrapper);
  }
}

function formatAgeSeconds(ageSecs) {
  if (ageSecs < 60) {
    return `${ageSecs}s`;
  }
  const minutes = Math.floor(ageSecs / 60);
  const seconds = ageSecs % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatHighlightSection(label, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `${label}: none`;
  }
  return `${label}: ${items.join(" • ")}`;
}
