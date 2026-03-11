/* global document */

export function createInstanceCompareController({ fetchJson, setText }) {
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
