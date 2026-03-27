import { extname, isAbsolute, resolve } from "node:path";

export const DEFAULT_MAX_FILES = 2000;
export const DEFAULT_MAX_MATCHES = 200;
export const DEFAULT_MAX_READ_BYTES = 64 * 1024;
export const DEFAULT_MAX_SCAN_FILE_BYTES = 256 * 1024;
export const MAX_PROPOSAL_BYTES = 256 * 1024;
export const DEFAULT_PROPOSAL_DIR = "/data/mule-doctor/proposals";

const RUST_PROJECT_EXTENSIONS = new Set([".rs", ".toml", ".md", ".txt", ".sh"]);
const RUST_PROJECT_FILENAMES = new Set(["Cargo.toml", "Cargo.lock", "Makefile", "Dockerfile"]);
const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.env(\..*)?(\/|$)/i,
  /\.(pem|key|p12|pfx)$/i,
];

export interface SourceCodeToolsConfig {
  sourcePath: string;
  proposalDir?: string;
  maxFiles?: number;
  maxMatches?: number;
  maxReadBytes?: number;
  maxScanFileBytes?: number;
}

export interface SourceFile {
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

export function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.round(value);
}

export function isRustProjectTextFile(fileName: string): boolean {
  if (RUST_PROJECT_FILENAMES.has(fileName)) return true;
  const extension = extname(fileName).toLowerCase();
  return RUST_PROJECT_EXTENSIONS.has(extension);
}

export function isRustSourceFile(fileName: string): boolean {
  return extname(fileName).toLowerCase() === ".rs";
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveProposalDir(
  proposalDirRaw: string | undefined,
  rootPath: string,
): string {
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

export function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function isSensitiveRelativePath(relPath: string): boolean {
  const normalized = toPosixPath(relPath);
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}
