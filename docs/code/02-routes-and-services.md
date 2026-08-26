# Volume 2 — Routes and Services

The HTTP surface and the business logic behind it. Routes are thin: they compose
middleware, extract parameters, call a service, and shape the response. Services hold
the orchestration — the interesting code lives there.

Assumes Volume 1 (middleware, utils, bootstrap).

---

## 1. The layering convention

Every endpoint follows the same composition:

```
router.<method>(path, [guards...], handler)
   guards  = authenticate → validate(schema) → idempotent(scope) → authorize(role)
   handler = destructure req → call Service.method() → res.json({ success, data })
```

Two validation styles coexist, which is worth knowing before reading the route files.
The **newer** style uses zod through `validate(schema)` on the write paths that matter
(register, login, appointment create, appointment rating, payment create, waitlist join,
dependents update). The **older** style uses `express-validator` arrays inline
(`[authenticate, param('id').isMongoId()]`) and is still present on many routes. Both
work; the zod path is the one to extend, since its schemas are shared with the frontend.
Consolidating the rest is outstanding work, not a bug.

Response envelope is uniform everywhere: `{ success: boolean, data?, error?, message? }`.
That is what makes the frontend's single error-handling path viable.

---

## 2. `routes/auth.ts` — the authentication surface

[`backend/src/routes/auth.ts`](../../backend/src/routes/auth.ts) · 11 endpoints, each
delegating to [`AuthService`](../../backend/src/services/AuthService.ts).

| Endpoint | Guards | Purpose |
|---|---|---|
| `POST /register` | `authLimiter`, `validate(registerSchema)` | create account, issue tokens |
| `POST /login` | `authLimiter`, `validate(loginSchema)` | authenticate, issue tokens |
| `POST /refresh` | — (cookie-based) | new access token |
| `POST /logout` | `authenticate` | revoke one refresh token |
| `POST /logout-all` | `authenticate` | revoke every session |
| `POST /verify-email/:token` | — | consume verification token |
| `POST /resend-verification` | `authLimiter` | re-send |
| `POST /forgot-password` | `passwordResetLimiter` | issue reset token |
| `POST /reset-password` | validator | consume reset token |
| `POST /change-password` | `authenticate` | rotate password while logged in |
| `GET /me` | `authenticate` | current user |

Note the dedicated `authLimiter` and `passwordResetLimiter` — tighter than the global
`/api` limiter, because credential endpoints are where brute-force and enumeration
attacks land. Rate limiting on `forgot-password` also throttles the outbound email
side-channel.

`POST /refresh` deliberately has no `authenticate` guard: the whole point is that the
access token has expired. It reads the refresh token from the httpOnly cookie, which is
why `cookieParser()` and `credentials: true` in CORS are prerequisites.

Since `validate(registerSchema)` runs first, the handlers no longer check
`validationResult` or hand-roll field checks — `req.body` is already a parsed,
trimmed, coerced DTO. This removed roughly 60 lines of imperative validation.

### `AuthService` — the ten methods

`register` and `login` are covered line-by-line in the architecture doc; the rest:

**`refreshToken(token)`** implements **single-use rotation against a whitelist**, which is
stronger than it first appears. It verifies the signature, loads the user, then checks
`user.refreshTokens.includes(refreshToken)` — so a structurally-valid JWT that is not in
the stored whitelist is rejected. It then `removeRefreshToken(old)`, mints a new pair, and
`addRefreshToken(new)`. Each refresh token is therefore consumed on use.

What is *not* implemented is **reuse detection**: presenting an already-rotated token is
rejected (it is no longer whitelisted) but does not invalidate the whole token family,
which is the classic response to a stolen-token replay. Tokens are also stored raw rather
than hashed, so a database leak hands over live sessions.

**`logout(userId, refreshToken)`** removes one token from the user's stored array —
logging out one device. **`logoutAll(userId)`** empties the array, invalidating every
session, which is the correct response to a suspected compromise.

**`verifyEmail(token)`** verifies the token *and* its `type` discriminator (see Volume 1
§5), then flips `isEmailVerified`. **`requestPasswordReset`** generates a 1-hour token
and stores a hash of it with an expiry on the user — storing the hash rather than the
token means a database leak does not hand over working reset links.
**`resetPassword(token, newPassword)`** verifies, checks expiry, assigns the new
password (the `pre('save')` hook hashes it), and clears the reset fields.
**`changePassword`** additionally requires the current password.

---

## 3. `routes/appointments.ts` — the busiest router

[`backend/src/routes/appointments.ts`](../../backend/src/routes/appointments.ts) · 14
endpoints including the waitlist block.

The create endpoint is the fully-modernised example and worth reading as the template:

```ts
router.post('/', authenticate, validate(createAppointmentSchema),
             idempotent('appointment'), async (req, res) => { ... })
```

Guard order is load-bearing. `authenticate` must precede `idempotent` because the
idempotency key is namespaced by user id. `validate` precedes `idempotent` so a
malformed request is rejected *before* consuming a key — otherwise a client would have
to mint a new key after every validation failure.

`GET /availability/:doctorId/:date` computes free slots by generating the doctor's
configured time grid and subtracting booked appointments, returning `allSlots`,
`availableSlots` and `bookedSlots` separately so the UI can render taken slots as
disabled rather than hiding them.

`PATCH /:id/status` and `/:id/notes`, `POST /:id/cancel`, `/:id/prescription`,
`/:id/rating` cover the consultation lifecycle. The waitlist trio
(`POST /waitlist`, `GET /waitlist/mine`, `DELETE /waitlist/:id`) delegates entirely to
`WaitlistService`.

### `AppointmentService` — orchestration

[`backend/src/services/AppointmentService.ts`](../../backend/src/services/AppointmentService.ts)
· 557 lines, 13 static methods. This is the service that touches the most collaborators,
and `createAppointment` shows why:

1. `validateAppointmentCreation` — existence, role, and slot checks.
2. Construct and `save()` the `Appointment`.
3. `populate` patient and doctor for the response.
4. `publishEvent({ type: 'appointment.booked', ... })` — fire-and-forget onto the bus.
5. `scheduleAppointmentReminders(id, date)` — enqueue the T-24h and T-1h delayed jobs.
6. `WaitlistService.markFulfilled(...)` — close out any waitlist entry this booking
   satisfies, wrapped in `.catch(() => {})`.
7. Two `NotificationService.createNotification` calls (patient and doctor).

The failure-isolation policy is the thing to notice. The event publish and the waitlist
update are explicitly non-fatal — a bus hiccup or a waitlist edge case must never fail a
booking the user already paid for. Reminder scheduling is similarly wrapped inside
`scheduleAppointmentReminders` itself. The notifications, by contrast, are awaited
unguarded, which is arguably inconsistent: a notification failure will currently fail
the booking. Worth aligning.

**`cancelAppointment`** mirrors it: guard `canBeCancelled` (a model virtual enforcing the
24-hour rule), set status, publish `appointment.cancelled`, then
`cancelAppointmentReminders(id)` so a cancelled booking cannot fire a reminder, then
`WaitlistService.offerNext(doctor, day)` to hand the freed slot down the queue.

**`getAppointmentById(id, userId)`** takes the caller's id and verifies participation —
authorisation lives *in the service*, not only in middleware, so no route can
accidentally expose another patient's record.

**`getAppointments(filters, page, limit)`** does offset pagination (`skip`/`limit`).
Fine at current scale; cursor pagination is the upgrade when a doctor has thousands of
records.

**`sendAppointmentReminders()`** and **`getUpcomingAppointments(hours)`** are the older
cron-scan approach to reminders. They are now superseded by the BullMQ delayed jobs but
remain in place — dead weight worth deleting once the queue is confirmed in production.

**`getAppointmentStats(userId, role)`** aggregates counts by status for the dashboards.

---

## 4. `routes/payments.ts` + `PaymentService`

[`routes/payments.ts`](../../backend/src/routes/payments.ts) ·
[`PaymentService`](../../backend/src/services/PaymentService.ts) (618 lines, the largest
service).

`POST /` carries the same `validate → idempotent('payment')` pair as booking — this is
the endpoint where a duplicate submission costs real money, so the idempotency guarantee
matters most here. `POST /:id/process` performs the gateway simulation and transitions
the payment to `completed` or `failed`; `POST /:id/refund` reverses it.

`getAppointmentForPayment(appointmentId)` exists so the route can derive the correct
patient id from the appointment rather than trusting a client-supplied one — a small but
important trust boundary.

`processPayment` branches by `paymentGateway` (`stripe`, `razorpay`, `paypal`, `cash`)
and by `paymentMethod`, writes a `transactionId`, and publishes `payment.completed` with
the amount, which is what feeds the revenue counter in the analytics consumer (§8).

`getPaymentStats` aggregates totals for the doctor earnings and admin revenue panels.

---

## 5. `routes/users.ts` — profiles, search, admin

[`backend/src/routes/users.ts`](../../backend/src/routes/users.ts) · note the
`// @ts-nocheck` at the top — this file opted out of type checking, which is technical
debt worth repaying incrementally.

**`GET /doctors`** is the highest-traffic read. It parses optional `lat`/`lng`/`maxKm`,
builds `{ role: 'doctor', isEmailVerified: true, isActive: true }`, and wraps the load in
the cache-aside helper:

```ts
const cacheKey = hasLocation
  ? `${CACHE_KEYS.doctors}${lat.toFixed(2)}:${lng.toFixed(2)}:${maxKm}`
  : `${CACHE_KEYS.doctors}all`;
let doctors = await getCached(cacheKey, 60, () => loadDoctors(baseFilter, ...));
```

`toFixed(2)` buckets coordinates to roughly one kilometre so nearby users share a cache
entry — without it every unique GPS reading would be its own key and the hit rate would
approach zero.

`loadDoctors` runs a `$geoNear` aggregation against the `2dsphere` index when
coordinates are present, returning `distanceMeters`, and falls back to a plain `find`
if the geo path throws (a missing index on a fresh database, for example). Results are
then reshaped into the flat contract the frontend expects, converting metres to
kilometres.

**`PUT /profile`**, **`PUT /admin/:userId/status`** and **`PUT /admin/:userId/verify`**
each call `invalidateCache(CACHE_KEYS.doctors)` after a successful write, because all
three can change what doctor search returns.

**`PUT /dependents`** is the family-accounts write: `validate(updateDependentsSchema)`
caps the list at ten and replaces the array wholesale.

**`GET /admin/stats`** aggregates the platform totals consumed by the admin overview and
analytics panels.

⚠️ `PUT /admin/:userId/verify` sets `isEmailVerified = true` and `isActive = true`. The
semantically correct field for admin credential approval is `isVerified` — which is what
`authorizeVerifiedDoctor` checks. As written, email confirmation and admin approval are
conflated, and seeded doctors (already `isEmailVerified`) never surface a Verify button.
This is the known modelling bug.

---

## 6. `routes/ai.ts` + `TriageService`

[`routes/ai.ts`](../../backend/src/routes/ai.ts) exposes both the legacy LLM endpoints
(`/analyze-symptoms`, `/recommend-doctors`, `/analyze-and-recommend`,
`/symptom-checker-mcp`) and the current trained-model triage
(`/triage/meta`, `/triage/start`, `/triage/answer`).

[`TriageService`](../../backend/src/services/TriageService.ts) is a thin, deliberate
bridge — 122 lines, four exports.

**URL resolution** (lines 13–17):

```ts
const ML_SERVICE_URL = process.env.ML_SERVICE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://symptobridge-ml.onrender.com'
    : 'http://localhost:8001');
```

The environment-aware fallback matters: defaulting to localhost in production would make
every triage call fail against a service that is never local, and the failure would look
like a timeout rather than a misconfiguration.

**`mlFetch(path, body)`** is the only egress point — plain `fetch`, POST when a body is
supplied, throwing on non-2xx. This is where a **circuit breaker and timeout budget
belong** and currently do not exist: a cold or hung Python service holds the Node request
open. It is the single highest-value resilience gap in the backend.

**`getSymptoms()`** memoises `/meta` in a module-level `symptomCache`. The vocabulary
changes only when the model is retrained, so caching for process lifetime is right —
though it means a model redeploy needs a Node restart to pick up new symptoms.

**`extractInitialFindings(text)`** is the NL→evidence step, and it is two deliberate
passes. First, token matching: for each symptom id, split on underscores, drop tokens of
two characters or fewer, and mark the symptom present if *every* remaining token appears
in the lowercased text. `back_pain` → `["back","pain"]` → matches "my back pain". The
`length > 2` filter prevents noise words like `of` from matching everything.

Second, a curated `SYNONYM_PHRASES` regex table for lay phrasings the token pass
structurally cannot catch — "when I stand" carries none of the tokens in
`pain_worse_movement`, and "shoots down my leg" none of `radiating_leg_pain`. Each entry
is guarded by `known.has(symptomId)` so a stale synonym for a symptom the model no
longer has is silently ignored rather than poisoning the evidence.

This function is the honest weak point of the AI pipeline: it is deterministic string
matching, not language understanding. Replacing it with an LLM extractor (structured
output constrained to the known symptom vocabulary) is the natural upgrade — and note
that it would improve *input parsing* only; the diagnosis stays with the trained model.

**`startTriage`** extracts evidence then calls `/next-question`, returning the evidence
alongside the step so the client can echo it back. **`answerTriage(evidence, skip)`** is
stateless — the client owns the accumulated evidence and resends it each turn. That
keeps the server free of session state at the cost of a slightly larger payload, and it
is the right trade for a horizontally-scaled API.

---

## 7. `routes/video-calls.ts` + `VideoCallService` + `SocketService`

**`VideoCallService`** ([file](../../backend/src/services/VideoCallService.ts)) manages
call *records*: `createVideoCall(appointmentId)` marks the appointment and returns call
data, `generateAccessToken(callId, userId, role)` issues a join credential,
`endVideoCall`, `getCallStats`, `validateCall`, and recording stubs. A `setProvider`
hook exists so a real provider (Twilio, Agora) could be swapped in behind the same
interface.

`getActiveCallForPatient(patientId)` is the polling fallback that decides whether a
patient's screen should ring. It filters to calls **started within the last 60 minutes**
— without that window, an old call record rang forever, which was a real bug.

**`SocketService`** ([file](../../backend/src/services/SocketService.ts)) is the
real-time layer, and it does two distinct jobs on one connection.

Authentication happens at the **handshake**, not per message:

```ts
this.io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  const payload = verifyAccessToken(token);
  socket.userId = payload.userId;
  next();
});
```

Verifying once at connect and stashing `userId` on the socket means every subsequent
event is implicitly attributed — no event handler needs to re-authenticate, and no client
can claim to be another user by putting an id in a payload. Note the consequence: a
socket authenticated with an access token stays connected past that token's 15-minute
expiry, since there is no periodic re-validation.

On connect, the socket joins `user:{id}` — a private room enabling targeted push via
`emitToUser`, which is how `call:ring` and live notifications reach exactly one person.

The WebRTC signaling handlers are a pure relay: `webrtc:offer`, `webrtc:answer` and
`webrtc:ice` each re-emit to `call:{callId}` using `socket.to(room)`, which broadcasts to
everyone in the room **except the sender**. The server never inspects or stores SDP or
candidates; media never touches it. The comment on `call:peer-joined` records the glare
convention — the *existing* peer initiates the offer — which is what prevents both sides
generating offers simultaneously and deadlocking negotiation.

`chat:message` reuses the same room, trimming and truncating to 2000 characters.
`disconnecting` (fired while rooms are still attached, unlike `disconnect`) notifies call
rooms that a peer dropped.

⚠️ Single-instance only: rooms live in this process's memory. Horizontal scaling requires
`@socket.io/redis-adapter`, otherwise two users on different instances cannot see each
other's events.

---

## 8. `EventBus` — domain events

[`backend/src/services/EventBus.ts`](../../backend/src/services/EventBus.ts) · 179 lines.
Kafka-shaped semantics on Redis Streams, with an in-process fallback.

**`publishEvent(event)`** stamps `occurredAt` and appends to the `aidoc:events` stream:

```ts
await redis.xadd(STREAM_KEY, 'MAXLEN', '~', String(MAX_STREAM_LENGTH), '*',
                 'event', JSON.stringify(enriched));
```

`MAXLEN ~ 10000` caps the log approximately — the `~` lets Redis trim on node boundaries,
which is dramatically cheaper than exact trimming and is the standard production choice.
The cap exists so a free Redis instance cannot fill up. Without Redis, `setImmediate(() =>
localBus.emit(...))` delivers to the same handlers in-process, deferred a tick so a
handler cannot re-enter the caller's stack.

The entire publish is wrapped in try/catch that only logs. Publishing is fire-and-forget
by contract: telemetry must never fail a user's booking.

**Consumers** are two independent groups, `audit` and `analytics`, so each sees every
event. `startStreamConsumer(group)` takes its **own blocking connection** (Volume 1 §4 —
`XREAD BLOCK` monopolises a connection), creates the group with
`XGROUP CREATE ... '$' MKSTREAM` (start at the current tail; `MKSTREAM` creates the stream
if absent), and swallows `BUSYGROUP` because the group surviving a restart is the normal
case.

The read loop uses `XREADGROUP ... COUNT 10 BLOCK 5000` — batch up to ten, block up to
five seconds. Blocking rather than polling is what keeps idle CPU and Upstash command
counts near zero.

The error policy inside the loop is a deliberate trade-off:

```ts
} catch (err) {
  logger.error(...);
  await conn.xack(STREAM_KEY, group, id).catch(() => {});
}
```

A poisoned message is **acked anyway**. Normally you would leave it unacked for a
dead-letter path, but a stuck entry would block the group indefinitely — and for
best-effort telemetry, losing one audit row beats halting the whole consumer. For
payment-critical events this would be the wrong call, and the comment says so.

`handleAudit` writes an `AuditLog` document. `handleAnalytics` increments a daily Redis
hash `aidoc:stats:YYYY-MM-DD` with `HINCRBY`, adds revenue for `payment.completed`, and
sets a 45-day expiry so counters self-prune. `getLiveStats(day)` reads that hash — it is
what powers the admin System panel's event counters, and returns `{}` without Redis,
which is why that panel shows an explanatory empty state rather than an error.

⚠️ This is not a transactional outbox. `publishEvent` is called *after* the domain write
commits, so a crash in between loses the event. Acceptable for audit/analytics; not
acceptable if an event ever drives money movement.

---

## 9. `NotificationService`, `KeepAliveService`, `MCPService`, `AIService`

**`NotificationService`** ([file](../../backend/src/services/NotificationService.ts)) —
`createNotification` persists and pushes over Socket.IO; `getNotifications` paginates and
filters; `markAsRead` / `markAllAsRead` / `deleteNotification` / `deleteAllNotifications`
are scoped by `userId` in the query itself, so one user cannot mutate another's rows.
`getUnreadCount` backs the bell badge. `createBulkNotifications` and
`sendMaintenanceNotification` handle fan-out; `cleanupExpiredNotifications` prunes.

**`KeepAliveService`** ([file](../../backend/src/services/KeepAliveService.ts)) — pings
itself and the ML service on an interval to defeat Render free-tier cold starts.
`getStatus()` is surfaced in `/health`. Pragmatic infrastructure compensation, and
harmless to delete on a paid tier.

**`MCPService`** ([file](../../backend/src/services/MCPService.ts)) — a tool-calling
wrapper around Gemini with a registry (`registerTool`, `getOpenAIFunctions`,
`executeTool`), used for free-text symptom parsing with `analyzeWithFallback` degrading
gracefully when no API key is configured. **`AIService`**
([file](../../backend/src/services/AIService.ts)) is the older heuristic analyser. Both
sit *beside* the diagnostic path, never inside it — the trained model in the Python
service makes every clinical determination.

---

## Next

Volume 3 covers the models these services write through — schema definitions, hooks,
virtuals, and the indexing decisions that make the queries above fast.
