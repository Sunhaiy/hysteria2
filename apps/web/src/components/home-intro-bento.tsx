"use client";

import { Icon } from "@/components/icon";

const TRAFFIC_BARS = [34, 52, 43, 68, 57, 76, 64, 88, 72, 94];

function NetworkGraphic() {
  return (
    <div className="home2-bento-network" aria-hidden="true">
      <span className="home2-bento-network-ring ring-one" />
      <span className="home2-bento-network-ring ring-two" />
      <span className="home2-bento-network-line line-one" />
      <span className="home2-bento-network-line line-two" />
      <span className="home2-bento-network-line line-three" />
      <span className="home2-bento-network-node node-one" />
      <span className="home2-bento-network-node node-two" />
      <span className="home2-bento-network-node node-three" />
      <span className="home2-bento-network-core">
        <Icon name="network_node" />
      </span>
    </div>
  );
}

function TrafficGraphic() {
  return (
    <div className="home2-bento-traffic" aria-hidden="true">
      <div className="home2-bento-traffic-head">
        <span>ACCOUNTED TRAFFIC</span>
        <strong>实时同步</strong>
      </div>
      <div className="home2-bento-traffic-value">128.6 GB</div>
      <div className="home2-bento-traffic-bars">
        {TRAFFIC_BARS.map((height, index) => (
          <i key={`${height}-${index}`} style={{ height: `${height}%` }} />
        ))}
      </div>
      <div className="home2-bento-traffic-meta">
        <span>已用 32%</span>
        <span>剩余 271.4 GB</span>
      </div>
    </div>
  );
}

function SpeedGraphic() {
  return (
    <div className="home2-bento-speed" aria-hidden="true">
      <div className="home2-bento-speed-dial">
        <i />
        <span>300</span>
        <small>Mbps</small>
      </div>
      <div className="home2-bento-speed-status">
        <span />
        线路状态稳定
      </div>
    </div>
  );
}

function DeviceGraphic() {
  return (
    <div className="home2-bento-devices" aria-hidden="true">
      {[
        ["platform_windows", "Windows"],
        ["platform_macos", "macOS"],
        ["platform_android", "Android"],
        ["platform_ios", "iOS"],
      ].map(([icon, label]) => (
        <span key={label}>
          <Icon name={icon} />
          <small>{label}</small>
        </span>
      ))}
    </div>
  );
}

function SupportGraphic() {
  return (
    <div className="home2-bento-support" aria-hidden="true">
      <div className="home2-bento-support-status">
        <span />
        SERVICE ONLINE
      </div>
      <div className="home2-bento-support-row is-long" />
      <div className="home2-bento-support-row" />
      <div className="home2-bento-support-message">
        <Icon name="portal_tickets" />
        <span>
          <strong>工单已响应</strong>
          <small>刚刚</small>
        </span>
      </div>
    </div>
  );
}

const INTRO_CARDS = [
  {
    eyebrow: "01 / STABILITY",
    title: "高峰时段，依然从容",
    description:
      "持续观察线路状态并保留服务余量，让日常浏览、影音与远程协作都保持稳定。",
    graphic: <NetworkGraphic />,
    className: "is-wide is-network",
  },
  {
    eyebrow: "02 / CLARITY",
    title: "每一份流量，都看得明白",
    description:
      "计费流量、剩余额度与近期趋势清晰呈现，使用情况不再依赖猜测。",
    graphic: <TrafficGraphic />,
    className: "is-wide is-traffic",
  },
  {
    eyebrow: "03 / SPEED",
    title: "为真实使用保留余量",
    description: "线路与套餐能力清晰匹配，在需要速度的时候保持从容。",
    graphic: <SpeedGraphic />,
    className: "is-compact is-speed",
  },
  {
    eyebrow: "04 / DEVICES",
    title: "设备切换，无需重新适应",
    description: "覆盖常用桌面与移动平台，一份订阅即可连接多个使用场景。",
    graphic: <DeviceGraphic />,
    className: "is-compact is-devices",
  },
  {
    eyebrow: "05 / SUPPORT",
    title: "遇到问题，始终有人回应",
    description: "从订阅接入到线路异常，站内工单完整记录每一次沟通。",
    graphic: <SupportGraphic />,
    className: "is-compact is-support",
  },
] as const;

export function HomeIntroBento({ siteName }: { siteName: string }) {
  return (
    <section className="home2-intro" aria-labelledby="home2-intro-title">
      <header className="home2-intro-heading">
        <div>
          <span className="home2-section-index">01 / WHY {siteName}</span>
          <h2 id="home2-intro-title">连接之外，更在意每一次使用体验</h2>
        </div>
        <p>
          从线路状态、流量计费到多端接入，把复杂的技术留在背后，把清晰、稳定和安心留给你。
        </p>
      </header>

      <div className="home2-bento-grid">
        {INTRO_CARDS.map((card) => (
          <article
            className={`home2-bento-card ${card.className}`}
            key={card.eyebrow}
          >
            <div className="home2-bento-graphic">{card.graphic}</div>
            <div className="home2-bento-copy">
              <span>{card.eyebrow}</span>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
