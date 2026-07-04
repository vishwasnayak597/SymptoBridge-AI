import { io, Socket } from 'socket.io-client';

/**
 * Singleton Socket.IO client, authenticated with the same JWT the REST client uses.
 * The socket server lives on the backend host (NEXT_PUBLIC_API_URL minus the /api suffix).
 * socket.io handles reconnection with backoff automatically; on reconnect the auth
 * callback re-reads the (possibly refreshed) token from localStorage.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://aidoc.onrender.com/api';
const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null; // SSR/prerender guard

  if (!socket) {
    socket = io(SOCKET_URL, {
      // Function form: re-evaluated on every (re)connect, so a refreshed token is picked up.
      auth: (cb) => cb({ token: localStorage.getItem('accessToken') }),
      reconnectionDelayMax: 10000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
