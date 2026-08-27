import type { ReactNode } from "react";

export function Panel({
  title,
  copy,
  action,
  allowOverflow = false,
  className,
  children,
}: {
  title: string;
  copy?: string;
  action?: ReactNode;
  allowOverflow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`panel${allowOverflow ? " panel-overflow-visible" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      <div className="panel-header">
        <div className="split">
          <h3 className="panel-title">{title}</h3>
          {copy ? <span className="panel-copy">{copy}</span> : null}
        </div>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
