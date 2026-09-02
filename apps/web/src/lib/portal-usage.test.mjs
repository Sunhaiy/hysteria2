import assert from "node:assert/strict";
import test from "node:test";
import { buildNodeUsage, buildSevenDayUsage } from "./portal-usage.ts";

const recent = [
  {
    nodeId: "node_a",
    nodeLabel: "US A",
    bucketStart: "2026-09-01T17:00:00.000Z",
    txBytes: 2_000,
    rxBytes: 8_000,
    accountedBytes: 21_000,
  },
];

test("portal usage maps UTC samples to the matching Shanghai calendar day", () => {
  const result = buildSevenDayUsage(
    recent,
    new Date("2026-09-02T09:30:00.000Z"),
  );

  assert.equal(result.at(-1)?.key, "2026-09-02");
  assert.equal(result.at(-1)?.label, "09/02");
  assert.equal(result.at(-1)?.txBytes, 2_000);
  assert.equal(result.at(-1)?.rxBytes, 8_000);
  assert.equal(result.at(-1)?.accountedBytes, 21_000);
});

test("portal node distribution ranks nodes by billed traffic", () => {
  const result = buildNodeUsage([
    ...recent,
    {
      ...recent[0],
      nodeId: "node_b",
      nodeLabel: "US B",
      accountedBytes: 42_000,
    },
  ]);

  assert.deepEqual(
    result.map((item) => [item.label, item.accountedBytes]),
    [
      ["US B", 42_000],
      ["US A", 21_000],
    ],
  );
});
