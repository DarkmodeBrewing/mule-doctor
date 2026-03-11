/* global document */

import { INSTANCE_PRESET_HELP_PLACEHOLDER } from "./constants.js";

export function createInstancePresetsController({ state }) {
  function lookupPresetDefinition(presetId) {
    return state.currentInstancePresets.find((candidate) => candidate.id === presetId) || null;
  }

  function formatPresetSummary(preset) {
    const nodeLabels = preset.nodes.map((node) => node.suffix).join(", ");
    const nodeCount = preset.nodes.length;
    return `${nodeCount} ${nodeCount === 1 ? "node" : "nodes"} • layout ${nodeLabels}`;
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

  return {
    formatPresetSummary,
    lookupPresetDefinition,
    renderInstancePresets,
    renderSelectedPresetHelp,
  };
}
