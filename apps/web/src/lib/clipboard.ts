export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  if (!ok) throw new Error("execCommand copy failed");
}
