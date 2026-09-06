import crypto from 'crypto';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { getRedis } from '../utils/redis';
import { publishEvent } from './EventBus';
import { SocketService } from './SocketService';
import logger from '../utils/logger';
import { loadDoctorsCached, toDoctorSummary, DoctorSummary } from './DoctorDirectoryService';
import { availabilityForDoctors } from './SlotService';
import { AppointmentService, SlotTakenError } from './AppointmentService';

/**
 * Booking agent: turns "find a cardiologist this week under ₹800" into a handful of
 * concrete, bookable proposals.
 *
 * ARCHITECTURE — the two rules that make this safe:
 *
 * 1. THE MODEL CANNOT WRITE. It only ever reaches the read tools below. Booking runs
 *    through `confirmProposal`, which is reachable exclusively from an authenticated
 *    HTTP call carrying a proposal id the patient clicked. A system prompt saying
 *    "always ask first" is not a control — anything the model reads (a doctor's own
 *    profile text, a symptom description) could tell it otherwise. A missing tool can't
 *    be talked into existing.
 *
 * 2. THE MODEL DOES NOT AUTHOR PROPOSALS. It plans: it extracts constraints and may
 *    call the search/availability tools. Every doctor, slot and fee in the result comes
 *    from `rankProposals` reading tool output. So a hallucinated doctor or a phantom
 *    "Tuesday 3pm" cannot reach the patient — there is no path for model prose to
 *    become a card.
 *
 * Without GEMINI_API_KEY the same pipeline runs on `parseWithRules`, matching how
 * MCPService already degrades. The feature works with no LLM configured; it just reads
 * fewer phrasings.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_TOOL_ROUNDS = 4;
const PROPOSAL_TTL_SECONDS = 15 * 60;
const MAX_DOCTORS_TO_CHECK = 25;
const MAX_PROPOSALS = 3;

// ---------------------------------------------------------------- types

export interface BookingConstraints {
  specialization?: string;
  maxFee?: number;
  minRating?: number;
  /** Inclusive 'YYYY-MM-DD' window to search. */
  from: string;
  to: string;
  maxKm?: number;
  /** Urgent triage ranks by soonest slot; otherwise cheap + well-rated wins. */
  preferSoonest?: boolean;
  /** 0=Sunday..6=Saturday. Set when the request names specific days. */
  daysOfWeek?: number[];
  /**
   * Spelling corrections the parser applied, so the patient is told how their words
   * were read rather than silently getting a different speciality.
   */
  corrections?: Array<{ from: string; to: string }>;
  /**
   * Slot-of-day window as 'HH:MM', inclusive of `afterTime`, exclusive of `beforeTime`.
   * Compared against the slot label the UI shows, so "after 5pm" filters the same
   * clock the patient reads on the card.
   */
  afterTime?: string;
  beforeTime?: string;
}

/** Constraint keys a patient can drop from the UI when the parse was wrong. */
export type DroppableConstraint = keyof Pick<
  BookingConstraints,
  'specialization' | 'maxFee' | 'minRating' | 'maxKm' | 'daysOfWeek' | 'afterTime' | 'beforeTime'
>;

export interface AgentStep {
  label: string;
  detail?: string;
}

export interface BookingProposal {
  proposalId: string;
  doctorId: string;
  doctorName: string;
  specialization: string;
  fee: number;
  rating: number;
  distanceKm: number | null;
  /** Full ISO instant of the slot, and its display parts. */
  slotISO: string;
  date: string;
  time: string;
  reason: string;
}

export interface AgentRunResult {
  constraints: BookingConstraints;
  steps: AgentStep[];
  /**
   * The whole trace in one line, for the fast path.
   *
   * The step-by-step list exists to cover a wait: with Gemini planning it is several
   * tool rounds and 5-15 seconds, where silence reads as a hang. The rules path
   * answers in well under a second, so four lines of narration there is theatre —
   * the UI shows this single line instead and keeps `steps` for the slow path.
   */
  summary: string;
  proposals: BookingProposal[];
  /** Set when nothing matched — the UI relaxes these chips rather than dead-ending. */
  noMatchReason?: string;
  plannedBy: 'gemini' | 'rules';
}

interface RunOptions {
  patientId: string;
  query: string;
  lat?: number;
  lng?: number;
  /** Raised by the caller when the patient's triage said high/urgent. */
  urgent?: boolean;
  /** Constraints the patient dismissed in the UI — dropped after parsing. */
  drop?: DroppableConstraint[];
}

// ---------------------------------------------------------------- date helpers

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * End of "this week" — the coming Sunday. Asked ON a Sunday, the calendar week ends
 * today, which would leave a one-day search; treat that as the week ahead instead.
 */
function endOfWeek(): string {
  const daysToSunday = (7 - new Date().getUTCDay()) % 7;
  return addDays(todayISO(), daysToSunday === 0 ? 6 : daysToSunday);
}

// ---------------------------------------------------------------- read tools

/**
 * The complete set of tools the model can reach. Note what is absent: nothing here
 * creates, updates or pays for anything.
 */
async function searchDoctorsTool(
  args: { specialization?: string; maxFee?: number; minRating?: number; maxKm?: number },
  ctx: { lat?: number; lng?: number }
): Promise<DoctorSummary[]> {
  const near =
    typeof ctx.lat === 'number' && typeof ctx.lng === 'number'
      ? { lat: ctx.lat, lng: ctx.lng, maxKm: args.maxKm || 5000 }
      : null;

  const all = (await loadDoctorsCached(near)).map(toDoctorSummary);
  const wanted = args.specialization?.trim().toLowerCase();

  return all.filter((d) => {
    if (wanted && !d.specialization.toLowerCase().includes(wanted)) return false;
    if (typeof args.maxFee === 'number' && d.consultationFee > args.maxFee) return false;
    if (typeof args.minRating === 'number' && d.rating < args.minRating) return false;
    return true;
  });
}

async function getAvailabilityTool(args: { doctorIds: string[]; from: string; to: string }) {
  return availabilityForDoctors(args.doctorIds.slice(0, MAX_DOCTORS_TO_CHECK), args.from, args.to);
}

const TOOL_DECLARATIONS = [
  {
    name: 'searchDoctors',
    description:
      'Find bookable doctors. Returns id, name, specialization, consultation fee in INR, rating and distance. Read-only.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        specialization: {
          type: SchemaType.STRING,
          description: 'e.g. "Cardiology", "Dermatology". Omit to search all specialities.',
        },
        maxFee: { type: SchemaType.NUMBER, description: 'Maximum consultation fee in INR.' },
        minRating: { type: SchemaType.NUMBER, description: 'Minimum star rating, 0-5.' },
        maxKm: { type: SchemaType.NUMBER, description: 'Maximum distance in km from the patient.' },
      },
      required: [],
    },
  },
  {
    name: 'getAvailability',
    description:
      'Free appointment slots for up to 25 doctors across a date range. Returns doctorId -> date -> ["09:30", ...]. Read-only.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        doctorIds: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'Doctor ids from searchDoctors.',
        },
        from: { type: SchemaType.STRING, description: 'Start date, YYYY-MM-DD.' },
        to: { type: SchemaType.STRING, description: 'End date, YYYY-MM-DD.' },
      },
      required: ['doctorIds', 'from', 'to'],
    },
  },
];

// ---------------------------------------------------------------- planning

/**
 * Matched on word-initial STEMS, not whole words, because patients misspell
 * specialities constantly — "gastraentologist" must still reach Gastroenterology, and
 * an exact "gastro" test misses it.
 *
 * Two rules keep the stems safe:
 *  - every alternative is anchored with \b, so a stem only matches at the start of a
 *    word. Without that, `ent` matches inside "gastra-ENT-ologist" and a stomach
 *    complaint is routed to an ENT clinic.
 *  - short, ambiguous words (ent, ear, eye, gp) must match as WHOLE words.
 * Order matters: the first hit wins, so specific stems precede generic ones.
 */
const SPECIALIZATION_HINTS: Array<[RegExp, string]> = [
  [/\bcardi|\bheart\b/i, 'Cardiology'],
  [/\bgastr|\bstomach\b|\bdigest|\bliver\b|\bacidity\b/i, 'Gastroenterology'],
  [/\bderm|\bskin\b|\brash\b|\bacne\b/i, 'Dermatology'],
  [/\bp(a)?ediatr|\bchild|\bkid\b|\bbaby\b|\binfant/i, 'Pediatrics'],
  [/\borthop|\bbone\b|\bjoint\b|\bknee\b|\bfractur/i, 'Orthopedics'],
  [/\bpsychi|\bmental\b|\banxiet|\bdepress/i, 'Psychiatry'],
  [/\bneuro|\bmigrain|\bheadach|\bseizur/i, 'Neurology'],
  [/\bgyn|\bpregnan|\bobstetr/i, 'Gynecology'],
  [/\burol|\bkidney\b|\burin|\bbladder\b/i, 'Urology'],
  [/\bdent|\btooth\b|\bteeth\b/i, 'Dentistry'],
  [/\bophthal|\boptom|\beye\b|\bvision\b/i, 'Ophthalmology'],
  [/\bent\b|\bear\b|\bnose\b|\bthroat\b|\botolaryng/i, 'ENT (Ear, Nose & Throat)'],
  [/\bonco|\bcancer\b|\btumou?r\b/i, 'Oncology'],
  [/\bsurg/i, 'Surgery'],
  [/\bphysician\b|\bgeneral\s+medicine\b|\bgp\b/i, 'General Medicine'],
];

const WEEKDAY_HINTS: Array<[RegExp, number]> = [
  [/\bsun(day)?\b/i, 0],
  [/\bmon(day)?\b/i, 1],
  [/\btue(s|sday)?\b/i, 2],
  [/\bwed(nesday)?\b/i, 3],
  [/\bthu(r|rs|rsday)?\b/i, 4],
  [/\bfri(day)?\b/i, 5],
  [/\bsat(urday)?\b/i, 6],
];

/**
 * FUZZY MATCHING — the stem pass above only survives typos that keep the word's
 * opening intact. Real patients write "cardologist", "nuerologist", "opthalmologist",
 * "stomac". Those need edit distance.
 *
 * Damerau-Levenshtein (optimal string alignment) rather than plain Levenshtein,
 * because the most common medical misspelling is a TRANSPOSITION — "nuero" for
 * "neuro", "firday" for "friday" — which plain Levenshtein scores as 2 edits and
 * would reject at a distance-1 threshold.
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      // transposition of two adjacent characters
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * How wrong a word may be before we stop trusting the match. Scaled by length: one
 * edit in a 4-letter word is a different word, three edits in a 14-letter word is a
 * typo.
 */
function allowedDistance(length: number): number {
  if (length < 4) return 0;
  if (length <= 6) return 1;
  if (length <= 10) return 2;
  return 3;
}

/**
 * Words that must never be fuzzy-matched. Without this, "dont" is one edit from
 * "dent" and "I dont know" books a dentist.
 */
const FUZZY_STOPWORDS = new Set([
  'dont', 'doesnt', 'cant', 'wont', 'want', 'need', 'this', 'that', 'them', 'then',
  'week', 'weeks', 'time', 'date', 'slot', 'slots', 'find', 'book', 'give', 'show',
  'with', 'from', 'have', 'here', 'near', 'best', 'good', 'some', 'someone', 'please',
  'appointment', 'appointments', 'doctor', 'doctors', 'specialist', 'consultation',
  'after', 'before', 'under', 'below', 'over', 'about', 'today', 'tomorrow', 'morning',
  'afternoon', 'evening', 'night', 'available', 'availability', 'earliest', 'soonest',
]);

/**
 * Speciality vocabulary for the fuzzy pass. Each entry carries BOTH short roots and
 * the full spelled-out words, because the two catch different typos:
 *
 *  - roots catch suffix mangling — "cardologist" -> root "card" vs "cardi" (1 edit),
 *    where comparing against "cardiologist" whole would be 2+.
 *  - full words catch dropped letters mid-word — "ortopedic" vs "orthopedic" is 1
 *    edit, while its root "ortoped" against "orthop" is 3 and would be rejected.
 */
const SPECIALITY_TERMS: Array<[string[], string]> = [
  [['cardi', 'cardiology', 'cardiologist', 'heart'], 'Cardiology'],
  [
    ['gastr', 'gastroenter', 'gastroenterology', 'gastroenterologist', 'stomach', 'digest', 'liver', 'acidity'],
    'Gastroenterology',
  ],
  [['derm', 'dermatology', 'dermatologist', 'skin', 'rash', 'acne', 'eczema'], 'Dermatology'],
  [['pediatr', 'paediatr', 'pediatrics', 'pediatrician', 'paediatrician', 'child', 'infant'], 'Pediatrics'],
  [
    ['orthop', 'orthopedic', 'orthopaedic', 'orthopedics', 'orthopedist', 'bone', 'joint', 'knee', 'fractur', 'spine'],
    'Orthopedics',
  ],
  [['psych', 'psychi', 'psychiatry', 'psychiatrist', 'mental', 'anxiet', 'depress'], 'Psychiatry'],
  [['neur', 'neurology', 'neurologist', 'migrain', 'headach', 'seizur', 'epilep'], 'Neurology'],
  [['gynec', 'gynaec', 'gynecology', 'gynecologist', 'obstetr', 'pregnan'], 'Gynecology'],
  [['urol', 'urology', 'urologist', 'kidney', 'urin', 'bladder', 'prostat'], 'Urology'],
  [['dent', 'dentist', 'dentistry', 'tooth', 'teeth', 'cavit'], 'Dentistry'],
  [['ophthalm', 'opthalm', 'ophthalmology', 'ophthalmologist', 'optom', 'vision'], 'Ophthalmology'],
  [['otolaryng', 'throat', 'sinus', 'tonsil'], 'ENT (Ear, Nose & Throat)'],
  [['oncol', 'oncology', 'oncologist', 'cancer', 'tumor', 'tumour'], 'Oncology'],
  [['surg', 'surgery', 'surgeon'], 'Surgery'],
  [['physician', 'medicine'], 'General Medicine'],
];

/**
 * Specialities that describe a ROLE rather than a body system. "Orthopedic surgeon"
 * matches both Surgery and Orthopedics — and Surgery matches at distance 0 while the
 * misspelled "ortopedic" matches at 1. Distance alone would therefore send an
 * orthopedic request to general Surgery, so a specific speciality always outranks a
 * generic one that also matched.
 */
const GENERIC_SPECIALITIES = new Set(['Surgery', 'General Medicine']);

/** "cardologist" -> "card"; "neurology" -> "neur"; "dermatologist" -> "dermat". */
function medicalRoot(word: string): string {
  return word.replace(/(ologists?|ology|ologies|iatrists?|iatry|icians?|ists?|ic|al)$/, '');
}

export interface SpecialityMatch {
  specialization: string;
  /** The word the patient actually typed, so the UI can show what was corrected. */
  from: string;
  /** 0 when the word matched a known term exactly — nothing was corrected. */
  distance: number;
}

/**
 * Best fuzzy speciality match in a query, or null when nothing is close enough.
 * Runs only after the exact/stem pass fails, so a correctly spelled request never
 * pays for it.
 */
export function fuzzySpecialization(query: string): SpecialityMatch | null {
  const words = query.toLowerCase().match(/[a-z]+/g) || [];
  let best: { spec: string; word: string; distance: number } | null = null;

  const better = (spec: string, distance: number) => {
    if (!best) return true;
    // A specific speciality beats a generic one regardless of distance; between two of
    // the same kind, the closer spelling wins.
    const bestIsGeneric = GENERIC_SPECIALITIES.has(best.spec);
    const thisIsGeneric = GENERIC_SPECIALITIES.has(spec);
    if (bestIsGeneric !== thisIsGeneric) return bestIsGeneric;
    return distance < best.distance;
  };

  for (const word of words) {
    if (word.length < 4 || FUZZY_STOPWORDS.has(word)) continue;
    const root = medicalRoot(word);

    for (const [terms, spec] of SPECIALITY_TERMS) {
      for (const term of terms) {
        // Compare the word both whole and stripped of its medical suffix; the
        // threshold follows the term being matched against.
        const distance = Math.min(
          editDistance(word, term),
          root.length >= 3 ? editDistance(root, term) : Infinity
        );
        if (distance <= allowedDistance(term.length) && better(spec, distance)) {
          best = { spec, word, distance };
        }
      }
    }
  }

  return best ? { specialization: best.spec, from: best.word, distance: best.distance } : null;
}

const FULL_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Misspelled day names: "firday" -> Friday, "saterday" -> Saturday. */
export function fuzzyWeekdays(query: string): number[] {
  const words = query.toLowerCase().match(/[a-z]+/g) || [];
  const found = new Set<number>();
  for (const word of words) {
    if (word.length < 5 || FUZZY_STOPWORDS.has(word)) continue;
    FULL_WEEKDAYS.forEach((day, index) => {
      if (editDistance(word, day) <= allowedDistance(day.length)) found.add(index);
    });
  }
  return Array.from(found).sort();
}

/** "5pm" / "5 pm" / "17" -> "17:00". Returns null for nonsense hours. */
function toClock(hour: string, meridiem?: string): string | null {
  let h = Number(hour);
  if (Number.isNaN(h) || h > 24) return null;
  const m = meridiem?.toLowerCase();
  if (m === 'pm' && h < 12) h += 12;
  if (m === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * Constraint extraction without an LLM. Covers the phrasings the UI's own filters
 * expose, which is most of what patients type.
 */
export function parseWithRules(query: string): BookingConstraints {
  const q = query.toLowerCase();
  const constraints: BookingConstraints = { from: todayISO(), to: addDays(todayISO(), 7) };

  let exactSpec: string | undefined;
  for (const [pattern, spec] of SPECIALIZATION_HINTS) {
    if (pattern.test(q)) {
      exactSpec = spec;
      break;
    }
  }

  // The fuzzy pass also runs when the exact pass only found a GENERIC speciality:
  // "ortopedic surgeon" matches /\bsurg/ perfectly, and stopping there would book a
  // general surgeon for a bone problem.
  if (!exactSpec || GENERIC_SPECIALITIES.has(exactSpec)) {
    const guess = fuzzySpecialization(q);
    if (guess && (!exactSpec || !GENERIC_SPECIALITIES.has(guess.specialization))) {
      constraints.specialization = guess.specialization;
      // A non-zero distance means we read the word as something the patient did not
      // type, which they are entitled to see.
      if (guess.distance > 0) {
        constraints.corrections = [{ from: guess.from, to: guess.specialization }];
      }
    }
  }
  if (!constraints.specialization) constraints.specialization = exactSpec;

  // "under 800", "below ₹800", "less than rs 800", "800 rupees or less"
  const fee = q.match(/(?:under|below|less than|max(?:imum)?|upto|up to|within)\s*(?:₹|rs\.?|inr)?\s*(\d{2,6})/);
  if (fee) constraints.maxFee = Number(fee[1]);

  const rating = q.match(/(\d(?:\.\d)?)\s*\+?\s*(?:star|rating)/);
  if (rating) constraints.minRating = Number(rating[1]);

  const km = q.match(/within\s*(\d{1,3})\s*km/);
  if (km) constraints.maxKm = Number(km[1]);

  if (/today/.test(q)) {
    constraints.to = todayISO();
  } else if (/tomorrow/.test(q)) {
    constraints.from = addDays(todayISO(), 1);
    constraints.to = addDays(todayISO(), 1);
  } else if (/this week/.test(q)) {
    constraints.to = endOfWeek();
  } else if (/next week/.test(q)) {
    constraints.from = addDays(endOfWeek(), 1);
    constraints.to = addDays(endOfWeek(), 7);
  }

  // Named days: "friday saturday" -> [5, 6]. Misspellings ("firday", "saterday")
  // fall through to the same fuzzy pass the speciality uses.
  const days = WEEKDAY_HINTS.filter(([pattern]) => pattern.test(q)).map(([, day]) => day);
  if (days.length === 0) {
    const fuzzyDays = fuzzyWeekdays(q);
    if (fuzzyDays.length > 0) days.push(...fuzzyDays);
  }
  if (days.length > 0) {
    constraints.daysOfWeek = days;
    // A named weekday has to exist inside the window, or the search returns nothing.
    // "this week ... friday" asked on a Sunday would otherwise scan Sun-Tue and find
    // no Friday at all.
    if (!windowContainsAnyDay(constraints.from, constraints.to, days)) {
      constraints.to = addDays(constraints.from, 13);
    }
  }

  // Time of day: "after 5pm", "before 11 am", or a named part of the day.
  const after = q.match(/\bafter\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/);
  if (after) {
    const clock = toClock(after[1], after[3]);
    if (clock) constraints.afterTime = clock;
  }
  const before = q.match(/\bbefore\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/);
  if (before) {
    const clock = toClock(before[1], before[3]);
    if (clock) constraints.beforeTime = clock;
  }
  if (!after && !before) {
    if (/\bmorning\b/.test(q)) constraints.beforeTime = '12:00';
    else if (/\bafternoon\b/.test(q)) {
      constraints.afterTime = '12:00';
      constraints.beforeTime = '17:00';
    } else if (/\bevening\b|\bnight\b/.test(q)) constraints.afterTime = '17:00';
  }

  if (/asap|urgent|soonest|earliest|emergency/.test(q)) constraints.preferSoonest = true;

  return constraints;
}

/** True when at least one date in [from, to] falls on one of `days`. */
function windowContainsAnyDay(from: string, to: string, days: number[]): boolean {
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    if (days.includes(cursor.getUTCDay())) return true;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return false;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '17:00' -> '5pm', for step text the patient can read. */
export function clockLabel(clock: string): string {
  const [h, m] = clock.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour12}:${String(m).padStart(2, '0')}${suffix}` : `${hour12}${suffix}`;
}

/** Human summary of the date/day/time window, used in the trace. */
export function describeWindow(c: BookingConstraints): string {
  const parts: string[] = [];
  if (c.daysOfWeek?.length) {
    parts.push(`on ${c.daysOfWeek.map((d) => DAY_NAMES[d]).join('/')}`);
  }
  if (c.afterTime && c.beforeTime) parts.push(`between ${clockLabel(c.afterTime)} and ${clockLabel(c.beforeTime)}`);
  else if (c.afterTime) parts.push(`after ${clockLabel(c.afterTime)}`);
  else if (c.beforeTime) parts.push(`before ${clockLabel(c.beforeTime)}`);
  parts.push(`between ${c.from} and ${c.to}`);
  return parts.join(', ');
}

/**
 * The window, naming only what narrows it. When the patient asked for specific days or
 * hours those are the interesting part and the date range is already on a chip; with no
 * such filter, the range IS the window.
 */
export function compactWindow(c: BookingConstraints): string {
  const parts: string[] = [];
  if (c.daysOfWeek?.length) parts.push(`on ${c.daysOfWeek.map((d) => DAY_NAMES[d]).join('/')}`);
  if (c.afterTime && c.beforeTime) parts.push(`between ${clockLabel(c.afterTime)} and ${clockLabel(c.beforeTime)}`);
  else if (c.afterTime) parts.push(`after ${clockLabel(c.afterTime)}`);
  else if (c.beforeTime) parts.push(`before ${clockLabel(c.beforeTime)}`);
  if (parts.length === 0) parts.push(`between ${c.from} and ${c.to}`);
  return parts.join(', ');
}

/** Everything the parser understood, as one line. */
export function describeConstraints(c: BookingConstraints): string {
  return [
    c.specialization || 'any speciality',
    c.maxFee ? `under ₹${c.maxFee}` : null,
    c.minRating ? `${c.minRating}★ and up` : null,
    describeWindow(c),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Does one (date, slot) pair satisfy the day/time constraints? */
export function slotMatches(date: string, time: string, c: BookingConstraints): boolean {
  if (c.daysOfWeek?.length) {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (!c.daysOfWeek.includes(day)) return false;
  }
  // 'HH:MM' strings are zero-padded, so lexical comparison is chronological.
  if (c.afterTime && time < c.afterTime) return false;
  if (c.beforeTime && time >= c.beforeTime) return false;
  return true;
}

function geminiClient(): GoogleGenerativeAI | null {
  return GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
}

/**
 * Gemini plans the search: it reads the request, calls the read tools, and stops.
 * Its answer is discarded — only the constraints and the tool results are kept, because
 * the ranking below must be reproducible and auditable.
 */
async function planWithGemini(
  query: string,
  ctx: { lat?: number; lng?: number },
  steps: AgentStep[]
): Promise<{ constraints: BookingConstraints; doctors: DoctorSummary[] } | null> {
  const genAI = geminiClient();
  if (!genAI) return null;

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash-latest',
    tools: [{ functionDeclarations: TOOL_DECLARATIONS as any }],
    generationConfig: { temperature: 0, maxOutputTokens: 512 },
  });

  const seed = parseWithRules(query);
  const prompt = [
    'You are a booking assistant for a telemedicine platform in India. Fees are in INR.',
    `Today is ${todayISO()}. The current week ends ${endOfWeek()}.`,
    'Call searchDoctors with the constraints in the request, then getAvailability for the ids you found.',
    'Do not answer in prose and do not invent doctors or time slots. Use the tools.',
    '',
    `Patient request: ${JSON.stringify(query)}`,
  ].join('\n');

  const chat = model.startChat();
  let constraints: BookingConstraints = seed;
  let doctors: DoctorSummary[] = [];
  let message: any = prompt;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result: any = await chat.sendMessage(message);
    const calls = result.response.functionCalls?.() || [];
    if (calls.length === 0) break;

    const responses: any[] = [];
    for (const call of calls) {
      if (call.name === 'searchDoctors') {
        const args = call.args || {};
        constraints = {
          ...constraints,
          specialization: args.specialization ?? constraints.specialization,
          maxFee: args.maxFee ?? constraints.maxFee,
          minRating: args.minRating ?? constraints.minRating,
          maxKm: args.maxKm ?? constraints.maxKm,
        };
        doctors = await searchDoctorsTool(args, ctx);
        steps.push({
          label: `Searched ${constraints.specialization || 'all specialities'}`,
          detail: `${doctors.length} doctor${doctors.length === 1 ? '' : 's'} match the fee and rating limits`,
        });
        responses.push({
          functionResponse: {
            name: call.name,
            response: { doctors: doctors.slice(0, MAX_DOCTORS_TO_CHECK) },
          },
        });
      } else if (call.name === 'getAvailability') {
        const args = call.args || {};
        if (args.from) constraints.from = args.from;
        if (args.to) constraints.to = args.to;
        const availability = await getAvailabilityTool({
          doctorIds: (args.doctorIds || doctors.map((d) => d._id)) as string[],
          from: constraints.from,
          to: constraints.to,
        });
        responses.push({ functionResponse: { name: call.name, response: { availability } } });
      } else {
        // Unknown tool name — the model asked for something that does not exist.
        responses.push({
          functionResponse: { name: call.name, response: { error: 'no such tool' } },
        });
      }
    }
    message = responses;
  }

  return { constraints, doctors };
}

// ---------------------------------------------------------------- ranking

/**
 * Build the proposals from tool output. This is the only place a proposal is created,
 * and it reads nothing the model wrote.
 */
function rankProposals(
  doctors: DoctorSummary[],
  availability: Record<string, Record<string, string[]>>,
  constraints: BookingConstraints
): Omit<BookingProposal, 'proposalId'>[] {
  const candidates: Array<Omit<BookingProposal, 'proposalId'> & { score: number }> = [];

  for (const doctor of doctors) {
    const byDate = availability[doctor._id] || {};
    const dates = Object.keys(byDate).sort();
    let earliest: { date: string; time: string } | null = null;
    for (const date of dates) {
      // Honour the day-of-week and time-of-day constraints. Taking slots[0] blindly
      // is what offered a Sunday 9am for a "friday saturday after 5pm" request.
      const slot = (byDate[date] || []).find((time) => slotMatches(date, time, constraints));
      if (slot) {
        earliest = { date, time: slot };
        break;
      }
    }
    if (!earliest) continue;

    const slotISO = `${earliest.date}T${earliest.time}:00.000Z`;
    const hoursAway = (new Date(slotISO).getTime() - Date.now()) / 3_600_000;

    // Sooner is better; cheaper is better; better-rated is better. Urgent sessions
    // weight time an order of magnitude harder than money.
    const timeWeight = constraints.preferSoonest ? 1.5 : 0.15;
    const score = -hoursAway * timeWeight - doctor.consultationFee * 0.05 + doctor.rating * 12;

    const reasonBits: string[] = [];
    if (hoursAway < 30) reasonBits.push('soonest opening');
    if (constraints.maxFee && doctor.consultationFee <= constraints.maxFee) {
      reasonBits.push(`₹${doctor.consultationFee}, within your budget`);
    }
    if (doctor.rating >= 4) reasonBits.push(`rated ${doctor.rating.toFixed(1)}`);
    if (doctor.distanceKm != null) reasonBits.push(`${doctor.distanceKm} km away`);

    candidates.push({
      doctorId: doctor._id,
      doctorName: doctor.name,
      specialization: doctor.specialization,
      fee: doctor.consultationFee,
      rating: doctor.rating,
      distanceKm: doctor.distanceKm,
      slotISO,
      date: earliest.date,
      time: earliest.time,
      reason: reasonBits.join(' · ') || 'Available in your window',
      score,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PROPOSALS)
    .map(({ score, ...proposal }) => proposal);
}

// ---------------------------------------------------------------- proposal store

interface StoredProposal {
  patientId: string;
  doctorId: string;
  slotISO: string;
  fee: number;
  specialization: string;
  doctorName: string;
}

// Redis is the real store; the Map keeps single-instance dev working without it.
const memoryProposals = new Map<string, { value: StoredProposal; expiresAt: number }>();

async function storeProposal(id: string, value: StoredProposal): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(`booking:proposal:${id}`, JSON.stringify(value), 'EX', PROPOSAL_TTL_SECONDS);
    return;
  }
  memoryProposals.set(id, { value, expiresAt: Date.now() + PROPOSAL_TTL_SECONDS * 1000 });
}

/** Reads and CONSUMES a proposal — single use, so a double-click can't double-book. */
async function takeProposal(id: string): Promise<StoredProposal | null> {
  const redis = getRedis();
  if (redis) {
    const key = `booking:proposal:${id}`;
    const raw = await redis.get(key);
    if (!raw) return null;
    await redis.del(key);
    return JSON.parse(raw) as StoredProposal;
  }
  const hit = memoryProposals.get(id);
  memoryProposals.delete(id);
  if (!hit || hit.expiresAt < Date.now()) return null;
  return hit.value;
}

// ---------------------------------------------------------------- public API

export async function runBookingAgent(opts: RunOptions): Promise<AgentRunResult> {
  const { patientId, query, lat, lng, urgent, drop } = opts;
  const steps: AgentStep[] = [];
  const emit = (step: AgentStep) => {
    steps.push(step);
    // Streamed so the patient sees progress during the 5-15s the tools take.
    SocketService.emitToUser(patientId, 'booking-agent:step', step);
  };

  let constraints = parseWithRules(query);
  if (urgent) constraints.preferSoonest = true;
  // The UI's "×" on a chip lands here: the patient telling us that constraint was a
  // misread. Re-running the same sentence would just re-derive it, so the drop has to
  // be applied after parsing.
  for (const key of drop || []) delete (constraints as any)[key];
  let doctors: DoctorSummary[] | null = null;
  let plannedBy: 'gemini' | 'rules' = 'rules';

  if (GEMINI_API_KEY) {
    try {
      const planned = await planWithGemini(query, { lat, lng }, steps);
      if (planned && planned.doctors.length >= 0) {
        constraints = { ...planned.constraints, preferSoonest: constraints.preferSoonest };
        doctors = planned.doctors;
        plannedBy = 'gemini';
      }
    } catch (err) {
      logger.warn(`Booking agent: Gemini planning failed, using rules — ${(err as Error).message}`);
    }
  }

  if (doctors === null) {
    emit({
      label: constraints.corrections?.length
        ? `Read "${constraints.corrections[0].from}" as ${constraints.corrections[0].to}`
        : `Reading your request`,
      detail: describeConstraints(constraints),
    });
    doctors = await searchDoctorsTool(
      {
        specialization: constraints.specialization,
        maxFee: constraints.maxFee,
        minRating: constraints.minRating,
        maxKm: constraints.maxKm,
      },
      { lat, lng }
    );
    emit({
      label: `Found ${doctors.length} matching doctor${doctors.length === 1 ? '' : 's'}`,
      detail: constraints.maxFee ? `fee ≤ ₹${constraints.maxFee}` : undefined,
    });
  }

  const specLabel = constraints.specialization ? `${constraints.specialization} ` : '';

  if (doctors.length === 0) {
    return {
      constraints,
      steps,
      summary: `No ${specLabel}doctors match those filters`,
      proposals: [],
      plannedBy,
      noMatchReason: 'No doctor matches those filters yet. Try widening the fee or speciality.',
    };
  }

  const shortlist = doctors.slice(0, MAX_DOCTORS_TO_CHECK);
  const availability = await getAvailabilityTool({
    doctorIds: shortlist.map((d) => d._id),
    from: constraints.from,
    to: constraints.to,
  });

  // Count only slots that survive the day/time filters — reporting every open slot
  // while proposing from a filtered subset makes the trace lie about its own work.
  const openCount = Object.values(availability).reduce(
    (sum, byDate) =>
      sum +
      Object.entries(byDate).reduce(
        (n, [date, slots]) => n + slots.filter((time) => slotMatches(date, time, constraints)).length,
        0
      ),
    0
  );
  emit({
    label: `Checked ${shortlist.length} calendar${shortlist.length === 1 ? '' : 's'}`,
    detail: `${openCount} slot${openCount === 1 ? '' : 's'} open ${describeWindow(constraints)}`,
  });

  const summary =
    `Checked ${shortlist.length} ${specLabel}calendar${shortlist.length === 1 ? '' : 's'} · ` +
    `${openCount} slot${openCount === 1 ? '' : 's'} ${compactWindow(constraints)}`;

  const ranked = rankProposals(shortlist, availability, constraints);
  if (ranked.length === 0) {
    return {
      constraints,
      steps,
      summary,
      proposals: [],
      plannedBy,
      // Name the narrowing constraint — "nothing free" is not actionable when the
      // reason is a day or time filter the patient can simply drop.
      noMatchReason:
        constraints.daysOfWeek?.length || constraints.afterTime || constraints.beforeTime
          ? `Nothing open ${describeWindow(constraints)}. Remove the day or time filter above, or widen the dates.`
          : 'Those doctors have nothing free in that window. Try a wider date range or join a waitlist.',
    };
  }

  const proposals: BookingProposal[] = [];
  for (const candidate of ranked) {
    const proposalId = crypto.randomUUID();
    await storeProposal(proposalId, {
      patientId,
      doctorId: candidate.doctorId,
      slotISO: candidate.slotISO,
      fee: candidate.fee,
      specialization: candidate.specialization,
      doctorName: candidate.doctorName,
    });
    proposals.push({ ...candidate, proposalId });
  }

  emit({ label: `Prepared ${proposals.length} option${proposals.length === 1 ? '' : 's'}`, detail: 'Nothing is booked yet' });

  publishEvent({
    type: 'booking_agent.proposed',
    actorId: patientId,
    entityType: 'booking_proposal',
    payload: { query, plannedBy, proposals: proposals.length, constraints: constraints as any },
  });

  return { constraints, steps, summary, proposals, plannedBy };
}

/**
 * The write gate. Reachable only from an authenticated request carrying a proposal id
 * the patient clicked — never from the agent loop.
 */
export async function confirmProposal(
  proposalId: string,
  patientId: string,
  extras: { symptoms?: string; consultationType?: string; triageEvidence?: Record<string, number> } = {}
) {
  const proposal = await takeProposal(proposalId);
  if (!proposal) {
    throw new Error('That option expired. Please search again.');
  }
  // A proposal is bound to the patient it was built for; ids are unguessable, but the
  // check means a leaked id still can't book on someone else's account.
  if (proposal.patientId !== patientId) {
    throw new Error('That option belongs to a different account.');
  }

  const appointment = await AppointmentService.createAppointment({
    patientId,
    doctorId: proposal.doctorId,
    appointmentDate: new Date(proposal.slotISO),
    duration: 30,
    consultationType: (extras.consultationType as any) || 'video',
    symptoms: extras.symptoms || 'Booked via assistant',
    specialization: proposal.specialization,
    fee: proposal.fee,
  } as any);

  publishEvent({
    type: 'booking_agent.confirmed',
    actorId: patientId,
    entityType: 'appointment',
    entityId: String((appointment as any)._id),
    payload: { doctorId: proposal.doctorId, slotISO: proposal.slotISO, fee: proposal.fee },
  });

  return appointment;
}

export { SlotTakenError };
