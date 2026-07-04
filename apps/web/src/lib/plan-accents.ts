export const PLAN_ACCENTS = [
  { value: "green", label: "翡翠绿", color: "#22c55e" },
  { value: "teal", label: "湖水青", color: "#14b8a6" },
  { value: "blue", label: "天际蓝", color: "#3b82f6" },
  { value: "indigo", label: "靛青蓝", color: "#6366f1" },
  { value: "purple", label: "紫罗兰", color: "#8b5cf6" },
  { value: "orange", label: "暖橙", color: "#f97316" },
  { value: "pink", label: "樱花粉", color: "#ec4899" },
] as const;

export type PlanAccent = (typeof PLAN_ACCENTS)[number]["value"];

export function normalizePlanAccent(value: string): PlanAccent {
  return PLAN_ACCENTS.some((accent) => accent.value === value)
    ? (value as PlanAccent)
    : "green";
}

export function planAccentColor(value: string) {
  const normalized = normalizePlanAccent(value);
  return PLAN_ACCENTS.find((accent) => accent.value === normalized)?.color ?? "#22c55e";
}
