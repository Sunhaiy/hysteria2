import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL(".next/server/app/index.html", root), "utf8");
for (const name of ["ppanel-hero", "ppanel-hero-copy"]) {
  const tag = html.match(new RegExp(`<[^>]+class="${name}"[^>]*>`))?.[0];
  assert.ok(tag, `Missing ${name}`);
  assert.doesNotMatch(tag, /opacity:\s*0(?:;|")|visibility:\s*hidden/);
}
assert.match(html, /<p class="ppanel-generated-copy ppanel-hero-description">[^<]+<\/p>/);
assert.doesNotMatch(html, /class="ppanel-generated-word"/);

const require = createRequire(import.meta.url);
const playerRequire = createRequire(require.resolve("@lottiefiles/dotlottie-react"));
const runtimeDirectory = dirname(playerRequire.resolve("@lottiefiles/dotlottie-web"));
const [runtime, shipped] = await Promise.all([
  readFile(join(runtimeDirectory, "dotlottie-player.wasm")),
  readFile(new URL("public/vendor/dotlottie/dotlottie-player-0.80.0.wasm", root)),
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(runtime), hash(shipped), "Animation runtime must match the installed player");
console.log("PASS: built first-screen copy is visible without JavaScript; shipped animation runtime matches");
