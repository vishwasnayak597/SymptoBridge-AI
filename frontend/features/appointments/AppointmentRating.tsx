import React, { useState } from 'react';
import { StarIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { Appointment } from './types';

/** Interactive 1–5 star selector; read-only when `onChange` is omitted. */
export const StarRating: React.FC<{
  value: number;
  onChange?: (value: number) => void;
}> = ({ value, onChange }) => {
  const [hover, setHover] = useState(0);
  const readOnly = !onChange;
  return (
    <div className="flex items-center space-x-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = (hover || value) >= star;
        return (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            onMouseEnter={() => !readOnly && setHover(star)}
            onMouseLeave={() => !readOnly && setHover(0)}
            onClick={() => onChange?.(star)}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            className={readOnly ? 'cursor-default' : 'cursor-pointer'}
          >
            {filled
              ? <StarIconSolid className="h-6 w-6 text-yellow-400" />
              : <StarIcon className="h-6 w-6 text-gray-300" />}
          </button>
        );
      })}
    </div>
  );
};

/** Lets a patient rate a completed consultation, or shows the rating already left. */
export const AppointmentRating: React.FC<{
  appointment: Appointment;
  onSubmit: (appointmentId: string, rating: number, review: string) => Promise<void>;
}> = ({ appointment, onSubmit }) => {
  const existingRating = appointment.rating?.patientRating;
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (existingRating) {
    return (
      <div className="mt-4 pt-4 border-t border-gray-100">
        <p className="text-sm font-medium text-gray-700 mb-1">Your rating</p>
        <div className="flex items-center space-x-2">
          <StarRating value={existingRating} />
          {appointment.rating?.patientReview && (
            <span className="text-sm text-gray-500 italic">&ldquo;{appointment.rating.patientReview}&rdquo;</span>
          )}
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (rating < 1) {
      setError('Please select a star rating.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSubmit(appointment._id, rating, review.trim());
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not submit your rating. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <p className="text-sm font-medium text-gray-700 mb-2">Rate your consultation</p>
      <StarRating value={rating} onChange={setRating} />
      <textarea
        value={review}
        onChange={(e) => setReview(e.target.value)}
        placeholder="Share your experience (optional)"
        rows={2}
        className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral-500"
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={rating < 1 || submitting}
        className="mt-2 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Submitting…' : 'Submit Rating'}
      </button>
    </div>
  );
};
