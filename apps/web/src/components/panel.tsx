import type { ReactNode } from "react";

export function Panel({
  title,
  copy,
  action,
  children,
}: {
  title: string;
  copy?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
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
