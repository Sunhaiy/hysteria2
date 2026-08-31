export const apiBaseUrl =
  process.env.NODE_ENV === "production"
    ? ""
    : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "");
