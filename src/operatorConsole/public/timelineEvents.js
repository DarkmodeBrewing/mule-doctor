/* global document */

export function createTimelineEventsController(state, applyOperatorEventFilters) {
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
    if (event.type === "managed_instance_control_applied") {
      return {
        title: "Managed control",
        summary: event.message,
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

  function shouldGroupOperatorEvents() {
    return document.getElementById("operator-event-grouping-toggle").checked;
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

  return {
    renderOperatorEvents,
  };
}
