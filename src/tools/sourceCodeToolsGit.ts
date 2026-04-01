import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { relative } from "node:path";
import { clampPositive, toPosixPath, type GitBlameResult } from "./sourceCodeToolsShared.js";

const execFileAsync = promisify(execFile);

export async function gitBlame(
  rootPath: string,
  safePath: string,
  lineRaw: number,
): Promise<GitBlameResult> {
  const line = clampPositive(lineRaw, 1);
  const relPath = toPosixPath(relative(rootPath, safePath));
  const args = ["blame", "-L", `${line},${line}`, "--porcelain", "--", relPath];

  try {
    const result = await execFileAsync("git", args, {
      cwd: rootPath,
      maxBuffer: 1024 * 1024,
    });
    return parsePorcelainBlame(result.stdout, relPath, line);
  } catch (err) {
    throw new Error(`git_blame failed for ${relPath}:${line}: ${String(err)}`, { cause: err });
  }
}

function parsePorcelainBlame(stdout: string, relPath: string, line: number): GitBlameResult {
  const lines = stdout.split("\n");
  if (lines.length === 0 || !lines[0]) {
    throw new Error(`git_blame returned empty output for ${relPath}:${line}`);
  }

  const first = lines[0].split(" ");
  const commit = first[0] ?? "";
  let author = "";
  let authorEmail = "";
  let authorTime: string | undefined;
  let summary = "";
  let content = "";

  for (const entry of lines.slice(1)) {
    if (!entry) continue;
    if (entry.startsWith("\t")) {
      content = entry.slice(1);
      continue;
    }
    const [key, ...rest] = entry.split(" ");
    const value = rest.join(" ");
    if (key === "author") author = value;
    if (key === "author-mail") authorEmail = value.replace(/^<|>$/g, "");
    if (key === "author-time") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        authorTime = new Date(numeric * 1000).toISOString();
      }
    }
    if (key === "summary") summary = value;
  }

  if (!commit) {
    throw new Error(`Unable to parse git blame commit for ${relPath}:${line}`);
  }

  return {
    path: relPath,
    line,
    commit,
    author,
    authorEmail,
    authorTime,
    summary,
    content,
  };
}
