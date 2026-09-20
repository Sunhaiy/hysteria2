"use client";

import { useState } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { Icon } from "@/components/icon";

export function CustomSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    whileElementsMounted: autoUpdate,
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [
      offset(4),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
            maxHeight: `${Math.max(0, Math.min(320, availableHeight))}px`,
          });
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context, { enabled: !disabled }),
    useDismiss(context),
    useRole(context, { role: "listbox" }),
  ]);
  const { setReference, setFloating } = refs;

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`custom-select${open ? " open" : ""}`}>
      <button
        type="button"
        className="custom-select-trigger control"
        ref={setReference}
        {...getReferenceProps()}
        disabled={disabled}
      >
        <span>{selected?.label ?? value}</span>
        <Icon name="arrow_down" className="custom-select-chevron" />
      </button>

      {open && (
        <FloatingPortal>
          <div
            className="custom-select-dropdown"
            ref={setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`custom-select-option${opt.value === value ? " active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
