/** The hosts this deploy answers on (TALORYS_ALLOWED_HOSTS), or null when every host is accepted. */
export function allowedHosts(env: { TALORYS_ALLOWED_HOSTS?: string }): Set<string> | null {
  const hosts = (env.TALORYS_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? new Set(hosts) : null;
}
