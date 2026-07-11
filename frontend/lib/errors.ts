import { AxiosError } from 'axios';

/**
 * Extract a human-readable message from any thrown value.
 *
 * Prefers the API's own error/message fields (our ApiResponse shape), then
 * axios-level context (timeouts, network down), then generic Error messages.
 * Components should never render `String(err)` directly — use this.
 */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { error?: string; message?: string } | undefined;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
    if (!error.response) return 'Cannot reach the server. Check your connection.';
    return `Request failed (${error.response.status}).`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
