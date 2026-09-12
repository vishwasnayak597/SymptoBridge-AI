import React, { useEffect, useState } from 'react';
import { CommandLineIcon, ClipboardDocumentIcon, TrashIcon } from '@heroicons/react/24/outline';
import { apiClient } from '../../lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://symptobridge-ai.onrender.com/api';
const MCP_URL = `${API_BASE_URL.replace(/\/$/, '')}/mcp`;

interface TokenRow {
  _id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt?: string;
}

const SCOPE_LABEL: Record<string, string> = {
  'doctors:read': 'search doctors and availability',
  'appointments:read': 'see your appointments and waitlist',
  'booking:propose': 'suggest bookings for you to confirm',
};

function when(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/**
 * Connect an AI assistant (any MCP client) to this account with a personal access token.
 *
 * The token is shown once, at creation. The copy is explicit about the one thing that
 * matters to a patient: the assistant can suggest bookings, but only they can book or pay.
 */
export default function AssistantAccessCard() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const response = await apiClient.get('/tokens');
      setTokens(response.data.data ?? []);
    } catch {
      // Non-patient accounts get a 403 here; the card just stays empty.
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await apiClient.post('/tokens', { name: name.trim() || 'AI assistant' });
      setCreated({ token: response.data.data.token, name: response.data.data.name });
      setName('');
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not create a token.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await apiClient.delete(`/tokens/${id}`);
      load();
    } catch {
      setError('Could not revoke that token.');
    }
  };

  const command = created
    ? `claude mcp add --transport http symptobridge ${MCP_URL} --header "Authorization: Bearer ${created.token}"`
    : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — select the command and copy it manually.');
    }
  };

  return (
    <div className="card">
      <div className="card-body space-y-4">
        <div className="flex items-start gap-3">
          <CommandLineIcon className="h-6 w-6 text-stone-700 shrink-0" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Use SymptoBridge from your AI assistant</h3>
            <p className="text-sm text-gray-600">
              Connect Claude or any MCP-compatible assistant. It can{' '}
              {Object.values(SCOPE_LABEL).join(', ')}.{' '}
              <strong>It can never book or pay</strong> — every booking it suggests comes back to you here.
            </p>
          </div>
        </div>

        {created ? (
          <div className="rounded-xl border border-ember-200 bg-ember-50 p-4 space-y-2">
            <p className="text-sm font-semibold text-stone-800">
              Token for &ldquo;{created.name}&rdquo; — copy it now, it won&rsquo;t be shown again.
            </p>
            <pre className="text-xs bg-white border border-stone-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {command}
            </pre>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={copy} className="btn-secondary text-sm py-2 px-4 flex items-center">
                <ClipboardDocumentIcon className="h-4 w-4 mr-2" />
                {copied ? 'Copied' : 'Copy command'}
              </button>
              <button onClick={() => setCreated(null)} className="text-sm text-stone-600 hover:text-stone-900">
                Done
              </button>
            </div>
            <p className="text-xs text-stone-500">
              For other assistants: server URL <code>{MCP_URL}</code>, header{' '}
              <code>Authorization: Bearer &lt;token&gt;</code>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this connection, e.g. Claude on my laptop"
              className="input-field flex-1"
              maxLength={60}
            />
            <button onClick={create} disabled={busy} className="btn-primary text-sm disabled:opacity-50 shrink-0">
              {busy ? 'Creating…' : 'Create access token'}
            </button>
          </div>
        )}

        {tokens.length > 0 && (
          <ul className="divide-y divide-stone-200 text-sm">
            {tokens.map((t) => (
              <li key={t._id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-stone-800">{t.name}</span>{' '}
                  <code className="text-xs text-stone-500">{t.prefix}…</code>
                  <span className="block text-xs text-stone-500">
                    Last used {when(t.lastUsedAt)} · expires {when(t.expiresAt)}
                  </span>
                </span>
                <button
                  onClick={() => revoke(t._id)}
                  className="flex items-center gap-1 text-xs text-error-700 hover:underline shrink-0"
                  aria-label={`Revoke ${t.name}`}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-error-700">{error}</p>}
      </div>
    </div>
  );
}
