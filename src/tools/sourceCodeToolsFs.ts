import { realpathSync } from "node:fs";
import { mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  isSensitiveRelativePath,
  MAX_PROPOSAL_BYTES,
  toPosixPath,
  type ProposePatchResult,
  type ReadFileResult,
  type SourceFile,
} from "./sourceCodeToolsShared.js";

const EXCLUDED_DIRS = new Set([".git", "node_modules", "target", "dist", "build"]);

export class SourceCodeToolsFs {
  readonly rootPath: string;
  readonly rootRealPath: string;
  readonly proposalDir: string;

  constructor(rootPath: string, proposalDir: string) {
    this.rootPath = rootPath;
    this.rootRealPath = realpathSync(rootPath);
    this.proposalDir = proposalDir;
  }

  async listFiles(
    maxFiles: number,
    includeFile: (name: string) => boolean,
  ): Promise<SourceFile[]> {
    const files: SourceFile[] = [];
    await walkDir(this.rootPath, this.rootPath, maxFiles, files, includeFile);
    return files;
  }

  resolveUserPath(inputPath: string): string {
    if (typeof inputPath !== "string") {
      throw new Error("Path must be a string");
    }
    const trimmed = inputPath.trim();
    if (!trimmed) {
      throw new Error("Path must be non-empty");
    }
    if (isAbsolute(trimmed)) {
      throw new Error("Path must be relative to RUST_MULE_SOURCE_PATH");
    }
    const resolved = resolve(this.rootPath, trimmed);
    const rel = relative(this.rootPath, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Path escapes source root: ${inputPath}`);
    }
    return resolved;
  }

  async assertPathWithinRoot(absPath: string): Promise<void> {
    const realTarget = await realpathSyncSafe(absPath);
    const rel = relative(this.rootRealPath, realTarget);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Resolved path escapes source root");
    }
  }

  async readFile(pathRaw: string, maxReadBytes: number): Promise<ReadFileResult> {
    const safePath = this.resolveUserPath(pathRaw);
    await this.assertPathWithinRoot(safePath);
    const relPath = toPosixPath(relative(this.rootPath, safePath));
    this.assertPathAllowed(relPath, "read_file");
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) {
      throw new Error(`read_file path is not a regular file: ${pathRaw}`);
    }
    const content = await this.readTextFileBounded(safePath, maxReadBytes);
    return {
      path: relPath,
      sizeBytes: fileStat.size,
      truncated: fileStat.size > maxReadBytes,
      content,
    };
  }

  async readTextFileBounded(absPath: string, maxBytes: number): Promise<string> {
    const fileHandle = await open(absPath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await fileHandle.read(buffer, 0, maxBytes, 0);
      const bounded = buffer.subarray(0, bytesRead);
      if (bounded.includes(0)) {
        throw new Error(`Binary file cannot be read as text: ${absPath}`);
      }
      return bounded.toString("utf8");
    } finally {
      await fileHandle.close();
    }
  }

  assertPathAllowed(relPath: string, operation: string): void {
    if (isSensitiveRelativePath(relPath)) {
      throw new Error(`${operation} blocked for sensitive path: ${relPath}`);
    }
  }

  async proposePatch(diffRaw: string): Promise<ProposePatchResult> {
    const diff = diffRaw.trim();
    if (!diff) {
      throw new Error("propose_patch requires non-empty diff");
    }
    const artifactContent = `${diff}\n`;
    const bytes = Buffer.byteLength(artifactContent, "utf8");
    if (bytes > MAX_PROPOSAL_BYTES) {
      throw new Error(
        `propose_patch diff exceeds ${MAX_PROPOSAL_BYTES} bytes; split into smaller proposals`,
      );
    }

    await mkdir(this.proposalDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    const artifactName = `proposal-${timestamp}.patch`;
    const artifactAbsPath = resolve(this.proposalDir, artifactName);
    await writeFile(artifactAbsPath, artifactContent, "utf8");

    return {
      mode: "proposal_only",
      applied: false,
      bytes,
      lines: diff.split("\n").length,
      artifactPath: toPosixPath(artifactAbsPath),
      message: "Patch proposal saved for human review. No source files were modified.",
    };
  }
}

async function walkDir(
  rootPath: string,
  currentPath: string,
  maxFiles: number,
  output: SourceFile[],
  includeFile: (name: string) => boolean,
): Promise<void> {
  if (output.length >= maxFiles) return;

  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (output.length >= maxFiles) return;
    if (entry.isSymbolicLink()) continue;

    const absPath = resolve(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await walkDir(rootPath, absPath, maxFiles, output, includeFile);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!includeFile(entry.name)) continue;
    const relPath = toPosixPath(relative(rootPath, absPath));
    if (isSensitiveRelativePath(relPath)) continue;

    output.push({
      absPath,
      relPath,
    });
  }
}

async function realpathSyncSafe(path: string): Promise<string> {
  try {
    return realpathSync(path);
  } catch {
    throw new Error(`Path does not exist: ${path}`);
  }
}
