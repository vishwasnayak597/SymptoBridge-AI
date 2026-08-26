# Volume 3 — Data Models

Ten Mongoose models, ~1,600 lines. This volume covers each schema's fields, hooks,
virtuals and — most importantly — the indexing and modelling decisions, since those are
what determine whether the queries in Volume 2 are fast or catastrophic at scale.

---

## 0. Conventions across every model

Almost every schema is declared with:

```ts
{ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
```

`timestamps` adds and maintains `createdAt`/`updatedAt`. The `virtuals: true` pair is
required because Mongoose **omits virtuals from serialised output by default** — without
it, computed fields like `fullName` or `isSuccessful` exist on the document in memory but
silently vanish from every API response. `Appointment` additionally sets
`getters: true`, which is what runs PHI decryption on serialisation (§2).

Relationships are `ObjectId` references with `ref`, resolved at query time via
`.populate()` rather than embedded. That is the right call here: users are mutable and
shared across many appointments, so embedding would create update anomalies. The
exception is deliberate — `Appointment.forDependent` is an embedded *snapshot* (§2).

Validation is expressed as tuples — `required: [true, 'Patient ID is required']` — so the
message is authored once and surfaces through `errorHandler`'s `ValidationError` branch
(Volume 1 §12) as a readable 400.

---

## 1. `User.ts` — one collection, three roles

[`backend/src/models/User.ts`](../../backend/src/models/User.ts) · 333 lines.

Patients, doctors and admins share a single collection discriminated by `role`. The
alternative — three collections or Mongoose discriminators — was not taken, and the
trade-off is real: authentication, profile updates and admin listing all work uniformly
against one collection, but role-specific fields are nullable for everyone else. At this
domain size the simplicity wins; the cost is that nothing at the schema level prevents a
patient document carrying a `licenseNumber`.

**Field groups:**

*Identity and auth* — `email` (unique, lowercased, trimmed, regex-matched), `password`
(min 7), `firstName`, `lastName`, `phone`, `avatar`, `role` (enum).

*Account state* — `isActive` (default true), `isEmailVerified`, `emailVerificationToken`,
`passwordResetToken`, `passwordResetExpires`, `loginAttempts`, `lockUntil`, `lastLogin`,
`refreshTokens[]`.

⚠️ `isEmailVerified` **defaults to `true`**. That is a pragmatic choice for a portfolio
deployment with no email provider — but it means the field cannot distinguish "confirmed
their email" from "never asked to". Combined with the admin verify endpoint writing to
this same field instead of `isVerified` (Volume 2 §5), it is why seeded doctors never
show a Verify action.

*Patient profile* — `dateOfBirth`, `gender`, `bloodGroup`, `emergencyContact`,
`medicalHistory[]`, `allergies[]`, and `dependents[]` (family accounts: `name` ≤80,
`relation` ≤40, optional `dateOfBirth`, capped at ten by the zod schema at the edge).

*Doctor profile* — `specialization`, `licenseNumber`, `experience`, `qualifications[]`,
`consultationFee`, `isVerified`, `availability`, and `location` with both a human address
and a GeoJSON `geo` point.

*Admin* — `permissions[]`, already populated by the seed script and read by
`authorizeAdminWithPermissions`, though no route mounts that guard yet.

### Hooks and methods

**`pre('save')` password hashing** (line 235) — guarded by `isModified('password')` so
re-saving a user for any other reason does not re-hash an already-hashed value into
oblivion. This is the single most important hook in the codebase: it makes it
*structurally impossible* to persist a plaintext password, no matter which service writes
the document.

**`comparePassword(candidate)`** — `bcrypt.compare`, constant-time by construction.

**`isLocked()`** — `!!(this.lockUntil && this.lockUntil > Date.now())`. The double-bang
coerces to a real boolean rather than a truthy Date.

**`incLoginAttempts()`** — first clears a lock that has already elapsed, then issues
`{ $inc: { loginAttempts: 1 } }` plus, on crossing the threshold,
`{ $set: { lockUntil } }`. Using atomic update operators rather than read-modify-write
means simultaneous failed logins cannot lose increments.

**`resetLoginAttempts()`** — `$unset`s both counters and stamps `lastLogin`.

**`addRefreshToken` / `removeRefreshToken`** — session management; the array is what
`logout` and `logoutAll` manipulate.

**`toUserObject()`** — deletes `password`, `refreshTokens`, `emailVerificationToken`,
`passwordResetToken`, `loginAttempts` and `lockUntil` from a plain object copy. This is
the serialisation boundary every auth response passes through, and it works by
*exclusion*. That is the fragile direction: a newly added sensitive field is exposed by
default until someone remembers to delete it here. An allowlist (`select`/`pick`) would
fail safe instead. Worth noting that everything *not* deleted flows through — which is
precisely why `dependents` reached the frontend with no additional wiring.

### Indexes

```ts
UserSchema.index({ role: 1 });
UserSchema.index({ 'location.geo': '2dsphere' }, { sparse: true });
```

`email` is *not* indexed here — `unique: true` on the field already creates one, and
declaring it again produced the duplicate-index warnings that used to appear at boot.

The `2dsphere` index is what makes `$geoNear` in the doctor search possible at all; it is
`sparse` because only doctors carry coordinates, so patient documents stay out of the
index entirely.

---

## 2. `Appointment.ts` — the central entity

[`backend/src/models/Appointment.ts`](../../backend/src/models/Appointment.ts) · 236 lines.

References `patient` and `doctor` (both → `User`), plus `appointmentDate`, `duration`
(default 30), `consultationType` (`in-person` | `video` | `phone`), `status`
(`scheduled` | `confirmed` | `in-progress` | `completed` | `cancelled` | `no-show`),
`specialization`, `fee`, `paymentStatus`, `paymentId`, `videoCallId`, `videoCallUrl`, an
embedded `prescription`, a `rating` subdocument, `symptoms`, `notes` and `forDependent`.

### Encrypted fields

```ts
symptoms: { type: String, required: [...], set: encryptPhi, get: decryptPhi,
            maxlength: [4096, 'Symptoms payload too large'] },
notes: { type: String, set: encryptPhi, get: decryptPhi },
```

Three consequences follow from putting encryption in a setter, and all three are
documented in the file:

1. **Setters run before validators**, so any length rule sees ciphertext. The real
   10–1000 character constraint therefore lives in `createAppointmentSchema` at the API
   edge, and `maxlength` here is sized for base64 + IV + tag overhead.
2. **`getters: true` is mandatory** in `toJSON`/`toObject`, otherwise API responses would
   serialise raw ciphertext.
3. **`.lean()` bypasses getters entirely** — a lean query returns ciphertext strings.
   Verified that no current read path on `Appointment` uses `.lean()`; it is a live
   footgun for anyone adding one for performance.

### The dependent snapshot

```ts
forDependent: { name: String, relation: String }
```

Embedded rather than referenced, deliberately. If a user later renames a dependent or
removes them, historical appointments must still show who the visit was for — a
reference would rewrite history. This is the standard "store what was true at the time"
pattern used for invoices and audit records.

### Indexes

```ts
appointmentSchema.index({ patient: 1, appointmentDate: 1 });
appointmentSchema.index({ doctor: 1, appointmentDate: 1 });
```

Two compound indexes matching the two dominant access patterns — "my appointments sorted
by date" for each side. Field order matters: the high-selectivity equality field
(`patient`/`doctor`) precedes the range field (`appointmentDate`), which is the correct
ESR (equality, sort, range) ordering. These also serve the availability query, which
filters by doctor and a date window.

Note there is a **unique** compound index on `(doctor, appointmentDate)` established in an
earlier change to close the double-booking race — the database, not application logic, is
what makes two simultaneous bookings for the same slot impossible.

---

## 3. `Payment.ts`

[`backend/src/models/Payment.ts`](../../backend/src/models/Payment.ts) · 178 lines.

References `appointment`, `patient`, `doctor`. Carries `amount`, `currency` (default
`INR`), `paymentMethod` and `paymentGateway` enums, `status`, `transactionId`
(**unique + sparse**), `paymentGatewayId` (sparse), `gatewayResponse`, `refundDetails`,
`failureReason` and free-form `metadata`.

The **conditional required** functions are the interesting piece:

```ts
failureReason: { type: String, required: function() { return this.status === 'failed'; } }
```

Mongoose evaluates these with `this` bound to the document, so a failed payment must
carry a reason and refund fields become mandatory only on refunded payments. Schema-level
state-dependent invariants, rather than scattered service checks.

`unique: true, sparse: true` on `transactionId` means "unique among documents that have
one" — pending payments with no transaction id do not all collide on `null`. Missing the
`sparse` flag here is a classic production bug.

Indexes: `{ appointment }`, `{ patient, createdAt: -1 }`, `{ doctor, createdAt: -1 }`,
`{ status }`. The descending `createdAt` matches the "newest first" listing. The
field-level unique/sparse indexes on `transactionId` and `paymentGatewayId` are *not*
re-declared at schema level — re-declaring them was the second source of the boot
warnings.

Virtual `isSuccessful` returns `status === 'completed'`.

---

## 4. `Notification.ts`

[`backend/src/models/Notification.ts`](../../backend/src/models/Notification.ts) · 250 lines.

`recipient` (required) and optional `sender`, a `type` enum, `priority`, `title`,
`message`, arbitrary `data`, `isRead`/`readAt`, `actionUrl`/`actionText` for the
click-through, a `channels` array (`in_app` | `email` | `sms` | `push`, defaulting to
`in_app`), and a per-channel `deliveryStatus` object.

The multi-channel structure is scaffolding for email/SMS delivery that is not wired up —
honest to note rather than present as working.

**`expiresAt`** has a function default (a computed offset from creation) and is paired
with a TTL index:

```ts
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

`expireAfterSeconds: 0` means "delete when the date in this field passes" — MongoDB
prunes old notifications automatically with no cron job. This is the same mechanism used
for idempotency keys (§8).

The primary index is `{ recipient: 1, isRead: 1, createdAt: -1 }` — a covering compound
for the two hot queries: the badge count (`recipient` + `isRead: false`) and the panel
listing (`recipient`, newest first). One index serving both is why the 30-second badge
poll is cheap.

Virtuals `isExpired` and `timeSinceCreated` are presentation helpers.

---

## 5. `Prescription.ts`

[`backend/src/models/Prescription.ts`](../../backend/src/models/Prescription.ts) · 113 lines.

A nested `MedicationSchema` (name, dosage, frequency, duration, instructions) embedded as
`medications[]` — correct embedding, since a medication line has no identity outside its
prescription and is always read with it.

`prescriptionNumber` is unique and generated in a `pre('save')` hook. Generating it in a
hook rather than a service guarantees every prescription gets one regardless of write
path — the same defensive reasoning as password hashing.

`status` is `active` | `completed` | `cancelled`, with `validTill` for expiry. Indexes:
`{ patient, date: -1 }`, `{ doctor, date: -1 }`, `{ status }`.

---

## 6. `Report.ts`

[`backend/src/models/Report.ts`](../../backend/src/models/Report.ts) · 131 lines.

Uploaded medical documents. Stores `fileName`, `filePath`, `fileSize`, `mimeType` — file
**metadata**, with bytes on disk via multer. That is the constraint worth flagging:
Render's filesystem is ephemeral, so uploaded files do not survive a deploy. Production
would put the bytes in S3/R2 and keep only the key here. The model is already shaped for
that swap — `filePath` becomes an object key.

`type` is a nine-value enum (`blood_test`, `xray`, `mri`, …), `status` is
`pending`/`reviewed`/`archived`, and there is a review workflow (`reviewedBy`,
`reviewedAt`, `doctorNotes`) plus sharing controls (`isSharedWithDoctor`, `sharedWith[]`).

⚠️ `doctorNotes` is clinical free text and is **not** encrypted, unlike
`Appointment.notes`. If the PHI boundary is meant to cover clinical commentary, this
field belongs inside it — an inconsistency, not a deliberate exemption.

---

## 7. `MedicalRecord.ts`

[`backend/src/models/MedicalRecord.ts`](../../backend/src/models/MedicalRecord.ts) · 90 lines.

Structured clinical records: `patient`, `doctor`, optional `appointment`, `date`,
`diagnosis`, `symptoms[]`, `treatment`, `notes`, `followUpRequired`/`followUpDate`, and a
`vitals` subdocument. Indexes mirror the same access patterns:
`{ patient, date: -1 }`, `{ doctor, date: -1 }`, `{ appointment }`.

Same PHI observation as Report: `diagnosis`, `treatment` and `notes` are unencrypted
clinical content.

---

## 8. `AuditLog.ts` — the compliance trail

[`backend/src/models/AuditLog.ts`](../../backend/src/models/AuditLog.ts) · 30 lines, and
the most deliberate small file in the repo.

```ts
{ timestamps: false, versionKey: false }
```

Both defaults are switched off on purpose. `timestamps` is redundant because the event
carries its own authoritative `occurredAt` — the moment the domain event happened, which
is not necessarily when the row was written. `versionKey` (`__v`) exists to support
optimistic concurrency on documents that get updated; audit rows are **append-only and
never updated**, so it is noise.

Fields: `eventType` (indexed), `actor` (→ User), `entityType`, `entityId` (indexed),
`payload` (Mixed), `occurredAt` (indexed). Plus `AuditLogSchema.index({ occurredAt: -1 })`
for the descending "most recent first" listing that the admin Audit Log panel runs.

`Schema.Types.Mixed` for `payload` is the right call — the shape differs per event type,
and constraining it would mean a schema migration every time a new event is published.
The cost is no validation on payload contents.

---

## 9. `IdempotencyKey.ts`

[`backend/src/models/IdempotencyKey.ts`](../../backend/src/models/IdempotencyKey.ts) · 22 lines.

```ts
key: { type: String, required: true, unique: true },
statusCode: { type: Number },
responseBody: { type: Schema.Types.Mixed },
createdAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 },
```

Small file, two load-bearing lines. `unique: true` on `key` is the **concurrency
primitive** — the duplicate-key error from a losing concurrent insert is what makes the
reserve-then-run protocol race-free without a distributed lock (Volume 1 §10).

`expires: 24 * 60 * 60` creates a TTL index so records self-prune after 24 hours. That
window is also the practical bound on the failure mode described in Volume 1: a
reservation orphaned by a crash blocks retries only until the TTL clears it.

`statusCode` and `responseBody` are optional because a reserved-but-unfinished key has
neither — their absence is precisely how the middleware distinguishes "in progress" from
"completed, replay this".

---

## 10. `WaitlistEntry.ts`

[`backend/src/models/WaitlistEntry.ts`](../../backend/src/models/WaitlistEntry.ts) · 39 lines.

`doctor`, `patient`, `date` (a `YYYY-MM-DD` **string** with a regex match), and `status`
(`waiting` | `offered` | `fulfilled` | `expired` | `cancelled`) with `offeredAt`.

Storing the day as a formatted string rather than a `Date` is intentional: the waitlist
is keyed on a *calendar day*, and a `Date` drags in timezone semantics that make equality
comparison error-prone. The regex enforces the format at the schema level, and
`joinWaitlistSchema` enforces it again at the edge.

```ts
waitlistEntrySchema.index({ doctor: 1, date: 1, status: 1, createdAt: 1 });
```

One compound index deliberately serving both queries. `offerNext` filters on
`doctor + date + status: 'waiting'` and sorts by `createdAt` ascending — every component
is a prefix or continuation of this index, so the atomic `findOneAndUpdate` is an index
scan with no in-memory sort. The duplicate check in `join` uses `patient + doctor + date
+ status`, partially covered.

The status enum encodes the full lifecycle so no separate state table is needed, and the
terminal states (`fulfilled`, `expired`, `cancelled`) are what make `expireOffer`'s
`findOneAndUpdate({ _id, status: 'offered' })` a safe no-op when the patient already
booked.

---

## Cross-cutting observations

**Index hygiene.** Every collection has indexes matching its actual query shapes, and the
duplicate declarations that used to warn at boot are gone. The compound orderings follow
equality-then-sort correctly.

**TTL indexes** are used in three places (notifications, idempotency keys, analytics
counters in Redis) to make cleanup the database's problem rather than a cron job's.

**PHI coverage is incomplete.** `Appointment.symptoms`/`notes` are encrypted;
`MedicalRecord.diagnosis`/`treatment`/`notes` and `Report.doctorNotes` are not. If the
threat model is "a database dump must not reveal clinical detail", those fields belong
inside the boundary too — the `phiCrypto` getter/setter pair applies unchanged.

**`toUserObject` denies by exclusion**, which fails open on newly added fields. Converting
it to an allowlist is a small change with a real safety improvement.

---

## Next

Volume 4 covers the Python ML service — the knowledge base, the synthetic data
generator, the training script, and the FastAPI surface that `TriageService` calls.
