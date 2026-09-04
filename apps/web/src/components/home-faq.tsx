"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";

const FAQ_ITEMS = [
  {
    index: "01",
    eyebrow: "PAYMENT",
    question: "付款后多久可以开始使用？",
    answer:
      "在线支付确认后，订单与对应权益会自动发放。你可以在订单记录中查看支付和到账状态。",
    className: "is-wide",
  },
  {
    index: "02",
    eyebrow: "PLAN",
    question: "季付和年付的流量会一次到账吗？",
    answer:
      "季付与年付购买的是更长服务周期，套餐流量仍按月恢复，不会把数月额度一次性堆叠到账户中。",
    className: "is-wide",
  },
  {
    index: "03",
    eyebrow: "TRAFFIC PACK",
    question: "单独购买的流量包会过期吗？",
    answer:
      "永久流量包购买后长期有效，可在适用线路中持续使用，直到对应额度消耗完毕。",
    className: "is-compact",
  },
  {
    index: "04",
    eyebrow: "CLIENTS",
    question: "电脑和手机都能使用吗？",
    answer:
      "支持常见桌面与移动平台，可通过 Clash、Mihomo、v2rayN 或 Hiddify 等客户端导入订阅。",
    className: "is-compact",
  },
  {
    index: "05",
    eyebrow: "SUPPORT",
    question: "连接异常时应该怎么处理？",
    answer:
      "先确认订阅已更新；仍无法连接时，可在用户中心提交工单并保留完整沟通记录。",
    className: "is-compact",
  },
] as const;

export function HomeFaq() {
  return (
    <section className="home2-faq" id="faq" aria-labelledby="home2-faq-title">
      <header className="home2-faq-heading">
        <div>
          <span className="home2-section-index">03 / FAQ</span>
          <h2 id="home2-faq-title">开始之前，先了解这些</h2>
        </div>
        <p>
          关于购买、流量、客户端和售后支持，我们把最常见的问题整理在这里。
        </p>
      </header>

      <div className="home2-faq-grid">
        {FAQ_ITEMS.map((item) => (
          <article
            className={`home2-faq-card ${item.className}`}
            key={item.index}
          >
            <div className="home2-faq-visual" aria-hidden="true">
              <span>{item.index}</span>
              <i />
              <Icon name="puzzle" />
            </div>
            <div className="home2-faq-copy">
              <span>{item.index} / {item.eyebrow}</span>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="home2-faq-support">
        <span>没有找到需要的答案？</span>
        <Link href="/portal/tickets">
          联系工单支持
          <Icon name="arrow_forward" />
        </Link>
      </div>
    </section>
  );
}
