/* global document */

function formatRecordedAt(value) {
  if (!value) {
    return "unknown time";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function createBadge(text, className = "") {
  const badge = document.createElement("span");
  badge.className = className ? `event-badge ${className}` : "event-badge";
  badge.textContent = text;
  return badge;
}

function renderDiscoverabilityDetail(result, recordedAt) {
  const detail = document.createElement("div");
  detail.className = "event-detail";
  const fixtureName = result.fixture?.fileName || result.fixture?.fixtureId || "fixture unknown";
  const finalState = result.finalState || "unknown";
  detail.textContent =
    `${result.query} via ${fixtureName} • final state ${finalState} • ` +
    `${result.resultCount} results • recorded ${formatRecordedAt(recordedAt)}`;
  return detail;
}

function renderDiscoverabilityItem(record) {
  const item = document.createElement("li");
  const line = document.createElement("div");
  line.className = "event-line";

  const title = document.createElement("strong");
  title.textContent = `${record.result.publisherInstanceId} -> ${record.result.searcherInstanceId}`;
  line.appendChild(title);

  const badges = document.createElement("div");
  badges.className = "event-badges";
  badges.appendChild(
    createBadge(record.result.outcome, record.result.outcome === "found" ? "success" : "warn"),
  );
  badges.appendChild(createBadge(`${record.result.resultCount} hits`));
  if (record.result.readinessAtDispatch?.publisherReady && record.result.readinessAtDispatch?.searcherReady) {
    badges.appendChild(createBadge("ready at dispatch", "instance"));
  }
  line.appendChild(badges);

  item.appendChild(line);
  item.appendChild(renderDiscoverabilityDetail(record.result, record.recordedAt));
  return item;
}

export function createDiscoverabilityController(fetchJson) {
  async function refreshDiscoverabilityResults() {
    const list = document.getElementById("discoverability-results");
    list.replaceChildren();
    try {
      const data = await fetchJson("/api/discoverability/results?limit=8");
      const results = Array.isArray(data.results) ? [...data.results].reverse() : [];
      if (!results.length) {
        const item = document.createElement("li");
        item.className = "muted";
        item.textContent = "No controlled discoverability checks recorded yet.";
        list.appendChild(item);
        return;
      }

      for (const record of results) {
        list.appendChild(renderDiscoverabilityItem(record));
      }
    } catch (err) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = `Failed to load discoverability results: ${String(err)}`;
      list.appendChild(item);
    }
  }

  return {
    refreshDiscoverabilityResults,
  };
}
