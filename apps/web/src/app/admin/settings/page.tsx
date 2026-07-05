"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
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

type TutorialPlatformId = "windows" | "android" | "ios";

interface TutorialPlatformSettings {
  id: TutorialPlatformId;
  name: string;
  meta: string;
  client: string;
  steps: string[];
  externalUrl: string;
  asset: {
    originalName: string;
    size: number;
    uploadedAt: string;
    downloadUrl: string;
  } | null;
}

interface TutorialSettings {
  platforms: TutorialPlatformSettings[];
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
    purchaseMode: "balance" | "cdk";
    buyButtonText: string;
    cdkButtonText: string;
    cdkButtonUrl: string;
  };
  site: {
    name: string;
    description: string;
    browserTitle: string;
    iconUrl: string;
  };
  tutorial: TutorialSettings;
  registrationEnabled: boolean;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
  const [savingRegistration, setSavingRegistration] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const [oauth, setOauth] = useState<SettingsResponse["oauth"] | null>(null);
  const [googleId, setGoogleId] = useState("");
  const [googleSecret, setGoogleSecret] = useState("");
  const [githubId, setGithubId] = useState("");
  const [githubSecret, setGithubSecret] = useState("");
  const [savingOauth, setSavingOauth] = useState(false);

  const [siteName, setSiteName] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [siteBrowserTitle, setSiteBrowserTitle] = useState("");
  const [siteIconUrl, setSiteIconUrl] = useState("");
  const [savingSite, setSavingSite] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<"balance" | "cdk">(
    "balance",
  );
  const [buyButtonText, setBuyButtonText] = useState("");
  const [cdkButtonText, setCdkButtonText] = useState("");
  const [cdkButtonUrl, setCdkButtonUrl] = useState("");
  const [savingBranding, setSavingBranding] = useState(false);
  const [tutorial, setTutorial] = useState<TutorialSettings>({ platforms: [] });
  const [tutorialFiles, setTutorialFiles] = useState<
    Partial<Record<TutorialPlatformId, File>>
  >({});
  const [savingTutorial, setSavingTutorial] = useState(false);
  const [uploadingPlatform, setUploadingPlatform] =
    useState<TutorialPlatformId | null>(null);

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
    setSiteName(data.site.name);
    setSiteDescription(data.site.description);
    setSiteBrowserTitle(data.site.browserTitle);
    setSiteIconUrl(data.site.iconUrl);
    setPurchaseMode(data.branding.purchaseMode);
    setBuyButtonText(data.branding.buyButtonText);
    setCdkButtonText(data.branding.cdkButtonText);
    setCdkButtonUrl(data.branding.cdkButtonUrl);
    setTutorial(data.tutorial);
  }, []);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        token,
      });
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

  async function saveRegistration() {
    if (!token) return;
    setSavingRegistration(true);
    setError(null);
    try {
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body: { registrationEnabled },
      });
      applySettings(data);
      showToast(
        registrationEnabled ? "会员自助注册已开放" : "会员自助注册已关闭",
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败。");
    } finally {
      setSavingRegistration(false);
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

  async function saveSite() {
    if (!token) {
      return;
    }
    setSavingSite(true);
    setError(null);
    try {
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body: { siteName, siteDescription, siteBrowserTitle, siteIconUrl },
      });
      applySettings(data);
      window.dispatchEvent(
        new CustomEvent("site-info-updated", { detail: data.site }),
      );
      showToast("站点资料已保存");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败。");
    } finally {
      setSavingSite(false);
    }
  }

  function handleSiteIconFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 64 * 1024) {
      setError("站点图标请控制在 64 KB 以内，建议使用 64×64 PNG、ICO 或 SVG。");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSiteIconUrl(reader.result);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
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
        body: { purchaseMode, buyButtonText, cdkButtonText, cdkButtonUrl },
      });
      applySettings(data);
      showToast("前台购买设置已保存");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败。");
    } finally {
      setSavingBranding(false);
    }
  }

  function updateTutorialPlatform(
    id: TutorialPlatformId,
    patch: Partial<TutorialPlatformSettings>,
  ) {
    setTutorial((current) => ({
      platforms: current.platforms.map((platform) =>
        platform.id === id ? { ...platform, ...patch } : platform,
      ),
    }));
  }

  async function saveTutorial() {
    if (!token) return;
    setSavingTutorial(true);
    setError(null);
    const platform = (id: TutorialPlatformId) =>
      tutorial.platforms.find((item) => item.id === id);
    try {
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body: {
          tutorialWindowsClient: platform("windows")?.client ?? "v2rayN",
          tutorialWindowsSteps: platform("windows")?.steps.join("\n") ?? "",
          tutorialWindowsUrl: platform("windows")?.externalUrl ?? "",
          tutorialAndroidClient: platform("android")?.client ?? "Hiddify",
          tutorialAndroidSteps: platform("android")?.steps.join("\n") ?? "",
          tutorialAndroidUrl: platform("android")?.externalUrl ?? "",
          tutorialIosClient: platform("ios")?.client ?? "sing-box",
          tutorialIosSteps: platform("ios")?.steps.join("\n") ?? "",
          tutorialIosUrl: platform("ios")?.externalUrl ?? "",
        },
      });
      applySettings(data);
      showToast("使用教程已保存");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "教程保存失败。");
    } finally {
      setSavingTutorial(false);
    }
  }

  async function uploadTutorialApp(id: "windows" | "android") {
    if (!token || !tutorialFiles[id]) return;
    setUploadingPlatform(id);
    setError(null);
    const body = new FormData();
    body.append("file", tutorialFiles[id]);
    try {
      const data = await apiRequest<TutorialSettings>(
        `/api/admin/tutorial-assets/${id}`,
        {
          method: "POST",
          token,
          body,
        },
      );
      setTutorial(data);
      setTutorialFiles((current) => ({ ...current, [id]: undefined }));
      showToast(`${id === "windows" ? "Windows" : "Android"} 客户端已上传`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "客户端上传失败。");
    } finally {
      setUploadingPlatform(null);
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
      showToast(
        configured
          ? "测试邮件已发送，请查收"
          : "未配置 SMTP，验证码已写入后端日志",
      );
    } catch (cause) {
      showToast(
        cause instanceof ApiError ? cause.message : "发送失败",
        "error",
      );
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
        <button
          className="toolbar-button"
          type="button"
          onClick={() => void load()}
        >
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
            title="站点资料"
            copy="统一管理站点名称、浏览器标签标题与标签图标。"
          >
            <div className="form-grid">
              <label className="field">
                <span className="fine-print">站点名称</span>
                <input
                  className="control"
                  value={siteName}
                  onChange={(event) => setSiteName(event.target.value)}
                  placeholder="九玄"
                />
              </label>
              <label className="field">
                <span className="fine-print">站点简介（可选）</span>
                <input
                  className="control"
                  value={siteDescription}
                  onChange={(event) => setSiteDescription(event.target.value)}
                  placeholder="一句话介绍你的站点"
                />
              </label>
              <label className="field">
                <span className="fine-print">浏览器标签标题</span>
                <input
                  className="control"
                  value={siteBrowserTitle}
                  onChange={(event) => setSiteBrowserTitle(event.target.value)}
                  placeholder="素心Network VPN"
                  maxLength={80}
                />
              </label>
              <div className="field site-icon-field">
                <span className="fine-print">浏览器标签图标</span>
                <div className="site-icon-editor">
                  <div className="site-icon-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={siteIconUrl || "/favicon.ico"}
                      alt="站点图标预览"
                    />
                  </div>
                  <div className="site-icon-controls">
                    <input
                      className="control"
                      value={
                        siteIconUrl.startsWith("data:")
                          ? "已选择本地图标"
                          : siteIconUrl
                      }
                      onChange={(event) => setSiteIconUrl(event.target.value)}
                      onFocus={(event) => {
                        if (siteIconUrl.startsWith("data:"))
                          event.currentTarget.select();
                      }}
                      placeholder="https://example.com/favicon.png"
                    />
                    <div className="toolbar-actions">
                      <label className="toolbar-button site-icon-upload">
                        上传图标
                        <input
                          type="file"
                          accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/webp"
                          onChange={handleSiteIconFile}
                        />
                      </label>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setSiteIconUrl("/favicon.ico")}
                      >
                        恢复默认
                      </button>
                    </div>
                  </div>
                </div>
                <span className="fine-print">
                  支持图片链接或上传 64 KB 以内的小图标。
                </span>
              </div>
            </div>
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={savingSite}
                onClick={() => void saveSite()}
              >
                {savingSite ? "保存中..." : "保存站点资料"}
              </button>
            </div>
          </Panel>

          <Panel
            title="会员注册"
            copy="关闭后，会员将无法通过邮箱验证码自助注册（登录与已注册账号不受影响）。"
          >
            <div className="setting-toggle-row">
              <div className="setting-toggle-copy">
                <strong>
                  {registrationEnabled ? "允许新会员注册" : "暂停新会员注册"}
                </strong>
                <span>
                  {registrationEnabled
                    ? "访客可以通过邮箱验证码创建会员账号。"
                    : "注册入口仍会显示，但无法提交新的注册申请。"}
                </span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={registrationEnabled}
                  onChange={(event) =>
                    setRegistrationEnabled(event.target.checked)
                  }
                />
                <span className="toggle-track" aria-hidden="true">
                  <span />
                </span>
                <span className="toggle-label">
                  {registrationEnabled ? "已开启" : "已关闭"}
                </span>
              </label>
            </div>
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={savingRegistration}
                onClick={() => void saveRegistration()}
              >
                {savingRegistration ? "保存中..." : "保存注册设置"}
              </button>
            </div>
          </Panel>

          <Panel
            title="使用教程与客户端下载"
            copy="Windows 使用 v2rayN，Android 使用 Hiddify，iOS 使用 sing-box。每行填写一个操作步骤；Windows 与 Android 安装包会保存到持久目录，部署后不会丢失。"
          >
            <div className="tutorial-admin-grid">
              {tutorial.platforms.map((platform) => (
                <section className="tutorial-admin-card" key={platform.id}>
                  <div className="tutorial-admin-heading">
                    <div>
                      <strong>{platform.name}</strong>
                      <span>{platform.meta}</span>
                    </div>
                    <span className="badge info">{platform.client}</span>
                  </div>
                  <label className="field">
                    <span className="fine-print">客户端名称</span>
                    <input
                      className="control"
                      value={platform.client}
                      onChange={(event) =>
                        updateTutorialPlatform(platform.id, {
                          client: event.target.value,
                        })
                      }
                      placeholder={
                        platform.id === "windows"
                          ? "v2rayN"
                          : platform.id === "android"
                            ? "Hiddify"
                            : "sing-box"
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="fine-print">操作步骤（每行一项）</span>
                    <textarea
                      className="control tutorial-steps-editor"
                      value={platform.steps.join("\n")}
                      onChange={(event) =>
                        updateTutorialPlatform(platform.id, {
                          steps: event.target.value.split("\n"),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="fine-print">
                      {platform.id === "ios"
                        ? "App Store / 外部下载链接"
                        : "备用外部下载链接（可选）"}
                    </span>
                    <input
                      className="control"
                      value={platform.externalUrl}
                      onChange={(event) =>
                        updateTutorialPlatform(platform.id, {
                          externalUrl: event.target.value,
                        })
                      }
                      placeholder="https://..."
                    />
                  </label>
                  {platform.id !== "ios" ? (
                    <div className="tutorial-upload-box">
                      <div>
                        <strong>
                          {platform.asset?.originalName ?? "尚未上传安装包"}
                        </strong>
                        <span>
                          {platform.asset
                            ? `${formatFileSize(platform.asset.size)} · ${new Date(platform.asset.uploadedAt).toLocaleString("zh-CN")}`
                            : platform.id === "windows"
                              ? "支持 EXE、MSI、ZIP，最大 250 MB"
                              : "支持 APK，最大 250 MB"}
                        </span>
                      </div>
                      <input
                        className="control"
                        type="file"
                        accept={
                          platform.id === "windows" ? ".exe,.msi,.zip" : ".apk"
                        }
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          setTutorialFiles((current) => ({
                            ...current,
                            [platform.id]: file,
                          }));
                        }}
                      />
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={
                          !tutorialFiles[platform.id] ||
                          uploadingPlatform === platform.id
                        }
                        onClick={() =>
                          void uploadTutorialApp(
                            platform.id as "windows" | "android",
                          )
                        }
                      >
                        {uploadingPlatform === platform.id
                          ? "上传中..."
                          : platform.asset
                            ? "替换安装包"
                            : "上传安装包"}
                      </button>
                    </div>
                  ) : (
                    <p className="fine-print tutorial-ios-note">
                      iOS 不在服务器上传安装包，填写 App Store
                      或指定渠道链接即可。
                    </p>
                  )}
                </section>
              ))}
            </div>
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={savingTutorial}
                onClick={() => void saveTutorial()}
              >
                {savingTutorial ? "保存中..." : "保存教程内容"}
              </button>
            </div>
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
                  onChange={(event) =>
                    setPort(event.target.value.replace(/\D/g, "").slice(0, 5))
                  }
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
                  placeholder={
                    passSet ? "已设置（留空保持不变）" : "请输入授权码"
                  }
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
              <button
                className="action-button"
                type="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "保存中..." : "保存设置"}
              </button>
            </div>
          </Panel>

          <Panel
            title="前台购买设置"
            copy="选择会员点「购买」的行为：余额购买走站内钱包结算；CDK购买会弹出输入框，会员去店铺（下方链接）买卡后回来兑换。链接可填站内路径（/portal/redeem）或完整外链（http 开头，新标签打开）。"
          >
            <div className="form-grid">
              <label className="field">
                <span className="fine-print">购买方式</span>
                <CustomSelect
                  value={purchaseMode}
                  onChange={(v) => setPurchaseMode(v as "balance" | "cdk")}
                  options={[
                    { value: "balance", label: "余额购买（站内钱包结算）" },
                    { value: "cdk", label: "CDK购买（去店铺买卡后兑换）" },
                  ]}
                />
              </label>
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
              <button
                className="action-button"
                type="button"
                disabled={savingBranding}
                onClick={() => void saveBranding()}
              >
                {savingBranding ? "保存中..." : "保存购买设置"}
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
                <span
                  className={`badge ${oauth?.google.configured ? "success" : "warn"}`}
                >
                  {oauth?.google.configured ? "已启用" : "未配置"}
                </span>
              </div>
              <label className="field">
                <span className="fine-print">
                  Google 回调地址（填到 Google 控制台）
                </span>
                <input
                  className="control mono"
                  value={oauth?.google.callbackUrl ?? ""}
                  readOnly
                />
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
                  placeholder={
                    oauth?.google.secretSet
                      ? "已设置（留空保持不变）"
                      : "请输入 Secret"
                  }
                  autoComplete="new-password"
                />
              </label>

              <div className="list-row" style={{ marginTop: 8 }}>
                <span className="muted">GitHub 状态</span>
                <span
                  className={`badge ${oauth?.github.configured ? "success" : "warn"}`}
                >
                  {oauth?.github.configured ? "已启用" : "未配置"}
                </span>
              </div>
              <label className="field">
                <span className="fine-print">
                  GitHub 回调地址（填到 GitHub OAuth App）
                </span>
                <input
                  className="control mono"
                  value={oauth?.github.callbackUrl ?? ""}
                  readOnly
                />
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
                  placeholder={
                    oauth?.github.secretSet
                      ? "已设置（留空保持不变）"
                      : "请输入 Secret"
                  }
                  autoComplete="new-password"
                />
              </label>
            </div>
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={savingOauth}
                onClick={() => void saveOauth()}
              >
                {savingOauth ? "保存中..." : "保存第三方登录配置"}
              </button>
            </div>
          </Panel>

          <Panel
            title="发送测试邮件"
            copy="保存配置后，填写一个邮箱地址验证 SMTP 是否可用。"
          >
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
