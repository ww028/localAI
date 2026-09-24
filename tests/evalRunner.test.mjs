import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

test("npm run eval reports passing knowledge retrieval baseline", async () => {
  const { stdout } = await execFileAsync("npm", ["run", "eval"], {
    cwd: repoRoot,
  });

  assert.match(stdout, /knowledge retrieval baseline/);
  assert.match(stdout, /7\/7 passed/);
  assert.match(stdout, /exact-fact-zhangsan/);
});
