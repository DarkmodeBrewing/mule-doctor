import { createTimelineEventsController } from "./timelineEvents.js";
import { createTimelineFiltersController } from "./timelineFilters.js";

export function createTimelineController(state) {
  let filters;
  const events = createTimelineEventsController(state, () => filters.applyOperatorEventFilters());
  filters = createTimelineFiltersController(state, events.renderOperatorEvents);

  return {
    applyOperatorEventFilters: filters.applyOperatorEventFilters,
    applyOperatorEventViewPreset: filters.applyOperatorEventViewPreset,
    focusOperatorTimeline: filters.focusOperatorTimeline,
    focusOperatorTimelineForGroup: filters.focusOperatorTimelineForGroup,
    focusOperatorTimelineForInstance: filters.focusOperatorTimelineForInstance,
    focusOperatorTimelineForTarget: filters.focusOperatorTimelineForTarget,
    partitionInstances: filters.partitionInstances,
    populateOperatorEventFilters: filters.populateOperatorEventFilters,
    renderOperatorEvents: events.renderOperatorEvents,
  };
}
