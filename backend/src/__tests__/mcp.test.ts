import http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { Types } from 'mongoose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import User from '../models/User';
import { Appointment } from '../models/Appointment';
import { ApiToken } from '../models/ApiToken';
import { ApiTokenService } from '../services/ApiTokenService';
import { peekProposal, confirmProposal } from '../services/BookingAgentService';
import { stopJobWorkers } from '../services/JobQueueService';
import { mcpRouter } from '../mcp/server';

/**
 * End to end over the real protocol: the SDK's own client, over HTTP, against the
 * router the server mounts — so auth, scopes and the no-write guarantee are tested
 * the way an assistant like Claude Desktop would hit them.
 */

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await stopJobWorkers();
});

async function seed() {
  const patient = await User.create({
    email: 'mcppatient@test.com', password: 'SuperSecret123!', firstName: 'Mia', lastName: 'Patient', role: 'patient',
  });
  const doctor = await User.create({
    email: 'mcpdoc@test.com', password: 'SuperSecret123!', firstName: 'Asha', lastName: 'Rao', role: 'doctor',
    specialization: 'Cardiology', licenseNumber: 'LIC-MCP', consultationFee: 700, rating: 4.8,
    phone: '+919999999999', isEmailVerified: true, isActive: true,
  });
  return {
    patientId: (patient._id as Types.ObjectId).toString(),
    doctorId: (doctor._id as Types.ObjectId).toString(),
  };
}

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'test-assistant', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  return client;
}

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe('personal access tokens', () => {
  it('stores only a hash of the secret', async () => {
    const { patientId } = await seed();
    const { token } = await ApiTokenService.create(patientId, 'Claude Desktop');

    const stored = await ApiToken.findOne({ user: patientId }).lean();
    expect(token.startsWith('sb_pat_')).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('rejects revoked and expired tokens', async () => {
    const { patientId } = await seed();
    const revoked = await ApiTokenService.create(patientId, 'old laptop');
    await ApiTokenService.revoke(patientId, String(revoked.record._id));
    const expired = await ApiTokenService.create(patientId, 'expired');
    await ApiToken.updateOne({ _id: expired.record._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await ApiTokenService.authenticate(revoked.token)).toBeNull();
    expect(await ApiTokenService.authenticate(expired.token)).toBeNull();
  });

  it('caps active tokens per user', async () => {
    const { patientId } = await seed();
    for (let i = 0; i < 5; i++) await ApiTokenService.create(patientId, `t${i}`);
    await expect(ApiTokenService.create(patientId, 'one too many')).rejects.toThrow(/at most 5/);
  });
});

describe('MCP endpoint', () => {
  it('refuses requests without a valid token', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('refuses doctor accounts', async () => {
    const { doctorId } = await seed();
    const { token } = await ApiTokenService.create(doctorId, 'doctor tool');
    await expect(connect(token)).rejects.toThrow();
  });

  it('exposes read and propose tools — and nothing that books or pays', async () => {
    const { patientId } = await seed();
    const { token } = await ApiTokenService.create(patientId, 'Claude Desktop');
    const client = await connect(token);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['find_appointment', 'get_availability', 'list_my_appointments', 'my_waitlist', 'search_doctors']);
    expect(names.some((n) => /confirm|pay|cancel|book_/.test(n))).toBe(false);
    await client.close();
  });

  it('searches doctors without exposing contact details, understanding typos', async () => {
    const { patientId } = await seed();
    const { token } = await ApiTokenService.create(patientId, 'Claude Desktop');
    const client = await connect(token);

    const result = parse(await client.callTool({ name: 'search_doctors', arguments: { specialization: 'cardologist' } }));

    expect(result.interpretedSpecialization).toBe('Cardiology');
    expect(result.doctors[0].name).toBe('Dr. Asha Rao');
    const raw = JSON.stringify(result);
    expect(raw).not.toContain('mcpdoc@test.com');
    expect(raw).not.toContain('+919999999999');
    expect(raw).not.toContain('LIC-MCP');
    await client.close();
  });

  it('proposes options with a link, books nothing, and only the patient can confirm', async () => {
    const { patientId } = await seed();
    const { token } = await ApiTokenService.create(patientId, 'Claude Desktop');
    const client = await connect(token);

    const result = parse(
      await client.callTool({ name: 'find_appointment', arguments: { request: 'cardiologist this week under 1000' } })
    );
    await client.close();

    expect(result.options.length).toBeGreaterThan(0);
    expect(await Appointment.countDocuments({})).toBe(0); // proposing never books

    const link = new URL(result.options[0].bookAndPayLink);
    const proposalId = link.searchParams.get('proposal')!;
    expect(link.pathname).toBe('/patient/dashboard/');

    // The patient's own UI can see it; nobody else can.
    const other = await User.create({
      email: 'other@test.com', password: 'SuperSecret123!', firstName: 'O', lastName: 'Ther', role: 'patient',
    });
    expect(await peekProposal(proposalId, (other._id as Types.ObjectId).toString())).toBeNull();
    expect(await peekProposal(proposalId, patientId)).not.toBeNull();

    // Confirming is a first-party action, outside MCP entirely.
    await confirmProposal(proposalId, patientId);
    expect(await Appointment.countDocuments({})).toBe(1);
  });

  it('enforces token scopes per tool', async () => {
    const { patientId } = await seed();
    const { token } = await ApiTokenService.create(patientId, 'read only', ['doctors:read']);
    const client = await connect(token);

    const denied: any = await client.callTool({ name: 'find_appointment', arguments: { request: 'a cardiologist' } });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toMatch(/booking:propose/);

    const allowed: any = await client.callTool({ name: 'search_doctors', arguments: {} });
    expect(allowed.isError).toBeFalsy();
    await client.close();
  });
});
