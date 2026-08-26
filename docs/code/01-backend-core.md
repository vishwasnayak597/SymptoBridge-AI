# Volume 1 — Backend Core (bootstrap, middleware, utils)

Complete walkthrough of the 12 files that every request passes through. Every
exported function is covered; every non-obvious line is explained. Read this volume
first — the routes, services and models in later volumes are all variations layered
on top of what happens here.

Files covered: [`server.ts`](../../backend/src/server.ts) ·
[`utils/database.ts`](../../backend/src/utils/database.ts) ·
[`utils/logger.ts`](../../backend/src/utils/logger.ts) ·
[`utils/redis.ts`](../../backend/src/utils/redis.ts) ·
[`utils/jwt.ts`](../../backend/src/utils/jwt.ts) ·
[`utils/cache.ts`](../../backend/src/utils/cache.ts) ·
[`utils/phiCrypto.ts`](../../backend/src/utils/phiCrypto.ts) ·
[`middleware/auth.ts`](../../backend/src/middleware/auth.ts) ·
[`middleware/validate.ts`](../../backend/src/middleware/validate.ts) ·
[`middleware/idempotency.ts`](../../backend/src/middleware/idempotency.ts) ·
[`middleware/observability.ts`](../../backend/src/middleware/observability.ts) ·
[`middleware/errorHandler.ts`](../../backend/src/middleware/errorHandler.ts)

---

## 1. `server.ts` — the composition root

[`backend/src/server.ts`](../../backend/src/server.ts) · 284 lines · the only file that
wires everything together. Everything it does happens inside one `async function
startServer()`, guarded by a try/catch that exits the process on any boot failure
(line 268) — fail fast rather than run half-initialised.

### 1.1 The two import side-effects (lines 2–3)

```ts
import 'dotenv/config';
import 'express-async-errors';
```

`dotenv/config` loads `.env` into `process.env` as a side effect of importing, and it
must be first: every module imported below reads env vars at module scope (for example
`utils/database.ts` reads `MONGODB_URI`, `utils/logger.ts` reads `LOG_LEVEL`), so
loading later would leave them undefined.

`express-async-errors` monkey-patches Express's router so that a rejected promise
inside an `async` route handler is forwarded to `next(err)` automatically. Without it,
Express 4 silently swallows async rejections and the request hangs until timeout. This
single import is why route handlers throughout the codebase can be `async` without
being wrapped in try/catch or in `asyncHandler` — the safety net is global.

### 1.2 Trust proxy (line 40)

```ts
app.set('trust proxy', 1);
```

Render terminates TLS at a load balancer and forwards to the Node process, so
`req.socket.remoteAddress` is the balancer, not the user. With `trust proxy` set,
Express reads the leftmost untrusted value from `X-Forwarded-For` into `req.ip`.

The value is `1`, not `true`, deliberately. `true` trusts the entire forwarded chain,
which lets a client send a forged `X-Forwarded-For` header and impersonate an
arbitrary IP — defeating rate limiting entirely. `1` means "trust exactly one proxy
hop" (Render's), so the client-supplied portion is ignored. This is also what
`express-rate-limit` validates on startup; before this line existed the app crashed
with `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.

### 1.3 CORS (lines 43–77)

The origin check is a function rather than a static list, because it needs a regex
branch:

```ts
if (!origin) return callback(null, true);
const isRenderHost = /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin);
if (allowedOrigins.indexOf(origin) !== -1 || isRenderHost) callback(null, true);
else callback(new Error('Not allowed by CORS'));
```

`!origin` covers same-origin requests, `curl`, and native apps, which send no `Origin`
header at all — rejecting those would break the health checks and the metrics scrape.
The `isRenderHost` regex means any `*.onrender.com` deployment is accepted, so renaming
a service or adding a preview environment never breaks CORS. The explicit list carries
legacy origins from earlier deployments so old URLs kept working during migration.

`credentials: true` plus `exposedHeaders: ['Set-Cookie']` are what allow the refresh
token to travel as an httpOnly cookie across origins in development. Note that in
production the frontend is served by this same process (section 1.9), so CORS is
effectively a development and preview-environment concern.

### 1.4 Helmet, parsers, compression (lines 80–90)

```ts
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, ... }));
```

Helmet sets a bundle of defensive headers (`X-Content-Type-Options`,
`X-Frame-Options`, HSTS, and others). Two are disabled: **CSP** is off because the
default policy blocks the inline styles and Google Fonts the frontend uses — this is a
known debt, and turning it back on with a nonce-based policy is a real task, not a
one-line flip. **COEP** is off because it would break loading cross-origin media and
the WebRTC-adjacent assets.

`express.json({ limit: '10mb' })` parses JSON bodies into `req.body` and caps payload
size (a cheap denial-of-service guard). `urlencoded` handles form posts.
`cookieParser()` populates `req.cookies`, which is how the refresh token is read on
`POST /auth/refresh`. `compression()` gzips responses.

### 1.5 Observability wiring (lines 98–101)

```ts
app.use(requestId);
app.use(httpMetrics);
app.get('/metrics', metricsHandler);
app.post('/api/vitals', vitalsHandler);
```

Order matters. `requestId` runs before `httpMetrics` so that a request already carries
its correlation id by the time timing starts; both run before the routers so every
route is measured. `/metrics` is registered here — before the rate limiter is scoped
to `/api` — so a monitoring scrape can never be rate-limited away. `/api/vitals` is
registered at this level rather than inside a router because it is telemetry ingest
with no auth and no database access; keeping it flat avoids paying router overhead for
a fire-and-forget beacon.

### 1.6 Rate limiting (lines 105–117)

```ts
const redis = getRedis();
const globalRateLimit = rateLimit({
  windowMs: 60_000,
  max: NODE_ENV === 'production' ? 300 : 10000,
  skip: () => NODE_ENV === 'development',
  ...(redis ? { store: new RedisStore({ sendCommand: ..., prefix: 'rl:' }) } : {}),
});
app.use('/api', globalRateLimit);
```

The spread `...(redis ? { store } : {})` is the graceful-degradation idiom used
throughout the codebase: when Redis is configured the counters live there, so limits
hold across every instance; without it `express-rate-limit` falls back to its in-memory
store, which is correct only for a single instance. Development skips limiting
entirely so hot-reload loops do not trip it. The limiter is mounted on `/api` only, so
static assets and health checks are unaffected.

### 1.7 Health check (lines 122–132)

Registered *before* `await Database.connect()` so the endpoint answers even while the
database is still connecting or is down — which is the whole point of a health check.

```ts
database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
```

`readyState` is Mongoose's live connection enum (`0` disconnected, `1` connected, `2`
connecting, `3` disconnecting). This line previously returned the hardcoded string
`'connected'`, which meant the admin System panel reported a healthy database even
when Mongo was unreachable — a monitoring surface that lies is worse than none.

### 1.8 Dynamic route imports (lines 138–167)

Routes are imported with `await import(...)` *after* the database connects, not with
top-level static imports. The reason is initialisation order: route modules import
services, which import Mongoose models, and model files call `mongoose.model(...)` at
module scope. Deferring the import until the connection exists avoids
buffering/registration ordering problems, and `bufferCommands: false` in the database
options (section 2) makes any accidental pre-connection query fail loudly instead of
hanging.

Each router is mounted under its prefix, and because `.default` is used, every route
module must have a default export. A failure here is caught and rethrown (line 165) so
a bad route file aborts boot rather than producing a server with silently missing
endpoints.

### 1.9 Static frontend serving (lines 170–201)

In production only, the compiled Next.js static export in `frontend/out` is served by
this same process — which is why the deployed app has no cross-origin problem at all.
Three handlers, in order: `/_next` for hashed build assets, `/` for everything else in
`out`, and finally a catch-all `app.get('*')` that returns `index.html` for any
non-`/api/` path. That last one is standard SPA fallback: deep links like
`/patient/dashboard` are client-side routes with no file on disk, so the shell is
returned and the router takes over in the browser. The `if (!req.path.startsWith('/api/'))`
guard prevents the fallback from swallowing unmatched API routes, letting them fall
through to the 404 handler.

The explicit `setHeaders` MIME overrides for `.css` and `.js` exist because
mis-served content types cause browsers to refuse stylesheets and modules outright.

### 1.10 Error handlers last (lines 204–205)

```ts
app.use(notFoundHandler);
app.use(errorHandler);
```

Express matches middleware in registration order, so these must be last: anything
reaching `notFoundHandler` matched no route, and `errorHandler` has the four-argument
signature Express uses to recognise an error handler. Registering them earlier would
intercept requests before the real routes ever ran.

### 1.11 Server, real-time, workers, shutdown (lines 208–262)

The Express app is wrapped in `http.createServer(app)` because Socket.IO needs the raw
HTTP server to perform its upgrade handshake — `app.listen()` alone would not expose
it. Then `SocketService.init(httpServer)`, `startEventConsumers()` and
`startJobWorkers()` bring up the real-time layer, the Redis Streams consumers, and the
BullMQ worker respectively; each of those degrades internally if Redis is absent.

`gracefulShutdown` (line 223) stops the keep-alive pinger, the event consumers, the job
workers, and Socket.IO, then closes the HTTP server (which stops accepting new
connections while letting in-flight ones finish) and only then closes Redis and Mongo
before exiting. Order is deliberate: stop producing work, drain, then tear down
dependencies.

It is registered for `SIGTERM` (what Render sends on deploy) and `SIGINT` (Ctrl-C), and
also for `uncaughtException` and `unhandledRejection`. Routing crashes through the same
path means a fatal error still closes connections cleanly rather than leaving sockets
dangling — and because logging is now stdout-only (section 3), those crash logs are
actually visible in the platform log stream.

The whole `listen` call is wrapped in a promise so `startServer()` only resolves once
the port is actually bound, and a `server.on('error')` handler rejects it on
`EADDRINUSE` and friends.

---

## 2. `utils/database.ts` — connection lifecycle

[`backend/src/utils/database.ts`](../../backend/src/utils/database.ts) · 142 lines.

A singleton class exported as an instance (`export default new Database()`), with the
singleton enforced in the constructor by returning the existing instance if one exists.

`connect()` is idempotent — it returns early if `isConnected` is already true — then
reads config and calls `mongoose.connect`. The connection options in
`getDatabaseConfig()` are the interesting part:

- `maxPoolSize: 10`, `minPoolSize: 2` — the connection pool. Ten concurrent sockets is
  generous for this workload and comfortably inside Atlas free-tier limits; keeping two
  warm avoids paying handshake latency on the first request after idle.
- `serverSelectionTimeoutMS: 5000` — how long the driver hunts for a reachable node
  before failing. Kept short so a misconfigured URI surfaces in five seconds instead of
  thirty.
- `connectTimeoutMS: 30000`, `heartbeatFrequencyMS: 10000` — socket establishment
  budget, and how often the driver re-checks topology health.
- `bufferCommands: false` — the important one. By default Mongoose *queues* queries
  issued before a connection exists and replays them later, which converts a
  configuration bug into a mysterious hang. With buffering off, such a query rejects
  immediately with a clear error.

`setupEventListeners()` subscribes to `connected` / `error` / `disconnected` /
`reconnected` and flips `isConnected` on the last two, so the flag tracks reality rather
than only the initial call. It also registers a `SIGINT` handler that disconnects and
exits — note this overlaps with the `gracefulShutdown` in `server.ts`, which is
harmless (both are idempotent) but is duplication worth collapsing eventually.

`isDBConnected()` deliberately checks both the internal flag *and*
`mongoose.connection.readyState === 1`, so it cannot report healthy on a stale flag.

---

## 3. `utils/logger.ts` — logging strategy

[`backend/src/utils/logger.ts`](../../backend/src/utils/logger.ts) · Winston, configured
to write **only to stdout**.

Two formats: a colourised human-readable one in development, and structured JSON (one
object per line, with `errors({ stack: true })` so stack traces survive serialisation)
in production. The environment check picks between them at construction.

The design decision worth understanding is the absence of file transports. Writing log
files inside a container is an anti-pattern on any ephemeral-filesystem platform: the
disk is wiped on every deploy, nothing can read the files, and disk pressure becomes
your problem. The platform captures stdout and owns retention and shipping.

More seriously, the previous configuration sent `exceptionHandlers` and
`rejectionHandlers` *only* to files — meaning uncaught exceptions, the single most
important thing to see, were written to a location nobody could read and which vanished
on restart. Both now point at the same console transport, so crashes appear in the log
stream.

`morganStream` is the adapter that lets Morgan's HTTP access logs flow through Winston
rather than writing directly to stdout, keeping one formatting pipeline.

---

## 4. `utils/redis.ts` — optional connections

[`backend/src/utils/redis.ts`](../../backend/src/utils/redis.ts).

Three exports, all built around the principle that Redis is optional.

`getRedis()` memoises with an `attempted` flag so the connection is created at most
once, and — critically — returns `null` rather than throwing when `REDIS_URL` is unset
or malformed. Every caller is written to handle `null`. A malformed URL is caught and
logged, not propagated, because a typo in an env var must not prevent boot.

`createBlockingRedis()` exists because of a hard constraint in the Redis protocol: a
blocking read (`XREAD BLOCK`, used by the event-bus consumers) occupies its connection
for the duration, so it cannot share the main client without stalling every other
command. It sets `maxRetriesPerRequest: null` (required for indefinitely-blocking
operations) and includes a small `reported` latch so a flapping connection logs once
per outage rather than on every reconnect attempt — an easy way to flood logs
otherwise.

`closeRedis()` quits and resets the memo, letting shutdown be clean and tests
re-initialise.

---

## 5. `utils/jwt.ts` — token issuance and verification

[`backend/src/utils/jwt.ts`](../../backend/src/utils/jwt.ts) · 188 lines. Four token
types, each with a generate/verify pair.

Every function begins by asserting its secret exists and throwing if not. That is
intentional: a missing `JWT_SECRET` is unrecoverable, and failing loudly at first use
beats signing tokens with `undefined`.

**Access tokens** (line 36) carry `userId`, `email`, `role` and `isEmailVerified`, and
expire in **15 minutes**. The payload embeds `role` so `authorize()` can make decisions
without a database round trip — though note `authenticate` loads the user anyway, so
the embedded copy is a convenience rather than a saving. Short expiry bounds the damage
of a stolen token.

**Refresh tokens** (line 51) are signed with a *different* secret
(`JWT_REFRESH_SECRET`), last **7 days**, and carry only `userId` plus a
`crypto.randomUUID()` `tokenId`. Separate secrets mean compromising the access-token
secret does not let an attacker forge refresh tokens. The `tokenId` is the hook for
revocation: the id is persisted on the user document, so a specific session can be
invalidated. (Today they are stored but never rotated on use — see the limitations
section of the architecture doc.)

**Email-verification** (24h) and **password-reset** (1h) tokens reuse `JWT_SECRET` but
embed a `type` discriminator, and their verifiers explicitly check it:

```ts
if (payload.type !== 'password-reset') throw new Error('Invalid token type');
```

Without that check, a valid email-verification token would also satisfy the
password-reset verifier — a token-confusion vulnerability, since both are signed with
the same key.

All tokens set and verify `issuer: 'aidoc-api'` and `audience: 'aidoc-app'`. These are
standard JWT claims that scope a token to this application, so a token minted by an
unrelated system sharing the secret would still be rejected.

`extractTokenFromHeader` (line 181) is a small parser that requires exactly two
space-separated parts with the first being literally `Bearer`, returning `null`
otherwise — so malformed headers become a clean 401 rather than an exception.

---

## 6. `utils/cache.ts` — cache-aside

[`backend/src/utils/cache.ts`](../../backend/src/utils/cache.ts).

`getCached(key, ttlSeconds, loader)` implements the read path. If Redis is absent it
simply calls the loader. Otherwise it attempts a `GET`; a hit is JSON-parsed and
returned. Note the check is `hit !== null` rather than a truthiness test, so a cached
empty array or `0` is still treated as a hit rather than re-querying.

Both the read and the write to Redis are individually wrapped so a cache failure never
fails the request — a read error logs and falls through to the loader; a `SET` error is
swallowed entirely, since the only consequence is that the next read misses too.
Caching is an optimisation and must never be a new failure mode.

`invalidateCache(prefix)` deletes every key under a prefix using `SCAN` in a cursor
loop with `COUNT 100`, explicitly not `KEYS`. `KEYS` is O(n) over the entire keyspace
and blocks the single-threaded Redis server for its duration — fine on a laptop,
catastrophic in production. `SCAN` iterates in bounded chunks.

Callers live in [`routes/users.ts`](../../backend/src/routes/users.ts): the doctor list
is read through `getCached` with a 60-second TTL and a key that buckets latitude and
longitude to two decimal places (roughly 1 km) so nearby users share entries, and
invalidation fires on profile update, activation status change, and doctor
verification.

Not yet handled: cache stampede. If a popular key expires while under load, every
concurrent request misses and hits Mongo simultaneously. A single-flight lock or
probabilistic early expiry would fix it.

---

## 7. `utils/phiCrypto.ts` — field-level encryption

[`backend/src/utils/phiCrypto.ts`](../../backend/src/utils/phiCrypto.ts).

AES-256-GCM, chosen because it is *authenticated*: tampering or a wrong key fails
verification loudly instead of decrypting to plausible garbage. Output format is
`enc:v1:<iv>:<tag>:<ciphertext>`, all base64. The `v1` tag leaves room to rotate
algorithm or key derivation later without ambiguity about how existing rows were
written.

`getKey()` derives a fixed 32-byte key by SHA-256-ing whatever passphrase is in
`PHI_ENCRYPTION_KEY`, so operators are not required to supply exactly 32 bytes. When
the variable is unset it returns `null` and logs a warning exactly once (a module-level
`warned` latch), rather than every single write.

`encryptPhi` short-circuits on non-strings, empty strings, values already carrying the
prefix (so a re-save cannot double-encrypt), and a missing key. Otherwise it generates a
fresh 12-byte IV per value — never reused, which is mandatory for GCM — encrypts, and
appends the auth tag.

`decryptPhi` is where backward compatibility lives:

```ts
if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
```

Any value without the prefix is returned untouched, so every pre-encryption plaintext
row in the database continues to display exactly as before. This is what makes the
feature safe to deploy against live data with no migration. If the prefix is present but
the key is missing or decryption fails, it returns an explicit marker string rather than
throwing — a single corrupt row degrades one field instead of failing the whole request.

The signatures are `(string) => string` rather than `(unknown) => unknown`, which looks
like a lie at runtime (the guards handle non-strings) but is required for Mongoose's
`SchemaDefinitionProperty` type inference to accept them as getters and setters. With
`unknown` the model fails to typecheck.

Wired up in [`models/Appointment.ts`](../../backend/src/models/Appointment.ts) on
`symptoms` and `notes`, with `toJSON`/`toObject` set to `{ getters: true }` so
serialisation for API responses runs the decryption. Two consequences worth knowing:
the setter runs *before* validators, so length rules apply to ciphertext (the real
10–1000 character rule is enforced by the zod schema at the edge, and `maxlength` is
sized for ciphertext at 4096); and encrypted fields cannot be queried or regex-matched
server-side, which is acceptable only because these are free-text fields never used as
filters.

---

## 8. `middleware/auth.ts` — authentication and authorisation

[`backend/src/middleware/auth.ts`](../../backend/src/middleware/auth.ts) · 241 lines,
seven exports. The `declare global` block at the top augments Express's `Request` type
with an optional `user`, which is what makes `req.user` type-safe everywhere downstream.

**`authenticate`** (line 23) is the workhorse. It extracts the bearer token, 401s if
absent, verifies the signature and expiry, then loads the user from the database by the
id in the payload. Loading rather than trusting the token wholesale is what allows
deactivation and lockout to take effect immediately — a token issued before an admin
disabled the account is rejected on the very next request. `!user || !user.isActive`
yields 401; a locked account yields **423 Locked**, a distinct status so the client can
show a specific message. On success it assigns `req.user` and calls `next()`.

Every branch `return`s after responding. Forgetting that in Express is a classic bug:
the handler would continue executing and later attempt a second response, producing
`ERR_HTTP_HEADERS_SENT`. The surrounding try/catch converts any thrown verification
error (malformed, expired, wrong signature) into a uniform 401 — the client cannot
distinguish causes, which is deliberate.

**`authorize(...roles)`** (line 90) is a middleware factory: it returns a middleware
closed over the allowed roles, so routes read `authorize('admin')`. It 401s when
`req.user` is missing (meaning it was mounted without `authenticate` before it — an
ordering mistake) and 403s when the role is not in the list. 401 versus 403 is the
correct distinction: *who are you* versus *you may not*.

**`requireEmailVerification`** (line 71) gates on `isEmailVerified`.

**`authorizeVerifiedDoctor`** (line 115) layers three checks — authenticated, role is
doctor, and `isVerified` — for endpoints only credential-approved doctors may reach.
Note it reads `isVerified`, which is the field the admin approval flow *should* be
setting; the current admin verify endpoint sets `isEmailVerified` instead, which is the
semantic mismatch documented elsewhere.

**`authorizeAdminWithPermissions(...permissions)`** (line 150) checks the admin role and
then that `req.user.permissions` is a superset of the required list via
`permissions.every(...)`. The seeded admin already carries a `permissions` array, so the
data model for fine-grained RBAC exists; this middleware is simply not yet mounted on
routes.

**`authorizeOwnerOrAdmin(userIdParam)`** (line 188) compares `req.user._id.toString()`
against a route parameter and allows either the owner or an admin — the standard guard
for `/users/:userId/...` shaped endpoints. The `.toString()` matters because one side is
an `ObjectId` and the other a string; `===` on those is always false.

**`optionalAuth`** (line 217) populates `req.user` when a valid token is present but
never rejects — for endpoints whose response varies by login state. Both the missing-token
path and the catch call `next()` unchanged.

---

## 9. `middleware/validate.ts` — the edge contract

[`backend/src/middleware/validate.ts`](../../backend/src/middleware/validate.ts) · 23
lines, and one of the highest-leverage files in the codebase.

```ts
export function validate(schema: ZodSchema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join(', ');
      return res.status(400).json({ success: false, error: message });
    }
    req.body = result.data;
    next();
  };
}
```

`safeParse` returns a discriminated union instead of throwing, so the failure path is
ordinary control flow. Messages from all issues are joined, so a form with three bad
fields reports all three in one response rather than one per round trip.

The line that does the real work is `req.body = result.data`. Zod does not merely
validate — it *transforms*: `.trim()` strips whitespace, `.toLowerCase()` normalises
emails, `z.coerce.number()` converts numeric strings from form posts, and unknown keys
are stripped by default. Replacing the body means every downstream handler receives
clean, canonical, minimal data and can never accidentally read an attacker-supplied
extra field. Combined with the schemas living in
[`shared/schemas.ts`](../../shared/schemas.ts) and being imported by the frontend forms
too, the client and server literally cannot disagree about what is valid.

---

## 10. `middleware/idempotency.ts` — exactly-once writes

[`backend/src/middleware/idempotency.ts`](../../backend/src/middleware/idempotency.ts).

Opt-in per route via `idempotent('appointment')` or `idempotent('payment')`. Requests
without an `Idempotency-Key` header pass straight through, so the feature is additive.

The stored key is namespaced as `` `${scope}:${userId}:${clientKey}` `` — scoping by
user prevents one client's key from colliding with another's, and by scope prevents a
booking key from matching a payment key.

The flow has four states. If a record exists **with** a stored `statusCode`, the
original response is replayed verbatim with an `Idempotency-Replayed: true` header. If a
record exists **without** one, the first attempt is still in flight and the retry gets
**409**. Otherwise the middleware inserts the key to reserve it.

The reservation is the concurrency primitive. Rather than taking a lock, it relies on
the unique index on `key` in
[`models/IdempotencyKey.ts`](../../backend/src/models/IdempotencyKey.ts): two simultaneous
requests both attempt the insert, exactly one succeeds, and the loser's `E11000`
duplicate-key error is caught and mapped to the same 409. Any *other* error — meaning
the idempotency store itself is unavailable — calls `next()`, degrading to
non-idempotent behaviour rather than blocking a legitimate booking.

Response capture is done by wrapping `res.json`:

```ts
const originalJson = res.json.bind(res);
res.json = ((body) => {
  const succeeded = res.statusCode >= 200 && res.statusCode < 300;
  const settle = succeeded
    ? IdempotencyKey.updateOne({ key }, { $set: { statusCode: res.statusCode, responseBody: body } })
    : IdempotencyKey.deleteOne({ key });
  settle.catch(() => {});
  return originalJson(body);
}) as Response['json'];
```

The success/failure asymmetry is the subtle part. Successes are persisted so retries
replay them. Failures **release** the key by deleting it — otherwise a validation error
would be cached and replayed forever, and the user could never correct their input and
retry. The persistence promise is deliberately not awaited: blocking the response on a
bookkeeping write would add latency to every request, and the `.catch(() => {})`
prevents an unhandled rejection.

Records carry a 24-hour TTL index, so the collection self-prunes.

The known weakness: persistence happens *after* the handler completes, so a crash
between the domain write and the response-capture write leaves a reserved key with no
stored response. Retries then receive 409 until the TTL expires. Closing that hole means
folding the reservation and the domain write into one transaction, or an outbox.

---

## 11. `middleware/observability.ts` — correlation and metrics

[`backend/src/middleware/observability.ts`](../../backend/src/middleware/observability.ts).

A dedicated `client.Registry()` is created rather than using prom-client's global
default registry, which keeps metrics isolated and makes the module testable.
`collectDefaultMetrics` adds process-level series for free — heap, RSS, event-loop lag,
GC, active handles — which is why the Grafana dashboard can chart memory and event-loop
lag without any extra code.

**`requestId`** honours an inbound `X-Request-Id` if present and otherwise generates a
UUID, attaches it to `req`, and echoes it in the response header. Honouring the inbound
value is what makes correlation work across services: `TriageService` forwards the same
id to the Python ML service, so one user action is traceable end to end.

**`httpMetrics`** starts a histogram timer and observes it on the response `finish`
event. The label choice is the important detail:

```ts
const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || ...;
```

It uses the matched route *template* — `/api/appointments/:id` — never the raw URL.
Labelling by raw URL would create a distinct time series per appointment id, which is
the classic Prometheus cardinality explosion that takes down a metrics backend.

**`vitalsHandler`** ingests real-user web vitals beaconed from the browser. It validates
the metric name against an allowlist and the value with `isFinite`, silently ignoring
anything else, and always responds **204** regardless. Beacons do not retry and no user
is waiting on the response, so an error path would be pointless; the allowlist prevents
arbitrary label values from being injected into the metric.

**`metricsHandler`** guards the endpoint with an optional shared secret from
`METRICS_TOKEN`, accepted either as a bearer header or a `?token=` query parameter (the
query form exists because some scrapers configure auth awkwardly). Without the variable
set, the endpoint is public.

---

## 12. `middleware/errorHandler.ts` — the last line

[`backend/src/middleware/errorHandler.ts`](../../backend/src/middleware/errorHandler.ts)
· 111 lines, three exports.

**`errorHandler`** has the four-parameter signature `(error, req, res, next)` — that
arity is how Express identifies an error-handling middleware, and removing the unused
`next` would silently turn it into a regular one.

It defaults to `500`, logs the error with request context (URL, method, IP, user agent),
then translates known error shapes into appropriate statuses: Mongoose `ValidationError`
becomes 400 with the individual field messages joined; `CastError` (a malformed
`ObjectId` in a URL) becomes 400 "Invalid resource ID" rather than an ugly 500;
duplicate-key `11000` becomes 400 naming the offending field from `keyValue`;
`JsonWebTokenError` and `TokenExpiredError` become 401; and `MongoNetworkError` becomes
**503**, correctly signalling a dependency outage rather than an application bug.

The stack trace is included in the response body only when `NODE_ENV === 'development'`,
via a conditional spread — never leaked to production clients.

**`notFoundHandler`** returns a 404 in the same `{ success, error }` envelope every other
endpoint uses, so clients have exactly one response shape to parse.

**`asyncHandler`** wraps a handler so a rejected promise routes to `next`. It is largely
redundant now that `express-async-errors` is imported in `server.ts` (section 1.1), and
remains for explicit use.

---

## Where this fits

Everything above runs on *every* request, before any business logic. Volume 2 covers the
routes and services that sit on top: how `routes/auth.ts` composes
`authLimiter → validate → AuthService`, how `AppointmentService` orchestrates booking
across the model, the event bus, the job queue and the waitlist, and how the Mongoose
models define the persistence contract.
