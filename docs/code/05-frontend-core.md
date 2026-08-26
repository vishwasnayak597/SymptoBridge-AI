# Volume 5 — Frontend Core

The infrastructure layer the screens are built on: the API client, React Query
configuration and offline persistence, the auth hook and provider, the socket singleton,
error normalisation, and the shared query hooks. Roughly 1,200 lines, and where all the
architectural decisions live — Volume 6's UI is mostly consumption of these.

---

## 1. Architectural stance

The frontend distinguishes two kinds of state, and the split is enforced by which tool
you reach for:

**Server state** — anything owned by the backend (appointments, prescriptions, reports,
notification counts). Managed by React Query. Never copied into `useState`, never
prop-drilled, never manually refetched after a write. The cache is the single source of
truth and every component that asks for the same key gets the same data.

**UI state** — modal open/closed, form fields, active tab, selected date. Ordinary
`useState`, local to the component that owns it.

Getting this boundary right is what eliminated the `useState` + `useEffect` +
`setLoading` + manual-refetch pattern that used to be duplicated across every dashboard.
Auth is the one deliberate exception: it lives in React Context rather than React Query,
because it is genuinely global, changes rarely, and gates rendering.

---

## 2. `lib/api.ts` — the HTTP client

[`frontend/lib/api.ts`](../../frontend/lib/api.ts) · 205 lines. Covered line-by-line in
[the architecture doc](../CODE_WALKTHROUGH.md#32-the-frontend-sends-a-request----frontendlibapits);
the essentials plus the parts not covered there:

A class rather than a bare axios instance, because the refresh logic needs **instance
state**: `isRefreshing` (a boolean flag) and `failedQueue` (parked requests). Those must
be shared across every call site, which a module-level singleton (`export const apiClient
= new ApiClient()`) provides.

`baseURL` comes from `NEXT_PUBLIC_API_URL` with a production fallback. The
`NEXT_PUBLIC_` prefix is required — Next.js only inlines env vars with that prefix into
the client bundle, and since this is a static export the value is baked in at build time,
not read at runtime. Changing the API URL requires a rebuild.

`withCredentials: true` makes the browser send the refresh-token cookie cross-origin,
which pairs with `credentials: true` in the backend's CORS config.

`timeout: 30000` is generous by design: the Render free tier cold-starts, and the ML
service can take ~30 s on the first triage call after idle. A conventional 10 s timeout
would make the flagship feature appear broken.

The token accessors (`getAccessToken`, `setAccessToken`, `clearTokens`) all guard
`typeof window === 'undefined'` because Next.js executes this module during static
generation, where `localStorage` does not exist. Omitting the guard breaks the build, not
just the runtime.

The public surface is thin — `get`/`post`/`put`/`patch`/`delete` typed as
`AxiosResponse<ApiResponse<T>>`, plus `setAuthToken`/`clearAuthToken` for the auth hook
and `getInstance()` for escape hatches (blob downloads, custom headers).

---

## 3. `lib/queryClient.ts` — cache policy and central error handling

[`frontend/lib/queryClient.ts`](../../frontend/lib/queryClient.ts) · 70 lines, and
disproportionately important.

### Error handling in one place

```ts
queryCache: new QueryCache({
  onError: (error, query) => {
    if (query.meta?.silent || isAuthError(error)) return;
    if (query.state.data === undefined) {
      toast.error(getErrorMessage(error));
    }
  },
}),
```

Three deliberate filters:

**`meta.silent`** — an opt-out for components that render errors inline. The unread-badge
poll sets it (§7), because a failed background poll must not produce a toast every 30
seconds.

**`isAuthError`** — 401s are excluded entirely. The axios interceptor already handles
them by refreshing or redirecting to login; toasting here would double-report the same
event and, worse, flash "Unauthorized" at a user who is being transparently recovered.

**`query.state.data === undefined`** — the subtlest and best rule. A toast fires only
when there is *nothing cached to fall back on*. If a background refetch fails while
stale-but-valid data is on screen, the user sees slightly old data and no interruption —
which is exactly right for an offline-capable app. Interrupting someone reading a valid
appointment list because a refresh failed is worse than saying nothing.

`MutationCache.onError` has no data-undefined check, because a failed write always
warrants telling the user.

### Cache defaults

```ts
staleTime: 30 * 1000,
gcTime: 24 * 60 * 60 * 1000,
retry: (failureCount, error) => !isAuthError(error) && failureCount < 2,
refetchOnWindowFocus: false,
```

`staleTime: 30s` — data is considered fresh for 30 seconds, so tab switching or
remounting within that window is free. `gcTime: 24h` is *not* about freshness; it is how
long an unused entry survives before eviction, and it is set long specifically so the
IndexedDB persister has something to write and restore. A short `gcTime` would defeat
offline support.

`retry` is a function so 401s are never retried — retrying an expired-token request is
guaranteed waste, since the interceptor's refresh is the only thing that can fix it.

`refetchOnWindowFocus: false` is a deliberate deviation from React Query's default.
Refetch-on-focus is great for dashboards you leave open; here it produced surprising
loading states every time a user returned from a Google Calendar tab.

### Persistence and cache clearing

`queryPersister` wraps `idbStorage` and is `undefined` during SSR — `PersistQueryClientProvider`
accepts that and simply skips persistence, which is what allows the static export to
build.

```ts
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  try { await idbStorage.removeItem(PERSIST_KEY); } catch {}
}
```

This exists for a specific security reason: on a shared browser, IndexedDB survives
logout. Without clearing it, the next user to log in would briefly see the previous
user's persisted appointments before the first refetch replaced them. It is called on
both logout **and** login — login too, because a session can end without a clean logout
(closed tab, expired refresh token).

---

## 4. `lib/idbStorage.ts` — the persistence adapter

[`frontend/lib/idbStorage.ts`](../../frontend/lib/idbStorage.ts). A small
`getItem`/`setItem`/`removeItem` shim over IndexedDB matching the persister's expected
async-storage interface.

IndexedDB rather than `localStorage` for two reasons: `localStorage` is synchronous and
blocks the main thread on every write of a potentially large serialised cache, and it
caps at roughly 5 MB. IndexedDB is async and effectively unbounded.

Worth being precise about the division of labour, since it is a common interview
question: **IndexedDB caches the data; the service worker caches the app shell.** Opening
the app offline requires the service worker (HTML, JS, CSS); *seeing your appointments*
offline requires IndexedDB. Neither alone is sufficient.

---

## 5. `hooks/useAuth.ts` — session lifecycle

[`frontend/hooks/useAuth.ts`](../../frontend/hooks/useAuth.ts) · 329 lines, ten operations.

State is two values — `user` and `isLoading` — with `isAuthenticated` derived as `!!user`
rather than stored. Deriving prevents the classic bug where a boolean flag and the user
object disagree.

Every callback is wrapped in `useCallback` with an explicit dependency array. That is not
ceremony: the hook's return object is passed into a Context provider (§6), and unstable
function identities would re-render every consumer on every render of the provider.

**`initializeAuth`** runs once via `useEffect` on mount. It reads the stored token,
installs it on the API client, and calls `/auth/me` to validate it server-side. A token
that fails validation is cleared. This round trip is why a refresh briefly shows a loading
state — and why the app knows within one request whether a persisted token is still good.

**`login`** has an ordering detail that matters:

```ts
setAccessToken(accessToken);
await clearQueryCache();   // before setUser
setUser(userData);
```

The cache is cleared *before* `setUser` triggers the re-render that mounts dashboard
components and fires their queries. Reversing these two lines would let the new user's
components briefly read the previous user's persisted cache.

**`logout`** does its cleanup in a `finally` block, so a failed logout request still
clears local state:

```ts
clearAccessToken();
disconnectSocket();
setUser(null);
void clearQueryCache();
```

All four matter. Leaving the socket connected would keep pushing the previous user's
notifications into a logged-out browser. `void` marks the deliberately un-awaited
promise.

**`refreshUser`** re-fetches the profile without a full re-auth — used after mutations
that change the user document, such as adding a family member in the booking modal.

The remaining operations (`register`, `changePassword`, `verifyEmail`,
`requestPasswordReset`, `resetPassword`) share one shape: call the API, toast success or
the server's error message, return a boolean so the calling form knows whether to close.

⚠️ Two observations. First, this hook toasts directly, while `queryClient` centralises
toasting for queries and mutations — two error-reporting paths coexisting. Consistent, but
worth knowing. Second, every method returns `boolean` rather than throwing, so callers
cannot distinguish failure causes; adequate here, limiting if a form ever needs
field-level server errors.

---

## 6. `components/AuthProvider.tsx` — one session per app

[`frontend/components/AuthProvider.tsx`](../../frontend/components/AuthProvider.tsx).

A thin wrapper: it calls `useAuth()` **once** and publishes the result through Context.

```tsx
<AuthContext.Provider value={authHook}>{children}</AuthContext.Provider>
```

This is the entire point. `useAuth` holds real state and fires an `/auth/me` request on
mount; calling it in five components would create five independent sessions and five
identical requests. `useAuthContext()` is the accessor every component uses instead, and
it throws if used outside the provider — failing loudly at development time rather than
returning `undefined` and producing a confusing downstream error.

[`ProtectedRoute.tsx`](../../frontend/components/ProtectedRoute.tsx) consumes the same
context to gate pages by role, redirecting rather than rendering. It is a **UX** guard,
not a security boundary — the backend's `authenticate` and `authorize` middleware are the
real enforcement, and the frontend check exists only so users are not shown a screen that
will fail every request.

---

## 7. Query hooks — the shared-cache pattern

**`hooks/useAppointments.ts`** ([file](../../frontend/hooks/useAppointments.ts)) is the
template every feature hook follows:

```ts
const APPOINTMENTS_KEY = ['appointments', 'mine'] as const;

export function useAppointments<T = any>(enabled = true) {
  const query = useQuery({
    queryKey: APPOINTMENTS_KEY,
    queryFn: async () => {
      const response = await apiClient.get('/appointments');
      const list = response.data.data?.appointments;
      return (Array.isArray(list) ? list : []) as T[];
    },
    enabled,
  });
  return { appointments: query.data ?? [], isLoading: query.isLoading, refetch: query.refetch };
}

export function useInvalidateAppointments() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: APPOINTMENTS_KEY });
}
```

Several decisions in a small file. The key is a module-level constant so the hook and its
invalidator cannot drift apart. `Array.isArray(list) ? list : []` normalises the response
inside the `queryFn`, so no consumer has to defend against a missing field — and the
`?? []` in the return means components never see `undefined` and never need a null check
before `.map()`. `enabled` lets callers defer until a user exists, avoiding a guaranteed
401 on first paint.

Exporting the invalidator separately is what replaced manual refetching: after a rating
or a booking, a component calls `invalidateAppointments()` and every subscriber updates.
No callbacks passed down, no duplicated fetch logic.

**`hooks/useNotifications.ts`** ([file](../../frontend/hooks/useNotifications.ts)) adds two
ideas:

```ts
refetchInterval: 30 * 1000,
meta: { silent: true },
```

`refetchInterval` polls the badge count — and React Query pauses polling when the tab is
hidden, so a backgrounded tab stops hitting the API entirely. `meta: { silent: true }` is
the opt-out from §3, so a failed poll never toasts.

`useSetUnreadCount` is a **write-through** into the same cache entry:

```ts
return (count: number) => client.setQueryData(UNREAD_COUNT_KEY, count);
```

When the NotificationPanel marks something read, it already knows the authoritative new
count. Writing it directly updates every badge in the app instantly, with no request and
no waiting for the next poll — the same effect as an optimistic update, but with a value
that is actually correct rather than guessed.

The feature-scoped hooks —
[`usePrescriptions`](../../frontend/features/prescriptions/usePrescriptions.ts) and
[`useReports`](../../frontend/features/reports/useReports.ts) — follow the identical shape,
with `useReports` additionally colocating its mutations (`uploadReport`, `removeReport`,
`downloadReport`), each invalidating the shared key on success. That colocation is why
`ReportsPanel` takes **zero props**.

---

## 8. `lib/socket.ts` — the connection singleton

[`frontend/lib/socket.ts`](../../frontend/lib/socket.ts) · 33 lines, one clever detail.

```ts
socket = io(SOCKET_URL, {
  auth: (cb) => cb({ token: localStorage.getItem('accessToken') }),
  reconnectionDelayMax: 10000,
});
```

`auth` is passed as a **function**, not an object. Socket.IO invokes it on every connect
*and every reconnect*, so the token is re-read at that moment. With an object literal the
token would be captured once at first connect — and after the access token expired and
the axios interceptor silently refreshed it, every subsequent reconnect would present the
stale token and be rejected by the handshake guard. The function form is what makes the
real-time layer survive a token refresh.

`SOCKET_URL` strips the `/api` suffix, since Socket.IO attaches at the host root.
`getSocket()` returns `null` during SSR and memoises otherwise, so every consumer shares
one connection. `disconnectSocket()` nulls the reference so a subsequent login builds a
fresh connection with the new user's token — called from `logout` for exactly that
reason.

---

## 9. `lib/errors.ts` — one message extractor

[`frontend/lib/errors.ts`](../../frontend/lib/errors.ts) · 21 lines.

```ts
if (data?.error) return data.error;          // our API's message
if (data?.message) return data.message;
if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
if (!error.response) return 'Cannot reach the server. Check your connection.';
return `Request failed (${error.response.status}).`;
```

The precedence is right: the server's own message first (it has the most context), then
axios-level conditions. The `!error.response` branch specifically catches "no response at
all" — network down, CORS rejection, DNS failure — and says something actionable instead
of the raw `Network Error` string users cannot act on.

Small file, but it is the reason no component renders `String(err)` or `err.message`
directly, which is how apps end up showing `[object Object]` or leaking stack traces into
the UI.

---

## 10. `lib/idempotency.ts` and `lib/calendar.ts`

**[`idempotency.ts`](../../frontend/lib/idempotency.ts)** — `newIdempotencyKey()` returns
`crypto.randomUUID()` with a timestamp+random fallback for older browsers. The contract is
in the doc comment and is the part people get wrong: **one key per logical operation, not
per HTTP attempt**, regenerated only after success. Held in a `useRef` (not `useState`)
in the booking and payment components, because it must survive re-renders without causing
one.

**[`calendar.ts`](../../frontend/lib/calendar.ts)** — `googleCalendarUrl()` builds a
`calendar.google.com/render?action=TEMPLATE` link via `URLSearchParams`; `downloadIcs()`
generates RFC-5545 text, wraps it in a `Blob`, and triggers a download through a
synthetic anchor, revoking the object URL afterwards to avoid a memory leak. Both are
pure client-side with no API keys — the user's own calendar account does the saving.
`toUtcStamp` produces the compact `YYYYMMDDTHHMMSSZ` form both formats require.

---

## 11. `pages/_app.tsx` — composition root

[`frontend/pages/_app.tsx`](../../frontend/pages/_app.tsx). Provider nesting, outermost
first:

`ErrorBoundary` → `PersistQueryClientProvider` → `AuthProvider` → page → `Toaster`.

The order encodes dependencies. `ErrorBoundary` is outermost so it catches render errors
from everything inside. The query provider precedes `AuthProvider` because `useAuth`'s
`clearQueryCache` needs the client to exist. `Toaster` sits inside so any provider can
fire a toast.

It also registers the service worker and exports `reportWebVitals`:

```ts
export function reportWebVitals(metric) {
  if (process.env.NODE_ENV !== 'production') return;
  fetch(`${base}/vitals`, { method: 'POST', body: JSON.stringify(metric), keepalive: true })
    .catch(() => {});
}
```

Next.js calls this automatically for every vital. `keepalive: true` is the essential flag
— it lets the request survive page navigation or tab close, which is exactly when
terminal metrics like CLS are reported. The dev-mode early return keeps local numbers
(unminified, hot-reloading) out of production data, and the empty `.catch` guarantees
telemetry can never surface an error to a user.

---

## Next

Volume 6 covers the screens built on all of this: the three dashboards, the booking and
payment flows, the triage wizard, the WebRTC call component, and the feature folders.
