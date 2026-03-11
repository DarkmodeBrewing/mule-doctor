import type { IncomingMessage, ServerResponse } from "node:http";

export class RequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "RequestError";
  }
}

export function getCookie(rawCookieHeader: string | undefined, cookieName: string): string | undefined {
  if (!rawCookieHeader) return undefined;
  const cookies = rawCookieHeader.split(";");
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function getBearerToken(rawHeader: string | undefined): string | undefined {
  if (!rawHeader) return undefined;
  const trimmed = rawHeader.trim();
  if (trimmed.length < 8) return undefined;
  const prefix = trimmed.slice(0, 7);
  if (prefix.toLowerCase() !== "bearer ") return undefined;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

export function getHeaderValue(
  headers: IncomingMessage["headers"],
  name: string,
): string | undefined {
  const rawValue = headers[name];
  if (typeof rawValue === "string") return rawValue;
  return Array.isArray(rawValue) ? rawValue[0] : undefined;
}

export async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON body must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new RequestError(400, `invalid JSON body: ${String(err)}`);
  }
}

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  applySecurityHeaders(res);
  res.end(JSON.stringify(payload));
}

export function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 303;
  applySecurityHeaders(res);
  res.setHeader("Location", location);
  res.end();
}

export function sendSseHeaders(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Connection", "keep-alive");
  applySecurityHeaders(res);
  res.flushHeaders?.();
}

export function writeSseEvent(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
