export function HeroGlobe({ className = "lp-globe" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 460 460" role="img" aria-label="全球节点示意">
      <defs>
        <pattern id="lp-dots" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.15" fill="var(--accent-500)" />
        </pattern>
        <radialGradient id="lp-sphere" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="62%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--accent-500)" stopOpacity="0.16" />
        </radialGradient>
        <clipPath id="lp-clip">
          <circle cx="230" cy="200" r="140" />
        </clipPath>
      </defs>

      <ellipse cx="230" cy="372" rx="168" ry="34" fill="var(--accent-500)" opacity="0.10" />
      <ellipse cx="230" cy="360" rx="132" ry="26" fill="var(--accent-500)" opacity="0.08" />

      <g clipPath="url(#lp-clip)">
        <circle cx="230" cy="200" r="140" fill="var(--accent-ghost)" />
        <rect x="90" y="60" width="280" height="280" fill="url(#lp-dots)" />
        <g fill="none" stroke="var(--accent-500)" strokeOpacity="0.18">
          <ellipse cx="230" cy="200" rx="48" ry="140" />
          <ellipse cx="230" cy="200" rx="98" ry="140" />
          <ellipse cx="230" cy="200" rx="140" ry="48" />
          <ellipse cx="230" cy="200" rx="140" ry="98" />
        </g>
        <circle cx="230" cy="200" r="140" fill="url(#lp-sphere)" />
      </g>
      <circle cx="230" cy="200" r="140" fill="none" stroke="var(--accent-500)" strokeOpacity="0.28" />

      <g transform="rotate(-18 230 200)">
        <ellipse cx="230" cy="200" rx="195" ry="74" fill="none" stroke="var(--accent-500)" strokeOpacity="0.45" strokeDasharray="2 6" strokeLinecap="round" />
        <circle cx="425" cy="200" r="6" fill="var(--accent-500)" />
      </g>
    </svg>
  );
}
