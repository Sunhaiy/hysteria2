export function userSyncStaleBefore(now = new Date()) {
  const configured = Number(process.env.NODE_USER_SYNC_STALE_SECONDS ?? 600);
  const seconds = Number.isFinite(configured) ? Math.max(configured, 60) : 600;
  return new Date(now.getTime() - seconds * 1000);
}

export function hasFreshUserSync(
  protocol: string,
  lastUserSyncAt: Date | string | null | undefined,
  now = new Date(),
) {
  if (protocol.toLowerCase() !== 'vless_reality') return true;
  return (
    !!lastUserSyncAt &&
    new Date(lastUserSyncAt).getTime() >= userSyncStaleBefore(now).getTime()
  );
}
