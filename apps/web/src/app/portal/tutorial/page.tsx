"use client";

import Link from "next/link";
import { useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { portalNav } from "@/lib/copy";

type PlatformId = "android" | "ios" | "windows";

const PLATFORMS: Array<{
  id: PlatformId;
  name: string;
  meta: string;
  description: string;
  steps: string[];
}> = [
  {
    id: "android",
    name: "Android",
    meta: "手机 / 平板",
    description: "Android 客户端下载、安装与导入教程。",
    steps: ["下载并安装客户端", "打开接入信息并复制连接 URI", "在客户端中导入连接", "选择节点并启动连接"],
  },
  {
    id: "ios",
    name: "iOS",
    meta: "iPhone / iPad",
    description: "iOS 客户端安装、授权与导入教程。",
    steps: ["从指定渠道安装客户端", "打开接入信息并复制连接 URI", "在客户端中添加配置", "允许 VPN 权限并启动连接"],
  },
  {
    id: "windows",
    name: "Windows",
    meta: "电脑",
    description: "Windows 客户端下载、配置与连接教程。",
    steps: ["下载并解压客户端", "打开接入信息并复制连接 URI", "在客户端中导入配置", "选择节点并启动系统代理"],
  },
];

export default function TutorialPage() {
  const [platformId, setPlatformId] = useState<PlatformId>("android");
  const platform = PLATFORMS.find((item) => item.id === platformId) ?? PLATFORMS[0];

  return (
    <ConsoleShell
      title="使用教程"
      subtitle="按设备平台查看客户端下载、配置导入和连接步骤"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={<span className="badge info">Android · iOS · Windows</span>}
      toolbarActions={
        <Link className="toolbar-button" href="/portal/access">
          打开接入信息
        </Link>
      }
    >
      <section className="tutorial-layout">
        <div className="tutorial-tabs" role="tablist" aria-label="选择设备平台">
          {PLATFORMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === platformId}
              className={`tutorial-tab${item.id === platformId ? " active" : ""}`}
              onClick={() => setPlatformId(item.id)}
            >
              <span className="tutorial-platform-mark" aria-hidden="true">
                {item.id === "android" ? "A" : item.id === "ios" ? "i" : "W"}
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>{item.meta}</small>
              </span>
            </button>
          ))}
        </div>

        <Panel
          title={`${platform.name} 使用教程`}
          copy={platform.description}
          action={<span className="badge warn">内容待完善</span>}
        >
          <div className="tutorial-actions">
            <button className="action-button" type="button" disabled title="配置下载地址后启用">
              <Icon name="add" />
              客户端下载待配置
            </button>
            <Link className="ghost-button" href="/portal/access">
              <Icon name="qr_code_2" />
              获取连接信息
            </Link>
          </div>

          <ol className="tutorial-steps">
            {platform.steps.map((step, index) => (
              <li key={step} className="tutorial-step">
                <span className="tutorial-step-number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{step}</strong>
                  <p>这里可以补充详细文字、截图、下载链接和注意事项。</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </section>
    </ConsoleShell>
  );
}
