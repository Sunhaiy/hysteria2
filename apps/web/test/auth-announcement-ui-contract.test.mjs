import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("login exposes the self-service password recovery flow", async () => {
  const [login, register, experience, forgot, shell, shader, styles] =
    await Promise.all([
      source("app/login/page.tsx"),
      source("app/register/page.tsx"),
      source("components/auth-experience.tsx"),
      source("app/forgot-password/page.tsx"),
      source("components/auth-shell.tsx"),
      source("components/auth-shader-background.tsx"),
      source("app/globals.scss"),
    ]);

  assert.match(login, /<AuthExperience initialMode="login"/);
  assert.match(register, /<AuthExperience initialMode="register"/);
  assert.match(experience, /忘记密码/);
  assert.match(experience, /\/forgot-password/);
  assert.match(experience, /window\.history\.pushState/);
  assert.match(experience, /onModeChange=\{switchMode\}/);
  assert.match(experience, /className="auth2-optional-region"/);
  assert.match(experience, /data-open=\{showOptional\}/);
  assert.match(experience, /inert=\{!showOptional\}/);
  assert.doesNotMatch(experience, /showOptional \? \(/);
  assert.match(experience, /选填信息/);
  assert.match(experience, /邀请码与显示名称/);
  assert.match(experience, /auth2-field-stack/);
  assert.match(experience, /<Icon name="edit" \/>/);
  assert.doesNotMatch(experience, /<Icon name="add" \/>[\s\S]*?选填信息/);
  assert.match(
    styles,
    /\.auth2-field-stack\s*\{[^}]*display:\s*grid;[^}]*gap:\s*10px;/s,
  );
  assert.match(
    styles,
    /\.auth2-input\s*\{[^}]*border:\s*1px solid var\(--border-strong\);/s,
  );
  assert.doesNotMatch(styles, /\.auth2-input \+ \.auth2-input/);
  assert.match(
    styles,
    /\.auth2-field-label\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\);/s,
  );
  assert.match(
    styles,
    /\.auth2-optional-region\s*\{[^}]*grid-template-rows:\s*0fr;[^}]*transition:/s,
  );
  assert.match(
    styles,
    /\.auth2-optional-region\[data-open="true"\]\s*\{[^}]*grid-template-rows:\s*1fr;/s,
  );
  assert.match(experience, /placeholder="邮箱地址"/);
  assert.match(experience, /placeholder="登录密码"/);
  assert.match(
    experience,
    /loginSubmitting \? "登录中\.\.\." : "登录"[\s\S]*?<Icon name="login"/,
  );
  const authSubmitStyles = styles.match(
    /\.auth2-submit\s*\{[\s\S]*?\.auth2-foot/,
  )?.[0];
  assert.ok(authSubmitStyles);
  assert.doesNotMatch(authSubmitStyles, /box-shadow/);
  assert.match(shell, /role="tab"[\s\S]*?onClick=\{\(\) => onModeChange/);
  assert.match(forgot, /\/api\/auth\/forgot-password/);
  assert.match(forgot, /如果该邮箱已注册/);
  assert.match(shell, /<AuthShaderBackground/);
  assert.match(shell, /auth2-panel/);
  assert.match(shader, /getContext\("webgl"/);
  assert.match(styles, /\.auth2-card\s*\{[^}]*min-height:\s*100dvh;/s);
  assert.match(
    styles,
    /\.auth2-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.12fr\) minmax\(440px, 0\.88fr\);/s,
  );
});

test("member console sequences the anniversary gift before announcements", async () => {
  const [shell, dialogs, announcement, gift, settings, styles] =
    await Promise.all([
      source("components/console-shell.tsx"),
      source("components/member-portal-dialogs.tsx"),
      source("components/member-announcement-dialog.tsx"),
      source("components/anniversary-gift-dialog.tsx"),
      source("app/admin/settings/page.tsx"),
      source("app/globals.scss"),
    ]);

  assert.match(shell, /<MemberPortalDialogs/);
  assert.match(dialogs, /\/api\/portal\/anniversary-gift/);
  assert.match(dialogs, /anniversary-gift\/claim/);
  assert.match(dialogs, /<MemberAnnouncementDialog/);
  assert.match(announcement, /\/api\/portal\/announcement/);
  assert.match(announcement, /announcement\/acknowledge/);
  assert.match(announcement, /我已知晓/);
  assert.match(gift, /致一路同行的你/);
  assert.match(gift, /这张礼物票属于您/);
  assert.match(gift, /周年礼物已经到账/);
  assert.match(gift, /anniversary-gift-letter/);
  assert.match(gift, /anniversary-gift-ticket/);
  assert.match(gift, /继续/);
  assert.match(gift, /领取礼物/);
  assert.match(gift, /previewRevealed/);
  assert.match(gift, /FIRST ANNIVERSARY/);
  assert.match(settings, /周年礼物/);
  assert.match(settings, /预览礼物动画/);
  assert.match(settings, /anniversaryGiftOfferId/);
  assert.match(settings, /每次重新登录/);
  assert.match(settings, /关闭后不显示公告/);
  assert.match(styles, /@keyframes anniversary-confetti-fall/);
  assert.match(styles, /@keyframes anniversary-letter-in/);
  assert.match(styles, /@keyframes anniversary-ticket-in/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
