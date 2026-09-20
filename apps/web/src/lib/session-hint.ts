/** Only a hint to avoid anonymous probes; the API still verifies the session. */
export function hasSessionHint(cookie: string): boolean {
  return cookie.split(";").some((part) => {
    const [name, ...value] = part.trim().split("=");
    return name === "hysteria2-csrf" && value.join("=").length > 0;
  });
}
