import { access, mkdir, stat } from "fs/promises";
import { constants } from "fs";
import { dirname, resolve } from "path";

export interface StartupReadinessConfig {
  tokenPath: string;
  debugTokenPath?: string;
  logPath: string;
  dataDir: string;
  statePath?: string;
  historyPath?: string;
  llmLogDir: string;
  proposalDir: string;
}

export async function validateStartupReadiness(config: StartupReadinessConfig): Promise<void> {
  const errors: string[] = [];

  await checkReadableFile(config.tokenPath, "RUST_MULE_TOKEN_PATH", errors);

  if (config.debugTokenPath) {
    await checkReadableFile(config.debugTokenPath, "RUST_MULE_DEBUG_TOKEN_FILE", errors);
  }

  await checkExistingDirectory(dirname(resolve(config.logPath)), "RUST_MULE_LOG_PATH parent", errors);

  await checkWritableDirectory(config.dataDir, "MULE_DOCTOR_DATA_DIR", errors, true);
  await checkWritableFileParent(config.statePath ?? `${config.dataDir}/state.json`, "MULE_DOCTOR_STATE_PATH", errors);
  await checkWritableFileParent(
    config.historyPath ?? `${config.dataDir}/history.json`,
    "MULE_DOCTOR_HISTORY_PATH",
    errors,
  );
  await checkWritableDirectory(config.llmLogDir, "MULE_DOCTOR_LLM_LOG_DIR", errors, true);
  await checkWritableDirectory(config.proposalDir, "Proposal artifact directory", errors, true);

  if (errors.length > 0) {
    throw new Error(`Startup readiness validation failed:\n- ${errors.join("\n- ")}`);
  }
}

async function checkReadableFile(path: string, label: string, errors: string[]): Promise<void> {
  try {
    const resolved = resolve(path);
    const info = await stat(resolved);
    if (!info.isFile()) {
      errors.push(`${label} is not a file: ${resolved}`);
      return;
    }
    await access(resolved, constants.R_OK);
  } catch (err) {
    errors.push(`${label} is not readable: ${describePathError(path, err)}`);
  }
}

async function checkExistingDirectory(path: string, label: string, errors: string[]): Promise<void> {
  try {
    const resolved = resolve(path);
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      errors.push(`${label} is not a directory: ${resolved}`);
      return;
    }
    await access(resolved, constants.R_OK | constants.X_OK);
  } catch (err) {
    errors.push(`${label} is unavailable: ${describePathError(path, err)}`);
  }
}

async function checkWritableDirectory(
  path: string,
  label: string,
  errors: string[],
  createIfMissing: boolean,
): Promise<void> {
  const resolved = resolve(path);
  try {
    let info;
    try {
      info = await stat(resolved);
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "ENOENT" && createIfMissing) {
        await mkdir(resolved, { recursive: true });
        info = await stat(resolved);
      } else {
        throw err;
      }
    }
    if (!info.isDirectory()) {
      errors.push(`${label} is not a directory: ${resolved}`);
      return;
    }
    await access(resolved, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch (err) {
    errors.push(`${label} is not writable: ${describePathError(path, err)}`);
  }
}

async function checkWritableFileParent(
  path: string,
  label: string,
  errors: string[],
): Promise<void> {
  const resolved = resolve(path);
  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      errors.push(`${label} is not a file: ${resolved}`);
      return;
    }
    await access(resolved, constants.W_OK);
  } catch (err) {
    const code = getErrorCode(err);
    if (code === "ENOENT") {
      const parent = dirname(resolved);
      await checkWritableDirectory(parent, `${label} parent`, errors, true);
      return;
    }
    errors.push(`${label} is not writable: ${describePathError(path, err)}`);
  }
}

function describePathError(path: string, err: unknown): string {
  return `${resolve(path)} (${String(err)})`;
}

function getErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) {
    return undefined;
  }
  const code = Reflect.get(err, "code");
  return typeof code === "string" ? code : undefined;
}
