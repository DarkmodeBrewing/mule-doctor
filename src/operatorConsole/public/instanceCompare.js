/* global document */

export function createInstanceCompareController({ fetchJson, setText }) {
  function renderEmptySurface(elementId, message) {
    const element = document.getElementById(elementId);
    element.replaceChildren();
    element.textContent = message;
    element.className = "surface-list muted";
  }

  function renderSurfaceEntries(elementId, entries) {
    const element = document.getElementById(elementId);
    element.replaceChildren();
    if (!entries.length) {
      element.textContent = "No matching runtime surface entries.";
      element.className = "surface-list muted";
      return;
    }
    element.className = "surface-list";
    for (const entry of entries) {
      const wrapper = document.createElement("div");
      wrapper.className = "surface-entry";
      const title = document.createElement("div");
      title.className = "surface-entry-title";
      title.textContent = entry.title;
      const meta = document.createElement("div");
      meta.className = "surface-entry-meta";
      meta.textContent = entry.meta;
      wrapper.append(title, meta);
      element.appendChild(wrapper);
    }
  }

  function formatAgeSeconds(ageSecs) {
    if (typeof ageSecs !== "number") {
      return "";
    }
    if (ageSecs < 60) {
      return `${ageSecs}s`;
    }
    const minutes = Math.floor(ageSecs / 60);
    const seconds = ageSecs % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  function isSearchThreadVisible(search, stateFilter, publishOnly) {
    const state = typeof search.state === "string" ? search.state.toLowerCase() : "unknown";
    const active = state !== "completed" && state !== "complete" && state !== "done" && state !== "timed_out";
    if (stateFilter === "active" && !active) {
      return false;
    }
    if (stateFilter !== "all" && stateFilter !== "active" && state !== stateFilter) {
      return false;
    }
    if (publishOnly && !(search.publishEnabled || search.publishAcked)) {
      return false;
    }
    return true;
  }

  function summarizeRuntimeSurface(snapshot, filters) {
    const detail = snapshot?.detail;
    if (!detail) {
      return {
        summary: "Runtime surface unavailable.",
        entries: [],
      };
    }
    const visibleSearches = detail.searches.filter((search) =>
      isSearchThreadVisible(search, filters.stateFilter, filters.publishOnly),
    );
    const searchEntries = visibleSearches.map((search) => ({
      title: search.label,
      meta: [
        `state ${search.state}`,
        typeof search.ageSecs === "number" ? `age ${formatAgeSeconds(search.ageSecs)}` : "",
        `${search.hits} hits`,
        search.publishEnabled ? "publish enabled" : "",
        search.publishAcked ? "publish acked" : "",
        search.searchId ? `search ${search.searchId}` : "",
      ]
        .filter((value) => value)
        .join(" • "),
    }));
    const publishFiles = detail.sharedFiles.filter(
      (file) =>
        !filters.publishOnly ||
        file.keywordPublishQueued ||
        file.keywordPublishFailed ||
        file.keywordPublishAckedCount > 0,
    );
    for (const file of publishFiles.slice(0, 4)) {
      searchEntries.push({
        title: `publish ${file.fileName}`,
        meta: [
          file.keywordPublishQueued ? "queued" : "",
          file.keywordPublishFailed ? "failed" : "",
          file.keywordPublishAckedCount > 0 ? `${file.keywordPublishAckedCount} acks` : "",
          file.sourcePublishResponseReceived ? "source response received" : "",
        ]
          .filter((value) => value)
          .join(" • "),
      });
    }
    const runningActions = detail.sharedActions.slice(0, 2).map((action) => `${action.kind}:${action.state}`);
    const activeDownloads = detail.downloads
      .filter((download) => download.state !== "completed" && download.state !== "failed")
      .length;
    return {
      summary: [
        `${visibleSearches.length}/${detail.searches.length} searches shown`,
        `${publishFiles.length}/${detail.sharedFiles.length} publish entries shown`,
        `${activeDownloads} active downloads`,
        runningActions.length > 0 ? `actions ${runningActions.join(", ")}` : "",
      ]
        .filter((value) => value)
        .join(" • "),
      entries: searchEntries.slice(0, 8),
    };
  }

  function renderComparisonSurfaces(left, right, filters) {
    if (!left || !right) {
      document.getElementById("instance-compare-summary").textContent =
        "Compare current runtime surface state across two managed instances.";
      document.getElementById("instance-compare-summary").className = "preset-help muted";
      renderEmptySurface("instance-compare-left-surface", "Select two managed instances to compare.");
      renderEmptySurface("instance-compare-right-surface", "Select two managed instances to compare.");
      return;
    }
    const leftSummary = summarizeRuntimeSurface(left, filters);
    const rightSummary = summarizeRuntimeSurface(right, filters);
    const summaryElement = document.getElementById("instance-compare-summary");
    summaryElement.textContent = [
      `${left.instanceId}: ${leftSummary.summary}`,
      `${right.instanceId}: ${rightSummary.summary}`,
    ].join(" | ");
    summaryElement.className = "preset-help";
    renderSurfaceEntries("instance-compare-left-surface", leftSummary.entries);
    renderSurfaceEntries("instance-compare-right-surface", rightSummary.entries);
  }

  function renderCompareTimelineControls() {
    const leftId = document.getElementById("compare-left").value;
    const rightId = document.getElementById("compare-right").value;
    document.getElementById("view-compare-left-events").disabled = !leftId;
    document.getElementById("view-compare-right-events").disabled = !rightId;
    document.getElementById("view-compare-left-failures").disabled = !leftId;
    document.getElementById("view-compare-right-failures").disabled = !rightId;
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
    renderCompareTimelineControls();
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

  async function refreshInstanceCompare() {
    const left = document.getElementById("compare-left").value;
    const right = document.getElementById("compare-right").value;
    const stateFilter = document.getElementById("compare-search-state").value;
    const publishOnly = document.getElementById("compare-publish-only").checked;
    renderCompareTimelineControls();
    if (!left || !right) {
      setText("instance-compare", "Select two managed instances to compare.");
      renderComparisonSurfaces(undefined, undefined, { stateFilter, publishOnly });
      return;
    }
    try {
      const [data, leftSurface, rightSurface] = await Promise.all([
        fetchJson(`/api/instances/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`),
        fetchJson(`/api/instances/${encodeURIComponent(left)}/runtime_surface`),
        fetchJson(`/api/instances/${encodeURIComponent(right)}/runtime_surface`),
      ]);
      renderComparisonSurfaces(leftSurface.diagnostics, rightSurface.diagnostics, {
        stateFilter,
        publishOnly,
      });
      setText(
        "instance-compare",
        JSON.stringify(
          {
            comparedAt: new Date().toISOString(),
            left: summarizeComparisonSide(data.comparison.left),
            right: summarizeComparisonSide(data.comparison.right),
            filters: {
              stateFilter,
              publishOnly,
            },
          },
          null,
          2,
        ),
      );
    } catch (err) {
      renderComparisonSurfaces(undefined, undefined, { stateFilter, publishOnly });
      setText("instance-compare", `Failed to compare instances: ${String(err)}`);
    }
  }

  async function comparePresetGroup(instances) {
    const candidates = instances
      .map((instance) => instance.id)
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    if (candidates.length < 2) {
      setText("instance-compare", "Need at least two instances in the preset group to compare.");
      return;
    }

    const left = document.getElementById("compare-left");
    const right = document.getElementById("compare-right");
    left.value = candidates[0];
    right.value = candidates[1];
    renderCompareTimelineControls();
    await refreshInstanceCompare();
  }

  return {
    comparePresetGroup,
    refreshInstanceCompare,
    renderComparisonSelectors,
    renderCompareTimelineControls,
  };
}
