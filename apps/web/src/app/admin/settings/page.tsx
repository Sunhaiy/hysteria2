"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
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
    purchaseMode: "balance" | "cdk";
    buyButtonText: string;
    cdkButtonText: string;
    cdkButtonUrl: string;
    purchaseNotice: {
      enabled: boolean;
      title: string;
      content: string;
    };
  };
  payment: {
    checkoutMode: "store" | "epay";
    epay: {
      gatewayUrl: string;
      merchantId: string;
      merchantKeySet: boolean;
      paymentType: "alipay" | "wxpay" | "qqpay";
      configured: boolean;
      notifyUrl: string;
      returnUrl: string;
      successUrl: string;
    };
  };
  site: {
    name: string;
    description: string;
    browserTitle: string;
    iconUrl: string;
    fontWeight: number;
  };
  registrationEnabled: boolean;
  announcement: {
    enabled: boolean;
    title: string;
    content: string;
    version: string;
  };
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
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("服务公告");
  const [announcementContent, setAnnouncementContent] = useState("");
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
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
  const [siteFontWeight, setSiteFontWeight] = useState(400);
  const [savingSite, setSavingSite] = useState(false);
  const [buyButtonText, setBuyButtonText] = useState("");
  const [cdkButtonText, setCdkButtonText] = useState("");
  const [cdkButtonUrl, setCdkButtonUrl] = useState("");
  const [purchaseNoticeEnabled, setPurchaseNoticeEnabled] = useState(false);
  const [purchaseNoticeTitle, setPurchaseNoticeTitle] = useState("买前须知");
  const [purchaseNoticeContent, setPurchaseNoticeContent] = useState("");
  const [savingPurchaseNotice, setSavingPurchaseNotice] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState<"store" | "epay">("store");
  const [epayGatewayUrl, setEpayGatewayUrl] = useState("");
  const [epayMerchantId, setEpayMerchantId] = useState("");
  const [epayMerchantKey, setEpayMerchantKey] = useState("");
  const [epayMerchantKeySet, setEpayMerchantKeySet] = useState(false);
  const [epayPaymentType, setEpayPaymentType] = useState<
    "alipay" | "wxpay" | "qqpay"
  >("alipay");
  const [epayConfigured, setEpayConfigured] = useState(false);
  const [epayNotifyUrl, setEpayNotifyUrl] = useState("");
  const [epayReturnUrl, setEpayReturnUrl] = useState("");
  const [savingBranding, setSavingBranding] = useState(false);
  const applySettings = useCallback((data: SettingsResponse) => {
    setHost(data.smtp.host);
    setPort(String(data.smtp.port));
    setUser(data.smtp.user);
    setFrom(data.smtp.from);
    setPassSet(data.smtp.passSet);
    setConfigured(data.smtp.configured);
    setRegistrationEnabled(data.registrationEnabled);
    setAnnouncementEnabled(data.announcement.enabled);
    setAnnouncementTitle(data.announcement.title);
    setAnnouncementContent(data.announcement.content);
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
    setSiteFontWeight(data.site.fontWeight);
    setBuyButtonText(data.branding.buyButtonText);
    setCdkButtonText(data.branding.cdkButtonText);
    setCdkButtonUrl(data.branding.cdkButtonUrl);
    setPurchaseNoticeEnabled(data.branding.purchaseNotice.enabled);
    setPurchaseNoticeTitle(data.branding.purchaseNotice.title);
    setPurchaseNoticeContent(data.branding.purchaseNotice.content);
    setCheckoutMode(data.payment.checkoutMode);
    setEpayGatewayUrl(data.payment.epay.gatewayUrl);
    setEpayMerchantId(data.payment.epay.merchantId);
    setEpayMerchantKey("");
    setEpayMerchantKeySet(data.payment.epay.merchantKeySet);
    setEpayPaymentType(data.payment.epay.paymentType);
    setEpayConfigured(data.payment.epay.configured);
    setEpayNotifyUrl(data.payment.epay.notifyUrl);
    setEpayReturnUrl(data.payment.epay.returnUrl);
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

  async function saveAnnouncement() {
    if (!token) return;
    setSavingAnnouncement(true);
    setError(null);
    try {
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body: {
          announcementEnabled,
          announcementTitle,
          announcementContent,
        },
      });
      applySettings(data);
      showToast(data.announcement.enabled ? "公告已发布" : "公告已暂停展示");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "公告保存失败。");
    } finally {
      setSavingAnnouncement(false);
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
        body: {
          siteName,
          siteDescription,
          siteBrowserTitle,
          siteIconUrl,
          siteFontWeight,
        },
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
      const body: Record<string, unknown> = {
        checkoutMode,
        epayGatewayUrl,
        epayMerchantId,
        epayPaymentType,
        purchaseMode: checkoutMode === "store" ? "cdk" : "balance",
        buyButtonText,
        cdkButtonText,
        cdkButtonUrl,
      };
      if (epayMerchantKey.trim()) {
        body.epayMerchantKey = epayMerchantKey;
      }
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body,
      });
      applySettings(data);
      showToast(
        data.payment.checkoutMode === "store"
          ? "已启用店铺链接购买"
          : "已启用易支付",
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败。");
    } finally {
      setSavingBranding(false);
    }
  }

  async function savePurchaseNotice() {
    if (!token) return;
    setSavingPurchaseNotice(true);
    setError(null);
    try {
      const data = await apiRequest<SettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        token,
        body: {
          purchaseNoticeEnabled,
          purchaseNoticeTitle,
          purchaseNoticeContent,
        },
      });
      applySettings(data);
      showToast(
        data.branding.purchaseNotice.enabled
          ? "买前须知已展示"
          : "买前须知已关闭",
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "买前须知保存失败。",
      );
    } finally {
      setSavingPurchaseNotice(false);
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
        <PageSkeleton variant="settings" />
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
              <label className="field typography-weight-field">
                <span className="setting-range-heading">
                  <span className="fine-print">界面基础字重</span>
                  <output>{siteFontWeight}</output>
                </span>
                <input
                  className="range-control"
                  type="range"
                  min={350}
                  max={600}
                  step={50}
                  value={siteFontWeight}
                  onChange={(event) =>
                    setSiteFontWeight(Number(event.target.value))
                  }
                />
                <span
                  className="typography-weight-preview"
                  style={{ fontWeight: siteFontWeight }}
                >
                  中文界面预览 · Interface 123
                </span>
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
            title="会员公告"
            copy="启用后，会员每次重新登录都会看到公告弹窗；点击我已知晓后，本次登录内不再重复显示。关闭后不显示公告。"
          >
            <div className="setting-toggle-row">
              <div className="setting-toggle-copy">
                <strong>
                  {announcementEnabled ? "向会员展示公告" : "暂停公告展示"}
                </strong>
                <span>
                  {announcementEnabled
                    ? "每个新登录会话都需要确认一次。"
                    : "会员端当前不会显示公告。"}
                </span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={announcementEnabled}
                  onChange={(event) =>
                    setAnnouncementEnabled(event.target.checked)
                  }
                />
                <span className="toggle-track" aria-hidden="true">
                  <span />
                </span>
                <span className="toggle-label">
                  {announcementEnabled ? "已开启" : "已关闭"}
                </span>
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                <span className="fine-print">公告标题</span>
                <input
                  className="control"
                  value={announcementTitle}
                  onChange={(event) => setAnnouncementTitle(event.target.value)}
                  maxLength={80}
                  placeholder="服务公告"
                />
              </label>
              <label className="field">
                <span className="fine-print">公告正文</span>
                <textarea
                  className="control announcement-editor"
                  value={announcementContent}
                  onChange={(event) =>
                    setAnnouncementContent(event.target.value)
                  }
                  maxLength={6000}
                  placeholder="填写需要会员确认的重要内容"
                  rows={7}
                />
              </label>
            </div>
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={
                  savingAnnouncement ||
                  (announcementEnabled && !announcementContent.trim())
                }
                onClick={() => void saveAnnouncement()}
              >
                {savingAnnouncement ? "保存中..." : "保存公告"}
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
            title="商城买前须知"
            copy="启用后固定展示在会员套餐页最顶部，适合说明流量重置、有效期、退款或购买限制。"
          >
            <div className="setting-toggle-row">
              <div className="setting-toggle-copy">
                <strong>
                  {purchaseNoticeEnabled ? "展示买前须知" : "隐藏买前须知"}
                </strong>
                <span>
                  {purchaseNoticeEnabled
                    ? "会员进入套餐页后会首先看到这段内容。"
                    : "套餐页当前不会显示买前提示。"}
                </span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={purchaseNoticeEnabled}
                  onChange={(event) =>
                    setPurchaseNoticeEnabled(event.target.checked)
                  }
                />
                <span className="toggle-track" aria-hidden="true">
                  <span />
                </span>
                <span className="toggle-label">
                  {purchaseNoticeEnabled ? "已开启" : "已关闭"}
                </span>
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                <span className="fine-print">标题</span>
                <input
                  className="control"
                  value={purchaseNoticeTitle}
                  onChange={(event) =>
                    setPurchaseNoticeTitle(event.target.value)
                  }
                  maxLength={80}
                  placeholder="买前须知"
                />
              </label>
              <label className="field">
                <span className="fine-print">正文</span>
                <textarea
                  className="control announcement-editor"
                  value={purchaseNoticeContent}
                  onChange={(event) =>
                    setPurchaseNoticeContent(event.target.value)
                  }
                  maxLength={4000}
                  placeholder="每行填写一条需要用户购买前了解的内容"
                  rows={6}
                />
              </label>
            </div>
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={
                  savingPurchaseNotice ||
                  (purchaseNoticeEnabled && !purchaseNoticeContent.trim())
                }
                onClick={() => void savePurchaseNotice()}
              >
                {savingPurchaseNotice ? "保存中..." : "保存买前须知"}
              </button>
            </div>
          </Panel>

          <Panel
            title="购买与支付"
            copy="会员购买时只会使用当前选择的一个渠道。店铺模式直接跳转商品或周期链接；易支付模式在站内创建订单并跳转支付网关。"
          >
            <div className="form-grid">
              <div className="field">
                <span className="fine-print">当前购买渠道</span>
                <div className="segmented-control" aria-label="购买渠道">
                  <button
                    className={checkoutMode === "store" ? "active" : ""}
                    type="button"
                    aria-pressed={checkoutMode === "store"}
                    onClick={() => setCheckoutMode("store")}
                  >
                    店铺链接
                  </button>
                  <button
                    className={checkoutMode === "epay" ? "active" : ""}
                    type="button"
                    aria-pressed={checkoutMode === "epay"}
                    onClick={() => setCheckoutMode("epay")}
                  >
                    易支付
                  </button>
                </div>
              </div>
              {checkoutMode === "store" ? (
                <>
                  <div className="two-col">
                    <label className="field">
                      <span className="fine-print">购买按钮文案</span>
                      <input
                        className="control"
                        value={buyButtonText}
                        onChange={(event) =>
                          setBuyButtonText(event.target.value)
                        }
                        placeholder="立即购买"
                      />
                    </label>
                    <label className="field">
                      <span className="fine-print">兑换入口文案</span>
                      <input
                        className="control"
                        value={cdkButtonText}
                        onChange={(event) =>
                          setCdkButtonText(event.target.value)
                        }
                        placeholder="CDK 兑换"
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span className="fine-print">全局店铺链接</span>
                    <input
                      className="control"
                      value={cdkButtonUrl}
                      onChange={(event) => setCdkButtonUrl(event.target.value)}
                      placeholder="https://shop.example.com"
                    />
                    <span className="fine-print">
                      商品或周期配置了独立链接时优先使用；未配置时回退到这里。
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <div className="list-row">
                    <span className="muted">网关状态</span>
                    <span
                      className={`badge ${epayConfigured ? "success" : "warn"}`}
                    >
                      {epayConfigured ? "配置完整" : "等待配置"}
                    </span>
                  </div>
                  <label className="field">
                    <span className="fine-print">易支付网关地址</span>
                    <input
                      className="control mono"
                      value={epayGatewayUrl}
                      onChange={(event) =>
                        setEpayGatewayUrl(event.target.value)
                      }
                      placeholder="https://pay.example.com"
                    />
                    <span className="fine-print">
                      可填写网关根地址或完整 submit.php 地址，线上必须使用
                      HTTPS。
                    </span>
                  </label>
                  <div className="two-col">
                    <label className="field">
                      <span className="fine-print">商户 ID</span>
                      <input
                        className="control mono"
                        value={epayMerchantId}
                        onChange={(event) =>
                          setEpayMerchantId(event.target.value)
                        }
                        autoComplete="off"
                      />
                    </label>
                    <label className="field">
                      <span className="fine-print">默认支付方式</span>
                      <CustomSelect
                        value={epayPaymentType}
                        onChange={(value) =>
                          setEpayPaymentType(
                            value as "alipay" | "wxpay" | "qqpay",
                          )
                        }
                        options={[
                          { value: "alipay", label: "支付宝" },
                          { value: "wxpay", label: "微信支付" },
                          { value: "qqpay", label: "QQ 钱包" },
                        ]}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span className="fine-print">商户密钥</span>
                    <input
                      className="control mono"
                      type="password"
                      value={epayMerchantKey}
                      onChange={(event) =>
                        setEpayMerchantKey(event.target.value)
                      }
                      placeholder={
                        epayMerchantKeySet
                          ? "已设置（留空保持不变）"
                          : "填写易支付商户密钥"
                      }
                      autoComplete="new-password"
                    />
                  </label>
                  <div className="two-col">
                    <label className="field">
                      <span className="fine-print">异步通知地址</span>
                      <input
                        className="control mono"
                        value={epayNotifyUrl}
                        readOnly
                      />
                    </label>
                    <label className="field">
                      <span className="fine-print">同步返回地址</span>
                      <input
                        className="control mono"
                        value={epayReturnUrl}
                        readOnly
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={savingBranding}
                onClick={() => void saveBranding()}
              >
                {savingBranding ? "保存中..." : "保存并切换渠道"}
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
