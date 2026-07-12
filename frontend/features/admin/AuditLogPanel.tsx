import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { apiClient } from '../../lib/api';

interface AuditEntry {
  _id: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  occurredAt: string;
  actor?: { firstName?: string; lastName?: string; email?: string; role?: string } | null;
}

function eventBadge(eventType: string): string {
  if (eventType.includes('payment')) return 'bg-green-100 text-green-800';
  if (eventType.includes('appointment')) return 'bg-blue-100 text-blue-800';
  if (eventType.includes('user') || eventType.includes('auth')) return 'bg-purple-100 text-purple-800';
  return 'bg-gray-100 text-gray-800';
}

/**
 * Immutable audit trail (who did what, when) — the healthcare-style compliance
 * record. Reads GET /api/audit, admin-only on the server.
 */
export default function AuditLogPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', 'log'],
    queryFn: async () => {
      const res = await apiClient.get('/audit?limit=30');
      return (res.data.data?.entries ?? []) as AuditEntry[];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Audit Trail</h2>
        <p className="text-gray-600">Immutable record of platform events for compliance and review</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12" role="status" aria-label="Loading audit trail">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
        </div>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load the audit trail.</p>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="text-center py-12">
          <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No events recorded yet</h3>
          <p className="text-gray-600">Bookings, payments, and account changes will appear here as they happen.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Event</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Actor</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data!.map((entry) => (
                  <tr key={entry._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                      {new Date(entry.occurredAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${eventBadge(entry.eventType)}`}>
                        {entry.eventType.replace(/[._]/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {entry.actor
                        ? `${entry.actor.firstName ?? ''} ${entry.actor.lastName ?? ''}`.trim() || entry.actor.email || '—'
                        : 'System'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                      {entry.entityType || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
