export function isSameLocalOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = process.env.APP_ORIGIN ?? "http://127.0.0.1:8080";
  try {
    const actual = new URL(origin);
    const expected = new URL(allowed);
    return actual.origin === expected.origin && ["127.0.0.1", "localhost", "[::1]"].includes(actual.hostname);
  } catch {
    return false;
  }
}

export function isSameLocalOriginTest() {
  const request = (origin: string | null) => ({ headers: new Headers(origin ? { origin } : {}) }) as Request;
  return isSameLocalOrigin(request("http://127.0.0.1:3000")) &&
    !isSameLocalOrigin(request("https://attacker.example")) &&
    !isSameLocalOrigin(request("http://127.0.0.1.evil.example:3000")) &&
    !isSameLocalOrigin(request(null));
}
