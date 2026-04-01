import { readFile } from "fs/promises";
import {
  clampInt,
  DEFAULT_HTTP_TIMEOUT_MS,
  HttpError,
  isAbortError,
  isTerminalDebugResult,
  log,
  RequestTimeoutError,
  resolvePollOptions,
  sleep,
} from "./rustMuleClientShared.js";
import type { PollOptions, RequestOptions } from "./rustMuleClientTypes.js";

export class RustMuleClientTransport {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly tokenPath: string | undefined;
  private readonly debugTokenPath: string | undefined;
  private readonly httpTimeoutMs: number;
  private authToken: string | undefined;
  private debugToken: string | undefined;

  constructor(
    baseUrl: string,
    tokenPath?: string,
    apiPrefix = "/api/v1",
    debugTokenPath?: string,
    httpTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    const trimmedPrefix = apiPrefix.trim();
    if (trimmedPrefix === "") {
      this.apiPrefix = "";
    } else {
      const withoutTrailing = trimmedPrefix.replace(/\/+$/, "");
      this.apiPrefix = withoutTrailing.startsWith("/") ? withoutTrailing : `/${withoutTrailing}`;
    }
    this.tokenPath = tokenPath;
    this.debugTokenPath = debugTokenPath;
    this.httpTimeoutMs = clampInt(httpTimeoutMs, DEFAULT_HTTP_TIMEOUT_MS, 100, 120_000);
  }

  async loadToken(): Promise<void> {
    if (this.tokenPath) {
      try {
        const token = (await readFile(this.tokenPath, "utf8")).trim();
        if (!token) {
          throw new Error("Auth token file is empty");
        }
        this.authToken = token;
        log("info", "rustMuleClient", "Auth token loaded");
      } catch (err) {
        throw new Error(`Failed to load auth token from ${this.tokenPath}: ${String(err)}`, {
          cause: err,
        });
      }
    }

    if (this.debugTokenPath) {
      try {
        const token = (await readFile(this.debugTokenPath, "utf8")).trim();
        if (!token) {
          throw new Error("Debug token file is empty");
        }
        this.debugToken = token;
        log("info", "rustMuleClient", "Debug token loaded");
      } catch (err) {
        throw new Error(`Failed to load debug token from ${this.debugTokenPath}: ${String(err)}`, {
          cause: err,
        });
      }
    }
  }

  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.resolveUrl(path);
    const res = await this.fetchWithTimeout("GET", url, { headers: this.headers(options) });
    if (!res.ok) {
      throw new HttpError("GET", url, res.status);
    }
    return res.json() as Promise<T>;
  }

  async post<T>(
    path: string,
    body: Record<string, unknown> = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.resolveUrl(path);
    const res = await this.fetchWithTimeout("POST", url, {
      method: "POST",
      headers: this.headers(options),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new HttpError("POST", url, res.status);
    }
    return res.json() as Promise<T>;
  }

  async pollDebugResult<T extends Record<string, unknown>>(
    path: string,
    options: PollOptions = {},
  ): Promise<T> {
    const { pollIntervalMs, maxWaitMs } = resolvePollOptions(options);
    const deadline = Date.now() + maxWaitMs;

    while (true) {
      const result = await this.get<Record<string, unknown>>(path, { debug: true });
      if (isTerminalDebugResult(result)) {
        return result as T;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out polling ${path} after ${maxWaitMs}ms`);
      }
      await sleep(pollIntervalMs);
    }
  }

  private resolveUrl(path: string): string {
    return `${this.baseUrl}${this.apiPrefix}${path}`;
  }

  private headers(options: RequestOptions = {}): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) h["Authorization"] = `Bearer ${this.authToken}`;
    if (options.debug && this.debugToken) {
      h["X-Debug-Token"] = this.debugToken;
    }
    return h;
  }

  private async fetchWithTimeout(
    method: string,
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.httpTimeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (isAbortError(err)) {
        throw new RequestTimeoutError(method, url, this.httpTimeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
