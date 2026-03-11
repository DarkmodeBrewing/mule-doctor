/* global document */

import {
  DEFAULT_OPERATOR_EVENT_VIEW,
  OPERATOR_EVENT_TYPE_OPTIONS,
  OPERATOR_EVENT_VIEW_LABELS,
  OPERATOR_EVENT_VIEW_PRESETS,
  OPERATOR_EVENT_VIEW_STATE_KEYS,
} from "./constants.js";

export function createTimelineFiltersController(state, renderOperatorEvents) {
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
  };
}
