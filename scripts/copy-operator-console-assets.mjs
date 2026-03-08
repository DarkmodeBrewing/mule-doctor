import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const sourceDir = resolve("src/operatorConsole/public");
const targetDir = resolve("dist/operatorConsole/public");

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });
