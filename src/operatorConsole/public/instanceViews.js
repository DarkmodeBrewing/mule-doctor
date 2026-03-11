/* global document */

export function createInstanceViewsController({
  state,
  timeline,
  statusCards,
  instancePresets,
  compare,
  actions,
}) {
  function buildGroupStat(label, value) {
    const chip = document.createElement("span");
    chip.className = "group-stat";
    chip.textContent = `${label} ${value}`;
    return chip;
  }

  function renderSelectedInstanceTimelineControls() {
    const eventsButton = document.getElementById("view-selected-instance-events");
    const failuresButton = document.getElementById("view-selected-instance-failures");
    const hasSelectedInstance =
      typeof state.selectedInstanceId === "string" && state.selectedInstanceId.length > 0;
    eventsButton.disabled = !hasSelectedInstance;
    failuresButton.disabled = !hasSelectedInstance;
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
    inspect.onclick = () => actions.inspectInstance(instance.id);
    analyze.onclick = () => actions.analyzeInstance(instance.id);
    useAsTarget.onclick = () =>
      actions.updateObserverTarget({ kind: "managed_instance", instanceId: instance.id });
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
      const compareButton = document.createElement("button");
      const events = document.createElement("button");
      const failures = document.createElement("button");
      const runningCount = group.instances.filter((instance) => instance.status === "running").length;
      const plannedCount = group.instances.filter((instance) => instance.status === "planned").length;
      const stoppedCount = group.instances.filter((instance) => instance.status === "stopped").length;
      const failedInstances = group.instances.filter((instance) => instance.status === "failed");
      const preset = instancePresets.lookupPresetDefinition(group.presetId);

      wrapper.className = "group-card";
      header.className = "instance-header";
      controls.className = "controls";
      stats.className = "group-stats";
      members.className = "group-members";
      title.textContent = `${group.prefix} (${preset?.name || group.presetId})`;
      meta.className = "file-meta";
      meta.textContent = preset
        ? `${instancePresets.formatPresetSummary(preset)} • ${preset.description}`
        : `${group.instances.length} instances`;
      start.textContent = "Start preset";
      stop.textContent = "Stop preset";
      restart.textContent = "Restart preset";
      compareButton.textContent = "Compare group";
      events.textContent = "View group events";
      failures.textContent = "View group failures";
      start.onclick = () => actions.bulkMutatePreset(group.prefix, "start");
      stop.onclick = () => actions.bulkMutatePreset(group.prefix, "stop");
      restart.onclick = () => actions.bulkMutatePreset(group.prefix, "restart");
      compareButton.onclick = () => compare.comparePresetGroup(group.instances);
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
        compareButton.disabled = true;
      }

      stats.appendChild(buildGroupStat("running", runningCount));
      stats.appendChild(buildGroupStat("planned", plannedCount));
      stats.appendChild(buildGroupStat("stopped", stoppedCount));
      stats.appendChild(buildGroupStat("failed", failedInstances.length));

      header.appendChild(title);
      controls.appendChild(start);
      controls.appendChild(stop);
      controls.appendChild(restart);
      controls.appendChild(compareButton);
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

  function renderInstanceList(instances) {
    compare.renderComparisonSelectors(instances);
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

      inspect.onclick = () => actions.inspectInstance(instance.id);
      analyze.onclick = () => actions.analyzeInstance(instance.id);
      useAsTarget.onclick = () =>
        actions.updateObserverTarget({ kind: "managed_instance", instanceId: instance.id });
      events.onclick = () => timeline.focusOperatorTimelineForInstance(instance.id, { view: "all" });
      failures.onclick = () =>
        timeline.focusOperatorTimelineForInstance(instance.id, { view: "failures" });
      start.onclick = () => actions.mutateInstance(instance.id, "start");
      stop.onclick = () => actions.mutateInstance(instance.id, "stop");
      restart.onclick = () => actions.mutateInstance(instance.id, "restart");

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

  return {
    renderInstanceGroups,
    renderInstanceList,
    renderSelectedInstanceTimelineControls,
  };
}
