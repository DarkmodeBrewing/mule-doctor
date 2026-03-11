export const LOG_LINE_LIMIT = 250;
export const INSTANCE_DETAIL_PLACEHOLDER = "Select an instance to inspect details.";
export const INSTANCE_DIAGNOSTICS_PLACEHOLDER =
  "Select an instance to inspect diagnostics for that managed rust-mule node.";
export const INSTANCE_ANALYSIS_PLACEHOLDER =
  "Run on-demand analysis for the selected managed instance.";
export const INSTANCE_LOGS_PLACEHOLDER =
  "Select an instance to inspect per-instance rust-mule logs.";
export const OBSERVER_TARGET_PLACEHOLDER = "Loading active diagnostic target...";
export const INSTANCE_PRESET_PLACEHOLDER = "Loading instance presets...";
export const INSTANCE_PRESET_HELP_PLACEHOLDER =
  "Select a preset to inspect its layout and intended use.";
export const OPERATOR_EVENT_TYPE_OPTIONS = [
  { value: "", label: "All event types" },
  { value: "diagnostic_target_changed", label: "Target changes" },
  { value: "observer_run_requested", label: "Run requests" },
  { value: "observer_cycle_started", label: "Cycle starts" },
  { value: "observer_cycle_completed", label: "Cycle outcomes" },
];
export const OPERATOR_EVENT_VIEW_PRESETS = {
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
export const DEFAULT_OPERATOR_EVENT_VIEW = "all";
export const OPERATOR_EVENT_VIEW_LABELS = {
  all: "All",
  failures: "Failures",
  targeting: "Targeting",
  runs: "Run activity",
};
export const OPERATOR_EVENT_VIEW_STATE_KEYS = [
  "grouping",
  "signalTargets",
  "signalRuns",
  "signalFailures",
  "eventType",
];
