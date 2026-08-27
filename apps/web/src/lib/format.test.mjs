import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes, formatSpeedLimit, formatTrafficLimit } from "./format.ts";

test("legacy unlimited plan sentinels keep their customer-facing labels", () => {
  assert.equal(formatTrafficLimit(Number.MAX_SAFE_INTEGER), "无限流量");
  assert.equal(formatSpeedLimit(0), "不限速");
});

test("finite traffic and speed values retain their units", () => {
  assert.equal(formatTrafficLimit(100 * 1024 * 1024 * 1024), "100 GB");
  assert.equal(formatSpeedLimit(120), "120 Mbps");
});

test("byte formatting keeps small traffic precise and selects a readable unit", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(900), "900 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1.25 * 1024 * 1024), "1.25 MB");
  assert.equal(formatBytes(1024 ** 4), "1 TB");
});
