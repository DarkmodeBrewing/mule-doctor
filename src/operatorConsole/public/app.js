/* global document, EventSource, window */

const LOG_LINE_LIMIT = 250;
const INSTANCE_DETAIL_PLACEHOLDER = "Select an instance to inspect details.";
const INSTANCE_DIAGNOSTICS_PLACEHOLDER =
  "Select an instance to inspect diagnostics for that managed rust-mule node.";
const INSTANCE_ANALYSIS_PLACEHOLDER =
  "Run on-demand analysis for the selected managed instance.";
const INSTANCE_LOGS_PLACEHOLDER = "Select an instance to inspect per-instance rust-mule logs.";
const OBSERVER_TARGET_PLACEHOLDER = "Loading active diagnostic target...";
const INSTANCE_PRESET_PLACEHOLDER = "Loading instance presets...";
const INSTANCE_PRESET_HELP_PLACEHOLDER = "Select a preset to inspect its layout and intended use.";
const OPERATOR_EVENT_TYPE_OPTIONS = [
  { value: "", label: "All event types" },
  { value: "diagnostic_target_changed", label: "Target changes" },
  { value: "observer_run_requested", label: "Run requests" },
  { value: "observer_cycle_started", label: "Cycle starts" },
  { value: "observer_cycle_completed", label: "Cycle outcomes" },
];
const OPERATOR_EVENT_VIEW_PRESETS = {
  all: {
    grouping: true,
    signalTargets: false,
    signalRuns: false,
    signalFailures: false,
    eventType: "",
    groupFilter: "",
    instanceFilter: "",
  },
  failures: {
    grouping: true,
    signalTargets: false,
    signalRuns: false,
    signalFailures: true,
    eventType: "",
    groupFilter: "",
    instanceFilter: "",
  },
  targeting: {
    grouping: true,
    signalTargets: true,
    signalRuns: false,
    signalFailures: false,
    eventType: "",
    groupFilter: "",
    instanceFilter: "",
  },
  runs: {
    grouping: false,
    signalTargets: false,
    signalRuns: true,
    signalFailures: false,
    eventType: "",
    groupFilter: "",
    instanceFilter: "",
  },
};
const DEFAULT_OPERATOR_EVENT_VIEW = "all";
let selectedInstanceId = null;
let currentObserver = null;
let currentScheduledTarget = null;
let currentScheduler = null;
let currentManagedInstances = [];
let currentOperatorEvents = [];
let currentInstancePresets = [];
const expandedOperatorEventGroups = new Set();

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

  const groups = shouldGroupOperatorEvents()
    ? buildOperatorEventGroups(events.slice().reverse())
    : events.slice().reverse().map((event) => ({ id: buildOperatorEventGroupId([event]), events: [event] }));
  pruneExpandedOperatorEventGroups(groups);

  for (const group of groups) {
    if (group.events.length === 1) {
      list.appendChild(renderOperatorEventItem(group.events[0]));
      continue;
    }
    list.appendChild(renderOperatorEventGroup(group));
  }
}

function shouldGroupOperatorEvents() {
  return document.getElementById("operator-event-grouping-toggle").checked;
}

function buildOperatorEventGroups(events) {
  const groups = [];
  let current = undefined;
  for (const event of events) {
    const summary = summarizeOperatorEvent(event);
    if (!current || !sameOperatorEventGroup(current.summary, summary)) {
      if (current) {
        groups.push(current);
      }
      current = {
        id: "",
        summary,
        events: [event],
      };
      continue;
    }
    current.events.push(event);
  }
  if (current) {
    groups.push(current);
  }
  return groups.map((group) => ({
    ...group,
    id: buildOperatorEventGroupId(group.events),
  }));
}

function sameOperatorEventGroup(left, right) {
  return (
    left.title === right.title &&
    left.summary === right.summary &&
    left.targetLabel === right.targetLabel &&
    left.outcomeLabel === right.outcomeLabel &&
    left.actorLabel === right.actorLabel
  );
}

function buildOperatorEventGroupId(events) {
  const oldest = events[events.length - 1];
  const summary = summarizeOperatorEvent(oldest);
  return `${oldest.type}:${oldest.timestamp}:${summary.targetLabel}:${summary.outcomeLabel}:${summary.actorLabel}`;
}

function pruneExpandedOperatorEventGroups(groups) {
  const validIds = new Set(groups.map((group) => group.id));
  for (const id of expandedOperatorEventGroups) {
    if (!validIds.has(id)) {
      expandedOperatorEventGroups.delete(id);
    }
  }
}

function renderOperatorEventGroup(group) {
  const item = document.createElement("li");
  const header = document.createElement("div");
  const title = document.createElement("strong");
  const badges = document.createElement("div");
  const meta = document.createElement("span");
  const body = document.createElement("div");
  const toggle = document.createElement("button");
  const detail = document.createElement("div");
  const expanded = expandedOperatorEventGroups.has(group.id);
  const newest = group.events[0];
  const oldest = group.events[group.events.length - 1];

  item.className = "event-group";
  header.className = "event-line";
  badges.className = "event-badges";
  body.className = "file-meta";
  detail.className = "event-group-detail";
  title.textContent = group.summary.title;
  meta.className = "event-meta";
  meta.textContent = `${new Date(oldest.timestamp).toLocaleString()} to ${new Date(newest.timestamp).toLocaleString()}`;
  body.textContent = `${group.events.length} related events • ${group.summary.summary}`;
  toggle.className = "event-toggle";
  toggle.textContent = expanded ? "Collapse" : "Expand";
  toggle.onclick = () => {
    if (expandedOperatorEventGroups.has(group.id)) {
      expandedOperatorEventGroups.delete(group.id);
    } else {
      expandedOperatorEventGroups.add(group.id);
    }
    applyOperatorEventFilters();
  };

  header.appendChild(title);
  badges.appendChild(buildEventBadge(`${group.events.length}x`, "neutral"));
  appendOperatorEventBadges(badges, group.summary);
  header.appendChild(badges);
  header.appendChild(meta);
  item.appendChild(header);
  item.appendChild(body);
  item.appendChild(toggle);
  if (expanded) {
    for (const event of group.events) {
      detail.appendChild(renderOperatorEventItem(event, true));
    }
    item.appendChild(detail);
  }
  return item;
}

function renderOperatorEventItem(event, compact = false) {
  const item = document.createElement(compact ? "div" : "li");
  const header = document.createElement("div");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  const badges = document.createElement("div");
  const body = document.createElement("div");
  const detail = document.createElement("div");
  const summary = summarizeOperatorEvent(event);
  header.className = "event-line";
  badges.className = "event-badges";
  body.className = "file-meta";
  detail.className = "event-detail";
  if (compact) {
    item.className = "event-entry";
  }
  title.textContent = summary.title;
  meta.className = "event-meta";
  meta.textContent = new Date(event.timestamp).toLocaleString();
  body.textContent = summary.summary;
  detail.textContent = event.message;
  header.appendChild(title);
  appendOperatorEventBadges(badges, summary);
  if (badges.childNodes.length > 0) {
    header.appendChild(badges);
  }
  header.appendChild(meta);
  item.appendChild(header);
  item.appendChild(body);
  if (detail.textContent && detail.textContent !== body.textContent) {
    item.appendChild(detail);
  }
  return item;
}

function appendOperatorEventBadges(badges, summary) {
  if (summary.targetLabel) {
    badges.appendChild(buildEventBadge(summary.targetLabel, summary.targetTone));
  }
  if (summary.outcomeLabel) {
    badges.appendChild(buildEventBadge(summary.outcomeLabel, summary.outcomeTone));
  }
  if (summary.actorLabel) {
    badges.appendChild(buildEventBadge(summary.actorLabel, "neutral"));
  }
}

function summarizeOperatorEvent(event) {
  const target = describeEventTarget(event.target);
  if (event.type === "diagnostic_target_changed") {
    return {
      title: "Target changed",
      summary: target.summary ? `Active diagnostic target is now ${target.summary}.` : event.message,
      targetLabel: target.badge,
      targetTone: target.tone,
      actorLabel: event.actor === "operator_console" ? "operator" : event.actor || "",
      outcomeLabel: "",
      outcomeTone: "neutral",
    };
  }
  if (event.type === "observer_run_requested") {
    return {
      title: "Run requested",
      summary: target.summary
        ? `Operator requested an immediate observer cycle for ${target.summary}.`
        : event.message,
      targetLabel: target.badge,
      targetTone: target.tone,
      actorLabel: event.actor === "operator_console" ? "operator" : event.actor || "",
      outcomeLabel: "",
      outcomeTone: "neutral",
    };
  }
  if (event.type === "observer_cycle_started") {
    return {
      title: "Cycle started",
      summary: target.summary ? `Observer cycle started for ${target.summary}.` : event.message,
      targetLabel: target.badge,
      targetTone: target.tone,
      actorLabel: "",
      outcomeLabel: "",
      outcomeTone: "neutral",
    };
  }
  if (event.type === "observer_cycle_completed") {
    return {
      title: cycleOutcomeTitle(event.outcome),
      summary: cycleOutcomeSummary(event.outcome, target.summary, event.message),
      targetLabel: target.badge,
      targetTone: target.tone,
      actorLabel: "",
      outcomeLabel: event.outcome || "",
      outcomeTone: cycleOutcomeTone(event.outcome),
    };
  }
  return {
    title: event.type,
    summary: event.message,
    targetLabel: target.badge,
    targetTone: target.tone,
    actorLabel: event.actor || "",
    outcomeLabel: event.outcome || "",
    outcomeTone: cycleOutcomeTone(event.outcome),
  };
}

function describeEventTarget(target) {
  if (!target) {
    return {
      summary: "",
      badge: "",
      tone: "neutral",
    };
  }
  if (target.kind === "external") {
    return {
      summary: "external target",
      badge: "external",
      tone: "external",
    };
  }
  if (target.kind === "managed_instance") {
    const instance = currentManagedInstances.find((candidate) => candidate.id === target.instanceId);
    const group = instance?.preset?.prefix;
    return {
      summary: group ? `instance ${target.instanceId} in group ${group}` : `instance ${target.instanceId}`,
      badge: group ? `${group}/${target.instanceId}` : target.instanceId,
      tone: "instance",
    };
  }
  return {
    summary: String(target.kind),
    badge: String(target.kind),
    tone: "neutral",
  };
}

function cycleOutcomeTitle(outcome) {
  if (outcome === "success") return "Cycle succeeded";
  if (outcome === "unavailable") return "Target unavailable";
  if (outcome === "error") return "Cycle failed";
  return "Cycle completed";
}

function cycleOutcomeSummary(outcome, targetSummary, fallback) {
  if (outcome === "success") {
    return targetSummary ? `Observer cycle completed successfully for ${targetSummary}.` : fallback;
  }
  if (outcome === "unavailable") {
    return targetSummary ? `Observer could not reach ${targetSummary}.` : fallback;
  }
  if (outcome === "error") {
    return targetSummary ? `Observer cycle failed while processing ${targetSummary}.` : fallback;
  }
  return fallback;
}

function cycleOutcomeTone(outcome) {
  if (outcome === "success") return "success";
  if (outcome === "unavailable") return "warn";
  if (outcome === "error") return "error";
  return "neutral";
}

function buildEventBadge(text, tone = "neutral") {
  const badge = document.createElement("span");
  badge.className = `event-badge ${tone}`;
  badge.textContent = text;
  return badge;
}

function populateSelect(id, options, selectedValue = "") {
  const select = document.getElementById(id);
  select.replaceChildren();
  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    select.appendChild(option);
  }
  select.value = options.some((option) => option.value === selectedValue) ? selectedValue : "";
}

function populateOperatorEventFilters() {
  const { groups, standalone } = partitionInstances(currentManagedInstances);
  populateSelect(
    "operator-event-group-filter",
    [{ value: "", label: "All groups" }].concat(
      groups.map((group) => ({
        value: group.prefix,
        label: `${group.prefix} (${group.presetId})`,
      })),
    ),
    document.getElementById("operator-event-group-filter").value,
  );
  populateSelect(
    "operator-event-instance-filter",
    [{ value: "", label: "All instances" }].concat(
      groups
        .flatMap((group) => group.instances)
        .concat(standalone)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((instance) => ({
          value: instance.id,
          label: `${instance.id} (${instance.status})`,
        })),
    ),
    document.getElementById("operator-event-instance-filter").value,
  );
  populateSelect(
    "operator-event-type-filter",
    OPERATOR_EVENT_TYPE_OPTIONS,
    document.getElementById("operator-event-type-filter").value,
  );
}

function applyOperatorEventFilters() {
  const groupFilter = document.getElementById("operator-event-group-filter").value;
  const instanceFilter = document.getElementById("operator-event-instance-filter").value;
  const typeFilter = document.getElementById("operator-event-type-filter").value;
  const signalFilters = getSelectedOperatorEventSignals();
  const filtered = currentOperatorEvents.filter((event) => {
    if (typeFilter && event.type !== typeFilter) {
      return false;
    }
    if (signalFilters.size > 0 && !matchesSelectedOperatorEventSignals(event, signalFilters)) {
      return false;
    }
    if (instanceFilter) {
      if (event.target?.kind !== "managed_instance" || event.target.instanceId !== instanceFilter) {
        return false;
      }
    }
    if (groupFilter) {
      const instanceId = event.target?.kind === "managed_instance" ? event.target.instanceId : "";
      const instance = currentManagedInstances.find((candidate) => candidate.id === instanceId);
      if (instance?.preset?.prefix !== groupFilter) {
        return false;
      }
    }
    return true;
  });
  renderOperatorEvents(filtered);
}

function getSelectedOperatorEventSignals() {
  const selected = new Set();
  if (document.getElementById("operator-event-signal-targets").checked) {
    selected.add("targets");
  }
  if (document.getElementById("operator-event-signal-runs").checked) {
    selected.add("runs");
  }
  if (document.getElementById("operator-event-signal-failures").checked) {
    selected.add("failures");
  }
  return selected;
}

function applyOperatorEventViewPreset(name) {
  applyOperatorEventViewState(name);
}

function applyOperatorEventViewState(name, overrides = {}) {
  const preset = OPERATOR_EVENT_VIEW_PRESETS[name];
  if (!preset) {
    return;
  }
  const state = { ...preset, ...overrides };
  document.getElementById("operator-event-grouping-toggle").checked = state.grouping;
  document.getElementById("operator-event-signal-targets").checked = state.signalTargets;
  document.getElementById("operator-event-signal-runs").checked = state.signalRuns;
  document.getElementById("operator-event-signal-failures").checked = state.signalFailures;
  document.getElementById("operator-event-type-filter").value = state.eventType;
  document.getElementById("operator-event-group-filter").value = state.groupFilter;
  document.getElementById("operator-event-instance-filter").value = state.instanceFilter;
  applyOperatorEventFilters();
}

function matchesSelectedOperatorEventSignals(event, selectedSignals) {
  const matchesTargets = event.type === "diagnostic_target_changed";
  const matchesRuns = event.type === "observer_run_requested";
  const matchesFailures =
    (event.type === "observer_cycle_completed" &&
      (event.outcome === "error" || event.outcome === "unavailable")) ||
    /failed|unavailable/i.test(event.message);
  return (
    (selectedSignals.has("targets") && matchesTargets) ||
    (selectedSignals.has("runs") && matchesRuns) ||
    (selectedSignals.has("failures") && matchesFailures)
  );
}

function partitionInstances(instances) {
  const groups = new Map();
  const standalone = [];
  for (const instance of instances) {
    if (!instance.preset?.prefix) {
      standalone.push(instance);
      continue;
    }
    const key = instance.preset.prefix;
    const existing = groups.get(key) || {
      prefix: key,
      presetId: instance.preset.presetId,
      instances: [],
    };
    existing.instances.push(instance);
    groups.set(key, existing);
  }

  return {
    groups: Array.from(groups.values()).sort((left, right) => left.prefix.localeCompare(right.prefix)),
    standalone,
  };
}

function formatPresetSummary(preset) {
  const nodeLabels = preset.nodes.map((node) => node.suffix).join(", ");
  const nodeCount = preset.nodes.length;
  return `${nodeCount} ${nodeCount === 1 ? "node" : "nodes"} • layout ${nodeLabels}`;
}

function lookupPresetDefinition(presetId) {
  return currentInstancePresets.find((candidate) => candidate.id === presetId) || null;
}

function renderInstanceGroups(instances) {
  const list = document.getElementById("instance-groups");
  list.replaceChildren();
  const { groups } = partitionInstances(instances);

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
    events.onclick = () => focusOperatorTimelineForGroup(group.prefix, { view: "all" });
    failures.onclick = () => focusOperatorTimelineForGroup(group.prefix, { view: "failures" });
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
  await refreshInstanceCompare();
}

function buildGroupStat(label, value) {
  const chip = document.createElement("span");
  chip.className = "group-stat";
  chip.textContent = `${label} ${value}`;
  return chip;
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
  events.onclick = () => focusOperatorTimelineForInstance(instance.id, { view: "all" });
  failures.onclick = () => focusOperatorTimelineForInstance(instance.id, { view: "failures" });
  if (
    currentScheduledTarget?.kind === "managed_instance" &&
    currentScheduledTarget.instanceId === instance.id
  ) {
    useAsTarget.disabled = true;
  }

  header.appendChild(title);
  if (
    currentScheduledTarget?.kind === "managed_instance" &&
    currentScheduledTarget.instanceId === instance.id
  ) {
    const targetPill = document.createElement("span");
    targetPill.className = "pill target";
    targetPill.textContent = "scheduled target";
    header.appendChild(targetPill);
  }
  if (isUnavailableObservedTarget({ kind: "managed_instance", instanceId: instance.id })) {
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

function scrollToOperatorTimeline() {
  const element = document.getElementById("operator-timeline-card");
  if (element && typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function focusOperatorTimeline(config = {}) {
  const view = config.view || DEFAULT_OPERATOR_EVENT_VIEW;
  applyOperatorEventViewState(view, {
    groupFilter: config.groupFilter ?? "",
    instanceFilter: config.instanceFilter ?? "",
  });
  scrollToOperatorTimeline();
}

function focusOperatorTimelineForGroup(prefix, options = {}) {
  focusOperatorTimeline({
    view: options.view,
    groupFilter: prefix,
    instanceFilter: "",
  });
}

function focusOperatorTimelineForInstance(instanceId, options = {}) {
  const instance = currentManagedInstances.find((candidate) => candidate.id === instanceId);
  focusOperatorTimeline({
    view: options.view,
    instanceFilter: instanceId,
    groupFilter: instance?.preset?.prefix || "",
  });
}

function focusOperatorTimelineForTarget(target, options = {}) {
  if (!target || target.kind === "external") {
    focusOperatorTimeline({
      view: options.view || "targeting",
      groupFilter: "",
      instanceFilter: "",
    });
    return;
  }
  focusOperatorTimelineForInstance(target.instanceId, {
    view: options.view || "targeting",
  });
}

function renderSelectedInstanceTimelineControls() {
  const eventsButton = document.getElementById("view-selected-instance-events");
  const failuresButton = document.getElementById("view-selected-instance-failures");
  const hasSelectedInstance = typeof selectedInstanceId === "string" && selectedInstanceId.length > 0;
  eventsButton.disabled = !hasSelectedInstance;
  failuresButton.disabled = !hasSelectedInstance;
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
  const { standalone } = partitionInstances(instances);
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
    events.onclick = () => focusOperatorTimelineForInstance(instance.id, { view: "all" });
    failures.onclick = () => focusOperatorTimelineForInstance(instance.id, { view: "failures" });
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

function renderCompareTimelineControls() {
  const leftId = document.getElementById("compare-left").value;
  const rightId = document.getElementById("compare-right").value;
  document.getElementById("view-compare-left-events").disabled = !leftId;
  document.getElementById("view-compare-right-events").disabled = !rightId;
  document.getElementById("view-compare-left-failures").disabled = !leftId;
  document.getElementById("view-compare-right-failures").disabled = !rightId;
}

function renderInstancePresets(presets, errorText) {
  const select = document.getElementById("instance-preset-id");
  currentInstancePresets = presets.slice();
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
    currentOperatorEvents = data.events || [];
    applyOperatorEventFilters();
  } catch (err) {
    renderOperatorEvents([], `Failed to load operator events: ${String(err)}`);
  }
}

async function refreshInstancePresets() {
  try {
    const data = await fetchJson("/api/instance-presets");
    renderInstancePresets(data.presets || []);
    renderInstanceGroups(currentManagedInstances);
  } catch (err) {
    renderInstancePresets([], `presets unavailable: ${String(err)}`);
    renderInstanceGroups(currentManagedInstances);
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
    currentManagedInstances = data.instances;
    renderInstanceList(data.instances);
    renderInstanceGroups(data.instances);
    populateOperatorEventFilters();
    applyOperatorEventFilters();
    renderTargetStatusCard();
    if (selectedInstanceId) {
      const exists = data.instances.some((instance) => instance.id === selectedInstanceId);
      if (!exists) {
        selectedInstanceId = null;
        renderSelectedInstanceTimelineControls();
        setText("instance-detail", "Selected instance no longer exists.");
        setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
        setText("instance-analysis", INSTANCE_ANALYSIS_PLACEHOLDER);
        setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);
      }
    }
  } catch (err) {
    currentManagedInstances = [];
    selectedInstanceId = null;
    populateOperatorEventFilters();
    applyOperatorEventFilters();
    renderInstanceGroups([]);
    renderInstanceList([]);
    renderSelectedInstanceTimelineControls();
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

async function inspectInstance(id) {
  selectedInstanceId = id;
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
  selectedInstanceId = id;
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

setText("instance-detail", INSTANCE_DETAIL_PLACEHOLDER);
setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
setText("instance-analysis", INSTANCE_ANALYSIS_PLACEHOLDER);
setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);
setText("observer-target", OBSERVER_TARGET_PLACEHOLDER);
renderInstancePresets([], INSTANCE_PRESET_PLACEHOLDER);
setText("instance-compare", "Select two managed instances to compare.");
renderTargetStatusCard();
renderSchedulerStatusCard();
renderOperatorEvents([]);
populateOperatorEventFilters();
renderSelectedInstanceTimelineControls();
renderCompareTimelineControls();

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
      refreshInstancePresets(),
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
document.getElementById("compare-left").onchange = renderCompareTimelineControls;
document.getElementById("compare-right").onchange = renderCompareTimelineControls;
document.getElementById("refresh-target-status").onclick = refreshHealth;
document.getElementById("refresh-scheduler-status").onclick = refreshHealth;
document.getElementById("refresh-operator-events").onclick = refreshOperatorEvents;
document.getElementById("view-target-events").onclick = () => {
  focusOperatorTimelineForTarget(currentScheduledTarget, { view: "targeting" });
};
document.getElementById("view-scheduler-runs").onclick = () => {
  focusOperatorTimeline({ view: "runs" });
};
document.getElementById("view-scheduler-failures").onclick = () => {
  focusOperatorTimeline({ view: "failures" });
};
document.getElementById("view-selected-instance-events").onclick = () => {
  if (selectedInstanceId) {
    focusOperatorTimelineForInstance(selectedInstanceId, { view: "all" });
  }
};
document.getElementById("view-selected-instance-failures").onclick = () => {
  if (selectedInstanceId) {
    focusOperatorTimelineForInstance(selectedInstanceId, { view: "failures" });
  }
};
document.getElementById("view-compare-left-events").onclick = () => {
  const leftId = document.getElementById("compare-left").value;
  if (leftId) {
    focusOperatorTimelineForInstance(leftId, { view: "all" });
  }
};
document.getElementById("view-compare-right-events").onclick = () => {
  const rightId = document.getElementById("compare-right").value;
  if (rightId) {
    focusOperatorTimelineForInstance(rightId, { view: "all" });
  }
};
document.getElementById("view-compare-left-failures").onclick = () => {
  const leftId = document.getElementById("compare-left").value;
  if (leftId) {
    focusOperatorTimelineForInstance(leftId, { view: "failures" });
  }
};
document.getElementById("view-compare-right-failures").onclick = () => {
  const rightId = document.getElementById("compare-right").value;
  if (rightId) {
    focusOperatorTimelineForInstance(rightId, { view: "failures" });
  }
};
document.getElementById("operator-view-all").onclick = () => applyOperatorEventViewPreset("all");
document.getElementById("operator-view-failures").onclick = () =>
  applyOperatorEventViewPreset("failures");
document.getElementById("operator-view-targeting").onclick = () =>
  applyOperatorEventViewPreset("targeting");
document.getElementById("operator-view-runs").onclick = () => applyOperatorEventViewPreset("runs");
document.getElementById("operator-event-group-filter").onchange = applyOperatorEventFilters;
document.getElementById("operator-event-instance-filter").onchange = applyOperatorEventFilters;
document.getElementById("operator-event-type-filter").onchange = applyOperatorEventFilters;
document.getElementById("operator-event-signal-targets").onchange = applyOperatorEventFilters;
document.getElementById("operator-event-signal-runs").onchange = applyOperatorEventFilters;
document.getElementById("operator-event-signal-failures").onchange = applyOperatorEventFilters;
document.getElementById("operator-event-grouping-toggle").onchange = applyOperatorEventFilters;
document.getElementById("instance-preset-id").onchange = renderSelectedPresetHelp;
document.getElementById("run-instance-compare").onclick = () => {
  void refreshInstanceCompare();
};
document.getElementById("run-observer-now").onclick = () => {
  void runObserverNow();
};
document.getElementById("instance-create-form").onsubmit = createInstance;
document.getElementById("instance-preset-form").onsubmit = applyInstancePreset;
document.getElementById("use-external-target").onclick = () => {
  void updateObserverTarget({ kind: "external" });
};

refreshAll().finally(() => {
  connectStream(`/api/stream/app?lines=${LOG_LINE_LIMIT}`, "app-logs", "app-stream-status");
  connectStream(`/api/stream/rust-mule?lines=${LOG_LINE_LIMIT}`, "rust-logs", "rust-stream-status");
});
