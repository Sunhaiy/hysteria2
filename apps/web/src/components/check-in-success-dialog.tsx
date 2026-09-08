"use client";

import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/format";
import { Icon } from "./icon";

export function CheckInSuccessDialog({
  rewardBytes,
  preview = false,
  onClose,
}: {
  rewardBytes: number;
  preview?: boolean;
  onClose: () => void;
}) {
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="check-in-success-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="check-in-success-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="check-in-success-title"
        aria-describedby="check-in-success-copy"
      >
        <button
          className="check-in-success-close"
          type="button"
          aria-label={preview ? "关闭签到动画预览" : "关闭签到结果"}
          title="关闭"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>

        <div className="check-in-success-animation" key={animationKey}>
          <div className="check-in-success-visual" aria-hidden="true">
            <span className="check-in-success-ring" />
            <span className="check-in-success-mark">
              <Icon name="check" />
            </span>
          </div>

          <h2 id="check-in-success-title">签到成功</h2>
          <div className="check-in-success-reward">
            <span>今日获得</span>
            <strong>+{formatBytes(rewardBytes)}</strong>
          </div>
          <p id="check-in-success-copy">
            {preview
              ? "仅预览效果，不会生成记录或发放流量"
              : "奖励已加入当前权益周期"}
          </p>
        </div>

        <div className="check-in-success-actions">
          {preview ? (
            <button
              className="ghost-button"
              type="button"
              onClick={() => setAnimationKey((current) => current + 1)}
            >
              <Icon name="refresh" />
              重新播放
            </button>
          ) : null}
          <button className="action-button" type="button" onClick={onClose}>
            {preview ? "关闭预览" : "收下奖励"}
          </button>
        </div>
      </section>
    </div>
  );
}
