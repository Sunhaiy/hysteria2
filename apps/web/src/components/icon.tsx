import {
  Add01Icon,
  AccessIcon,
  Agreement03Icon,
  AiClothesIcon,
  AiCoEditingIcon,
  AiDrawingIcon,
  AlignStartVerticalIcon,
  Alert02Icon,
  AndroidIcon,
  AnonymousIcon,
  AppleIcon,
  ArrowDown01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  BookOpen01Icon,
  BubbleTea01Icon,
  Cancel01Icon,
  ChartHistogramIcon,
  ChartLineData02Icon,
  CheckmarkCircle02Icon,
  Clock03Icon,
  Copy02Icon,
  DashboardSquare01Icon,
  Database02Icon,
  Delete02Icon,
  Download04Icon,
  Edit02Icon,
  FlashIcon,
  GiftIcon,
  Globe02Icon,
  HashtagIcon,
  HierarchySquare02Icon,
  Home03Icon,
  Invoice03Icon,
  Key01Icon,
  Layers01Icon,
  LockKeyIcon,
  Login03Icon,
  Logout03Icon,
  Mail02Icon,
  Menu01Icon,
  Moon02Icon,
  PackageIcon,
  Payment02Icon,
  Plug02Icon,
  PowerServiceIcon,
  PuzzleIcon,
  QrCode01Icon,
  RefreshCwIcon,
  Search02Icon,
  Settings02Icon,
  Share08Icon,
  Shield01Icon,
  Suit01Icon,
  Sun03Icon,
  SmartPhone01Icon,
  Upload04Icon,
  UserAdd01Icon,
  UserCircleIcon,
  UserGroupIcon,
  UserShield01Icon,
  WindowsNewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { CSSProperties } from "react";

type IconName =
  | "brand_logo"
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
  | "arrow_down"
  | "search"
  | "content_copy"
  | "database"
  | "upload"
  | "trash"
  | "data_usage"
  | "power_settings_new"
  | "group_add"
  | "portal_overview"
  | "portal_plans"
  | "portal_access"
  | "portal_tutorial"
  | "portal_tickets"
  | "portal_referrals"
  | "portal_usage"
  | "portal_orders"
  | "platform_windows"
  | "platform_android"
  | "platform_macos"
  | "platform_ios";

type IconCue =
  | "bars"
  | "blink"
  | "draw"
  | "drop"
  | "fold"
  | "left"
  | "lift"
  | "menu"
  | "open"
  | "orbit"
  | "right"
  | "scan"
  | "signal"
  | "tilt"
  | "turn";

type IconMotion = {
  cue: IconCue;
  accentPart: number;
  secondaryPart?: number;
  distance: number;
  angle: number;
  duration: number;
  delay: number;
  origin?: string;
};

const icons: Record<IconName, IconSvgElement> = {
  brand_logo: Suit01Icon,
  space_dashboard: DashboardSquare01Icon,
  group: UserGroupIcon,
  stacks: Layers01Icon,
  subscription: PackageIcon,
  hub: HierarchySquare02Icon,
  receipt_long: Invoice03Icon,
  monitoring: ChartLineData02Icon,
  shield_person: UserShield01Icon,
  account_circle: UserCircleIcon,
  qr_code_2: QrCode01Icon,
  network_node: Share08Icon,
  payments: Payment02Icon,
  redeem: GiftIcon,
  menu: Menu01Icon,
  close: Cancel01Icon,
  settings: Settings02Icon,
  sun: Sun03Icon,
  moon: Moon02Icon,
  mail: Mail02Icon,
  lock: LockKeyIcon,
  bolt: FlashIcon,
  shield: Shield01Icon,
  globe: Globe02Icon,
  plug: Plug02Icon,
  puzzle: PuzzleIcon,
  key: Key01Icon,
  hash: HashtagIcon,
  logout: Logout03Icon,
  login: Login03Icon,
  home: Home03Icon,
  book: BookOpen01Icon,
  add: Add01Icon,
  edit: Edit02Icon,
  check: CheckmarkCircle02Icon,
  refresh: RefreshCwIcon,
  warning: Alert02Icon,
  schedule: Clock03Icon,
  download: Download04Icon,
  arrow_back: ArrowLeft02Icon,
  arrow_forward: ArrowRight02Icon,
  arrow_down: ArrowDown01Icon,
  search: Search02Icon,
  content_copy: Copy02Icon,
  database: Database02Icon,
  upload: Upload04Icon,
  trash: Delete02Icon,
  data_usage: ChartHistogramIcon,
  power_settings_new: PowerServiceIcon,
  group_add: UserAdd01Icon,
  portal_overview: AnonymousIcon,
  portal_plans: BubbleTea01Icon,
  portal_access: AccessIcon,
  portal_tutorial: AiDrawingIcon,
  portal_tickets: AiClothesIcon,
  portal_referrals: AiCoEditingIcon,
  portal_usage: Agreement03Icon,
  portal_orders: AlignStartVerticalIcon,
  platform_windows: WindowsNewIcon,
  platform_android: AndroidIcon,
  platform_macos: AppleIcon,
  platform_ios: SmartPhone01Icon,
};

// Motion belongs to a meaningful line inside the glyph. The SVG frame never
// moves, so every icon keeps the same optical size while its detail responds.
const iconMotions: Record<IconName, IconMotion> = {
  brand_logo: {
    cue: "open",
    accentPart: 1,
    secondaryPart: 2,
    distance: 0.65,
    angle: 3,
    duration: 720,
    delay: 14,
    origin: "50% 18%",
  },
  space_dashboard: {
    cue: "open",
    accentPart: 0,
    secondaryPart: 3,
    distance: 0.7,
    angle: 3,
    duration: 620,
    delay: 10,
  },
  group: {
    cue: "open",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.8,
    angle: 4,
    duration: 650,
    delay: 18,
  },
  stacks: {
    cue: "lift",
    accentPart: 0,
    secondaryPart: 2,
    distance: 0.8,
    angle: 3,
    duration: 640,
    delay: 12,
  },
  subscription: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 3,
    distance: 0.9,
    angle: 4,
    duration: 660,
    delay: 16,
  },
  hub: {
    cue: "signal",
    accentPart: 3,
    secondaryPart: 2,
    distance: 0.7,
    angle: 3,
    duration: 720,
    delay: 20,
  },
  receipt_long: {
    cue: "draw",
    accentPart: 3,
    secondaryPart: 4,
    distance: 0.6,
    angle: 3,
    duration: 700,
    delay: 14,
  },
  monitoring: {
    cue: "signal",
    accentPart: 4,
    secondaryPart: 3,
    distance: 0.8,
    angle: 3,
    duration: 740,
    delay: 24,
  },
  shield_person: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 2,
    distance: 0.7,
    angle: 3,
    duration: 660,
    delay: 20,
  },
  account_circle: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 2,
    distance: 0.6,
    angle: 3,
    duration: 630,
    delay: 12,
  },
  qr_code_2: {
    cue: "scan",
    accentPart: 5,
    secondaryPart: 2,
    distance: 0.9,
    angle: 3,
    duration: 710,
    delay: 18,
  },
  network_node: {
    cue: "signal",
    accentPart: 3,
    secondaryPart: 2,
    distance: 0.8,
    angle: 3,
    duration: 730,
    delay: 22,
  },
  payments: {
    cue: "right",
    accentPart: 3,
    secondaryPart: 4,
    distance: 0.8,
    angle: 3,
    duration: 640,
    delay: 10,
  },
  redeem: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 4,
    distance: 1,
    angle: 4,
    duration: 680,
    delay: 14,
  },
  menu: {
    cue: "menu",
    accentPart: 2,
    secondaryPart: 1,
    distance: 0.9,
    angle: 3,
    duration: 610,
    delay: 16,
  },
  close: {
    cue: "turn",
    accentPart: 0,
    distance: 0.6,
    angle: 90,
    duration: 590,
    delay: 8,
  },
  settings: {
    cue: "turn",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.6,
    angle: 72,
    duration: 760,
    delay: 12,
  },
  sun: {
    cue: "orbit",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.6,
    angle: 45,
    duration: 780,
    delay: 14,
  },
  moon: {
    cue: "draw",
    accentPart: 0,
    distance: 0.6,
    angle: 4,
    duration: 760,
    delay: 20,
  },
  mail: {
    cue: "fold",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.7,
    angle: 7,
    duration: 650,
    delay: 12,
    origin: "50% 100%",
  },
  lock: {
    cue: "left",
    accentPart: 2,
    secondaryPart: 1,
    distance: 0.9,
    angle: 3,
    duration: 670,
    delay: 18,
  },
  bolt: {
    cue: "blink",
    accentPart: 0,
    distance: 0.6,
    angle: 3,
    duration: 570,
    delay: 6,
  },
  shield: {
    cue: "draw",
    accentPart: 0,
    distance: 0.6,
    angle: 3,
    duration: 690,
    delay: 18,
  },
  globe: {
    cue: "orbit",
    accentPart: 2,
    secondaryPart: 3,
    distance: 0.6,
    angle: 32,
    duration: 800,
    delay: 24,
  },
  plug: {
    cue: "right",
    accentPart: 1,
    secondaryPart: 2,
    distance: 0.8,
    angle: 3,
    duration: 640,
    delay: 14,
  },
  puzzle: {
    cue: "right",
    accentPart: 0,
    distance: 0.7,
    angle: 3,
    duration: 670,
    delay: 16,
  },
  key: {
    cue: "turn",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.6,
    angle: 18,
    duration: 680,
    delay: 20,
    origin: "20% 50%",
  },
  hash: {
    cue: "open",
    accentPart: 2,
    secondaryPart: 3,
    distance: 0.6,
    angle: 3,
    duration: 620,
    delay: 12,
  },
  logout: {
    cue: "right",
    accentPart: 1,
    secondaryPart: 0,
    distance: 1,
    angle: 3,
    duration: 620,
    delay: 8,
  },
  login: {
    cue: "left",
    accentPart: 1,
    secondaryPart: 0,
    distance: 1,
    angle: 3,
    duration: 620,
    delay: 8,
  },
  home: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.7,
    angle: 3,
    duration: 640,
    delay: 16,
  },
  book: {
    cue: "open",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.7,
    angle: 4,
    duration: 700,
    delay: 18,
  },
  add: {
    cue: "turn",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.6,
    angle: 90,
    duration: 580,
    delay: 8,
  },
  edit: {
    cue: "right",
    accentPart: 1,
    secondaryPart: 2,
    distance: 0.8,
    angle: 3,
    duration: 650,
    delay: 14,
  },
  check: {
    cue: "draw",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.6,
    angle: 3,
    duration: 620,
    delay: 8,
  },
  refresh: {
    cue: "turn",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.6,
    angle: 180,
    duration: 780,
    delay: 16,
  },
  warning: {
    cue: "blink",
    accentPart: 1,
    secondaryPart: 2,
    distance: 0.6,
    angle: 3,
    duration: 620,
    delay: 12,
  },
  schedule: {
    cue: "turn",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.6,
    angle: 28,
    duration: 720,
    delay: 18,
    origin: "15% 100%",
  },
  download: {
    cue: "drop",
    accentPart: 0,
    secondaryPart: 1,
    distance: 1,
    angle: 3,
    duration: 620,
    delay: 8,
  },
  arrow_back: {
    cue: "left",
    accentPart: 0,
    secondaryPart: 1,
    distance: 1,
    angle: 3,
    duration: 590,
    delay: 6,
  },
  arrow_forward: {
    cue: "right",
    accentPart: 0,
    secondaryPart: 1,
    distance: 1,
    angle: 3,
    duration: 590,
    delay: 6,
  },
  arrow_down: {
    cue: "drop",
    accentPart: 0,
    distance: 0.9,
    angle: 3,
    duration: 590,
    delay: 6,
  },
  search: {
    cue: "scan",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.8,
    angle: 3,
    duration: 710,
    delay: 16,
  },
  content_copy: {
    cue: "right",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.7,
    angle: 3,
    duration: 640,
    delay: 12,
  },
  database: {
    cue: "bars",
    accentPart: 4,
    secondaryPart: 2,
    distance: 0.7,
    angle: 3,
    duration: 700,
    delay: 20,
  },
  upload: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 0,
    distance: 1,
    angle: 3,
    duration: 620,
    delay: 8,
  },
  trash: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 2,
    distance: 0.9,
    angle: 4,
    duration: 650,
    delay: 12,
  },
  data_usage: {
    cue: "bars",
    accentPart: 2,
    secondaryPart: 1,
    distance: 0.9,
    angle: 3,
    duration: 690,
    delay: 18,
  },
  power_settings_new: {
    cue: "blink",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.6,
    angle: 3,
    duration: 610,
    delay: 8,
  },
  group_add: {
    cue: "open",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.8,
    angle: 3,
    duration: 650,
    delay: 14,
  },
  portal_overview: {
    cue: "open",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.7,
    angle: 3,
    duration: 660,
    delay: 12,
  },
  portal_plans: {
    cue: "tilt",
    accentPart: 3,
    secondaryPart: 6,
    distance: 0.7,
    angle: 7,
    duration: 700,
    delay: 18,
    origin: "50% 100%",
  },
  portal_access: {
    cue: "signal",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.8,
    angle: 3,
    duration: 720,
    delay: 20,
  },
  portal_tutorial: {
    cue: "right",
    accentPart: 1,
    secondaryPart: 2,
    distance: 0.8,
    angle: 3,
    duration: 710,
    delay: 18,
  },
  portal_tickets: {
    cue: "blink",
    accentPart: 5,
    secondaryPart: 4,
    distance: 0.6,
    angle: 3,
    duration: 630,
    delay: 10,
  },
  portal_referrals: {
    cue: "open",
    accentPart: 2,
    secondaryPart: 3,
    distance: 0.7,
    angle: 3,
    duration: 720,
    delay: 22,
  },
  portal_usage: {
    cue: "draw",
    accentPart: 0,
    secondaryPart: 2,
    distance: 0.6,
    angle: 3,
    duration: 760,
    delay: 24,
  },
  portal_orders: {
    cue: "bars",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.7,
    angle: 3,
    duration: 650,
    delay: 14,
  },
  platform_windows: {
    cue: "open",
    accentPart: 0,
    secondaryPart: 1,
    distance: 0.6,
    angle: 3,
    duration: 640,
    delay: 10,
  },
  platform_android: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 6,
    distance: 0.7,
    angle: 3,
    duration: 670,
    delay: 16,
  },
  platform_macos: {
    cue: "tilt",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.6,
    angle: 6,
    duration: 690,
    delay: 20,
    origin: "20% 80%",
  },
  platform_ios: {
    cue: "lift",
    accentPart: 1,
    secondaryPart: 0,
    distance: 0.6,
    angle: 3,
    duration: 650,
    delay: 12,
  },
};

const traceableTags = new Set([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
]);

const animatedIcons = Object.fromEntries(
  (Object.entries(icons) as Array<[IconName, IconSvgElement]>).map(
    ([name, icon]) => {
      const motion = iconMotions[name];

      return [
        name,
        icon.map(
          ([tag, attributes], partIndex) =>
            [
              tag,
              traceableTags.has(tag)
                ? {
                    ...attributes,
                    pathLength: 1,
                    className: `icon-part icon-part-${partIndex}`,
                    "data-icon-part": partIndex,
                    "data-icon-accent":
                      partIndex === motion.accentPart ? "true" : undefined,
                    "data-icon-secondary":
                      partIndex === motion.secondaryPart ? "true" : undefined,
                  }
                : attributes,
            ] as const,
        ) as IconSvgElement,
      ];
    },
  ),
) as Record<IconName, IconSvgElement>;

function getIconMotion(iconName: IconName) {
  const motion = iconMotions[iconName];
  const visibleDistance = Number((motion.distance * 1.35).toFixed(2));

  return {
    cue: motion.cue,
    style: {
      "--icon-motion-distance": `${visibleDistance}px`,
      "--icon-motion-distance-reverse": `${visibleDistance * -1}px`,
      "--icon-motion-angle": `${motion.angle}deg`,
      "--icon-motion-angle-reverse": `${motion.angle * -1}deg`,
      "--icon-motion-duration": `${motion.duration}ms`,
      "--icon-motion-delay": `${motion.delay}ms`,
      "--icon-motion-origin": motion.origin ?? "center",
    } as CSSProperties,
  };
}

export function Icon({
  name,
  strokeWidth,
  className,
}: {
  name: string;
  strokeWidth?: number;
  className?: string;
}) {
  const iconName = name in icons ? (name as IconName) : "home";
  const motion = getIconMotion(iconName);
  const style = {
    ...motion.style,
    ...(strokeWidth
      ? { "--icon-stroke-width-override": strokeWidth }
      : undefined),
  } as CSSProperties;

  return (
    <span
      className={["icon-slot", className].filter(Boolean).join(" ")}
      data-icon-name={iconName}
      data-icon-cue={motion.cue}
      style={style}
    >
      <HugeiconsIcon
        icon={animatedIcons[iconName]}
        strokeWidth={strokeWidth}
        aria-hidden="true"
      />
    </span>
  );
}
