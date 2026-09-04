"use client";

import { useState, type CSSProperties } from "react";
import { formatBytes } from "@/lib/format";
import type { AnniversaryGiftSummary } from "@/lib/types";
import { Icon } from "./icon";

const confetti = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  x: (index * 37 + 11) % 100,
  delay: (index % 8) * 70,
  duration: 900 + (index % 5) * 120,
  rotation: (index * 47) % 180,
  color: index % 4,
}));

export function AnniversaryGiftDialog({
  gift,
  revealed,
  preview = false,
  claiming = false,
  error,
  onClaim,
  onClose,
}: {
  gift: AnniversaryGiftSummary;
  revealed: boolean;
  preview?: boolean;
  claiming?: boolean;
  error?: string | null;
  onClaim?: () => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"letter" | "ticket">("letter");
  const [previewRevealed, setPreviewRevealed] = useState(false);
  const isRevealed = revealed || previewRevealed;

  function claimGift() {
    if (preview) {
      setPreviewRevealed(true);
      return;
    }
    onClaim?.();
  }

  return (
    <div className="anniversary-gift-backdrop">
      <section
        className={`anniversary-gift-dialog ${
          isRevealed ? "revealed" : `${stage}-view`
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="anniversary-gift-title"
        aria-describedby="anniversary-gift-copy"
      >
        <button
          className="anniversary-gift-close"
          type="button"
          aria-label="关闭周年礼物"
          title="关闭"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>

        {isRevealed ? (
          <div className="anniversary-gift-stage anniversary-gift-success">
            <div className="anniversary-gift-visual" aria-hidden="true">
              <div className="anniversary-gift-confetti">
                {confetti.map((piece) => (
                  <span
                    className={`gift-confetti-color-${piece.color}`}
                    key={piece.id}
                    style={
                      {
                        "--gift-x": `${piece.x}%`,
                        "--gift-delay": `${piece.delay}ms`,
                        "--gift-duration": `${piece.duration}ms`,
                        "--gift-rotation": `${piece.rotation}deg`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              <div className="anniversary-gift-mark">
                <Icon name="check" />
              </div>
            </div>

            <span className="anniversary-gift-kicker">FIRST ANNIVERSARY</span>
            <h2 id="anniversary-gift-title">周年礼物已经到账</h2>
            <p id="anniversary-gift-copy" className="anniversary-gift-copy">
              感谢这一年的信任，这份礼物已经加入您的流量权益。
            </p>

            <div className="anniversary-gift-reward">
              <span>本次礼物</span>
              <strong>{gift.name}</strong>
              <div>
                <b>{formatBytes(gift.trafficBytes)}</b>
                <span>{gift.permanent ? "永久有效" : gift.offerName}</span>
              </div>
            </div>

            <div className="anniversary-gift-actions">
              <button
                className="action-button"
                type="button"
                onClick={onClose}
              >
                {preview ? "关闭预览" : "开心收下"}
              </button>
            </div>
          </div>
        ) : stage === "letter" ? (
          <div className="anniversary-gift-stage anniversary-gift-letter-stage">
            <span className="anniversary-gift-kicker">FIRST ANNIVERSARY</span>
            <div
              className="anniversary-gift-letter"
              aria-label="一周年手写纪念卡"
            >
              <div className="anniversary-gift-letter-heading">
                <span>一周年纪念函</span>
                <b aria-hidden="true">素</b>
              </div>
              <h2 id="anniversary-gift-title">致一路同行的你</h2>
              <div
                id="anniversary-gift-copy"
                className="anniversary-gift-letter-message"
              >
                <p>见字如面：</p>
                <p>
                  从第一次连接到今天，您已经与素心 Network
                  一起走过整整一年的有效订阅时光。
                </p>
                <p>
                  谢谢您把每一次出发交给我们。今天，我们也想认真地回赠一份心意。
                </p>
              </div>
              <div className="anniversary-gift-letter-signature">
                <span>素心 Network</span>
                <small>写于我们的第一个周年纪念日</small>
              </div>
            </div>
            <div className="anniversary-gift-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={onClose}
              >
                稍后再领
              </button>
              <button
                className="action-button"
                type="button"
                onClick={() => setStage("ticket")}
              >
                继续
                <Icon name="arrow_forward" />
              </button>
            </div>
          </div>
        ) : (
          <div className="anniversary-gift-stage anniversary-gift-ticket-stage">
            <span className="anniversary-gift-kicker">YOUR ANNIVERSARY GIFT</span>
            <h2 id="anniversary-gift-title">这张礼物票属于您</h2>
            <p id="anniversary-gift-copy" className="anniversary-gift-copy">
              一份不设期限的周年心意，确认后将直接存入您的流量权益。
            </p>

            <div className="anniversary-gift-ticket">
              <div className="anniversary-gift-ticket-main">
                <span>SU XIN · ANNIVERSARY PASS</span>
                <small>永久流量权益</small>
                <strong>{formatBytes(gift.trafficBytes)}</strong>
                <p>{gift.name}</p>
              </div>
              <div className="anniversary-gift-ticket-stub">
                <span>VALID</span>
                <strong>{gift.permanent ? "永久" : gift.offerName}</strong>
                <small>NO. 0001</small>
              </div>
            </div>

            <div className="anniversary-gift-ticket-note">
              <Icon name="check" />
              仅限当前账号领取一次，领取后立即生效
            </div>

            {error ? (
              <div className="feedback error" role="alert">
                {error}
              </div>
            ) : null}

            <div className="anniversary-gift-actions">
              <button
                className="ghost-button"
                type="button"
                disabled={claiming}
                onClick={() => setStage("letter")}
              >
                返回卡片
              </button>
              <button
                className="action-button"
                type="button"
                disabled={claiming}
                onClick={claimGift}
              >
                <Icon name="redeem" />
                {claiming ? "正在领取..." : "领取礼物"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
