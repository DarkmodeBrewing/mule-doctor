/* global document, EventSource, window */

const LOG_LINE_LIMIT = 250;

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

refreshAll().finally(() => {
  connectStream(`/api/stream/app?lines=${LOG_LINE_LIMIT}`, "app-logs", "app-stream-status");
  connectStream(`/api/stream/rust-mule?lines=${LOG_LINE_LIMIT}`, "rust-logs", "rust-stream-status");
});
