import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/session-hint.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { hasSessionHint } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("anonymous visits do not probe a protected session endpoint", () => {
  for (const cookie of ["", "theme=dark", "hysteria2-csrf=", "other-hysteria2-csrf=value"]) {
    assert.equal(hasSessionHint(cookie), false);
  }
});

test("login and OAuth CSRF cookies retain session discovery", () => {
  assert.equal(hasSessionHint("hysteria2-csrf=token"), true);
  assert.equal(hasSessionHint("theme=light; hysteria2-csrf=token; other=1"), true);
});
