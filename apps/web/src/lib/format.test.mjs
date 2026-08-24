import assert from "node:assert/strict";
import test from "node:test";
import { formatSpeedLimit, formatTrafficLimit } from "./format.ts";

test("legacy unlimited plan sentinels keep their customer-facing labels", () => {
  assert.equal(formatTrafficLimit(Number.MAX_SAFE_INTEGER), "无限流量");
  assert.equal(formatSpeedLimit(0), "不限速");
});

test("finite traffic and speed values retain their units", () => {
  assert.equal(formatTrafficLimit(100 * 1024 * 1024 * 1024), "100.0 GB");
  assert.equal(formatSpeedLimit(120), "120 Mbps");
});
