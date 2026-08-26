# Volume 6 — Frontend UI

The screens. Roughly 10,000 lines across pages, components and feature folders. This
volume covers state ownership, effects, handlers and data flow in full; repetitive JSX
and Tailwind class strings are summarised rather than reproduced, since they carry no
information a reader cannot get faster from the file itself.

Builds on Volume 5 (API client, React Query, auth context, socket).

---

## 1. Two generations of component design

The codebase visibly contains two eras, and knowing which you are reading saves
confusion.

**The original pattern** — one enormous page component holding all state, all fetching,
all handlers and all markup inline. `doctor/dashboard.tsx` (1,814 lines) and
`admin/dashboard.tsx` (806) are still written this way, as are the larger standalone
components.

**The refactored pattern** — a thin page shell that composes self-contained feature
folders, each owning its own server state via a colocated hook.
`patient/dashboard.tsx` was reduced from 1,782 lines to ~800 by this, and
`features/` is the result.

The refactored form is the intended direction; the doctor dashboard is the outstanding
work, and the template for doing it already exists.

---

## 2. `pages/patient/dashboard.tsx` — the composition example

[`frontend/pages/patient/dashboard.tsx`](../../frontend/pages/patient/dashboard.tsx) · ~800 lines.

What it still owns: `activeTab`, booking-modal state (`selectedDoctor`,
`showBookingModal`, `bookingSuccess`), `reminders` (still local dummy data),
`recommendedSpecializations` (carried from triage into doctor search), and the active
video-call invitation banner.

What it no longer owns: appointment, prescription and report data. Those come from hooks:

```ts
const { appointments, isLoading: loading } = useAppointments<Appointment>(!!user);
const { prescriptions } = usePrescriptions(!!user);
const { reports: uploadedReports } = useReports(!!user);
```

The overview tab's stat cards and the tab panels call the *same* hooks, and React Query
dedupes them into one request per key. That is the mechanism that removed prop-drilling:
two components needing the same data both ask for it, and neither has to receive it from
a parent.

The tab body is now composition:

```tsx
{activeTab === 'appointments' && (
  <AppointmentsList appointments={appointments} loading={loading}
                    onBookNew={() => setActiveTab('find-doctors')} />
)}
{activeTab === 'reports' && <ReportsPanel />}
```

`ReportsPanel` takes **zero props** because it owns its own data and mutations.
`AppointmentsList` takes data plus one navigation callback — the container/presentational
split, where the page decides *where tabs go* and the feature decides *what it shows*.

The video-call invitation banner is the remaining complexity: a polling effect against
`/video-calls/active` (belt-and-braces alongside the socket push), a 5-minute
auto-dismiss timeout held in a ref, and cleanup on unmount.

---

## 3. `features/appointments/` — the reference feature folder

[`AppointmentsList.tsx`](../../frontend/features/appointments/AppointmentsList.tsx) renders
the list and owns the rating write itself:

```ts
const invalidateAppointments = useInvalidateAppointments();
const submitRating = async (appointmentId, rating, review) => {
  await apiClient.post(`/appointments/${appointmentId}/rating`, { rating, review });
  await invalidateAppointments();
};
```

The write and its cache invalidation live together, so the page never learns that ratings
exist. Two module-level pure helpers sit above the component: `toCalendarEvent` maps an
appointment to the calendar payload, and `isUpcoming` gates the calendar buttons to
future, non-cancelled appointments. Defining them outside the component means they are
not recreated per render.

[`AppointmentRating.tsx`](../../frontend/features/appointments/AppointmentRating.tsx)
contains `StarRating` (reused read-only by passing no `onChange`, which also sets
`disabled` and removes the pointer cursor) and the rating form. It early-returns a
read-only view when `appointment.rating?.patientRating` exists, so a rated appointment
cannot be rated twice. Errors are rendered inline rather than toasted, because the user is
mid-form and needs the message next to the control.

[`utils.ts`](../../frontend/features/appointments/utils.ts) holds `formatAppointmentDate`,
`getStatusColor`, `canJoinVideoCall` (the −10/+30 minute window, confirmed status only)
and `joinVideoCall`. Extracting these matters because the overview tab and the
appointments tab both format dates and colour statuses — previously duplicated.

The other folders follow the same shape:
[`prescriptions/`](../../frontend/features/prescriptions/PrescriptionsList.tsx) (pure
presentation + its hook), [`reports/`](../../frontend/features/reports/ReportsPanel.tsx)
(fully self-contained: upload form state, client-side file validation at 10 MB and a MIME
allowlist, toasts instead of `alert()`, `htmlFor`/`id` pairs on every field), and
[`reminders/`](../../frontend/features/reminders/RemindersList.tsx) (presentational; the
page owns the array).

---

## 4. `components/VideoCall.tsx` — WebRTC

[`frontend/components/VideoCall.tsx`](../../frontend/components/VideoCall.tsx) · 407 lines,
and the most technically dense component in the app.

### Refs versus state

```ts
const pcRef = useRef<RTCPeerConnection | null>(null);
const localStreamRef = useRef<MediaStream | null>(null);
const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
```

Every piece of WebRTC machinery is a ref, never state. Two reasons: these objects are
mutable and imperative — re-rendering when a peer connection changes internally would be
meaningless and expensive — and, critically, socket event handlers registered inside the
effect close over their creation-time scope. A `useState` value read inside those handlers
would be permanently stale; a ref's `.current` always reads live. This is *the* correct
pattern for imperative browser APIs in React, and getting it wrong is the most common
WebRTC-in-React bug.

`status` is state, because it drives rendering:
`initializing → waiting → connecting → connected → peer-left`.

### `createPeerConnection`

Idempotent by its first line (`if (pcRef.current) return pcRef.current`), so repeated
signaling events cannot create parallel connections. It attaches local tracks, then wires
three handlers:

- `onicecandidate` — emits each discovered candidate to the peer via the socket. This is
  **trickle ICE**: candidates are sent as they are found rather than waiting for
  gathering to complete, which materially reduces time-to-connect.
- `ontrack` — assigns the remote stream to the video element. This single line is where
  the other person appears.
- `onconnectionstatechange` — on `connected`, flips status and starts the duration timer
  (guarded so re-entry cannot start two intervals); on `failed`, surfaces an error.

### The negotiation dance

```
A already in room ──── B joins ────► server emits call:peer-joined to A
A: createOffer → setLocalDescription → emit webrtc:offer
B: setRemoteDescription(offer) → createAnswer → setLocalDescription → emit webrtc:answer
A: setRemoteDescription(answer)
both: exchange webrtc:ice throughout
```

The rule that the **existing** peer initiates is the glare-avoidance convention (Volume 2
§7). Without a deterministic initiator, both sides can create offers simultaneously and
negotiation deadlocks.

### The ICE queue — the subtle correctness fix

```ts
const onIce = async ({ candidate }) => {
  if (pcRef.current?.remoteDescription) {
    await pcRef.current.addIceCandidate(candidate).catch(() => {});
  } else {
    pendingIceRef.current.push(candidate); // arrived before the SDP — queue it
  }
};
```

ICE candidates routinely arrive **before** the SDP they belong to, because both travel the
same socket and trickle ICE starts immediately. Calling `addIceCandidate` before
`setRemoteDescription` throws. So early candidates are queued and `flushPendingIce()` is
called immediately after each `setRemoteDescription`. This is exactly the kind of race a
naive implementation hits as an intermittent "sometimes the call doesn't connect" bug.

### Cleanup

The effect's teardown stops every media track (which is what actually turns the camera
light off), closes the peer connection, clears the duration interval, and removes every
socket listener. The `cancelled` flag guards the async `getUserMedia` start: if the
component unmounts while the permission prompt is open, the resolved stream is stopped
immediately rather than leaking a live camera.

Camera toggle uses `cameraTrackRef` to flip `track.enabled` — a real track toggle rather
than a CSS hide, so the peer genuinely stops receiving video.

---

## 5. `components/TriageWizard.tsx`

[`frontend/components/TriageWizard.tsx`](../../frontend/components/TriageWizard.tsx) · 272 lines.

State: `evidence` (the accumulated symptom map), `skip` (answered "not sure"), `step` (the
latest server response), and `modelInfo` (accuracy figures from `/meta`, rendered as a
model-card line — a nice touch of transparency).

The loop is stateless server-side (Volume 2 §6), so the client owns the evidence:

```ts
const answer = async (value: 'yes' | 'no' | 'unsure') => {
  const nextEvidence = value === 'unsure' ? evidence : { ...evidence, [symptom]: value === 'yes' ? 1 : 0 };
  const nextSkip = value === 'unsure' ? [...skip, symptom] : skip;
  const r = await apiClient.post('/ai/triage/answer', { evidence: nextEvidence, skip: nextSkip });
  ...
};
```

Three answers, three distinct semantics — and the distinction is the whole reason the
engine takes a `skip` array. "No" records `0`, which is *positive evidence of absence* and
genuinely shifts the posterior. "Not sure" adds to `skip`, which excludes the symptom from
being re-asked without asserting anything about it. Collapsing "not sure" into "no" would
silently corrupt the inference.

New state is built immutably and sent in the same call rather than relying on a state
update having landed — avoiding the stale-closure trap in an async handler.

The result view renders the ranked differential with probability bars, the urgency banner,
and the recommended specialization, which hands off to doctor search via
`onFindDoctors(symptoms, specializations)`.

---

## 6. `components/AppointmentBooking.tsx`

[`frontend/components/AppointmentBooking.tsx`](../../frontend/components/AppointmentBooking.tsx)
· 629 lines. A multi-step modal: details → payment → success.

**Slot loading** — an effect on `selectedDate` fetches availability and resets
`selectedTime`, so a stale selection from the previous date cannot be submitted. All slots
render, with unavailable ones disabled rather than hidden, so users can see that a slot
exists but is taken.

**Idempotency key** — held in a `useRef` so it survives re-renders, sent as a header on
create, and regenerated **only after a successful booking**:

```ts
const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
...
const response = await apiClient.post('/appointments', payload, {
  headers: { 'Idempotency-Key': idempotencyKeyRef.current },
});
if (response.data.success) {
  idempotencyKeyRef.current = newIdempotencyKey();
```

That ordering is the entire contract: a retry after a network failure reuses the key and
replays the original booking; a genuinely new booking gets a fresh key.

**Family accounts** — a "Who is this appointment for?" select listing `Myself` plus the
user's dependents, with an `➕ Add a family member…` option that reveals an inline form
posting to `/users/dependents`, then calls `refreshUser()` and auto-selects the new
member. The payload conditionally includes the snapshot:

```ts
...(forWhom !== 'self' && dependents[forWhom]
  ? { forDependent: { name: ..., relation: ... } } : {})
```

**Waitlist** — when a chosen day returns zero available slots, the empty state offers
"Join waitlist for this day", posting to `/appointments/waitlist`.

---

## 7. `components/PaymentProcessor.tsx`

[`frontend/components/PaymentProcessor.tsx`](../../frontend/components/PaymentProcessor.tsx)
· 561 lines. Method selection (card, UPI, wallet, net banking, cash), a UPI validator, then
a two-call flow: `POST /payments` to create, `POST /payments/:id/process` to execute.

The same idempotency ref pattern as booking, regenerated only when
`processData.data.status === 'completed'`. This is the endpoint where a duplicate
submission costs real money, which is why the guard exists on both the client and the
server.

Method options carry a `fees` percentage used to compute a displayed total; the base
amount is sent to the API and the fee breakdown travels in `metadata`, so the server
remains the authority on what is charged.

`paymentStatus` drives the UI through `pending → processing → completed | failed`, with a
2-second delay before `onPaymentSuccess` so the success state is actually seen.

---

## 8. `components/DoctorSearch.tsx` and `DoctorMap.tsx`

[`DoctorSearch.tsx`](../../frontend/components/DoctorSearch.tsx) · 523 lines. Holds
`doctors` and `filteredDoctors` as separate state — the raw fetch and the
client-filtered view — plus `userLocation`, `viewMode` (`list` | `map`) and filter
controls.

Geolocation is requested on mount and the coordinates appended to the query, so the
backend's `$geoNear` path runs and returns `distanceKm`; denial degrades to the unsorted
list rather than blocking. A second effect re-filters on any filter change, and a third
applies `recommendedSpecializations` when arriving from triage — which is the seam that
makes "AI recommended Orthopedics" turn into a pre-filtered doctor list.

⚠️ Filtering client-side over the full fetched list is fine at current scale and becomes
the wrong shape once doctor counts grow — the filters belong in the query, where the
cache key already accounts for location.

[`DoctorMap.tsx`](../../frontend/components/DoctorMap.tsx) renders markers with popups and
shares the same booking callback, so list and map are two views over one data source.

---

## 9. `components/NotificationPanel.tsx`

[`frontend/components/NotificationPanel.tsx`](../../frontend/components/NotificationPanel.tsx)
· 405 lines.

A slide-over dialog with local `notifications` state and a `filter`
(`all` | `unread` | `appointments` | `payments` | `system`). It fetches its own list and
count, and — importantly — pushes authoritative counts back into the shared React Query
cache via `useSetUnreadCount` after `markAsRead` / `markAllAsRead`, so every bell badge in
the app updates instantly without waiting for the 30-second poll (Volume 5 §7).

Accessibility work is concentrated here: `role="dialog"`, `aria-modal="true"`, an
`aria-label`, a labelled close button, click-outside dismissal, and an Escape handler
registered and torn down in the same effect:

```ts
const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
document.addEventListener('keydown', handleEscape);
return () => { document.removeEventListener('mousedown', handleClickOutside);
               document.removeEventListener('keydown', handleEscape); };
```

⚠️ This component predates the query-hook pattern and still manages its list with
`useState` + manual fetches. Migrating it to a `useNotifications` query would remove the
duplication between its internal count and the shared cache entry it writes through to.

---

## 10. `pages/doctor/dashboard.tsx` and `pages/admin/dashboard.tsx`

**Doctor dashboard** ([file](../../frontend/pages/doctor/dashboard.tsx)) · 1,814 lines —
the largest file in the repo and the clearest remaining refactor target. Tabs: overview
(today's appointments, patient count, monthly revenue, average rating), appointments
(status transitions, notes, prescriptions), schedule
([`DoctorScheduleCalendar`](../../frontend/components/DoctorScheduleCalendar.tsx) with
availability editing), and patients. All state, fetching, handlers and markup are inline.
Decomposing it along the same lines as the patient dashboard —
`features/schedule/`, `features/patients/`, reusing `features/appointments/` — is
mechanical work with a large readability payoff.

**Admin dashboard** ([file](../../frontend/pages/admin/dashboard.tsx)) · 806 lines. Overview
and Users are inline; the other three tabs are now composed feature components:

```tsx
{activeTab === 'analytics' && <AnalyticsPanel stats={stats} />}
{activeTab === 'system' && <SystemPanel />}
{activeTab === 'reports' && <AuditLogPanel />}
```

[`AnalyticsPanel`](../../frontend/features/admin/AnalyticsPanel.tsx) is pure presentation
over stats the page already fetched — users-by-role proportion bars and headline metrics,
no extra request. [`SystemPanel`](../../frontend/features/admin/SystemPanel.tsx) fetches
`/health` directly (deriving the origin by stripping `/api`, since health sits at the
root) on a 30-second `refetchInterval`, plus event counters from `/audit/stats` marked
`meta: { silent: true }`. [`AuditLogPanel`](../../frontend/features/admin/AuditLogPanel.tsx)
renders the audit trail as a table with colour-coded event badges and a genuine empty
state.

`verifyDoctor` (line 198) is the admin approval action — and carries the modelling bug
documented in Volumes 2 and 3: it writes `isEmailVerified`, and the button only renders
when that field is false, so seeded doctors never surface it.

---

## 11. Accessibility and PWA

Applied across the UI: `aria-label` on every icon-only button (password toggles,
notification bell including unread count, report download/delete, dialog close),
`aria-current="page"` on active nav tabs in all three dashboards, a labelled `nav`
landmark, `role="status"` on loading spinners, `htmlFor`/`id` pairs on the report upload
form, and dialog semantics with Escape-to-close on the notification panel.

PWA: [`public/sw.js`](../../frontend/public/sw.js) caches the app shell (cache-first for
static assets, network-first for navigation) so the app opens offline;
[`manifest.json`](../../frontend/public/manifest.json) makes it installable. Paired with
the IndexedDB query cache from Volume 5, the app both *opens* and *shows real data*
offline — the two halves people usually conflate.

---

## 12. Where the remaining work is

1. **Decompose `doctor/dashboard.tsx`** (1,814 lines) — the template exists.
2. **Migrate `NotificationPanel`** to the query-hook pattern, removing its parallel state.
3. **Move `DoctorSearch` filtering server-side** before the doctor count makes
   client-side filtering untenable.
4. **`strict: true`** — currently `zod`'s `z.infer` cannot be used for form types, forcing
   a handful of manually duplicated interfaces.
5. **Optimistic updates** for ratings and reminder toggles — the cache infrastructure
   already supports it.

---

That completes the six volumes: [Volume 1](01-backend-core.md) (bootstrap, middleware,
utils) · [Volume 2](02-routes-and-services.md) (routes, services) ·
[Volume 3](03-models.md) (data models) · [Volume 4](04-ml-service.md) (Python ML) ·
[Volume 5](05-frontend-core.md) (frontend infrastructure) · Volume 6 (UI).
