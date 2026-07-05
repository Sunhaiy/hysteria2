"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { apiRequest } from "@/lib/api";
import { apiBaseUrl } from "@/lib/config";
import { portalNav } from "@/lib/copy";

type PlatformId = "windows" | "android" | "ios";

interface TutorialPlatform {
  id: PlatformId;
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

const FALLBACK_PLATFORMS: TutorialPlatform[] = [
  {
    id: "windows",
    name: "Windows",
    meta: "电脑",
    client: "v2rayN",
    steps: [
      "下载并安装 v2rayN 客户端",
      "复制一键订阅链接",
      "在订阅分组中添加订阅",
      "更新订阅并启用系统代理",
    ],
    externalUrl: "",
    asset: null,
  },
  {
    id: "android",
    name: "Android",
    meta: "手机 / 平板",
    client: "Hiddify",
    steps: [
      "下载并安装 Hiddify 客户端",
      "复制一键订阅链接",
      "从剪贴板添加配置",
      "允许 VPN 权限并开始连接",
    ],
    externalUrl: "",
    asset: null,
  },
  {
    id: "ios",
    name: "iOS",
    meta: "iPhone / iPad",
    client: "sing-box",
    steps: [
      "从 App Store 安装 sing-box",
      "复制订阅或配置地址",
      "添加远程配置",
      "允许 VPN 权限并启动连接",
    ],
    externalUrl: "",
    asset: null,
  },
];

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function TutorialPage() {
  const [platforms, setPlatforms] = useState(FALLBACK_PLATFORMS);
  const [platformId, setPlatformId] = useState<PlatformId>("windows");
  const [loading, setLoading] = useState(true);
  const platform =
    platforms.find((item) => item.id === platformId) ?? platforms[0];

  useEffect(() => {
    let active = true;
    void apiRequest<{ platforms: TutorialPlatform[] }>("/api/tutorial-assets")
      .then((data) => {
        if (active && data.platforms.length) setPlatforms(data.platforms);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const downloadUrl = platform.asset
    ? `${apiBaseUrl}${platform.asset.downloadUrl}`
    : platform.externalUrl;

  return (
    <ConsoleShell
      title="使用教程"
      subtitle="选择设备，下载客户端并按步骤导入订阅"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
    >
      <section className="tutorial-layout">
        <div className="tutorial-tabs" role="tablist" aria-label="选择设备平台">
          {platforms.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === platformId}
              className={`tutorial-tab${item.id === platformId ? " active" : ""}`}
              onClick={() => setPlatformId(item.id)}
            >
              <span className="tutorial-platform-mark" aria-hidden="true">
                {item.id === "windows"
                  ? "W"
                  : item.id === "android"
                    ? "A"
                    : "i"}
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.client} · {item.meta}
                </small>
              </span>
            </button>
          ))}
        </div>

        <Panel
          title={`${platform.name} · ${platform.client}`}
          copy={`使用 ${platform.client} 完成配置导入和连接。`}
          action={
            platform.asset ? (
              <span className="badge success">安装包已就绪</span>
            ) : null
          }
        >
          <div className="tutorial-download-card">
            <div>
              <span className="fine-print">客户端</span>
              <strong>{platform.asset?.originalName ?? platform.client}</strong>
              <p>
                {platform.asset
                  ? `${formatFileSize(platform.asset.size)} · 由站点提供`
                  : platform.id === "ios"
                    ? "通过 App Store 或管理员指定渠道安装"
                    : "管理员暂未上传安装包"}
              </p>
            </div>
            {downloadUrl ? (
              <a
                className="action-button"
                href={downloadUrl}
                target={platform.asset ? undefined : "_blank"}
                rel="noreferrer"
              >
                <Icon name="add" />
                {platform.asset
                  ? "下载安装包"
                  : platform.id === "ios"
                    ? "前往安装"
                    : "外部下载"}
              </a>
            ) : (
              <button className="action-button" type="button" disabled>
                {loading ? "正在获取下载信息" : "下载暂未开放"}
              </button>
            )}
            <Link className="ghost-button" href="/portal/access">
              <Icon name="qr_code_2" />
              获取接入信息
            </Link>
          </div>

          <ol className="tutorial-steps">
            {platform.steps.map((step, index) => (
              <li key={`${index}-${step}`} className="tutorial-step">
                <span className="tutorial-step-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{step}</strong>
                  <p>
                    {index === 0
                      ? `先准备好 ${platform.client} 客户端。`
                      : index === 1
                        ? "接入信息页面提供订阅链接、URI 与二维码。"
                        : "按客户端提示完成操作即可。"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </section>
    </ConsoleShell>
  );
}
