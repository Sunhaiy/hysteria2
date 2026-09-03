import type { ReactElement, SVGProps } from "react";

type IconName =
  | "space_dashboard"
  | "group"
  | "stacks"
  | "subscription"
  | "hub"
  | "receipt_long"
  | "monitoring"
  | "shield_person"
  | "account_circle"
  | "qr_code_2"
  | "network_node"
  | "payments"
  | "redeem"
  | "menu"
  | "close"
  | "settings"
  | "sun"
  | "moon"
  | "mail"
  | "lock"
  | "bolt"
  | "shield"
  | "globe"
  | "plug"
  | "puzzle"
  | "key"
  | "hash"
  | "logout"
  | "login"
  | "home"
  | "book"
  | "add"
  | "edit"
  | "check"
  | "refresh"
  | "warning"
  | "schedule"
  | "download"
  | "arrow_back"
  | "arrow_forward"
  | "search"
  | "content_copy"
  | "database"
  | "upload"
  | "trash";

function BaseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

const icons: Record<IconName, ReactElement> = {
  check: (
    <BaseIcon>
      <path d="m5 12 4 4L19 6" />
    </BaseIcon>
  ),
  database: (
    <BaseIcon>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </BaseIcon>
  ),
  upload: (
    <BaseIcon>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </BaseIcon>
  ),
  trash: (
    <BaseIcon>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </BaseIcon>
  ),
  space_dashboard: (
    <BaseIcon>
      <rect x="3" y="4" width="8" height="7" rx="1.8" />
      <rect x="13" y="4" width="8" height="4" rx="1.8" />
      <rect x="13" y="10" width="8" height="10" rx="1.8" />
      <rect x="3" y="13" width="8" height="7" rx="1.8" />
    </BaseIcon>
  ),
  group: (
    <BaseIcon>
      <path d="M16 20v-1.4a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" />
      <circle cx="9.5" cy="8" r="3" />
      <path d="M21 20v-1a3.4 3.4 0 0 0-2.8-3.3" />
      <path d="M15.7 5.2a3 3 0 0 1 0 5.6" />
    </BaseIcon>
  ),
  stacks: (
    <BaseIcon>
      <path d="m12 4 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </BaseIcon>
  ),
  subscription: (
    <BaseIcon>
      <path d="M7 4h10" />
      <path d="M5 8h14" />
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M9 15h6" />
    </BaseIcon>
  ),
  hub: (
    <BaseIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="m5 5 3 3" />
      <path d="m16 16 3 3" />
      <path d="m19 5-3 3" />
      <path d="m8 16-3 3" />
    </BaseIcon>
  ),
  receipt_long: (
    <BaseIcon>
      <path d="M7 3h10v18l-2-1.5L12 21l-3-1.5L7 21V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </BaseIcon>
  ),
  monitoring: (
    <BaseIcon>
      <path d="M4 19h16" />
      <path d="M7 16V9" />
      <path d="M12 16V5" />
      <path d="M17 16v-7" />
    </BaseIcon>
  ),
  shield_person: (
    <BaseIcon>
      <path d="M12 3 5 6v5c0 4.7 2.9 8.9 7 10 4.1-1.1 7-5.3 7-10V6l-7-3Z" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M9.5 15a3 3 0 0 1 5 0" />
    </BaseIcon>
  ),
  account_circle: (
    <BaseIcon>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9" r="3" />
      <path d="M6.5 18a6.2 6.2 0 0 1 11 0" />
    </BaseIcon>
  ),
  qr_code_2: (
    <BaseIcon>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2z" />
      <path d="M18 14h2v6h-6v-2h4z" />
      <path d="M14 18h2" />
    </BaseIcon>
  ),
  network_node: (
    <BaseIcon>
      <circle cx="6" cy="12" r="2.3" />
      <circle cx="18" cy="7" r="2.3" />
      <circle cx="18" cy="17" r="2.3" />
      <path d="M8.2 11.1 15.7 7.9" />
      <path d="M8.2 12.9 15.7 16.1" />
    </BaseIcon>
  ),
  payments: (
    <BaseIcon>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14h3" />
      <path d="M16 14h2" />
    </BaseIcon>
  ),
  redeem: (
    <BaseIcon>
      <path d="M12 6.5 14 10l4 .6-2.9 2.8.7 4-3.8-2-3.8 2 .7-4L6 10.6l4-.6 2-3.5Z" />
      <path d="M6 20h12" />
    </BaseIcon>
  ),
  menu: (
    <BaseIcon>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </BaseIcon>
  ),
  close: (
    <BaseIcon>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </BaseIcon>
  ),
  sun: (
    <BaseIcon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.3 17.7-1.4 1.4" />
      <path d="m19.1 4.9-1.4 1.4" />
    </BaseIcon>
  ),
  moon: (
    <BaseIcon>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </BaseIcon>
  ),
  mail: (
    <BaseIcon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </BaseIcon>
  ),
  lock: (
    <BaseIcon>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </BaseIcon>
  ),
  bolt: (
    <BaseIcon>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </BaseIcon>
  ),
  shield: (
    <BaseIcon>
      <path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3Z" />
    </BaseIcon>
  ),
  globe: (
    <BaseIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 3 3 15 0 18c-3-3-3-15 0-18Z" />
    </BaseIcon>
  ),
  plug: (
    <BaseIcon>
      <path d="M12 22v-5" />
      <rect x="7" y="9" width="10" height="8" rx="2" />
      <path d="M9.5 9V5" />
      <path d="M14.5 9V5" />
    </BaseIcon>
  ),
  puzzle: (
    <BaseIcon>
      <path d="M9 4.5a2 2 0 0 1 4 0c0 .8 1 1 1.5.6l2.4-1 1 2.4c-.4.5-.2 1.5.6 1.5a2 2 0 0 1 0 4c-.8 0-1 1-.6 1.5l-1 2.4-2.4-1c-.5-.4-1.5-.2-1.5.6a2 2 0 0 1-4 0c0-.8-1-1-1.5-.6l-2.4 1-1-2.4c.4-.5.2-1.5-.6-1.5a2 2 0 0 1 0-4c.8 0 1-1 .6-1.5l1-2.4 2.4 1c.5.4 1.5.2 1.5-.6Z" />
    </BaseIcon>
  ),
  key: (
    <BaseIcon>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="m10 13 9-9" />
      <path d="m15 5 3 3" />
      <path d="m18 8 2-2" />
    </BaseIcon>
  ),
  hash: (
    <BaseIcon>
      <path d="M5 9h14" />
      <path d="M5 15h14" />
      <path d="M10 4 8 20" />
      <path d="M16 4l-2 16" />
    </BaseIcon>
  ),
  settings: (
    <BaseIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </BaseIcon>
  ),
  logout: (
    <BaseIcon>
      <path d="M14 16 18 12 14 8" />
      <path d="M18 12H9" />
      <path d="M11 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5" />
    </BaseIcon>
  ),
  login: (
    <BaseIcon>
      <path d="M10 16 6 12l4-4" />
      <path d="M6 12h9" />
      <path d="M13 20h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-5" />
    </BaseIcon>
  ),
  home: (
    <BaseIcon>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 10.5V20h12v-9.5" />
    </BaseIcon>
  ),
  book: (
    <BaseIcon>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
    </BaseIcon>
  ),
  add: (
    <BaseIcon>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </BaseIcon>
  ),
  edit: (
    <BaseIcon>
      <path d="m4 20 4.5-1 9-9a2.1 2.1 0 0 0-3-3l-9 9L4 20Z" />
      <path d="m13.5 6.5 4 4" />
    </BaseIcon>
  ),
  refresh: (
    <BaseIcon>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 5v5h-5" />
    </BaseIcon>
  ),
  warning: (
    <BaseIcon>
      <path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </BaseIcon>
  ),
  schedule: (
    <BaseIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </BaseIcon>
  ),
  download: (
    <BaseIcon>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </BaseIcon>
  ),
  arrow_back: (
    <BaseIcon>
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h10" />
    </BaseIcon>
  ),
  arrow_forward: (
    <BaseIcon>
      <path d="m9 18 6-6-6-6" />
      <path d="M5 12h10" />
    </BaseIcon>
  ),
  search: (
    <BaseIcon>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </BaseIcon>
  ),
  content_copy: (
    <BaseIcon>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </BaseIcon>
  ),
};

export function Icon({ name }: { name: string }) {
  const icon = icons[name as IconName] ?? icons.home;
  return <span className="icon-slot">{icon}</span>;
}
