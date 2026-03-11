/* global document */

import {
  DEFAULT_OPERATOR_EVENT_VIEW,
  OPERATOR_EVENT_TYPE_OPTIONS,
  OPERATOR_EVENT_VIEW_LABELS,
  OPERATOR_EVENT_VIEW_PRESETS,
  OPERATOR_EVENT_VIEW_STATE_KEYS,
} from "./constants.js";

export function createTimelineController(state) {
  function shouldGroupOperatorEvents() {
    return document.getElementById("operator-event-grouping-toggle").checked;
  }

  function buildEventBadge(text, tone = "neutral") {
    const badge = document.createElement("span");
    badge.className = `event-badge ${tone}`;
    badge.textContent = text;
    return badge;
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
      const instance = state.currentManagedInstances.find((candidate) => candidate.id === target.instanceId);
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

  function buildOperatorEventGroups(events) {
    const groups = [];
    let current;
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

  function pruneExpandedOperatorEventGroups(groups) {
    const validIds = new Set(groups.map((group) => group.id));
    for (const id of state.expandedOperatorEventGroups) {
      if (!validIds.has(id)) {
        state.expandedOperatorEventGroups.delete(id);
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
    const expanded = state.expandedOperatorEventGroups.has(group.id);
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
      if (state.expandedOperatorEventGroups.has(group.id)) {
        state.expandedOperatorEventGroups.delete(group.id);
      } else {
        state.expandedOperatorEventGroups.add(group.id);
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
      : events
          .slice()
          .reverse()
          .map((event) => ({ id: buildOperatorEventGroupId([event]), events: [event] }));
    pruneExpandedOperatorEventGroups(groups);

    for (const group of groups) {
      if (group.events.length === 1) {
        list.appendChild(renderOperatorEventItem(group.events[0]));
        continue;
      }
      list.appendChild(renderOperatorEventGroup(group));
    }
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
    const { groups, standalone } = partitionInstances(state.currentManagedInstances);
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

  function detectOperatorTimelineViewLabel(currentState) {
    for (const [presetKey, label] of Object.entries(OPERATOR_EVENT_VIEW_LABELS)) {
      const preset = OPERATOR_EVENT_VIEW_PRESETS[presetKey];
      if (!preset) {
        continue;
      }
      const matches = OPERATOR_EVENT_VIEW_STATE_KEYS.every((key) => currentState[key] === preset[key]);
      if (matches) {
        return label;
      }
    }
    return "Custom";
  }

  function renderOperatorTimelineContext({
    groupFilter,
    instanceFilter,
    typeFilter,
    signalFilters,
  }) {
    const element = document.getElementById("operator-timeline-context");
    const parts = [];
    const viewLabel = detectOperatorTimelineViewLabel({
      grouping: document.getElementById("operator-event-grouping-toggle").checked,
      signalTargets: signalFilters.has("targets"),
      signalRuns: signalFilters.has("runs"),
      signalFailures: signalFilters.has("failures"),
      eventType: typeFilter,
    });

    parts.push(`View ${viewLabel}`);
    if (groupFilter) {
      parts.push(`group ${groupFilter}`);
    }
    if (instanceFilter) {
      parts.push(`instance ${instanceFilter}`);
    }
    if (typeFilter) {
      const option = OPERATOR_EVENT_TYPE_OPTIONS.find((candidate) => candidate.value === typeFilter);
      parts.push(`type ${option?.label || typeFilter}`);
    }
    if (!groupFilter && !instanceFilter && !typeFilter && signalFilters.size === 0) {
      parts.push("all scopes");
    }

    element.textContent = `Timeline context: ${parts.join(" • ")}`;
  }

  function applyOperatorEventFilters() {
    const groupFilter = document.getElementById("operator-event-group-filter").value;
    const instanceFilter = document.getElementById("operator-event-instance-filter").value;
    const typeFilter = document.getElementById("operator-event-type-filter").value;
    const signalFilters = getSelectedOperatorEventSignals();
    const filtered = state.currentOperatorEvents.filter((event) => {
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
        const instance = state.currentManagedInstances.find((candidate) => candidate.id === instanceId);
        if (instance?.preset?.prefix !== groupFilter) {
          return false;
        }
      }
      return true;
    });
    renderOperatorTimelineContext({
      groupFilter,
      instanceFilter,
      typeFilter,
      signalFilters,
    });
    renderOperatorEvents(filtered);
  }

  function applyOperatorEventViewState(name, overrides = {}) {
    const preset = OPERATOR_EVENT_VIEW_PRESETS[name];
    if (!preset) {
      return;
    }
    const currentState = { ...preset, ...overrides };
    document.getElementById("operator-event-grouping-toggle").checked = currentState.grouping;
    document.getElementById("operator-event-signal-targets").checked = currentState.signalTargets;
    document.getElementById("operator-event-signal-runs").checked = currentState.signalRuns;
    document.getElementById("operator-event-signal-failures").checked = currentState.signalFailures;
    document.getElementById("operator-event-type-filter").value = currentState.eventType;
    document.getElementById("operator-event-group-filter").value = currentState.groupFilter;
    document.getElementById("operator-event-instance-filter").value = currentState.instanceFilter;
    applyOperatorEventFilters();
  }

  function applyOperatorEventViewPreset(name) {
    applyOperatorEventViewState(name);
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
    const instance = state.currentManagedInstances.find((candidate) => candidate.id === instanceId);
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

  return {
    applyOperatorEventFilters,
    applyOperatorEventViewPreset,
    focusOperatorTimeline,
    focusOperatorTimelineForGroup,
    focusOperatorTimelineForInstance,
    focusOperatorTimelineForTarget,
    partitionInstances,
    populateOperatorEventFilters,
    renderOperatorEvents,
  };
}
