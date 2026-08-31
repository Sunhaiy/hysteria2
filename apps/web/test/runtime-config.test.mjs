import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../src/lib/config.ts", import.meta.url);

test("production web builds always call the same-origin API", async () => {
  const source = await readFile(configUrl, "utf8");

  assert.match(
    source,
    /process\.env\.NODE_ENV === "production"\s*\?\s*""/,
  );
  assert.match(source, /process\.env\.NEXT_PUBLIC_API_BASE_URL/);
});
