import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("daily check-in is a stable action on the member overview", () => {
  const dialogs = read("src/components/member-portal-dialogs.tsx");
  const overview = read("src/app/portal/page.tsx");
  const admin = read("src/app/admin/activities/page.tsx");
  const celebration = read("src/components/check-in-success-dialog.tsx");
  assert.doesNotMatch(dialogs, /DailyCheckInDialog/);
  assert.doesNotMatch(dialogs, /\/api\/portal\/check-ins/);
  assert.match(overview, /portal-check-in-summary/);
  assert.match(overview, /\/api\/portal\/check-ins\/today/);
  assert.match(overview, /\/api\/portal\/check-ins\/claim/);
  assert.match(overview, /method: "POST"/);
  assert.match(overview, /CheckInSuccessDialog/);
  assert.match(overview, /setCheckInSuccessReward\(response\.rewardBytes\)/);
  assert.match(admin, /预览成功动画/);
  assert.match(admin, /<CheckInSuccessDialog/);
  assert.match(celebration, /重新播放/);
  assert.match(celebration, /preview/);
  assert.doesNotMatch(celebration, /\/api\/portal\/check-ins\/claim/);
  assert.match(
    read("src/app/globals.scss"),
    /\.check-in-success-dialog\s*\{[\s\S]*?animation:\s*check-in-success-dialog-in 180ms/s,
  );
});

test("group buying uses a dedicated route and explicit payment channel", () => {
  const navigation = read("src/lib/copy.ts");
  const page = read("src/components/group-buy-experience.tsx");
  const styles = read("src/app/globals.scss");
  assert.match(navigation, /href: "\/portal\/group-buys"/);
  assert.match(page, /"alipay" \| "wxpay" \| "balance"/);
  assert.match(page, /window\.open\("about:blank"/);
  assert.match(page, /\/api\/portal\/group-buys/);
  assert.match(page, /formatBytes\(selected\.bonusBytes\)/);
  assert.match(page, /campaign\.originalPriceCents/);
  assert.match(page, /paymentType === "balance"/);
  assert.match(
    page,
    /payment\.status === "failed" \|\| payment\.status === "expired"/,
  );
  assert.match(page, /selected\?\.originalPriceCents/);
  assert.match(page, /成团返余额/);
  assert.match(page, /未成团原价开通，不返不送/);
  assert.match(page, /仅成团成功发放/);
  assert.match(page, /switchesCurrentPlan/);
  assert.match(page, /请先确认立即切换套餐的影响/);
  assert.match(page, /planActivation === "immediate_switch"/);
  assert.match(page, /到期后切换/);
  assert.match(page, /formatDateTime\(currentPlan\.endsAt\)/);
  assert.match(page, /续费当前套餐/);
  assert.match(page, /付款后立即开通/);
  assert.match(page, /planActivation: switchesCurrentPlan/);
  assert.match(page, /overview\.subscription\.includedTrafficBytes > 0/);
  assert.match(page, /当前 \{currentPlan\.name\}/);
  assert.match(page, /<Icon name="group_add" \/>/);
  assert.match(
    page,
    /差 \$\{Math\.max\(group\.requiredMembers - group\.paidMembers, 0\)\} 人成团/,
  );
  assert.match(page, /group-buy-status-badge/);
  assert.match(page, /\/api\/portal\/group-buys\/\$\{group\.id\}\/cancel/);
  assert.match(page, /取消拼团/);
  assert.match(page, /分享链接/);
  assert.match(page, /copyToClipboard\(group\.shareUrl\)/);
  assert.doesNotMatch(page, /navigator\.share/);
  assert.match(page, /\/api\/portal\/group-buys\/\$\{shareCode\}/);
  assert.doesNotMatch(page, /className="group-buy-heading"/);
  assert.doesNotMatch(page, /className="group-buy-members"/);
  assert.match(
    styles,
    /\.group-buy-payment-options\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s,
  );
  assert.match(
    styles,
    /\.group-buy-campaign-card\s*\{[^}]*background:\s*transparent;/s,
  );
  assert.match(styles, /\.group-buy-row\s*\{[^}]*background:\s*transparent;/s);
  assert.match(
    styles,
    /\.group-buy-status-badge\.open\s*\{[^}]*background:\s*var\(--accent-500\);/s,
  );
  assert.match(page, /className="group-buy-list-stage"/);
  assert.match(
    styles,
    /\.group-buy-results-shell\s*\{[^}]*overflow-y:\s*scroll;/s,
  );
  assert.match(styles, /scrollbar-gutter:\s*stable;/);
  assert.match(styles, /@keyframes group-buy-list-enter/);
  assert.match(
    styles,
    /\.group-buy-checkout-saving\s*\{[^}]*background:\s*var\(--accent-500\);/s,
  );
});

test("admin activity center controls rewards, offers, and exception retries", () => {
  const navigation = read("src/lib/copy.ts");
  const page = read("src/app/admin/activities/page.tsx");
  assert.match(navigation, /href: "\/admin\/activities"/);
  assert.match(page, /\/api\/admin\/check-ins\/settings/);
  assert.match(page, /\/api\/admin\/group-buys\/campaigns/);
  assert.match(page, /discountPercent: campaigns\.discountPercent/);
  assert.match(page, /bonusTrafficGiB: campaigns\.bonusTrafficGiB/);
  assert.match(page, /重试退款/);
  assert.match(page, /重试发放/);
  assert.match(page, /exceptionsOnly=true/);
  assert.match(page, /待追缴/);
});
