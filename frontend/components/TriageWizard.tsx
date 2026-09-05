import React, { useEffect, useState, useCallback } from 'react';
import {
  SparklesIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CpuChipIcon,
  HeartIcon
} from '@heroicons/react/24/outline';
import { apiClient } from '../lib/api';

interface Condition {
  disease: string;
  prob: number;
  specialization: string;
  urgency: 'low' | 'medium' | 'high' | 'urgent';
}

interface NextQuestion {
  symptom: string;
  question: string;
  infoGain: number;
}

interface Step {
  posterior: Condition[];
  nextQuestion: NextQuestion | null;
  done: boolean;
  urgency: 'low' | 'medium' | 'high' | 'urgent';
  recommendedSpecializations: string[];
  askedCount: number;
  evidence?: Record<string, number>;
}

interface TriageWizardProps {
  symptoms: string;
  onFindDoctors?: (
    symptoms: string,
    specializations?: string[],
    triageEvidence?: Record<string, number>
  ) => void;
  onRestart?: () => void;
}

const URGENCY_BAR: Record<string, string> = {
  low: 'bg-green-500',
  medium: 'bg-blue-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500'
};

const URGENCY_BANNER: Record<string, string> = {
  low: 'bg-green-50 border-green-200 text-green-800',
  medium: 'bg-blue-50 border-blue-200 text-blue-800',
  high: 'bg-orange-50 border-orange-200 text-orange-800',
  urgent: 'bg-red-100 border-red-400 text-red-800'
};

const TriageWizard: React.FC<TriageWizardProps> = ({ symptoms, onFindDoctors, onRestart }) => {
  const [evidence, setEvidence] = useState<Record<string, number>>({});
  const [skip, setSkip] = useState<string[]>([]);
  const [step, setStep] = useState<Step | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modelInfo, setModelInfo] = useState<{ accuracy: number; top3_accuracy: number } | null>(null);

  // Model card (training metrics) — credibility signal
  useEffect(() => {
    apiClient
      .get('/ai/triage/meta')
      .then((r) => setModelInfo(r.data.data?.metrics?.naive_bayes || null))
      .catch(() => {});
  }, []);

  const start = useCallback(async () => {
    setLoading(true);
    setError('');
    setSkip([]);
    try {
      // The ML service spins down on the free tier and can take ~30-50s to wake.
      // Give this first call a generous timeout so it rides out the cold start.
      const r = await apiClient.post('/ai/triage/start', { symptoms }, { timeout: 90000 });
      const s: Step = r.data.data;
      setEvidence(s.evidence || {});
      setStep(s);
    } catch (e) {
      setError('The AI triage model is waking up — this can take up to a minute on the first try. Please retry.');
    } finally {
      setLoading(false);
    }
  }, [symptoms]);

  useEffect(() => {
    start();
  }, [start]);

  const answer = async (value: 'yes' | 'no' | 'unsure') => {
    if (!step?.nextQuestion) return;
    const sym = step.nextQuestion.symptom;
    const nextEvidence = { ...evidence };
    const nextSkip = [...skip];

    if (value === 'unsure') {
      nextSkip.push(sym);
    } else {
      nextEvidence[sym] = value === 'yes' ? 1 : 0;
    }
    setEvidence(nextEvidence);
    setSkip(nextSkip);
    setLoading(true);
    setError('');
    try {
      const r = await apiClient.post('/ai/triage/answer', { evidence: nextEvidence, skip: nextSkip }, { timeout: 90000 });
      setStep(r.data.data);
    } catch (e) {
      setError('The triage model service is unavailable. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  };

  const bars = step?.posterior || [];

  return (
    <div className="card">
      <div className="card-body space-y-5">
        {/* Header + model card */}
        <div className="flex items-start justify-between">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center mr-3">
              <CpuChipIcon className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">AI Triage</h3>
              <p className="text-xs text-gray-500">
                Trained probabilistic model · narrows the diagnosis with each answer
              </p>
            </div>
          </div>
          {modelInfo && (
            <div className="text-right text-xs text-gray-500 hidden sm:block">
              <div className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100">
                <SparklesIcon className="h-3 w-3 mr-1 text-indigo-500" />
                Naive Bayes · {Math.round(modelInfo.accuracy * 100)}% top-1 ·{' '}
                {Math.round(modelInfo.top3_accuracy * 100)}% top-3
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={start} className="text-red-700 underline text-xs">Retry</button>
          </div>
        )}

        {/* Probability bars (animate as the differential narrows) */}
        {bars.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Current differential ({bars.length} shown)
            </p>
            {bars.map((c) => (
              <div key={c.disease}>
                <div className="flex justify-between text-sm mb-0.5">
                  <span className="text-gray-700">{c.disease}</span>
                  <span className="text-gray-500 tabular-nums">{Math.round(c.prob * 100)}%</span>
                </div>
                <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${URGENCY_BAR[c.urgency] || 'bg-blue-500'}`}
                    style={{ width: `${Math.max(2, Math.round(c.prob * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Question or result */}
        {loading && !step ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <ArrowPathIcon className="h-5 w-5 animate-spin mr-2" />
            Analyzing your symptoms…
          </div>
        ) : step && !step.done && step.nextQuestion ? (
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-base font-medium text-gray-900">{step.nextQuestion.question}</p>
              <span
                className="ml-3 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-indigo-50 text-indigo-700"
                title="Expected information gain — how much this question narrows the diagnosis"
              >
                most informative · {step.nextQuestion.infoGain.toFixed(2)} bits
              </span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => answer('yes')}
                disabled={loading}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Yes
              </button>
              <button
                onClick={() => answer('no')}
                disabled={loading}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                No
              </button>
              <button
                onClick={() => answer('unsure')}
                disabled={loading}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              >
                Not sure
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Question {step.askedCount + 1} · refining the differential</p>
          </div>
        ) : step && step.done ? (
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <div className={`p-4 rounded-lg border ${URGENCY_BANNER[step.urgency]}`}>
              <div className="flex items-center">
                {step.urgency === 'urgent' || step.urgency === 'high' ? (
                  <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
                ) : (
                  <CheckCircleIcon className="h-5 w-5 mr-2" />
                )}
                <span className="font-semibold capitalize">{step.urgency} urgency</span>
              </div>
              <p className="text-sm mt-1">
                Most likely: <strong>{bars[0]?.disease}</strong> ({Math.min(99, Math.round((bars[0]?.prob || 0) * 100))}% confidence).
                {step.urgency === 'urgent' && ' Seek emergency care now.'}
              </p>
            </div>

            {step.recommendedSpecializations.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Recommended specialist(s):</p>
                <div className="flex flex-wrap gap-2">
                  {step.recommendedSpecializations.map((s) => (
                    <span key={s} className="px-3 py-1 rounded-full bg-stone-200 text-stone-700 text-sm font-semibold">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              {onFindDoctors && (
                <button
                  onClick={() => onFindDoctors(symptoms, step.recommendedSpecializations, evidence)}
                  className="btn-primary flex items-center justify-center"
                >
                  <HeartIcon className="h-4 w-4 mr-2" />
                  Find Matching Doctors
                </button>
              )}
              {onRestart && (
                <button onClick={onRestart} className="btn-secondary">Start Over</button>
              )}
            </div>

            <p className="text-xs text-gray-400">
              AI triage for guidance only — not a diagnosis. Always consult a qualified clinician.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default TriageWizard;
