import React, { useEffect, useState } from 'react';
import { ClockIcon, CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { apiClient } from '../../lib/api';
import { formatDateKey, formatDateTime } from '../../lib/time';
import PaymentProcessor from '../../components/PaymentProcessor';
import { useWaitlist, WaitlistItem } from './useWaitlist';

/** mm:ss until `iso`, ticking every second; 0 once it has passed. */
function useCountdown(iso: string | null): number {
  const [left, setLeft] = useState(() => (iso ? Math.max(0, new Date(iso).getTime() - Date.now()) : 0));
  useEffect(() => {
    if (!iso) return;
    const tick = () => setLeft(Math.max(0, new Date(iso).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return left;
}

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface OfferRowProps {
  item: WaitlistItem;
  onClaimed: (appointmentId: string, item: WaitlistItem) => void;
  onExpired: () => void;
}

/** A slot held for this patient: the exact time, the deadline, and one button. */
function OfferRow({ item, onClaimed, onExpired }: OfferRowProps) {
  const left = useCountdown(item.offerExpiresAt);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const expired = left === 0;

  useEffect(() => {
    if (expired) onExpired();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  const claim = async () => {
    setClaiming(true);
    setError('');
    try {
      const response = await apiClient.post(
        `/appointments/waitlist/${item._id}/claim`,
        {},
        // One key per offer: a retried click replays the first claim instead of
        // failing against the now-fulfilled entry.
        { headers: { 'Idempotency-Key': `claim-${item._id}` } }
      );
      const appointment = response.data.data;
      onClaimed(appointment._id || appointment.id, item);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not claim this slot.');
      if (err?.response?.status === 410 || err?.response?.status === 409) onExpired();
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="rounded-xl border border-ember-200 bg-ember-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-800">
            Held for you · Dr. {item.doctor.firstName} {item.doctor.lastName}
          </p>
          <p className="text-sm text-stone-700">
            {item.offeredSlot ? formatDateTime(item.offeredSlot) : formatDateKey(item.date)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ember-700 tabular-nums">
            <ClockIcon className="h-3.5 w-3.5" />
            {expired ? 'This hold has lapsed' : `Held for another ${formatCountdown(left)}`}
          </p>
        </div>
        <button
          onClick={claim}
          disabled={claiming || expired}
          className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
        >
          {claiming
            ? 'Claiming…'
            : `Claim & pay${item.doctor.consultationFee ? ` · ₹${item.doctor.consultationFee}` : ''}`}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-error-700">{error}</p>}
    </div>
  );
}

interface WaitlistCardProps {
  /** Refresh appointments once a claimed slot is paid for. */
  onBooked?: () => void;
}

/**
 * The patient's place on waitlists, and any slot currently held for them.
 *
 * Renders nothing when they aren't waiting on anything. An offer shows the exact slot
 * in the patient's own timezone with a live countdown; claiming books that instant and
 * hands straight to the same payment step as every other booking.
 */
export default function WaitlistCard({ onBooked }: WaitlistCardProps) {
  const { items, refresh } = useWaitlist();
  const [paying, setPaying] = useState<{ appointmentId: string; item: WaitlistItem } | null>(null);
  const [done, setDone] = useState<WaitlistItem | null>(null);
  const [error, setError] = useState('');

  const leave = async (id: string) => {
    try {
      await apiClient.delete(`/appointments/waitlist/${id}`);
      refresh();
    } catch {
      setError('Could not leave the waitlist. Please try again.');
    }
  };

  const handlePaid = async (paymentId: string) => {
    if (!paying) return;
    try {
      await apiClient.put(`/appointments/${paying.appointmentId}`, { paymentId, paymentStatus: 'paid' });
      setDone(paying.item);
    } catch {
      setError(
        `Payment ${paymentId} went through, but we could not mark the appointment paid. ` +
          'It is in your appointments below — please contact support with that reference.'
      );
    } finally {
      setPaying(null);
      refresh();
      onBooked?.();
    }
  };

  if (items.length === 0 && !paying && !done && !error) return null;

  const offers = items.filter((i) => i.status === 'offered');
  const waiting = items.filter((i) => i.status === 'waiting');

  return (
    <div className="bg-stone-50 rounded-2xl shadow-soft p-5 mb-6 space-y-3">
      <h3 className="font-bold text-stone-800">Waitlist</h3>

      {paying ? (
        <div className="space-y-3">
          <p className="text-sm text-stone-700">
            The slot is booked and held while you pay.
          </p>
          <PaymentProcessor
            appointmentId={paying.appointmentId}
            doctorId={paying.item.doctor._id}
            amount={paying.item.doctor.consultationFee ?? 0}
            consultationType="video"
            onPaymentSuccess={handlePaid}
            onPaymentFailure={(message) => setError(`Payment failed: ${message}`)}
            onCancel={() => {
              setPaying(null);
              setError('The appointment is booked but unpaid. You can pay for it from your appointments below.');
              onBooked?.();
            }}
          />
        </div>
      ) : (
        offers.map((item) => (
          <OfferRow
            key={item._id}
            item={item}
            onClaimed={(appointmentId, claimed) => {
              setPaying({ appointmentId, item: claimed });
              onBooked?.();
            }}
            onExpired={refresh}
          />
        ))
      )}

      {done && (
        <div className="flex items-start gap-2 rounded-xl bg-moss-50 border border-moss-200 p-3">
          <CheckCircleIcon className="h-5 w-5 text-moss-600 shrink-0" />
          <p className="text-sm text-moss-800">
            Paid and booked — Dr. {done.doctor.firstName} {done.doctor.lastName},{' '}
            {done.offeredSlot ? formatDateTime(done.offeredSlot) : formatDateKey(done.date)}.
          </p>
        </div>
      )}

      {waiting.map((item) => (
        <div key={item._id} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-stone-700">
            Dr. {item.doctor.firstName} {item.doctor.lastName} · {formatDateKey(item.date)}
            <span className="text-stone-500">
              {' '}
              — {item.position === 1 ? 'next in line' : `#${item.position} in line`}
            </span>
          </span>
          <button
            onClick={() => leave(item._id)}
            className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
            aria-label={`Leave the waitlist for Dr. ${item.doctor.lastName} on ${item.date}`}
          >
            <XMarkIcon className="h-3.5 w-3.5" />
            Leave
          </button>
        </div>
      ))}

      {error && <p className="text-sm text-error-700">{error}</p>}
    </div>
  );
}
