"use client";

import { useSite } from "./site-provider";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  const site = useSite();

  return (
    <span className="home-brand" aria-label={site.name}>
      <svg className="home-brand-mark" viewBox="0 0 42 42" aria-hidden="true">
        <path className="home-brand-line-a" d="M9 9v24" />
        <path className="home-brand-line-b" d="M33 7v28" />
        <path className="home-brand-link" d="m9 15 24-8M9 27l24 8M9 21h24" />
        <circle className="home-brand-node-a" cx="9" cy="9" r="3" />
        <circle className="home-brand-node-b" cx="33" cy="35" r="3" />
      </svg>
      {!compact ? <span className="home-brand-name">{site.name}</span> : null}
    </span>
  );
}
