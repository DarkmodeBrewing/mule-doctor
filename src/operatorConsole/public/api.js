/* global EventSource, window */

import { appendLine, setStreamStatus, setText } from "./dom.js";

export async function fetchJson(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("authentication required");
  }
  if (!res.ok) {
    throw new Error(`${url} failed: ${res.status}`);
  }
  return res.json();
}

export async function postJson(url, payload = {}) {
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

export function connectStream(url, targetId, statusId) {
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
