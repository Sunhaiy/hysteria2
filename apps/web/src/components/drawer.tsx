"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  isDirty,
}: {
  open: boolean;
  /** Page-owned close handler — include dirty-check logic here */
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
  /** Shows an "未保存" badge next to the title */
  isDirty?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <>
      {open ? <div className="drawer-backdrop" onClick={onClose} /> : null}
      <div
        className={`drawer${open ? " open" : ""}`}
        role="dialog"
        aria-modal={open ? "true" : undefined}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="drawer-header">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="drawer-title">{title}</span>
              {isDirty ? (
                <span className="badge warn" style={{ fontSize: 11, flexShrink: 0 }}>
                  未保存
                </span>
              ) : null}
            </div>
            {subtitle ? <span className="fine-print muted">{subtitle}</span> : null}
          </div>
          <button
            type="button"
            className="ghost-button compact"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </div>
    </>
  );
}
