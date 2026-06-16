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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
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
      <div className={`drawer${open ? " open" : ""}`} role="dialog" aria-modal="true">
        <div className="drawer-header">
          <div className="split" style={{ gap: 4 }}>
            <span className="drawer-title">{title}</span>
            {subtitle ? <span className="fine-print muted">{subtitle}</span> : null}
          </div>
          <button type="button" className="ghost-button compact" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </div>
    </>
  );
}
