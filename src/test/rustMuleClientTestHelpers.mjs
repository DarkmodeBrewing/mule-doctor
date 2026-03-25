import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

export function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

export async function writeTempFile(filename, content) {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-"));
  const filePath = join(dir, filename);
  await writeFile(filePath, content, "utf8");
  return {
    filePath,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
