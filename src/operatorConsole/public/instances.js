/* global document */

import {
  INSTANCE_ANALYSIS_PLACEHOLDER,
  INSTANCE_DIAGNOSTICS_PLACEHOLDER,
  INSTANCE_LOGS_PLACEHOLDER,
  INSTANCE_PRESET_HELP_PLACEHOLDER,
  LOG_LINE_LIMIT,
} from "./constants.js";

export function createInstancesController({
  state,
  timeline,
  statusCards,
  setText,
  fetchJson,
  postJson,
  refreshOperatorEvents,
}) {
  function lookupPresetDefinition(presetId) {
    return state.currentInstancePresets.find((candidate) => candidate.id === presetId) || null;
  }

  function formatPresetSummary(preset) {
    const nodeLabels = preset.nodes.map((node) => node.suffix).join(", ");
    const nodeCount = preset.nodes.length;
    return `${nodeCount} ${nodeCount === 1 ? "node" : "nodes"} • layout ${nodeLabels}`;
  }

  function buildGroupStat(label, value) {
    const chip = document.createElement("span");
    chip.className = "group-stat";
    chip.textContent = `${label} ${value}`;
    return chip;
  }

  function setInstanceFeedback(text, isError = false) {
    const element = document.getElementById("instance-feedback");
    element.textContent = text;
    element.className = isError ? "status" : "muted";
  }

  function renderSelectedInstanceTimelineControls() {
    const eventsButton = document.getElementById("view-selected-instance-events");
    const failuresButton = document.getElementById("view-selected-instance-failures");
    const hasSelectedInstance =
      typeof state.selectedInstanceId === "string" && state.selectedInstanceId.length > 0;
    eventsButton.disabled = !hasSelectedInstance;
    failuresButton.disabled = !hasSelectedInstance;
  }

  function renderCompareTimelineControls() {
    const leftId = document.getElementById("compare-left").value;
    const rightId = document.getElementById("compare-right").value;
    document.getElementById("view-compare-left-events").disabled = !leftId;
    document.getElementById("view-compare-right-events").disabled = !rightId;
    document.getElementById("view-compare-left-failures").disabled = !leftId;
    document.getElementById("view-compare-right-failures").disabled = !rightId;
  }

  function buildGroupMember(instance) {
    const wrapper = document.createElement("div");
    const header = document.createElement("div");
    const title = document.createElement("strong");
    const controls = document.createElement("div");
    const meta = document.createElement("div");
    const inspect = document.createElement("button");
    const analyze = document.createElement("button");
    const useAsTarget = document.createElement("button");
    const events = document.createElement("button");
    const failures = document.createElement("button");

    wrapper.className = "group-member";
    header.className = "instance-header";
    controls.className = "controls";
    meta.className = "group-member-meta";
    title.textContent = `${instance.id} (${instance.status})`;
    meta.textContent = `${instance.apiHost}:${instance.apiPort}${instance.currentProcess ? ` • pid ${instance.currentProcess.pid}` : ""}${instance.lastExit?.reason ? ` • last exit ${instance.lastExit.reason}` : ""}`;

    inspect.textContent = "Inspect";
    analyze.textContent = "Analyze";
    useAsTarget.textContent = "Use as target";
    events.textContent = "View events";
    failures.textContent = "View failures";
    inspect.onclick = () => inspectInstance(instance.id);
    analyze.onclick = () => analyzeInstance(instance.id);
    useAsTarget.onclick = () =>
      updateObserverTarget({ kind: "managed_instance", instanceId: instance.id });
    events.onclick = () => timeline.focusOperatorTimelineForInstance(instance.id, { view: "all" });
    failures.onclick = () =>
      timeline.focusOperatorTimelineForInstance(instance.id, { view: "failures" });
    if (
      state.currentScheduledTarget?.kind === "managed_instance" &&
      state.currentScheduledTarget.instanceId === instance.id
    ) {
      useAsTarget.disabled = true;
    }

    header.appendChild(title);
    if (
      state.currentScheduledTarget?.kind === "managed_instance" &&
      state.currentScheduledTarget.instanceId === instance.id
    ) {
      const targetPill = document.createElement("span");
      targetPill.className = "pill target";
      targetPill.textContent = "scheduled target";
      header.appendChild(targetPill);
    }
    if (statusCards.isUnavailableObservedTarget({ kind: "managed_instance", instanceId: instance.id })) {
      const degradedPill = document.createElement("span");
      degradedPill.className = "pill degraded";
      degradedPill.textContent = "unavailable";
      header.appendChild(degradedPill);
    }
    controls.appendChild(inspect);
    controls.appendChild(analyze);
    controls.appendChild(useAsTarget);
    controls.appendChild(events);
    controls.appendChild(failures);
    wrapper.appendChild(header);
    wrapper.appendChild(meta);
    wrapper.appendChild(controls);
    return wrapper;
  }

  function renderInstanceGroups(instances) {
    const list = document.getElementById("instance-groups");
    list.replaceChildren();
    const { groups } = timeline.partitionInstances(instances);

    if (groups.length === 0) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = "No preset groups created yet.";
      list.appendChild(item);
      return;
    }

    for (const group of groups) {
      const item = document.createElement("li");
      const wrapper = document.createElement("div");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const controls = document.createElement("div");
      const stats = document.createElement("div");
      const members = document.createElement("div");
      const start = document.createElement("button");
      const stop = document.createElement("button");
      const restart = document.createElement("button");
      const compare = document.createElement("button");
      const events = document.createElement("button");
      const failures = document.createElement("button");
      const runningCount = group.instances.filter((instance) => instance.status === "running").length;
      const plannedCount = group.instances.filter((instance) => instance.status === "planned").length;
      const stoppedCount = group.instances.filter((instance) => instance.status === "stopped").length;
      const failedInstances = group.instances.filter((instance) => instance.status === "failed");
      const preset = lookupPresetDefinition(group.presetId);

      wrapper.className = "group-card";
      header.className = "instance-header";
      controls.className = "controls";
      stats.className = "group-stats";
      members.className = "group-members";
      title.textContent = `${group.prefix} (${preset?.name || group.presetId})`;
      meta.className = "file-meta";
      meta.textContent = preset
        ? `${formatPresetSummary(preset)} • ${preset.description}`
        : `${group.instances.length} instances`;
      start.textContent = "Start preset";
      stop.textContent = "Stop preset";
      restart.textContent = "Restart preset";
      compare.textContent = "Compare group";
      events.textContent = "View group events";
      failures.textContent = "View group failures";
      start.onclick = () => bulkMutatePreset(group.prefix, "start");
      stop.onclick = () => bulkMutatePreset(group.prefix, "stop");
      restart.onclick = () => bulkMutatePreset(group.prefix, "restart");
      compare.onclick = () => comparePresetGroup(group.instances);
      events.onclick = () => timeline.focusOperatorTimelineForGroup(group.prefix, { view: "all" });
      failures.onclick = () =>
        timeline.focusOperatorTimelineForGroup(group.prefix, { view: "failures" });
      if (runningCount === group.instances.length) {
        start.disabled = true;
      }
      if (runningCount === 0) {
        stop.disabled = true;
        restart.disabled = true;
      }
      if (group.instances.length < 2) {
        compare.disabled = true;
      }

      stats.appendChild(buildGroupStat("running", runningCount));
      stats.appendChild(buildGroupStat("planned", plannedCount));
      stats.appendChild(buildGroupStat("stopped", stoppedCount));
      stats.appendChild(buildGroupStat("failed", failedInstances.length));

      header.appendChild(title);
      controls.appendChild(start);
      controls.appendChild(stop);
      controls.appendChild(restart);
      controls.appendChild(compare);
      controls.appendChild(events);
      controls.appendChild(failures);
      wrapper.appendChild(header);
      wrapper.appendChild(meta);
      wrapper.appendChild(stats);
      if (failedInstances.length > 0) {
        const errorBanner = document.createElement("div");
        errorBanner.className = "error-banner";
        errorBanner.textContent = failedInstances
          .map((instance) => `${instance.id}: ${instance.lastError || "failed"}`)
          .join(" | ");
        wrapper.appendChild(errorBanner);
      }
      for (const instance of group.instances) {
        members.appendChild(buildGroupMember(instance));
      }
      wrapper.appendChild(members);
      wrapper.appendChild(controls);
      item.appendChild(wrapper);
      list.appendChild(item);
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

  function renderInstanceList(instances) {
    renderComparisonSelectors(instances);
    const ul = document.getElementById("instance-list");
    ul.replaceChildren();
    const { standalone } = timeline.partitionInstances(instances);
    if (!standalone.length) {
      const li = document.createElement("li");
      li.textContent = "No standalone managed instances.";
      li.className = "muted";
      ul.appendChild(li);
      return;
    }

    for (const instance of standalone) {
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
      const events = document.createElement("button");
      const failures = document.createElement("button");

      wrapper.className = "instance-entry";
      header.className = "instance-header";
      controls.className = "controls";
      title.textContent = `${instance.id} (${instance.status})`;
      meta.className = "file-meta";
      meta.textContent = `${instance.apiHost}:${instance.apiPort}${instance.currentProcess ? ` • pid ${instance.currentProcess.pid}` : ""}${instance.preset ? ` • preset ${instance.preset.prefix}/${instance.preset.presetId}` : ""}`;

      inspect.textContent = "Inspect";
      analyze.textContent = "Analyze";
      useAsTarget.textContent = "Use as target";
      events.textContent = "View events";
      failures.textContent = "View failures";
      start.textContent = "Start";
      stop.textContent = "Stop";
      restart.textContent = "Restart";

      inspect.onclick = () => inspectInstance(instance.id);
      analyze.onclick = () => analyzeInstance(instance.id);
      useAsTarget.onclick = () =>
        updateObserverTarget({ kind: "managed_instance", instanceId: instance.id });
      events.onclick = () => timeline.focusOperatorTimelineForInstance(instance.id, { view: "all" });
      failures.onclick = () =>
        timeline.focusOperatorTimelineForInstance(instance.id, { view: "failures" });
      start.onclick = () => mutateInstance(instance.id, "start");
      stop.onclick = () => mutateInstance(instance.id, "stop");
      restart.onclick = () => mutateInstance(instance.id, "restart");

      const scheduledTarget =
        state.currentScheduledTarget?.kind === "managed_instance" ? state.currentScheduledTarget : undefined;
      const instanceTarget = { kind: "managed_instance", instanceId: instance.id };
      const isScheduledTarget = statusCards.sameTarget(scheduledTarget, instanceTarget);
      const isUnavailableTarget =
        isScheduledTarget && statusCards.isUnavailableObservedTarget(instanceTarget);

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
      controls.appendChild(events);
      controls.appendChild(failures);
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
    renderCompareTimelineControls();
  }

  function renderInstancePresets(presets, errorText) {
    const select = document.getElementById("instance-preset-id");
    state.currentInstancePresets = presets.slice();
    select.replaceChildren();
    if (errorText) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = errorText;
      select.appendChild(option);
      select.disabled = true;
      renderSelectedPresetHelp(errorText);
      return;
    }
    if (!presets.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No presets available";
      select.appendChild(option);
      select.disabled = true;
      renderSelectedPresetHelp("No presets available.");
      return;
    }
    select.disabled = false;
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = `${preset.name} (${preset.nodes.length})`;
      select.appendChild(option);
    }
    renderSelectedPresetHelp();
  }

  function renderSelectedPresetHelp(message = "") {
    const element = document.getElementById("instance-preset-help");
    const select = document.getElementById("instance-preset-id");
    if (message) {
      element.textContent = message;
      return;
    }
    const preset = lookupPresetDefinition(select.value);
    if (!preset) {
      element.textContent = INSTANCE_PRESET_HELP_PLACEHOLDER;
      return;
    }

    const code = document.createElement("div");
    const title = document.createElement("strong");
    const summary = document.createElement("div");
    const description = document.createElement("div");
    code.className = "preset-help-code";
    code.textContent = preset.id;
    title.textContent = preset.name;
    summary.textContent = formatPresetSummary(preset);
    description.textContent = preset.description;
    element.replaceChildren(code, title, summary, description);
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
    renderCompareTimelineControls();
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

  async function inspectInstance(id) {
    state.selectedInstanceId = id;
    renderSelectedInstanceTimelineControls();
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
    setText("instance-analysis", "Running analysis...");
    try {
      const result = await postJson(`/api/instances/${encodeURIComponent(id)}/analyze`);
      setText("instance-analysis", result.analysis.summary || "(no analysis summary)");
      await inspectInstance(id);
    } catch (err) {
      setText("instance-analysis", `Failed to analyze instance: ${String(err)}`);
    }
  }

  async function updateObserverTarget(target) {
    try {
      const data = await postJson("/api/observer/target", target);
      state.currentScheduledTarget = data.target;
      setText("observer-target", statusCards.describeTarget(data.target));
      statusCards.renderTargetStatusCard();
      setInstanceFeedback(
        `diagnostic target updated to ${statusCards.describeTarget(data.target).replace("Active diagnostic target: ", "")}`,
      );
      await refreshInstances();
      await refreshOperatorEvents();
    } catch (err) {
      setInstanceFeedback(String(err), true);
    }
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

  async function applyInstancePreset(event) {
    event.preventDefault();
    const form = document.getElementById("instance-preset-form");
    const formData = new FormData(form);
    const presetId = String(formData.get("presetId") || "").trim();
    const prefix = String(formData.get("prefix") || "").trim();

    try {
      const data = await postJson("/api/instance-presets/apply", { presetId, prefix });
      setInstanceFeedback(
        `applied preset ${data.applied.presetId}: ${data.applied.instances.map((instance) => instance.id).join(", ")}`,
      );
      await refreshInstances();
    } catch (err) {
      setInstanceFeedback(String(err), true);
    }
  }

  async function bulkMutatePreset(prefix, action) {
    try {
      if (action !== "start" && action !== "stop" && action !== "restart") {
        throw new Error(`unsupported preset action: ${action}`);
      }
      const data = await postJson(`/api/instance-presets/${encodeURIComponent(prefix)}/${action}`);
      const changedIds = data.result.instances.map((instance) => instance.id);
      const failureCount = data.result.failures.length;
      const pastTense = action === "stop" ? "stopped" : action === "start" ? "started" : "restarted";
      setInstanceFeedback(
        failureCount > 0
          ? `${pastTense} preset ${prefix}: ${changedIds.join(", ")} (${failureCount} failures)`
          : `${pastTense} preset ${prefix}: ${changedIds.join(", ")}`,
        failureCount > 0,
      );
      await refreshInstances();
      await refreshOperatorEvents();
    } catch (err) {
      setInstanceFeedback(String(err), true);
    }
  }

  async function refreshInstancePresets() {
    try {
      const data = await fetchJson("/api/instance-presets");
      renderInstancePresets(data.presets || []);
      renderInstanceGroups(state.currentManagedInstances);
    } catch (err) {
      renderInstancePresets([], `presets unavailable: ${String(err)}`);
      renderInstanceGroups(state.currentManagedInstances);
    }
  }

  async function refreshInstances() {
    try {
      const data = await fetchJson("/api/instances");
      state.currentManagedInstances = data.instances;
      renderInstanceList(data.instances);
      renderInstanceGroups(data.instances);
      timeline.populateOperatorEventFilters();
      timeline.applyOperatorEventFilters();
      statusCards.renderTargetStatusCard();
      if (state.selectedInstanceId) {
        const exists = data.instances.some((instance) => instance.id === state.selectedInstanceId);
        if (!exists) {
          state.selectedInstanceId = null;
          renderSelectedInstanceTimelineControls();
          setText("instance-detail", "Selected instance no longer exists.");
          setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
          setText("instance-analysis", INSTANCE_ANALYSIS_PLACEHOLDER);
          setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);
        }
      }
    } catch (err) {
      state.currentManagedInstances = [];
      state.selectedInstanceId = null;
      timeline.populateOperatorEventFilters();
      timeline.applyOperatorEventFilters();
      renderInstanceGroups([]);
      renderInstanceList([]);
      renderSelectedInstanceTimelineControls();
      setInstanceFeedback(`instance control unavailable: ${String(err)}`, true);
      statusCards.renderTargetStatusCard();
    }
  }

  return {
    analyzeInstance,
    applyInstancePreset,
    createInstance,
    inspectInstance,
    refreshInstanceCompare,
    refreshInstancePresets,
    refreshInstances,
    renderCompareTimelineControls,
    renderInstancePresets,
    renderSelectedInstanceTimelineControls,
    renderSelectedPresetHelp,
    setInstanceFeedback,
    updateObserverTarget,
  };
}
