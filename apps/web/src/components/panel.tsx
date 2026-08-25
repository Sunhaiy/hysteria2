import type { ReactNode } from "react";

export function Panel({
  title,
  copy,
  action,
  allowOverflow = false,
  children,
}: {
  title: string;
  copy?: string;
  action?: ReactNode;
  allowOverflow?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`panel${allowOverflow ? " panel-overflow-visible" : ""}`}
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
