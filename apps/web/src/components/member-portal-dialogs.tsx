"use client";

import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { AnniversaryGiftStatus } from "@/lib/types";
import { AnniversaryGiftDialog } from "./anniversary-gift-dialog";
import { useAuth } from "./auth-provider";
import { MemberAnnouncementDialog } from "./member-announcement-dialog";

export function MemberPortalDialogs() {
  const { token } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [gift, setGift] = useState<AnniversaryGiftStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<AnniversaryGiftStatus>(
      "/api/portal/anniversary-gift",
      { token, signal: controller.signal },
    )
      .then((response) => setGift(response))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setGift(null);
        }
      })
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, [token]);

  async function claim() {
    if (!token || !gift?.gift) return;
    setClaiming(true);
    setError(null);
    try {
      const response = await apiRequest<AnniversaryGiftStatus>(
        "/api/portal/anniversary-gift/claim",
        { method: "POST", token },
      );
      setGift(response);
      setRevealed(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "礼物领取失败，请稍后重试。",
      );
    } finally {
      setClaiming(false);
    }
  }

  const showGift = Boolean(
    gift?.gift && !dismissed && (gift.claimable || revealed),
  );

  if (!loaded) return null;
  if (showGift && gift?.gift) {
    return (
      <AnniversaryGiftDialog
        gift={gift.gift}
        revealed={revealed}
        claiming={claiming}
        error={error}
        onClaim={() => void claim()}
        onClose={() => setDismissed(true)}
      />
    );
  }
  return <MemberAnnouncementDialog />;
}
