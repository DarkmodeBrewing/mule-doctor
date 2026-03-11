import { resolve } from "node:path";

export const AUTH_COOKIE_NAME = "mule_doctor_ui_token";
export const DEFAULT_UI_HOST = "127.0.0.1";
export const DEFAULT_UI_PORT = 18080;
export const DEFAULT_LOG_LINES = 200;
export const DEFAULT_STREAM_LINES = 50;
export const DEFAULT_STREAM_POLL_MS = 1000;
export const DEFAULT_STREAM_HEARTBEAT_MS = 15000;
export const MAX_LOG_LINES = 2000;
export const MAX_STREAM_LINES = 500;
export const MAX_FILE_BYTES = 512 * 1024;
export const PUBLIC_UNAUTHENTICATED_ASSETS = new Set(["login.js", "styles.css"]);
export const STATIC_DIR = resolve(__dirname, "public");
