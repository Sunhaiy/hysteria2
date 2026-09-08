"use client";

import { Icon } from "./icon";
import { formatBytes } from "@/lib/format";

export function DailyCheckInDialog({
  rewardBytes,
  claiming,
  claimed,
  error,
  onClaim,
  onClose,
}: {
  rewardBytes: number;
  claiming: boolean;
  claimed: boolean;
  error: string | null;
  onClaim: () => void;
  onClose: () => void;
}) {
  return (
    <div className="daily-check-in-backdrop" role="presentation">
      <section
        className={`daily-check-in-dialog${claimed ? " claimed" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-check-in-title"
      >
        <button
          className="daily-check-in-close"
          type="button"
          aria-label="关闭签到"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        <div className="daily-check-in-mark" aria-hidden="true">
          <Icon name={claimed ? "check" : "gift"} />
        </div>
        <span className="daily-check-in-kicker">DAILY CHECK-IN</span>
        <h2 id="daily-check-in-title">
          {claimed ? "今日流量已到账" : "今天也见到您了"}
        </h2>
        <p>
          {claimed
            ? "奖励已加入当前套餐周期，可以立即使用。"
            : "签到领取今日流量，轻轻一点即可加入当前套餐。"}
        </p>
        <div className="daily-check-in-ticket">
          <span>今日奖励</span>
          <strong>+{formatBytes(rewardBytes)}</strong>
          <small>本期有效 · 随当前套餐周期到期</small>
        </div>
        {error ? <div className="feedback error">{error}</div> : null}
        <button
          className="action-button daily-check-in-action"
          type="button"
          disabled={claiming}
          onClick={claimed ? onClose : onClaim}
        >
          <Icon name={claimed ? "check" : "gift"} />
          {claiming ? "正在领取..." : claimed ? "知道了" : "领取今日流量"}
        </button>
      </section>
    </div>
  );
}
