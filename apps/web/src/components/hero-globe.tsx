export function HeroGlobe({ className = "lp-globe" }: { className?: string }) {
  // A few node points on the front of the sphere + the arcs that connect them.
  const nodes = [
    { x: 175, y: 150 },
    { x: 286, y: 132 },
    { x: 300, y: 232 },
    { x: 196, y: 270 },
    { x: 250, y: 196 },
  ];
  const arcs = [
    "M175 150 Q 240 110 286 132",
    "M286 132 Q 320 185 300 232",
    "M300 232 Q 240 270 196 270",
    "M196 270 Q 165 205 175 150",
    "M175 150 Q 230 175 250 196",
  ];

  return (
    <svg className={className} viewBox="0 0 460 460" role="img" aria-label="全球节点网络">
      <defs>
        <pattern id="lp-dots" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.9" fill="var(--accent-500)" />
        </pattern>
        <radialGradient id="lp-sphere-shade" cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--accent-500)" stopOpacity="0.28" />
        </radialGradient>
        <radialGradient id="lp-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent-500)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--accent-500)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="lp-clip">
          <circle cx="230" cy="200" r="140" />
        </clipPath>
      </defs>

      {/* platform */}
      <ellipse cx="230" cy="384" rx="176" ry="30" fill="var(--accent-500)" opacity="0.08" />
      <ellipse cx="230" cy="372" rx="140" ry="24" fill="var(--accent-500)" opacity="0.10" />
      <ellipse cx="230" cy="362" rx="96" ry="16" fill="url(#lp-core)" />

      {/* sphere */}
      <g clipPath="url(#lp-clip)">
        <circle cx="230" cy="200" r="140" fill="var(--accent-ghost)" />
        <rect x="84" y="54" width="292" height="292" fill="url(#lp-dots)" />
        <g fill="none" stroke="var(--accent-500)" strokeOpacity="0.16">
          <ellipse cx="230" cy="200" rx="46" ry="140" />
          <ellipse cx="230" cy="200" rx="96" ry="140" />
          <ellipse cx="230" cy="200" rx="140" ry="46" />
          <ellipse cx="230" cy="200" rx="140" ry="96" />
        </g>

        {/* connection arcs + node points (clipped to the sphere) */}
        <g fill="none" stroke="var(--accent-500)" strokeOpacity="0.55" strokeWidth="1.2">
          {arcs.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        {nodes.map((n, i) => (
          <g key={`${n.x}-${n.y}`}>
            <circle
              cx={n.x}
              cy={n.y}
              r="9"
              fill="var(--accent-500)"
              opacity="0.18"
              className="lp-node-halo"
              style={{ animationDelay: `${i * 0.4}s` }}
            />
            <circle cx={n.x} cy={n.y} r="3.2" fill="var(--accent-500)" />
          </g>
        ))}

        <circle cx="230" cy="200" r="140" fill="url(#lp-sphere-shade)" />
      </g>

      {/* rim */}
      <circle cx="230" cy="200" r="140" fill="none" stroke="var(--accent-500)" strokeOpacity="0.35" strokeWidth="1.4" />
      <path d="M120 130 A140 140 0 0 1 320 120" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />

      {/* orbits */}
      <g className="lp-globe-orbit lp-globe-orbit-a">
        <ellipse cx="230" cy="200" rx="196" ry="72" fill="none" stroke="var(--accent-500)" strokeOpacity="0.45" strokeDasharray="2 7" strokeLinecap="round" />
        <circle cx="426" cy="200" r="6" fill="var(--accent-500)" />
      </g>
      <g className="lp-globe-orbit lp-globe-orbit-b">
        <ellipse cx="230" cy="200" rx="180" ry="58" fill="none" stroke="var(--accent-500)" strokeOpacity="0.22" />
        <circle cx="50" cy="200" r="4" fill="var(--accent-500)" opacity="0.7" />
      </g>
    </svg>
  );
}
