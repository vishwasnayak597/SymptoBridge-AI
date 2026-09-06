import React, { useEffect, useRef, useState } from 'react';
import {
  SparklesIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XMarkIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '../../lib/api';
import { getSocket } from '../../lib/socket';

interface AgentStep {
  label: string;
  detail?: string;
}

interface Proposal {
  proposalId: string;
  doctorId: string;
  doctorName: string;
  specialization: string;
  fee: number;
  rating: number;
  distanceKm: number | null;
  slotISO: string;
  date: string;
  time: string;
  reason: string;
}

interface Constraints {
  specialization?: string;
  maxFee?: number;
  minRating?: number;
  from: string;
  to: string;
  maxKm?: number;
  preferSoonest?: boolean;
}

interface AgentResult {
  constraints: Constraints;
  steps: AgentStep[];
  proposals: Proposal[];
  noMatchReason?: string;
  plannedBy: 'gemini' | 'rules';
}

const EXAMPLES = [
  'A cardiologist this week under ₹800',
  'Earliest dermatologist appointment',
  'Paediatrician tomorrow, 4 star or better',
];

function formatSlot(proposal: Proposal): string {
  const date = new Date(proposal.slotISO);
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

/** The parsed request, as chips the patient can drop when the agent misreads them. */
function constraintChips(c: Constraints): Array<{ key: keyof Constraints; label: string }> {
  const chips: Array<{ key: keyof Constraints; label: string }> = [];
  if (c.specialization) chips.push({ key: 'specialization', label: c.specialization });
  if (c.maxFee) chips.push({ key: 'maxFee', label: `≤ ₹${c.maxFee}` });
  if (c.minRating) chips.push({ key: 'minRating', label: `${c.minRating}★ and up` });
  if (c.maxKm) chips.push({ key: 'maxKm', label: `within ${c.maxKm} km` });
  chips.push({ key: 'from', label: `${c.from} → ${c.to}` });
  return chips;
}

interface BookingAgentPanelProps {
  /** Called after a booking is confirmed, so the dashboard can refresh appointments. */
  onBooked?: () => void;
}

/**
 * Natural-language appointment search.
 *
 * The agent never books: it returns proposals, and `Confirm` posts the proposal id the
 * patient clicked to the one endpoint allowed to write. Everything rendered here comes
 * from server tool output — no model prose reaches the cards.
 */
export default function BookingAgentPanel({ onBooked }: BookingAgentPanelProps) {
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [booked, setBooked] = useState<Proposal | null>(null);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // Steps stream over the socket while the tools run — a 5-15s wait with no feedback
  // reads as a hang.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStep = (step: AgentStep) => setLiveSteps((prev) => [...prev, step]);
    socket.on('booking-agent:step', onStep);
    return () => {
      socket.off('booking-agent:step', onStep);
    };
  }, []);

  const run = async (text: string, overrides?: Partial<Constraints>) => {
    if (!text.trim() || running) return;
    setRunning(true);
    setError('');
    setBooked(null);
    setResult(null);
    setLiveSteps([]);
    try {
      const response = await apiClient.post(
        '/ai/booking-agent',
        { query: text, ...overrides },
        { timeout: 90000 }
      );
      setResult(response.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not search for appointments right now.');
    } finally {
      setRunning(false);
    }
  };

  const confirm = async (proposal: Proposal) => {
    setConfirming(proposal.proposalId);
    setError('');
    try {
      await apiClient.post(
        '/ai/booking-agent/confirm',
        { proposalId: proposal.proposalId, symptoms: query },
        // One key per logical booking: a network retry replays the original 201
        // instead of hitting the consumed-proposal error.
        { headers: { 'Idempotency-Key': proposal.proposalId } }
      );
      setBooked(proposal);
      setResult(null);
      onBooked?.();
    } catch (err: any) {
      // 409 means someone took the slot between proposal and click — re-run so the
      // patient gets fresh options instead of a dead error.
      setError(err?.response?.data?.error || 'Could not confirm that booking.');
      if (err?.response?.status === 409) run(query);
    } finally {
      setConfirming(null);
    }
  };

  const dropChip = (key: string) => {
    const next = new Set(dropped);
    next.add(key);
    setDropped(next);
    // Re-running without the dropped constraint is the repair path for a misparse.
    run(query, { [key]: undefined } as Partial<Constraints>);
  };

  const steps = result?.steps?.length ? result.steps : liveSteps;

  return (
    <div className="bg-stone-50 rounded-2xl shadow-soft p-5 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-ember-500 flex items-center justify-center shrink-0">
          <SparklesIcon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-stone-800">Ask for an appointment</h3>
          <p className="text-sm text-stone-500">
            Describe what you need — every matching doctor&rsquo;s calendar gets checked at once.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run(query)}
          placeholder="A cardiologist this week under ₹800"
          className="input-field flex-1"
          disabled={running}
        />
        <button
          onClick={() => run(query)}
          disabled={running || query.trim().length < 3}
          className="btn-primary flex items-center justify-center disabled:opacity-50 shrink-0"
        >
          {running ? (
            <>
              <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
              Searching
            </>
          ) : (
            'Find slots'
          )}
        </button>
      </div>

      {!result && !running && !booked && (
        <div className="flex flex-wrap gap-2 mt-3">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => {
                setQuery(example);
                run(example);
              }}
              className="text-xs text-stone-600 bg-stone-200 hover:bg-stone-300 rounded-full px-3 py-1"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {/* The trace: what it actually did, so the result is checkable rather than magic. */}
      {steps.length > 0 && !booked && (
        <ol className="mt-4 space-y-1.5">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <CheckCircleIcon className="h-4 w-4 text-moss-500 mt-0.5 shrink-0" />
              <span className="text-stone-700">
                {step.label}
                {step.detail && <span className="text-stone-500"> — {step.detail}</span>}
              </span>
            </li>
          ))}
          {running && (
            <li className="flex items-center gap-2 text-sm text-stone-500">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Working…
            </li>
          )}
        </ol>
      )}

      {result && !booked && (
        <>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-xs text-stone-500">Understood as:</span>
            {constraintChips(result.constraints)
              .filter((chip) => !dropped.has(chip.key as string))
              .map((chip) => (
                <span
                  key={chip.key as string}
                  className="inline-flex items-center gap-1 text-xs bg-stone-200 text-stone-700 rounded-full pl-3 pr-1.5 py-1"
                >
                  {chip.label}
                  {chip.key !== 'from' && (
                    <button
                      onClick={() => dropChip(chip.key as string)}
                      className="hover:bg-stone-300 rounded-full p-0.5"
                      aria-label={`Remove ${chip.label}`}
                    >
                      <XMarkIcon className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
          </div>

          {result.proposals.length > 0 ? (
            <div className="mt-4 space-y-3">
              {result.proposals.map((proposal) => (
                <div
                  key={proposal.proposalId}
                  className="bg-white rounded-xl border border-stone-200 p-4 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-stone-800">{proposal.doctorName}</p>
                    <p className="text-sm text-stone-500">
                      {proposal.specialization}
                      {proposal.rating > 0 && ` · ${proposal.rating.toFixed(1)}★`}
                      {proposal.distanceKm != null && ` · ${proposal.distanceKm} km`}
                    </p>
                    <p className="text-sm text-stone-700 mt-1 flex items-center gap-1.5">
                      <CalendarDaysIcon className="h-4 w-4 text-ember-600" />
                      {formatSlot(proposal)}
                    </p>
                    <p className="text-xs text-stone-500 mt-0.5">{proposal.reason}</p>
                  </div>
                  <button
                    onClick={() => confirm(proposal)}
                    disabled={confirming !== null}
                    className="btn-primary shrink-0 disabled:opacity-50"
                  >
                    {confirming === proposal.proposalId ? 'Booking…' : `Confirm · ₹${proposal.fee}`}
                  </button>
                </div>
              ))}
              <p className="text-xs text-stone-500">
                Nothing is booked until you confirm.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-stone-600">
              {result.noMatchReason || 'No open slots matched.'} You can also browse the full list below.
            </p>
          )}
        </>
      )}

      {booked && (
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-moss-50 border border-moss-200 p-4">
          <CheckCircleIcon className="h-5 w-5 text-moss-600 mt-0.5 shrink-0" />
          <p className="text-sm text-moss-800">
            Booked <strong>{booked.doctorName}</strong> for {formatSlot(booked)}. It&rsquo;s in your
            Appointments tab.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-error-700 bg-error-50 border border-error-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
