"use client";

import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { useAuth } from "./auth-provider";

interface Announcement {
  title: string;
  content: string;
  version: string;
}

export function MemberAnnouncementDialog() {
  const { token } = useAuth();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<{ announcement: Announcement | null }>(
      "/api/portal/announcement",
      { token, signal: controller.signal },
    )
      .then((response) => setAnnouncement(response.announcement))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setAnnouncement(null);
        }
      });
    return () => controller.abort();
  }, [token]);

  async function acknowledge() {
    if (!token || !announcement) return;
    setAcknowledging(true);
    setError(null);
    try {
      await apiRequest("/api/portal/announcement/acknowledge", {
        method: "POST",
        token,
        body: { version: announcement.version },
      });
      setAnnouncement(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "确认失败，请检查网络后重试。",
      );
    } finally {
      setAcknowledging(false);
    }
  }

  if (!announcement) return null;

  return (
    <div className="announcement-backdrop">
      <section
        className="announcement-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-title"
        aria-describedby="announcement-content"
      >
        <span className="announcement-label">重要公告</span>
        <h2 id="announcement-title">{announcement.title}</h2>
        <div id="announcement-content" className="announcement-content">
          {announcement.content}
        </div>
        {error ? (
          <div className="feedback error" role="alert">
            {error}
          </div>
        ) : null}
        <button
          className="action-button announcement-confirm"
          type="button"
          disabled={acknowledging}
          onClick={() => void acknowledge()}
        >
          {acknowledging ? "确认中..." : "我已知晓"}
        </button>
      </section>
    </div>
  );
}
