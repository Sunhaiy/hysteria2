"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { Toast, useToast } from "@/components/toast";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";

interface OAuthProviderState {
  clientId: string;
  secretSet: boolean;
  configured: boolean;
  callbackUrl: string;
}

interface SettingsResponse {
  smtp: {
    host: string;
    port: number;
    user: string;
    from: string;
    passSet: boolean;
    configured: boolean;
  };
  oauth: {
    google: OAuthProviderState;
    github: OAuthProviderState;
  };
  branding: {
    buyButtonText: string;
    cdkButtonText: string;
    cdkButtonUrl: string;
  };
  registrationEnabled: boolean;
}

export default function AdminSettingsPage() {
  const { token } = useAuth();
  const { toast, showToast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [host, setHost] = useState("");
  const [port, setPort] = useState("465");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [passSet, setPassSet] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const [oauth, setOauth] = useState<SettingsResponse["oauth"] | null>(null);
  const [googleId, setGoogleId] = useState("");
  const [googleSecret, setGoogleSecret] = useState("");
  const [githubId, setGithubId] = useState("");
  const [githubSecret, setGithubSecret] = useState("");
  const [savingOauth, setSavingOauth] = useState(false);

  const [buyButtonText, setBuyButtonText] = useState("");
  const [cdkButtonText, setCdkButtonText] = useState("");
  const [cdkButtonUrl, setCdkButtonUrl] = useState("");
  const [savingBranding, setSavingBranding] = useState(false);

  const applySettings = useCallback((data: SettingsResponse) => {
    setHost(data.smtp.host);
    setPort(String(data.smtp.port));
    setUser(data.smtp.user);
    setFrom(data.smtp.from);
    setPassSet(data.smtp.passSet);
    setConfigured(data.smtp.configured);
    setRegistrationEnabled(data.registrationEnabled);
    setPass("");
    setOauth(data.oauth);
    setGoogleId(data.oauth.google.clientId);
    setGithubId(data.oauth.github.clientId);
    setGoogleSecret("");
    setGithubSecret("");
    setBuyButtonText(data.branding.buyButtonText);
    setCdkButtonText(data.branding.cdkButtonText);
    setCdkButtonUrl(data.branding.cdkButtonUrl);
  }, []);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", { token });
      applySettings(data);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "设置加载失败。");
    } finally {
      setLoaded(true);
    }
  }, [token, applySettings]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function save() {
    if (!token) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        smtpHost: host,
        smtpPort: Number(port) || 465,
        smtpUser: user,
        smtpFrom: from,
        registrationEnabled,
      };
      if (pass) {
        body.smtpPass = pass;
      }
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body,
      });
      applySettings(data);
      showToast("设置已保存");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function saveOauth() {
    if (!token) {
      return;
    }
    setSavingOauth(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        googleClientId: googleId,
        githubClientId: githubId,
      };
      if (googleSecret) body.googleClientSecret = googleSecret;
      if (githubSecret) body.githubClientSecret = githubSecret;
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body,
      });
      applySettings(data);
      showToast("第三方登录配置已保存");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败。");
    } finally {
      setSavingOauth(false);
    }
  }

  async function saveBranding() {
    if (!token) {
      return;
    }
    setSavingBranding(true);
    setError(null);
    try {
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body: { buyButtonText, cdkButtonText, cdkButtonUrl },
      });
      applySettings(data);
      showToast("前台按钮文案已保存");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败。");
    } finally {
      setSavingBranding(false);
    }
  }

  async function sendTest() {
    if (!token || !testTo) {
      return;
    }
    setTesting(true);
    try {
      await apiRequest("/api/admin/settings/test-email", {
        method: "POST",
        token,
        body: { to: testTo },
      });
      showToast(configured ? "测试邮件已发送，请查收" : "未配置 SMTP，验证码已写入后端日志");
    } catch (cause) {
      showToast(cause instanceof ApiError ? cause.message : "发送失败", "error");
    } finally {
      setTesting(false);
    }
  }

  return (
    <ConsoleShell
      title="系统设置"
      subtitle="配置注册邮件 SMTP 与会员自助注册开关"
      scope="Admin"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className={`badge ${configured ? "success" : "warn"}`}>
          {configured ? "SMTP 已配置" : "SMTP 未配置"}
        </span>
      }
      toolbarActions={
        <button className="toolbar-button" type="button" onClick={() => void load()}>
          刷新
        </button>
      }
    >
      <Toast toast={toast} />
      {error ? <div className="feedback error">{error}</div> : null}

      {!loaded ? (
        <div className="skeleton-rows">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      ) : (
        <>
          <Panel
            title="会员注册"
            copy="关闭后，会员将无法通过邮箱验证码自助注册（登录与已注册账号不受影响）。"
          >
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={registrationEnabled}
                onChange={(event) => setRegistrationEnabled(event.target.checked)}
              />
              <span>{registrationEnabled ? "已开放自助注册" : "已关闭自助注册"}</span>
            </label>
          </Panel>

          <Panel
            title="注册邮件 SMTP"
            copy="用于发送注册验证码。465 端口走 SSL，587 走 STARTTLS。密码/授权码不会回显，留空表示保持不变。"
          >
            <div className="form-grid">
              <label className="field">
                <span className="fine-print">SMTP 主机</span>
                <input
                  className="control"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="smtp.qq.com"
                />
              </label>
              <label className="field">
                <span className="fine-print">端口</span>
                <input
                  className="control"
                  value={port}
                  onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="465"
                  inputMode="numeric"
                />
              </label>
              <label className="field">
                <span className="fine-print">账号</span>
                <input
                  className="control"
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                  placeholder="you@qq.com"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span className="fine-print">密码 / 授权码</span>
                <input
                  className="control"
                  type="password"
                  value={pass}
                  onChange={(event) => setPass(event.target.value)}
                  placeholder={passSet ? "已设置（留空保持不变）" : "请输入授权码"}
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span className="fine-print">发件人地址（可选）</span>
                <input
                  className="control"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  placeholder="留空则使用账号地址"
                />
              </label>
            </div>
            <div className="toolbar-actions">
              <button className="action-button" type="button" disabled={saving} onClick={() => void save()}>
                {saving ? "保存中..." : "保存设置"}
              </button>
            </div>
          </Panel>

          <Panel
            title="前台按钮文案"
            copy="自定义会员套餐页两个按钮的文字。CDK 按钮链接可填站内路径（如 /portal/redeem）或完整外链（http 开头，新标签打开）。"
          >
            <div className="form-grid">
              <div className="two-col">
                <label className="field">
                  <span className="fine-print">购买按钮文案</span>
                  <input
                    className="control"
                    value={buyButtonText}
                    onChange={(event) => setBuyButtonText(event.target.value)}
                    placeholder="购买"
                  />
                </label>
                <label className="field">
                  <span className="fine-print">CDK 按钮文案</span>
                  <input
                    className="control"
                    value={cdkButtonText}
                    onChange={(event) => setCdkButtonText(event.target.value)}
                    placeholder="cdk充值"
                  />
                </label>
              </div>
              <label className="field">
                <span className="fine-print">CDK 按钮链接</span>
                <input
                  className="control"
                  value={cdkButtonUrl}
                  onChange={(event) => setCdkButtonUrl(event.target.value)}
                  placeholder="/portal/redeem 或 https://t.me/yourbot"
                />
              </label>
            </div>
            <div className="toolbar-actions">
              <button className="action-button" type="button" disabled={savingBranding} onClick={() => void saveBranding()}>
                {savingBranding ? "保存中..." : "保存按钮文案"}
              </button>
            </div>
          </Panel>

          <Panel
            title="第三方登录（OAuth）"
            copy="去 Google / GitHub 创建 OAuth 应用，把下方回调地址填进去，再回来填 Client ID/Secret。密钥不会回显，留空表示保持不变。"
          >
            <div className="form-grid">
              <div className="list-row">
                <span className="muted">Google 状态</span>
                <span className={`badge ${oauth?.google.configured ? "success" : "warn"}`}>
                  {oauth?.google.configured ? "已启用" : "未配置"}
                </span>
              </div>
              <label className="field">
                <span className="fine-print">Google 回调地址（填到 Google 控制台）</span>
                <input className="control mono" value={oauth?.google.callbackUrl ?? ""} readOnly />
              </label>
              <label className="field">
                <span className="fine-print">Google Client ID</span>
                <input
                  className="control"
                  value={googleId}
                  onChange={(event) => setGoogleId(event.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span className="fine-print">Google Client Secret</span>
                <input
                  className="control"
                  type="password"
                  value={googleSecret}
                  onChange={(event) => setGoogleSecret(event.target.value)}
                  placeholder={oauth?.google.secretSet ? "已设置（留空保持不变）" : "请输入 Secret"}
                  autoComplete="new-password"
                />
              </label>

              <div className="list-row" style={{ marginTop: 8 }}>
                <span className="muted">GitHub 状态</span>
                <span className={`badge ${oauth?.github.configured ? "success" : "warn"}`}>
                  {oauth?.github.configured ? "已启用" : "未配置"}
                </span>
              </div>
              <label className="field">
                <span className="fine-print">GitHub 回调地址（填到 GitHub OAuth App）</span>
                <input className="control mono" value={oauth?.github.callbackUrl ?? ""} readOnly />
              </label>
              <label className="field">
                <span className="fine-print">GitHub Client ID</span>
                <input
                  className="control"
                  value={githubId}
                  onChange={(event) => setGithubId(event.target.value)}
                  placeholder="Iv1.xxxxxxxx"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span className="fine-print">GitHub Client Secret</span>
                <input
                  className="control"
                  type="password"
                  value={githubSecret}
                  onChange={(event) => setGithubSecret(event.target.value)}
                  placeholder={oauth?.github.secretSet ? "已设置（留空保持不变）" : "请输入 Secret"}
                  autoComplete="new-password"
                />
              </label>
            </div>
            <div className="toolbar-actions">
              <button className="action-button" type="button" disabled={savingOauth} onClick={() => void saveOauth()}>
                {savingOauth ? "保存中..." : "保存第三方登录配置"}
              </button>
            </div>
          </Panel>

          <Panel title="发送测试邮件" copy="保存配置后，填写一个邮箱地址验证 SMTP 是否可用。">
            <div className="form-grid">
              <label className="field">
                <span className="fine-print">收件邮箱</span>
                <input
                  className="control"
                  value={testTo}
                  onChange={(event) => setTestTo(event.target.value)}
                  placeholder="test@example.com"
                />
              </label>
              <div className="toolbar-actions">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={testing || !testTo}
                  onClick={() => void sendTest()}
                >
                  {testing ? "发送中..." : "发送测试邮件"}
                </button>
              </div>
            </div>
          </Panel>
        </>
      )}
    </ConsoleShell>
  );
}
