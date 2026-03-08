/* global document, EventSource, window */

const LOG_LINE_LIMIT = 250;
const INSTANCE_DETAIL_PLACEHOLDER = "Select an instance to inspect details.";
const INSTANCE_DIAGNOSTICS_PLACEHOLDER =
  "Select an instance to inspect diagnostics for that managed rust-mule node.";
const INSTANCE_LOGS_PLACEHOLDER = "Select an instance to inspect per-instance rust-mule logs.";
let selectedInstanceId = null;

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

function renderInstanceList(instances) {
  const ul = document.getElementById("instance-list");
  ul.replaceChildren();
  if (!instances.length) {
    const li = document.createElement("li");
    li.textContent = "No managed instances.";
    li.className = "muted";
    ul.appendChild(li);
    return;
  }

  for (const instance of instances) {
    const li = document.createElement("li");
    const wrapper = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const controls = document.createElement("div");
    const start = document.createElement("button");
    const stop = document.createElement("button");
    const restart = document.createElement("button");
    const inspect = document.createElement("button");

    wrapper.className = "instance-entry";
    controls.className = "controls";
    title.textContent = `${instance.id} (${instance.status})`;
    meta.className = "file-meta";
    meta.textContent = `${instance.apiHost}:${instance.apiPort}${instance.currentProcess ? ` • pid ${instance.currentProcess.pid}` : ""}`;

    inspect.textContent = "Inspect";
    start.textContent = "Start";
    stop.textContent = "Stop";
    restart.textContent = "Restart";

    inspect.onclick = () => inspectInstance(instance.id);
    start.onclick = () => mutateInstance(instance.id, "start");
    stop.onclick = () => mutateInstance(instance.id, "stop");
    restart.onclick = () => mutateInstance(instance.id, "restart");

    if (instance.status === "running") {
      start.disabled = true;
    } else {
      stop.disabled = true;
    }

    controls.appendChild(inspect);
    controls.appendChild(start);
    controls.appendChild(stop);
    controls.appendChild(restart);
    wrapper.appendChild(title);
    wrapper.appendChild(meta);
    wrapper.appendChild(controls);
    li.appendChild(wrapper);
    ul.appendChild(li);
  }
}

function setInstanceFeedback(text, isError = false) {
  const element = document.getElementById("instance-feedback");
  element.textContent = text;
  element.className = isError ? "status" : "muted";
}

async function refreshHealth() {
  const data = await fetchJson("/api/health");
  setText("health", JSON.stringify(data, null, 2));
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
    renderInstanceList(data.instances);
    if (selectedInstanceId) {
      const exists = data.instances.some((instance) => instance.id === selectedInstanceId);
      if (!exists) {
        selectedInstanceId = null;
        setText("instance-detail", "Selected instance no longer exists.");
        setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
        setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);
      }
    }
  } catch (err) {
    renderInstanceList([]);
    setInstanceFeedback(`instance control unavailable: ${String(err)}`, true);
  }
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

async function inspectInstance(id) {
  selectedInstanceId = id;
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

setText("instance-detail", INSTANCE_DETAIL_PLACEHOLDER);
setText("instance-diagnostics", INSTANCE_DIAGNOSTICS_PLACEHOLDER);
setText("instance-logs", INSTANCE_LOGS_PLACEHOLDER);

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
document.getElementById("instance-create-form").onsubmit = createInstance;

refreshAll().finally(() => {
  connectStream(`/api/stream/app?lines=${LOG_LINE_LIMIT}`, "app-logs", "app-stream-status");
  connectStream(`/api/stream/rust-mule?lines=${LOG_LINE_LIMIT}`, "rust-logs", "rust-stream-status");
});
