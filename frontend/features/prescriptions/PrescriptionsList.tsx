import React from 'react';
import { DocumentTextIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Prescription } from './usePrescriptions';

interface PrescriptionsListProps {
  prescriptions: Prescription[];
  /** Navigate to doctor search — a new prescription starts with a consultation. */
  onRequestNew: () => void;
}

/** Read-only list of the patient's prescriptions with medication details. */
export default function PrescriptionsList({ prescriptions, onRequestNew }: PrescriptionsListProps) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Prescriptions</h2>
          <p className="text-gray-600">Your current and past prescriptions</p>
        </div>
        <button onClick={onRequestNew} className="btn-primary flex items-center">
          <PlusIcon className="h-4 w-4 mr-2" />
          Get New Prescription
        </button>
      </div>

      {prescriptions.length === 0 ? (
        <div className="text-center py-12">
          <DocumentTextIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No prescriptions yet</h3>
          <p className="text-gray-600 mb-6">
            Your prescriptions from consultations will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {prescriptions.map((prescription) => (
            <div key={prescription.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{prescription.diagnosis}</h3>
                  <p className="text-sm text-gray-600">Prescribed by {prescription.doctorName}</p>
                  <p className="text-sm text-gray-500">Date: {new Date(prescription.date).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  {prescription.nextFollowUp && (
                    <div className="text-sm text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
                      Follow-up: {new Date(prescription.nextFollowUp).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {prescription.medications.map((medication, index) => (
                  <div key={index} className="border-l-4 border-blue-200 bg-blue-50 p-4 rounded-r-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 text-lg">{medication.name}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2 text-sm">
                          <div>
                            <span className="font-medium text-gray-700">Dosage:</span>
                            <span className="ml-2 text-gray-900">{medication.dosage}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Frequency:</span>
                            <span className="ml-2 text-gray-900">{medication.frequency}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Duration:</span>
                            <span className="ml-2 text-gray-900">{medication.duration}</span>
                          </div>
                        </div>
                        <div className="mt-3">
                          <span className="font-medium text-gray-700">Instructions:</span>
                          <p className="text-gray-900 mt-1">{medication.instructions}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
