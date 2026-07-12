import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowPathIcon, CheckCircleIcon, XCircleIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { apiClient } from '../../lib/api';

interface HealthResponse {
  status: string;
  timestamp: string;
  environment: string;
  database: string;
  keepAlive?: unknown;
}

/** The backend serves /health at the origin root, not under /api. */
function healthUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_URL || 'https://symptobridge-ai.onrender.com/api';
  return base.replace(/\/api\/?$/, '') + '/health';
}

function StatusCard({ name, ok, detail }: { name: string; ok: boolean; detail: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <ServerStackIcon className="h-6 w-6 text-gray-400" />
          <div>
            <p className="font-semibold text-gray-900">{name}</p>
            <p className="text-sm text-gray-500">{detail}</p>
          </div>
        </div>
        {ok ? (
          <span className="inline-flex items-center text-green-700 bg-green-50 px-2.5 py-1 rounded-full text-sm">
            <CheckCircleIcon className="h-4 w-4 mr-1" /> Operational
          </span>
        ) : (
          <span className="inline-flex items-center text-red-700 bg-red-50 px-2.5 py-1 rounded-full text-sm">
            <XCircleIcon className="h-4 w-4 mr-1" /> Unreachable
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Live system status: pings the backend /health and reads today's domain-event
 * counters from the audit stream. Real ops view, not a placeholder.
 */
export default function SystemPanel() {
  const health = useQuery({
    queryKey: ['system', 'health'],
    queryFn: async () => {
      const res = await fetch(healthUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`health ${res.status}`);
      return (await res.json()) as HealthResponse;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  const events = useQuery({
    queryKey: ['system', 'event-stats'],
    queryFn: async () => {
      const res = await apiClient.get('/audit/stats');
      return (res.data.data ?? {}) as Record<string, number>;
    },
    meta: { silent: true },
  });

  const apiOk = health.isSuccess && health.data?.status === 'OK';
  const dbOk = health.isSuccess && health.data?.database === 'connected';
  const eventEntries = Object.entries(events.data ?? {});

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">System Status</h2>
          <p className="text-gray-600">
            {health.data?.environment ? `Environment: ${health.data.environment}` : 'Live service health'}
          </p>
        </div>
        <button
          onClick={() => { health.refetch(); events.refetch(); }}
          className="btn-secondary text-sm flex items-center"
          aria-label="Refresh system status"
        >
          <ArrowPathIcon className={`h-4 w-4 mr-2 ${health.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatusCard name="API Server" ok={apiOk} detail={health.isLoading ? 'Checking…' : (apiOk ? 'Express · responding' : 'No response')} />
        <StatusCard name="Database" ok={dbOk} detail={dbOk ? 'MongoDB · connected' : 'Not connected'} />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Today&rsquo;s events</h3>
        {eventEntries.length === 0 ? (
          <p className="text-sm text-gray-500">
            No events recorded today (the live event counters require Redis; otherwise the audit
            trail under Reports still records every event).
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {eventEntries.map(([type, count]) => (
              <div key={type} className="p-3 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <p className="text-xs text-gray-600">{type.replace(/[._]/g, ' ')}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {health.data?.timestamp && (
        <p className="text-xs text-gray-400">
          Last checked {new Date(health.data.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
