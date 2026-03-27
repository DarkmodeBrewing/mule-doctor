import { resolve } from "node:path";
import { SourceCodeToolsFs } from "./sourceCodeToolsFs.js";
import { gitBlame } from "./sourceCodeToolsGit.js";
import {
  clampPositive,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_MATCHES,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_SCAN_FILE_BYTES,
  escapeRegex,
  isRustProjectTextFile,
  isRustSourceFile,
  resolveProposalDir,
  type GitBlameResult,
  type ProposePatchResult,
  type ReadFileResult,
  type SearchCodeResult,
  type ShowFunctionResult,
  type SourceCodeToolsConfig,
} from "./sourceCodeToolsShared.js";

export type {
  GitBlameResult,
  ProposePatchResult,
  ReadFileResult,
  SearchCodeResult,
  ShowFunctionResult,
  SourceCodeToolsConfig,
} from "./sourceCodeToolsShared.js";

export class SourceCodeTools {
  private readonly rootPath: string;
  private readonly maxFiles: number;
  private readonly maxMatches: number;
  private readonly maxReadBytes: number;
  private readonly maxScanFileBytes: number;
  private readonly fsTools: SourceCodeToolsFs;

  constructor(config: SourceCodeToolsConfig) {
    if (!config.sourcePath || !config.sourcePath.trim()) {
      throw new Error("RUST_MULE_SOURCE_PATH must be set for source tools");
    }
    this.rootPath = resolve(config.sourcePath);
    this.maxFiles = clampPositive(config.maxFiles, DEFAULT_MAX_FILES);
    this.maxMatches = clampPositive(config.maxMatches, DEFAULT_MAX_MATCHES);
    this.maxReadBytes = clampPositive(config.maxReadBytes, DEFAULT_MAX_READ_BYTES);
    this.maxScanFileBytes = clampPositive(config.maxScanFileBytes, DEFAULT_MAX_SCAN_FILE_BYTES);
    this.fsTools = new SourceCodeToolsFs(
      this.rootPath,
      resolveProposalDir(config.proposalDir, this.rootPath),
    );
  }

  async searchCode(queryRaw: string): Promise<SearchCodeResult> {
    const query = queryRaw.trim();
    if (!query) {
      throw new Error("search_code requires non-empty query");
    }

    const files = await this.fsTools.listFiles(this.maxFiles, isRustProjectTextFile);
    const needle = query.toLowerCase();
    let totalMatches = 0;
    const matches: Array<{ path: string; line: number; preview: string }> = [];

    for (const file of files) {
      const content = await this.fsTools.readTextFileBounded(file.absPath, this.maxScanFileBytes);
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
    return this.fsTools.readFile(pathRaw, this.maxReadBytes);
  }

  async showFunction(nameRaw: string): Promise<ShowFunctionResult> {
    const name = nameRaw.trim();
    if (!name) {
      throw new Error("show_function requires non-empty name");
    }

    const files = await this.fsTools.listFiles(this.maxFiles, isRustSourceFile);
    const escaped = escapeRegex(name);
    const rustFunctionPattern = new RegExp(
      `^\\s*(?:(?:pub(?:\\([^)]*\\))?|const|async|unsafe|extern(?:\\s+"[^"]+")?)\\s+)*fn\\s+${escaped}\\b`,
    );

    const matches: Array<{ path: string; line: number; signature: string }> = [];
    let totalMatches = 0;

    for (const file of files) {
      const content = await this.fsTools.readTextFileBounded(file.absPath, this.maxScanFileBytes);
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
    return this.fsTools.proposePatch(diffRaw);
  }

  async gitBlame(pathRaw: string, lineRaw: number): Promise<GitBlameResult> {
    const safePath = this.fsTools.resolveUserPath(pathRaw);
    await this.fsTools.assertPathWithinRoot(safePath);
    return gitBlame(this.rootPath, safePath, lineRaw);
  }
}
