import React from 'react';
import { DocumentTextIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Medication, Prescription } from './usePrescriptions';

interface PrescriptionsListProps {
  prescriptions: Prescription[];
  /** Navigate to doctor search — a new prescription starts with a consultation. */
  onRequestNew: () => void;
  isLoading?: boolean;
}

const STATUS_STYLES: Record<Prescription['status'], string> = {
  active: 'bg-moss-100 text-moss-700 ring-moss-200',
  completed: 'bg-stone-200 text-stone-700 ring-stone-300',
  cancelled: 'bg-error-100 text-error-700 ring-error-200',
};

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One medication as a dispensing line: name + dose, then the schedule underneath. */
function MedicationRow({ medication }: { medication: Medication }) {
  const facts = [
    { label: 'Frequency', value: medication.frequency },
    { label: 'Duration', value: medication.duration },
  ].filter((fact) => fact.value);

  return (
    <div className="border-l-[3px] border-ember-300 bg-stone-100/70 rounded-r-xl px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="font-bold text-stone-800">{medication.name}</h4>
        {medication.dosage && (
          <span className="font-mono text-xs text-ember-700 bg-ember-50 rounded-md px-2 py-0.5">
            {medication.dosage}
          </span>
        )}
      </div>

      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline gap-1.5">
              <dt className="text-stone-500">{fact.label}</dt>
              <dd className="text-stone-800 font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {medication.instructions && (
        <p className="mt-2 text-sm text-stone-600 leading-relaxed">{medication.instructions}</p>
      )}
    </div>
  );
}

/** Read-only list of the patient's prescriptions with medication details. */
export default function PrescriptionsList({
  prescriptions,
  onRequestNew,
  isLoading = false,
}: PrescriptionsListProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 justify-between items-start">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-stone-800">Prescriptions</h2>
          <p className="text-stone-500">Your current and past prescriptions</p>
        </div>
        <button onClick={onRequestNew} className="btn-primary flex items-center shrink-0">
          <PlusIcon className="h-4 w-4 mr-2" />
          Get New Prescription
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-4" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="bg-stone-50 rounded-2xl shadow-soft h-40 animate-pulse" />
          ))}
        </div>
      ) : prescriptions.length === 0 ? (
        <div className="bg-stone-50 rounded-2xl shadow-soft text-center px-6 py-14">
          <DocumentTextIcon className="h-12 w-12 text-stone-400 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-stone-800 mb-1">No prescriptions yet</h3>
          <p className="text-stone-500">Your prescriptions from consultations will appear here</p>
        </div>
      ) : (
        <div className="space-y-5">
          {prescriptions.map((prescription) => (
            <article
              key={prescription.id}
              className="bg-stone-50 rounded-2xl shadow-soft overflow-hidden"
            >
              <header className="flex flex-wrap items-start justify-between gap-3 px-6 py-4 border-b border-stone-200">
                <div className="min-w-0">
                  <p className="font-bold text-stone-800">{prescription.doctorName}</p>
                  <p className="text-sm text-stone-500">
                    {prescription.doctorSpecialization
                      ? `${prescription.doctorSpecialization} · ${formatDate(prescription.date)}`
                      : formatDate(prescription.date)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {prescription.prescriptionNumber && (
                    <span className="font-mono text-[11px] text-stone-400">
                      {prescription.prescriptionNumber}
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${
                      STATUS_STYLES[prescription.status] ?? STATUS_STYLES.active
                    }`}
                  >
                    {prescription.status}
                  </span>
                </div>
              </header>

              <div className="px-6 py-4 space-y-3">
                {prescription.medications.length === 0 ? (
                  <p className="text-sm text-stone-500">No medications listed on this prescription.</p>
                ) : (
                  prescription.medications.map((medication, index) => (
                    <MedicationRow key={`${medication.name}-${index}`} medication={medication} />
                  ))
                )}
              </div>

              {(prescription.generalInstructions || prescription.validTill) && (
                <footer className="px-6 py-3 bg-stone-100 border-t border-stone-200 flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
                  {prescription.generalInstructions && (
                    <p className="text-stone-600">
                      <span className="text-stone-500">Note: </span>
                      {prescription.generalInstructions}
                    </p>
                  )}
                  {prescription.validTill && (
                    <p className="text-stone-500 shrink-0">
                      Valid till {formatDate(prescription.validTill)}
                    </p>
                  )}
                </footer>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
