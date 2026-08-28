import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("customer controls are immediate and expose subscription-link lifecycle", async () => {
  const detail = await source("app/admin/customers/[id]/page.tsx");

  assert.doesNotMatch(detail, /placeholder="调整原因"/);
  assert.match(detail, /订阅链接/);
  assert.match(detail, /重新创建/);
  assert.match(detail, /销毁/);
  assert.match(detail, /identity\.mihomoSubscriptionUrl/);
  assert.match(detail, /v2rayN \/ Hiddify/);
  assert.match(detail, /Clash \/ Mihomo/);
});

test("catalog offers expose period-specific shop URLs and plan traffic policy", async () => {
  const catalog = await source("app/admin/catalog/page.tsx");
  const plans = await source("app/portal/plans/page.tsx");

  assert.match(catalog, /storeUrl/);
  assert.match(catalog, /该周期店铺链接/);
  assert.match(plans, /offer\.storeUrl/);
  assert.match(
    plans,
    /branding\.purchaseMode === "cdk"[\s\S]*branding\.cdkButtonUrl/,
  );
  assert.match(plans, /href=\{purchaseStoreUrl\}/);
  assert.match(catalog, /默认倍率/);
  assert.match(catalog, /上行限速/);
  assert.match(catalog, /下行限速/);
  assert.match(catalog, /nodeIds/);
  assert.match(catalog, /可用节点/);
  assert.doesNotMatch(catalog, /访问策略/);
});

test("catalog offer quota inputs stay fully visible and editable", async () => {
  const [catalog, styles] = await Promise.all([
    source("app/admin/catalog/page.tsx"),
    source("app/globals.scss"),
  ]);

  assert.match(catalog, /trafficGbInput:\s*string/);
  assert.match(catalog, /value=\{offer\.trafficGbInput\}/);
  assert.match(
    catalog,
    /onChange=\{\(event\)\s*=>\s*updateOffer\(offer\.billingPeriod,\s*\{\s*trafficGbInput:\s*event\.target\.value/s,
  );
  assert.match(
    catalog,
    /trafficBytes:\s*trafficGbToBytes\(offer\.trafficGbInput\)/,
  );
  assert.match(
    styles,
    /\.offer-editor-row\s*\{[^}]*grid-template-columns:[^;]*80px[^;]*minmax\(120px,[^;]*minmax\(140px,/s,
  );
  assert.match(styles, /\.offer-editor-row \.control\s*\{[^}]*width:\s*100%/s);
  assert.match(
    styles,
    /\.offer-editor-store\s*\{[^}]*grid-column:\s*2\s*\/\s*-1/s,
  );
});

test("node operations separate access and runtime service controls", async () => {
  const nodes = await source("app/admin/nodes/page.tsx");

  assert.match(nodes, /新增服务器/);
  assert.match(nodes, /新增节点/);
  assert.match(nodes, /停止接入/);
  assert.match(nodes, /停止服务/);
  assert.match(nodes, /当前连接会立即断开/);
  assert.match(nodes, /runtime-commands/);
  assert.match(nodes, /删除节点/);
  assert.match(nodes, /node-endpoint-list/);
  assert.match(nodes, /编辑服务器/);
  assert.match(nodes, /删除服务器/);
  assert.match(nodes, /历史流量和审计记录会保留/);
  assert.match(nodes, /安全删除服务器并保留历史记录/);
  assert.match(nodes, /编辑节点/);
  assert.match(nodes, /节点管理地址/);
  assert.doesNotMatch(nodes, /Agent/);
});

test("Hysteria2 nodes expose bounded UDP port hopping controls", async () => {
  const nodes = await source("app/admin/nodes/page.tsx");

  assert.match(nodes, /启用 UDP 端口跳跃/);
  assert.match(nodes, /portHoppingStart/);
  assert.match(nodes, /portHoppingEnd/);
  assert.match(nodes, /portHoppingIntervalSeconds/);
  assert.match(nodes, /min=\{1\}[\s\S]*max=\{65534\}/);
  assert.match(nodes, /min=\{2\}[\s\S]*max=\{65535\}/);
  assert.match(nodes, /min=\{5\}[\s\S]*max=\{300\}/);
  assert.match(nodes, /nodeForm\.protocol === "hysteria2"/);
});

test("admin navigation is grouped and nodes expose monthly traffic protection", async () => {
  const [copy, sidebar, nodes] = await Promise.all([
    source("lib/copy.ts"),
    source("components/sidebar-nav.tsx"),
    source("app/admin/nodes/page.tsx"),
  ]);

  assert.match(copy, /group:\s*"客户与支持"/);
  assert.match(copy, /group:\s*"商品与财务"/);
  assert.match(copy, /group:\s*"节点运营"/);
  assert.match(copy, /group:\s*"系统"/);
  assert.match(sidebar, /nav-section/);
  assert.match(sidebar, /item\.group/);
  assert.match(nodes, /traffic-limit/);
  assert.match(nodes, /月度双向流量上限/);
  assert.match(nodes, /达到上限时自动停止运行服务/);
});

test("customer traffic statistics include an accounted-usage chart", async () => {
  const detail = await source("app/admin/customers/[id]/page.tsx");

  assert.match(detail, /<EChart/);
  assert.match(detail, /trafficChartOption/);
  assert.match(detail, /accountedBytes/);
});

test("admin navigation keeps CDK management visible", async () => {
  const copy = await source("lib/copy.ts");

  assert.match(copy, /\/admin\/redemption-codes/);
});

test("customer list can filter everyone with subscription history", async () => {
  const customers = await source("app/admin/customers/page.tsx");

  assert.match(customers, /曾订阅/);
  assert.match(customers, /subscriptionHistory/);
});

test("member access prioritizes Clash and keeps subscription details aligned", async () => {
  const access = await source("app/portal/access/page.tsx");

  assert.match(access, /v2rayN/);
  assert.match(access, /Hiddify/);
  assert.match(access, /access\.subscriptionUrl/);
  assert.match(access, /access\.mihomoSubscriptionUrl/);
  assert.match(access, /title="订阅链接"/);
  assert.match(access, /subscription-method-grid/);
  assert.ok(
    access.indexOf("Clash / Mihomo") < access.indexOf("v2rayN / Hiddify"),
    "Clash / Mihomo should be presented before v2rayN / Hiddify",
  );
  assert.match(
    access,
    /className="portal-access-main"[\s\S]*className="portal-access-subscriptions"[\s\S]*className="portal-access-status"/,
  );
});

test("support tickets are available to members and administrators", async () => {
  const [copy, memberTickets, adminTickets] = await Promise.all([
    source("lib/copy.ts"),
    source("app/portal/tickets/page.tsx"),
    source("app/admin/tickets/page.tsx"),
  ]);

  assert.match(copy, /\/portal\/tickets/);
  assert.match(copy, /\/admin\/tickets/);
  assert.match(memberTickets, /\/api\/portal\/tickets/);
  assert.match(memberTickets, /\/api\/portal\/announcement\/current/);
  assert.match(memberTickets, /ticket-announcement/);
  assert.match(
    memberTickets,
    /disabled=\{busy \|\| !subject\.trim\(\) \|\| !message\.trim\(\)\}/,
  );
  assert.match(adminTickets, /\/api\/admin\/tickets/);
  assert.match(adminTickets, /关闭工单/);
});

test("layout guards keep panel titles and plan selectors visible", async () => {
  const [styles, panel, customer] = await Promise.all([
    source("app/globals.scss"),
    source("components/panel.tsx"),
    source("app/admin/customers/[id]/page.tsx"),
  ]);

  assert.match(styles, /\.panel-title\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(panel, /allowOverflow/);
  assert.match(customer, /title="套餐切换"[\s\S]*allowOverflow/);
});

test("CDKs expose renew and replace plan behavior", async () => {
  const codes = await source("app/admin/redemption-codes/page.tsx");

  assert.match(codes, /planMode/);
  assert.match(codes, /同套餐自动续费/);
  assert.match(codes, /立即覆盖当前套餐/);
  assert.match(codes, /trafficPackOfferId/);
  assert.match(codes, /绑定流量包规格/);
  assert.match(codes, /product\.kind === "traffic_pack"/);
});

test("tutorial management uploads installers and keeps the required platform order", async () => {
  const [adminTutorials, memberTutorials, settings] = await Promise.all([
    source("app/admin/tutorials/page.tsx"),
    source("app/portal/tutorial/page.tsx"),
    source("app/admin/settings/page.tsx"),
  ]);

  assert.match(adminTutorials, /tutorial-assets/);
  assert.match(adminTutorials, /客户端安装包/);
  assert.match(
    memberTutorials,
    /windows:\s*0[\s\S]*android:\s*1[\s\S]*macos:\s*2[\s\S]*ios:\s*3/,
  );
  assert.match(memberTutorials, /clientName: "Clash Meta"/);
  assert.doesNotMatch(memberTutorials, /FlClash/);
  assert.doesNotMatch(settings, /tutorial-assets/);
  assert.doesNotMatch(settings, /tutorialWindows/);
  assert.doesNotMatch(settings, /使用教程与客户端下载/);
});
