"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { apiRequest } from "@/lib/api";
import { apiBaseUrl } from "@/lib/config";
import { portalNav } from "@/lib/copy";

type PlatformId = "windows" | "macos" | "android" | "ios";
type TutorialImage = {
  id: string;
  originalName: string;
  width?: number | null;
  height?: number | null;
  url: string;
  thumbnailUrl: string;
};
type TutorialStep = {
  id: string;
  title: string;
  body: string;
  sortOrder: number;
  image?: TutorialImage | null;
};
type TutorialPlatform = {
  id: string;
  platform: PlatformId;
  name: string;
  meta: string;
  clientName: string;
  externalUrl?: string | null;
  asset?: { originalName: string; size: number; downloadUrl: string } | null;
  revision?: { id: string; version: number; steps: TutorialStep[] } | null;
};

const platformOrder: Record<PlatformId, number> = {
  windows: 0,
  android: 1,
  macos: 2,
  ios: 3,
};

const defaultSteps = (clientName: string): TutorialStep[] => [
  {
    id: "install",
    title: `安装 ${clientName}`,
    body: `从可信渠道安装 ${clientName}。`,
    sortOrder: 0,
  },
  {
    id: "copy",
    title: "复制 Mihomo 订阅链接",
    body: "在接入信息页复制专属订阅链接，请勿分享给他人。",
    sortOrder: 1,
  },
  {
    id: "import",
    title: "添加并更新订阅",
    body: `在 ${clientName} 中添加远程订阅并完成首次更新。`,
    sortOrder: 2,
  },
  {
    id: "connect",
    title: "启用自动节点",
    body: "选择自动节点策略并启用系统代理或 VPN 权限。",
    sortOrder: 3,
  },
];

const FALLBACK: TutorialPlatform[] = [
  {
    id: "windows",
    platform: "windows",
    name: "Windows",
    meta: "电脑",
    clientName: "Clash Verge Rev",
    revision: {
      id: "windows",
      version: 1,
      steps: defaultSteps("Clash Verge Rev"),
    },
  },
  {
    id: "android",
    platform: "android",
    name: "Android",
    meta: "手机 / 平板",
    clientName: "Clash Meta",
    revision: {
      id: "android",
      version: 1,
      steps: defaultSteps("Clash Meta"),
    },
  },
  {
    id: "macos",
    platform: "macos",
    name: "macOS",
    meta: "Mac",
    clientName: "Clash Verge Rev",
    revision: {
      id: "macos",
      version: 1,
      steps: defaultSteps("Clash Verge Rev"),
    },
  },
  {
    id: "ios",
    platform: "ios",
    name: "iOS",
    meta: "iPhone / iPad",
    clientName: "Stash",
    revision: { id: "ios", version: 1, steps: defaultSteps("Stash") },
  },
];

const absoluteApiUrl = (path: string) =>
  `${apiBaseUrl.replace(/\/$/, "")}${path}`;

export default function TutorialPage() {
  const [platforms, setPlatforms] = useState(FALLBACK);
  const [platformId, setPlatformId] = useState<PlatformId>("windows");
  const [loading, setLoading] = useState(true);
  const platform =
    platforms.find((item) => item.platform === platformId) ?? platforms[0];

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<{ platforms: TutorialPlatform[] }>("/api/tutorials", {
      signal: controller.signal,
    })
      .then((data) => {
        if (data.platforms.length) {
          setPlatforms(
            [...data.platforms].sort(
              (left, right) =>
                platformOrder[left.platform] - platformOrder[right.platform],
            ),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const downloadUrl = platform.asset
    ? absoluteApiUrl(platform.asset.downloadUrl)
    : platform.externalUrl;

  if (loading) {
    return (
      <ConsoleShell
        title="Clash 使用教程"
        subtitle="选择设备并导入 Mihomo YAML 订阅"
        scope="Member"
        navItems={portalNav}
        requireRole="member"
      >
        <PageSkeleton variant="detail" />
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title="Clash 使用教程"
      subtitle="选择设备并导入 Mihomo YAML 订阅"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
    >
      <section className="tutorial-layout">
        <div className="tutorial-tabs" role="tablist" aria-label="选择设备平台">
          {platforms.map((item) => (
            <button
              key={item.platform}
              type="button"
              role="tab"
              aria-selected={item.platform === platformId}
              className={`tutorial-tab${item.platform === platformId ? " active" : ""}`}
              onClick={() => setPlatformId(item.platform)}
            >
              <span className="tutorial-platform-mark" aria-hidden="true">
                {item.platform === "windows"
                  ? "W"
                  : item.platform === "macos"
                    ? "M"
                    : item.platform === "android"
                      ? "A"
                      : "i"}
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.clientName} · {item.meta}
                </small>
              </span>
            </button>
          ))}
        </div>
        <Panel
          title={`${platform.name} · ${platform.clientName}`}
          action={
            <span className="badge success">
              已发布 v{platform.revision?.version ?? 1}
            </span>
          }
        >
          <div className="tutorial-download-card">
            <div>
              <span className="fine-print">客户端</span>
              <strong>
                {platform.asset?.originalName ?? platform.clientName}
              </strong>
            </div>
            {downloadUrl ? (
              <a
                className="action-button"
                href={downloadUrl}
                target={platform.asset ? undefined : "_blank"}
                rel="noreferrer"
              >
                <Icon name="download" />
                下载安装
              </a>
            ) : (
              <span className="badge neutral">请从官方应用商店安装</span>
            )}
            <Link className="ghost-button" href="/portal/access">
              <Icon name="qr_code_2" />
              打开订阅
            </Link>
          </div>
          <ol className="tutorial-steps">
            {(platform.revision?.steps ?? []).map((step, index) => (
              <li key={step.id} className="tutorial-step">
                <span className="tutorial-step-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="tutorial-step-content">
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                  {step.image ? (
                    <Image
                      src={absoluteApiUrl(step.image.thumbnailUrl)}
                      alt={step.title}
                      width={step.image.width ?? 720}
                      height={step.image.height ?? 480}
                      sizes="(max-width: 720px) 88vw, 720px"
                      loading="lazy"
                      unoptimized
                      className="tutorial-step-image"
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </section>
    </ConsoleShell>
  );
}
