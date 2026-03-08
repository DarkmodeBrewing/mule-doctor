import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_MATCHES = 200;
const DEFAULT_MAX_READ_BYTES = 64 * 1024;
const DEFAULT_MAX_SCAN_FILE_BYTES = 256 * 1024;
const DEFAULT_PROPOSAL_DIR = "/data/mule-doctor/proposals";

const EXCLUDED_DIRS = new Set([".git", "node_modules", "target", "dist", "build"]);
const RUST_PROJECT_EXTENSIONS = new Set([".rs", ".toml", ".md", ".txt", ".sh", ".env"]);
const RUST_PROJECT_FILENAMES = new Set(["Cargo.toml", "Cargo.lock", "Makefile", "Dockerfile"]);

interface SourceCodeToolsConfig {
  sourcePath: string;
  proposalDir?: string;
  maxFiles?: number;
  maxMatches?: number;
  maxReadBytes?: number;
  maxScanFileBytes?: number;
}

interface SourceFile {
  absPath: string;
  relPath: string;
}

export interface SearchCodeResult {
  query: string;
  scannedFiles: number;
  totalMatches: number;
  truncated: boolean;
  matches: Array<{ path: string; line: number; preview: string }>;
}

export interface ReadFileResult {
  path: string;
  sizeBytes: number;
  truncated: boolean;
  content: string;
}

export interface ShowFunctionResult {
  name: string;
  scannedFiles: number;
  totalMatches: number;
  matches: Array<{ path: string; line: number; signature: string }>;
}

export interface ProposePatchResult {
  mode: "proposal_only";
  applied: false;
  bytes: number;
  lines: number;
  artifactPath: string;
  message: string;
}

export interface GitBlameResult {
  path: string;
  line: number;
  commit: string;
  author: string;
  authorEmail: string;
  authorTime?: string;
  summary: string;
  content: string;
}

export class SourceCodeTools {
  private readonly rootPath: string;
  private readonly rootRealPath: string;
  private readonly maxFiles: number;
  private readonly maxMatches: number;
  private readonly maxReadBytes: number;
  private readonly maxScanFileBytes: number;
  private readonly proposalDir: string;

  constructor(config: SourceCodeToolsConfig) {
    if (!config.sourcePath || !config.sourcePath.trim()) {
      throw new Error("RUST_MULE_SOURCE_PATH must be set for source tools");
    }
    this.rootPath = resolve(config.sourcePath);
    this.rootRealPath = realpathSync(this.rootPath);
    this.maxFiles = clampPositive(config.maxFiles, DEFAULT_MAX_FILES);
    this.maxMatches = clampPositive(config.maxMatches, DEFAULT_MAX_MATCHES);
    this.maxReadBytes = clampPositive(config.maxReadBytes, DEFAULT_MAX_READ_BYTES);
    this.maxScanFileBytes = clampPositive(config.maxScanFileBytes, DEFAULT_MAX_SCAN_FILE_BYTES);
    this.proposalDir = resolveProposalDir(config.proposalDir, this.rootPath);
  }

  async searchCode(queryRaw: string): Promise<SearchCodeResult> {
    const query = queryRaw.trim();
    if (!query) {
      throw new Error("search_code requires non-empty query");
    }

    const files = await this.listSourceFiles();
    const needle = query.toLowerCase();
    let totalMatches = 0;
    const matches: Array<{ path: string; line: number; preview: string }> = [];

    for (const file of files) {
      const content = await this.readTextFileBounded(file.absPath, this.maxScanFileBytes);
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.toLowerCase().includes(needle)) continue;
        totalMatches += 1;
        if (matches.length < this.maxMatches) {
          matches.push({
            path: file.relPath,
            line: index + 1,
            preview: line.slice(0, 400),
          });
        }
      }
    }

    return {
      query,
      scannedFiles: files.length,
      totalMatches,
      truncated: totalMatches > matches.length,
      matches,
    };
  }

  async readFile(pathRaw: string): Promise<ReadFileResult> {
    const safePath = this.resolveUserPath(pathRaw);
    await this.assertPathWithinRoot(safePath);
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) {
      throw new Error(`read_file path is not a regular file: ${pathRaw}`);
    }
    const content = await this.readTextFileBounded(safePath, this.maxReadBytes);
    return {
      path: toPosixPath(relative(this.rootPath, safePath)),
      sizeBytes: fileStat.size,
      truncated: fileStat.size > this.maxReadBytes,
      content,
    };
  }

  async showFunction(nameRaw: string): Promise<ShowFunctionResult> {
    const name = nameRaw.trim();
    if (!name) {
      throw new Error("show_function requires non-empty name");
    }

    const files = await this.listRustSourceFiles();
    const escaped = escapeRegex(name);
    const rustFunctionPattern = new RegExp(
      `^\\s*(?:(?:pub(?:\\([^)]*\\))?|const|async|unsafe|extern(?:\\s+"[^"]+")?)\\s+)*fn\\s+${escaped}\\b`,
    );

    const matches: Array<{ path: string; line: number; signature: string }> = [];
    let totalMatches = 0;

    for (const file of files) {
      const content = await this.readTextFileBounded(file.absPath, this.maxScanFileBytes);
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trimEnd();
        if (!rustFunctionPattern.test(line)) continue;
        totalMatches += 1;
        if (matches.length < this.maxMatches) {
          matches.push({
            path: file.relPath,
            line: index + 1,
            signature: line.slice(0, 500),
          });
        }
      }
    }

    return {
      name,
      scannedFiles: files.length,
      totalMatches,
      matches,
    };
  }

  async proposePatch(diffRaw: string): Promise<ProposePatchResult> {
    const diff = diffRaw.trim();
    if (!diff) {
      throw new Error("propose_patch requires non-empty diff");
    }

    await mkdir(this.proposalDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    const artifactName = `proposal-${timestamp}.patch`;
    const artifactAbsPath = resolve(this.proposalDir, artifactName);
    await writeFile(artifactAbsPath, diff + "\n", "utf8");

    return {
      mode: "proposal_only",
      applied: false,
      bytes: Buffer.byteLength(diff, "utf8"),
      lines: diff.split("\n").length,
      artifactPath: toPosixPath(artifactAbsPath),
      message: "Patch proposal saved for human review. No source files were modified.",
    };
  }

  async gitBlame(pathRaw: string, lineRaw: number): Promise<GitBlameResult> {
    const safePath = this.resolveUserPath(pathRaw);
    await this.assertPathWithinRoot(safePath);
    const line = clampPositive(lineRaw, 1);
    const relPath = toPosixPath(relative(this.rootPath, safePath));
    const args = ["blame", "-L", `${line},${line}`, "--porcelain", "--", relPath];

    try {
      const result = await execFileAsync("git", args, {
        cwd: this.rootPath,
        maxBuffer: 1024 * 1024,
      });
      return parsePorcelainBlame(result.stdout, relPath, line);
    } catch (err) {
      throw new Error(`git_blame failed for ${relPath}:${line}: ${String(err)}`, { cause: err });
    }
  }

  private async listSourceFiles(): Promise<SourceFile[]> {
    const files: SourceFile[] = [];
    await walkDir(this.rootPath, this.rootPath, this.maxFiles, files, isRustProjectTextFile);
    return files;
  }

  private async listRustSourceFiles(): Promise<SourceFile[]> {
    const files: SourceFile[] = [];
    await walkDir(this.rootPath, this.rootPath, this.maxFiles, files, isRustSourceFile);
    return files;
  }

  private resolveUserPath(inputPath: string): string {
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

  private async assertPathWithinRoot(absPath: string): Promise<void> {
    const realTarget = await realpathSyncSafe(absPath);
    const rel = relative(this.rootRealPath, realTarget);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Resolved path escapes source root");
    }
  }

  private async readTextFileBounded(absPath: string, maxBytes: number): Promise<string> {
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

    output.push({
      absPath,
      relPath: toPosixPath(relative(rootPath, absPath)),
    });
  }
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.round(value);
}

function isRustProjectTextFile(fileName: string): boolean {
  if (RUST_PROJECT_FILENAMES.has(fileName)) return true;
  const extension = extname(fileName).toLowerCase();
  return RUST_PROJECT_EXTENSIONS.has(extension);
}

function isRustSourceFile(fileName: string): boolean {
  return extname(fileName).toLowerCase() === ".rs";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveProposalDir(proposalDirRaw: string | undefined, rootPath: string): string {
  if (proposalDirRaw === undefined) {
    return resolve(DEFAULT_PROPOSAL_DIR);
  }
  const proposalDir = proposalDirRaw.trim();
  if (!proposalDir) {
    throw new Error("proposalDir must be non-empty when provided");
  }
  if (isAbsolute(proposalDir)) {
    return resolve(proposalDir);
  }
  return resolve(rootPath, proposalDir);
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

async function realpathSyncSafe(path: string): Promise<string> {
  try {
    return realpathSync(path);
  } catch {
    throw new Error(`Path does not exist: ${path}`);
  }
}
