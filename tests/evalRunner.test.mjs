import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("npm run eval reports passing knowledge retrieval baseline", async () => {
  const { stdout } = await execFileAsync("npm", ["run", "eval"], {
    cwd: new URL("../", import.meta.url),
  });

  assert.match(stdout, /knowledge retrieval baseline/);
  assert.match(stdout, /7\/7 knowledge hit checks passed/);
  assert.match(stdout, /exact-fact-zhangsan/);
});
