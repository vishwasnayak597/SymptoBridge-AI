import React from 'react';
import {
  BeakerIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

export interface Reminder {
  id: string;
  type: 'appointment' | 'medication' | 'checkup' | 'test';
  title: string;
  description: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
}

interface RemindersListProps {
  reminders: Reminder[];
  onToggle: (id: string) => void;
  onViewAppointments: () => void;
}

/** Upcoming + completed health reminders with priority styling. */
export default function RemindersList({ reminders, onToggle, onViewAppointments }: RemindersListProps) {
  const pending = reminders.filter((r) => !r.completed);
  const completed = reminders.filter((r) => r.completed);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Appointment Reminders</h2>
          <p className="text-gray-600">Stay on top of your health appointments and medication schedules</p>
        </div>
        <button onClick={onViewAppointments} className="btn-primary flex items-center">
          <CalendarDaysIcon className="h-4 w-4 mr-2" />
          View Appointments
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Reminders</h3>
          <div className="space-y-3">
            {pending.map((reminder) => (
              <div key={reminder.id} className={`p-4 rounded-lg border-l-4 ${
                reminder.priority === 'high' ? 'border-red-400 bg-red-50' :
                reminder.priority === 'medium' ? 'border-yellow-400 bg-yellow-50' :
                'border-green-400 bg-green-50'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <div className={`p-1 rounded-full ${
                        reminder.type === 'appointment' ? 'bg-blue-100 text-blue-600' :
                        reminder.type === 'medication' ? 'bg-purple-100 text-purple-600' :
                        reminder.type === 'test' ? 'bg-green-100 text-green-600' :
                        'bg-orange-100 text-orange-600'
                      }`}>
                        {reminder.type === 'appointment' ? <CalendarDaysIcon className="h-4 w-4" /> :
                         reminder.type === 'medication' ? <DocumentTextIcon className="h-4 w-4" /> :
                         reminder.type === 'test' ? <BeakerIcon className="h-4 w-4" /> :
                         <ClockIcon className="h-4 w-4" />}
                      </div>
                      <h4 className="font-semibold text-gray-900">{reminder.title}</h4>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        reminder.priority === 'high' ? 'bg-red-100 text-red-800' :
                        reminder.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {reminder.priority.toUpperCase()}
                      </span>
                    </div>

                    <p className="text-gray-700 text-sm mb-2">{reminder.description}</p>
                    <p className="text-sm font-medium text-gray-900">
                      Due: {new Date(reminder.dueDate).toLocaleDateString()}
                    </p>
                  </div>

                  <button
                    onClick={() => onToggle(reminder.id)}
                    className="ml-4 p-2 text-gray-400 hover:text-green-600 transition-colors"
                    aria-label={`Mark "${reminder.title}" as done`}
                  >
                    <CheckCircleIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Completed ({completed.length})
          </h3>
          <div className="space-y-2">
            {completed.map((reminder) => (
              <div key={reminder.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 opacity-75">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900 text-sm line-through">{reminder.title}</h4>
                    <p className="text-gray-600 text-xs">{new Date(reminder.dueDate).toLocaleDateString()}</p>
                  </div>
                  <CheckCircleIcon className="h-5 w-5 text-green-600" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
        <div className="flex items-start space-x-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <SparklesIcon className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Health Tip of the Day</h3>
            <p className="text-gray-700">
              Regular monitoring of blood pressure is crucial for cardiovascular health.
              Keep track of your readings and share them with your doctor during consultations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
