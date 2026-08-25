import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("login exposes the self-service password recovery flow", async () => {
  const [login, forgot] = await Promise.all([
    source("app/login/page.tsx"),
    source("app/forgot-password/page.tsx"),
  ]);

  assert.match(login, /忘记密码/);
  assert.match(login, /\/forgot-password/);
  assert.match(forgot, /\/api\/auth\/forgot-password/);
  assert.match(forgot, /如果该邮箱已注册/);
});

test("member console mounts the per-login announcement dialog", async () => {
  const [shell, dialog, settings] = await Promise.all([
    source("components/console-shell.tsx"),
    source("components/member-announcement-dialog.tsx"),
    source("app/admin/settings/page.tsx"),
  ]);

  assert.match(shell, /<MemberAnnouncementDialog/);
  assert.match(dialog, /\/api\/portal\/announcement/);
  assert.match(dialog, /announcement\/acknowledge/);
  assert.match(dialog, /我已知晓/);
  assert.match(settings, /每次重新登录/);
  assert.match(settings, /关闭后不显示公告/);
});
