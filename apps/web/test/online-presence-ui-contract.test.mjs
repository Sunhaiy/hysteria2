import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portal = await readFile(
  new URL("../src/app/portal/page.tsx", import.meta.url),
  "utf8",
);
const customers = await readFile(
  new URL("../src/app/admin/customers/page.tsx", import.meta.url),
  "utf8",
);
const customerDetail = await readFile(
  new URL("../src/app/admin/customers/[id]/page.tsx", import.meta.url),
  "utf8",
);

test("connection projections are not presented as unique devices", () => {
  assert.match(portal, /label="连接状态"/);
  assert.match(portal, /活跃连接不等于设备数量/);
  assert.match(portal, /当前不限设备数量/);
  assert.doesNotMatch(portal, /label="在线设备"/);
  assert.doesNotMatch(portal, /设备上限/);
  assert.doesNotMatch(portal, /仍可接入.*台设备/);

  assert.match(customers, /customer\.online \? "在线" : "离线"/);
  assert.doesNotMatch(customers, /customer\.onlineClients.*个连接/);

  assert.match(customerDetail, /label="活跃连接"/);
  assert.match(customerDetail, /同一设备可能产生多条连接/);
  assert.doesNotMatch(customerDetail, /label="在线设备"/);
});
