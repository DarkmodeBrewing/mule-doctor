/* global document */

import { LOG_LINE_LIMIT } from "./constants.js";

export function setText(id, text) {
  document.getElementById(id).textContent = text;
}

export function appendLine(id, line) {
  const element = document.getElementById(id);
  const lines = element.textContent ? element.textContent.split("\n") : [];
  lines.push(line);
  element.textContent = lines.slice(-LOG_LINE_LIMIT).join("\n");
  element.scrollTop = element.scrollHeight;
}

export function setStreamStatus(id, isLive, text) {
  const element = document.getElementById(id);
  element.textContent = text;
  element.className = isLive ? "status live" : "status";
}

export function renderFileList(targetId, files, onClick) {
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
