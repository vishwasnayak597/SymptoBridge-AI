import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
// 'zod/v3', not 'zod': the MCP SDK types its schemas against zod/v3's declarations,
// and TypeScript treats the two entry points of the same zod 3.25 package as
// unrelated classes.
import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApiTokenService, AuthenticatedToken } from '../services/ApiTokenService';
import { ApiTokenScope } from '../models/ApiToken';
import { loadDoctorsCached, toDoctorSummary } from '../services/DoctorDirectoryService';
import { availabilityForDoctor, isValidDateString } from '../services/SlotService';
import { runBookingAgent, parseWithRules } from '../services/BookingAgentService';
import { AppointmentService } from '../services/AppointmentService';
import { WaitlistService } from '../services/WaitlistService';
import { publishEvent } from '../services/EventBus';
import { CLINIC_TIMEZONE, formatClinicDateTime } from '../utils/clinicTime';
import logger from '../utils/logger';

/**
 * SymptoBridge over the Model Context Protocol.
 *
 * Lets a patient connect an AI assistant (Claude Desktop, an IDE, another agent) to
 * their account with a personal access token, then search doctors, check availability,
 * see their appointments and waitlist, and ask for booking options in plain language.
 *
 * THE LINE THIS SERVER DOES NOT CROSS: no tool confirms a booking or moves money. An
 * external assistant can PROPOSE — `find_appointment` returns options with a link —
 * and the patient books and pays in SymptoBridge's own UI. This is the same
 * propose/approve split the in-app booking agent uses, extended to a party we trust
 * even less: a model running somewhere else, reading text we don't control.
 *
 * Stateless: each POST builds a fresh server bound to the token's user, so there is no
 * session state to leak between users or to lose on a restart.
 */

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

type Ctx = AuthenticatedToken;

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function fail(message: string) {
  return { ...text(message), isError: true };
}

/** Scope check + audit around every tool, so neither can be forgotten per tool. */
function guarded<A>(ctx: Ctx, tool: string, scope: ApiTokenScope, run: (args: A) => Promise<ReturnType<typeof text>>) {
  return async (args: A) => {
    if (!ctx.token.scopes.includes(scope)) {
      return fail(`This token doesn't have the "${scope}" permission. Create a token with it in SymptoBridge.`);
    }
    publishEvent({
      type: 'mcp.tool_called',
      actorId: ctx.user._id.toString(),
      entityType: 'api_token',
      entityId: ctx.token._id.toString(),
      payload: { tool },
    });
    try {
      return await run(args);
    } catch (err) {
      logger.error('MCP tool failed', { tool, message: (err as Error).message });
      return fail('Something went wrong on SymptoBridge’s side. Please try again.');
    }
  };
}

interface ToolConfig {
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

/**
 * `server.registerTool` without the SDK's compile-time inference of the handler's
 * argument type from the zod shape — that recursion hits TS2589 ("excessively deep")
 * under ts-jest. Nothing is lost at runtime: the SDK still validates every call's
 * arguments against `inputSchema` before a handler runs.
 */
function register(server: McpServer, name: string, config: ToolConfig, cb: (args: any) => Promise<unknown>) {
  (server.registerTool as unknown as (n: string, c: ToolConfig, h: typeof cb) => void).call(server, name, config, cb);
}

/** The tools, bound to one authenticated patient. */
export function buildMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: 'symptobridge', version: '1.0.0' });
  const patientId = ctx.user._id.toString();

  register(
    server,
    'search_doctors',
    {
      title: 'Search doctors',
      description:
        'Find bookable doctors on SymptoBridge by specialty, fee (INR) and rating. Misspelled specialties are understood. Read-only.',
      inputSchema: {
        specialization: z.string().max(80).optional().describe('e.g. "cardiology" or "skin doctor"'),
        maxFee: z.number().positive().optional().describe('Maximum consultation fee in INR'),
        minRating: z.number().min(0).max(5).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(ctx, 'search_doctors', 'doctors:read', async ({ specialization, maxFee, minRating }: any) => {
      // Reuse the booking parser so "skin doctor" and "cardologist" resolve here too.
      const wanted = specialization ? parseWithRules(specialization).specialization || specialization : undefined;
      const doctors = (await loadDoctorsCached(null))
        .map(toDoctorSummary)
        .filter((d) => !wanted || d.specialization.toLowerCase().includes(wanted.toLowerCase()))
        .filter((d) => maxFee === undefined || d.consultationFee <= maxFee)
        .filter((d) => minRating === undefined || d.rating >= minRating)
        .slice(0, 20)
        // Deliberately no email, phone or licence number: an external client gets the
        // public directory view, nothing more.
        .map((d) => ({
          id: d._id,
          name: d.name,
          specialization: d.specialization,
          feeInr: d.consultationFee,
          rating: d.rating,
          experienceYears: d.experience,
        }));
      return text({ interpretedSpecialization: wanted ?? null, count: doctors.length, doctors });
    })
  );

  register(
    server,
    'get_availability',
    {
      title: 'Check a doctor’s availability',
      description:
        `Free appointment slots for one doctor on one day. Times are clinic time (${CLINIC_TIMEZONE}); each slot also has an ISO instant. Read-only.`,
      inputSchema: {
        doctorId: z.string().regex(/^[a-f\d]{24}$/i).describe('A doctor id from search_doctors'),
        date: z.string().describe('YYYY-MM-DD, on the clinic calendar'),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(ctx, 'get_availability', 'doctors:read', async ({ doctorId, date }: any) => {
      if (!isValidDateString(date)) return fail('date must be YYYY-MM-DD.');
      const day = await availabilityForDoctor(doctorId, date);
      return text({
        doctorId,
        date,
        timeZone: day.timeZone,
        freeSlots: day.slots.map((s) => ({ clinicTime: s.time, instant: s.iso })),
      });
    })
  );

  register(
    server,
    'find_appointment',
    {
      title: 'Find appointment options',
      description:
        'Describe what the patient needs in plain language ("a cardiologist this week under ₹800 after 5pm"). ' +
        'Returns up to three options, each with a link. NOTHING IS BOOKED: the patient must open the link to ' +
        'book and pay in SymptoBridge. Links expire after 15 minutes.',
      inputSchema: {
        request: z.string().min(3).max(400),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    guarded(ctx, 'find_appointment', 'booking:propose', async ({ request }: any) => {
      const result = await runBookingAgent({ patientId, query: request });
      return text({
        understoodAs: result.summary,
        corrections: result.constraints.corrections ?? [],
        noMatchReason: result.noMatchReason ?? null,
        options: result.proposals.map((p) => ({
          doctor: p.doctorName,
          specialization: p.specialization,
          feeInr: p.fee,
          when: formatClinicDateTime(new Date(p.slotISO)),
          instant: p.slotISO,
          why: p.reason,
          // The only way to act on this option: a person, in SymptoBridge.
          bookAndPayLink: `${CLIENT_URL}/patient/dashboard/?tab=find-doctors&proposal=${p.proposalId}`,
        })),
        note: 'Nothing has been booked. Share a link with the patient to confirm and pay.',
      });
    })
  );

  register(
    server,
    'list_my_appointments',
    {
      title: 'List my appointments',
      description: 'The patient’s upcoming appointments: doctor, time, status and whether it is paid. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guarded(ctx, 'list_my_appointments', 'appointments:read', async () => {
      const { appointments } = await AppointmentService.getAppointments(
        { patientId, dateFrom: new Date() } as any,
        1,
        20
      );
      // Data minimisation: no symptoms or notes leave through this door.
      return text(
        appointments.map((a: any) => ({
          id: String(a._id),
          doctor: a.doctor ? `Dr. ${a.doctor.firstName} ${a.doctor.lastName}` : 'Unknown',
          specialization: a.specialization,
          when: formatClinicDateTime(new Date(a.appointmentDate)),
          instant: new Date(a.appointmentDate).toISOString(),
          type: a.consultationType,
          status: a.status,
          paid: a.paymentStatus === 'paid',
        }))
      );
    })
  );

  register(
    server,
    'my_waitlist',
    {
      title: 'My waitlist',
      description: 'Waitlists the patient is on, their place in line, and any slot currently held for them. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guarded(ctx, 'my_waitlist', 'appointments:read', async () => {
      const entries = await WaitlistService.listForPatient(patientId);
      return text(
        entries.map((e: any) => ({
          doctor: `Dr. ${e.doctor.firstName} ${e.doctor.lastName}`,
          date: e.date,
          status: e.status,
          placeInLine: e.position,
          heldSlot: e.offeredSlot ? formatClinicDateTime(new Date(e.offeredSlot)) : null,
          holdExpires: e.offerExpiresAt ?? null,
          claimLink: e.status === 'offered' ? `${CLIENT_URL}/patient/dashboard/?tab=appointments` : null,
        }))
      );
    })
  );

  return server;
}

// ---------------------------------------------------------------- HTTP

type McpRequest = Request & { mcpAuth?: AuthenticatedToken };

function jsonRpcError(res: Response, status: number, code: number, message: string) {
  return res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/** Personal access token → user. Only patients can connect an assistant, for now. */
async function mcpAuth(req: McpRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const secret = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const auth = await ApiTokenService.authenticate(secret);
  if (!auth) {
    res.set('WWW-Authenticate', 'Bearer realm="symptobridge-mcp"');
    return jsonRpcError(res, 401, -32001, 'Missing, invalid, expired or revoked access token.');
  }
  if (auth.user.role !== 'patient') {
    return jsonRpcError(res, 403, -32003, 'Only patient accounts can connect an assistant.');
  }
  req.mcpAuth = auth;
  next();
}

// Per token, on top of the global per-IP limiter: one runaway assistant loop
// shouldn't be able to hammer the booking engine.
const perTokenLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as McpRequest).mcpAuth?.token._id.toString() ?? 'anonymous',
  handler: (_req, res) => jsonRpcError(res, 429, -32029, 'Too many requests for this token. Slow down.'),
});

export const mcpRouter = Router();

mcpRouter.post('/', mcpAuth, perTokenLimit, async (req: McpRequest, res: Response) => {
  const server = buildMcpServer(req.mcpAuth!);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // plain JSON: nothing to buffer through proxies
  });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error('MCP request failed', { message: (err as Error).message });
    if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal error');
  }
});

// Stateless server: no server-initiated streams and no sessions to delete.
mcpRouter.get('/', (_req, res) => {
  res.set('Allow', 'POST');
  jsonRpcError(res, 405, -32000, 'Method not allowed. Use POST.');
});
mcpRouter.delete('/', (_req, res) => {
  res.set('Allow', 'POST');
  jsonRpcError(res, 405, -32000, 'Method not allowed. Use POST.');
});
