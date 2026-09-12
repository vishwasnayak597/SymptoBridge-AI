/**
 * Where to send someone after login.
 *
 * A protected page that bounces a logged-out visitor to /auth/login passes where they
 * were going as `?redirect=`, so a deep link — a booking suggested by their AI
 * assistant, a "claim your waitlist slot" notification — survives the login.
 *
 * `redirect` comes from the URL, so it is attacker-controlled. The login page used to
 * `router.push()` it as-is, which made `/auth/login?redirect=https://evil.example` an
 * open redirect: log in on the real site, land on a lookalike. Only a same-site path
 * inside the user's own area is ever followed; anything else falls back to their
 * dashboard.
 */

type Role = 'patient' | 'doctor' | 'admin';

export const ROLE_HOME: Record<Role, string> = {
  patient: '/patient/dashboard',
  doctor: '/doctor/dashboard',
  admin: '/admin/dashboard',
};

const ROLE_AREAS: Record<Role, string[]> = {
  patient: ['/patient/', '/video-call'],
  doctor: ['/doctor/', '/video-call'],
  admin: ['/admin/'],
};

const SENTINEL_ORIGIN = 'http://same-site.invalid';

/** A safe path to follow after login for this role, or null if `raw` isn't one. */
export function safeRedirectPath(raw: unknown, role: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith('/')) return null;

  // Resolve against a sentinel origin: "//evil.example" and "/\evil.example" (which
  // browsers treat as "//") resolve to a different origin and are rejected here.
  let url: URL;
  try {
    url = new URL(raw, SENTINEL_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== SENTINEL_ORIGIN) return null;

  const path = url.pathname + url.search + url.hash;
  // Never loop back into the auth pages.
  if (url.pathname.startsWith('/auth/')) return null;

  const areas = role && role in ROLE_AREAS ? ROLE_AREAS[role as Role] : null;
  if (!areas || !areas.some((area) => url.pathname.startsWith(area))) return null;
  return path;
}
