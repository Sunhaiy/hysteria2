"use client";

import { useCallback, useEffect, useState } from "react";

type ToastState = { msg: string; kind: "success" | "error" } | null;

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const showToast = useCallback(
    (msg: string, kind: "success" | "error" = "success") => {
      setToast({ msg, kind });
    },
    [],
  );

  return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
      {toast.msg}
    </div>
  );
}
