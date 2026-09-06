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
}

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

/** End of the current week (Sunday), or 7 days out if that is sooner than 2 days away. */
function endOfWeek(): string {
  const now = new Date();
  const daysToSunday = (7 - now.getUTCDay()) % 7;
  return addDays(todayISO(), Math.max(daysToSunday, 2));
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

const SPECIALIZATION_HINTS: Array<[RegExp, string]> = [
  [/cardio|heart/i, 'Cardiology'],
  [/derma|skin|rash|acne/i, 'Dermatology'],
  [/p(a)?ediatric|child|kid|baby/i, 'Pediatrics'],
  [/ortho|bone|joint|knee|fracture/i, 'Orthopedics'],
  [/psych|mental|anxiety|depress/i, 'Psychiatry'],
  [/neuro|migraine|headache|seizure/i, 'Neurology'],
  [/gyn(a)?ec|pregnan/i, 'Gynecology'],
  [/uro|kidney|urin/i, 'Urology'],
  [/dent|tooth|teeth/i, 'Dentistry'],
  [/ophthal|eye|vision/i, 'Ophthalmology'],
  [/ent\b|ear|nose|throat/i, 'ENT (Ear, Nose & Throat)'],
  [/gastro|stomach|digest/i, 'Gastroenterology'],
  [/onco|cancer|tumou?r/i, 'Oncology'],
  [/surg/i, 'Surgery'],
  [/general|physician|gp\b/i, 'General Medicine'],
];

/**
 * Constraint extraction without an LLM. Covers the phrasings the UI's own filters
 * expose, which is most of what patients type.
 */
export function parseWithRules(query: string): BookingConstraints {
  const q = query.toLowerCase();
  const constraints: BookingConstraints = { from: todayISO(), to: addDays(todayISO(), 7) };

  for (const [pattern, spec] of SPECIALIZATION_HINTS) {
    if (pattern.test(q)) {
      constraints.specialization = spec;
      break;
    }
  }

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

  if (/asap|urgent|soonest|earliest|emergency/.test(q)) constraints.preferSoonest = true;

  return constraints;
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
      const slots = byDate[date];
      if (slots && slots.length > 0) {
        earliest = { date, time: slots[0] };
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
  const { patientId, query, lat, lng, urgent } = opts;
  const steps: AgentStep[] = [];
  const emit = (step: AgentStep) => {
    steps.push(step);
    // Streamed so the patient sees progress during the 5-15s the tools take.
    SocketService.emitToUser(patientId, 'booking-agent:step', step);
  };

  let constraints = parseWithRules(query);
  if (urgent) constraints.preferSoonest = true;
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
      label: `Reading your request`,
      detail: [
        constraints.specialization || 'any speciality',
        constraints.maxFee ? `under ₹${constraints.maxFee}` : null,
        `${constraints.from} to ${constraints.to}`,
      ]
        .filter(Boolean)
        .join(' · '),
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

  if (doctors.length === 0) {
    return {
      constraints,
      steps,
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

  const openCount = Object.values(availability).reduce(
    (sum, byDate) => sum + Object.values(byDate).reduce((n, slots) => n + slots.length, 0),
    0
  );
  emit({
    label: `Checked ${shortlist.length} calendars`,
    detail: `${openCount} open slot${openCount === 1 ? '' : 's'} between ${constraints.from} and ${constraints.to}`,
  });

  const ranked = rankProposals(shortlist, availability, constraints);
  if (ranked.length === 0) {
    return {
      constraints,
      steps,
      proposals: [],
      plannedBy,
      noMatchReason: 'Those doctors have nothing free in that window. Try a wider date range or join a waitlist.',
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

  return { constraints, steps, proposals, plannedBy };
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
