import { Server as HttpServer } from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import logger from '../utils/logger';

/**
 * Real-time layer:
 *  - JWT-authenticated Socket.IO on the same HTTP server as Express.
 *  - Per-user rooms (`user:{id}`) for targeted push (call ring, notifications).
 *  - Per-call rooms (`call:{appointmentId}`) used as the WebRTC *signaling* channel:
 *    the server relays SDP offers/answers and ICE candidates between the two peers;
 *    media itself flows peer-to-peer and never touches this server.
 *  - In-call chat messages are relayed through the same call room.
 */

interface AuthedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

class SocketServiceImpl {
  private io: IOServer | null = null;

  init(server: HttpServer): void {
    this.io = new IOServer(server, {
      cors: {
        origin: true, // reflect request origin; REST CORS already gates the app surface
        credentials: true,
      },
    });

    // Authenticate at handshake: token from socket.handshake.auth
    this.io.use((socket: AuthedSocket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error('Authentication required'));
        const payload = verifyAccessToken(token);
        socket.userId = payload.userId;
        socket.userRole = payload.role;
        next();
      } catch {
        next(new Error('Invalid or expired token'));
      }
    });

    this.io.on('connection', (socket: AuthedSocket) => {
      const userId = socket.userId!;
      socket.join(`user:${userId}`);

      // ---- WebRTC signaling ----
      socket.on('call:join', ({ callId }: { callId: string }) => {
        if (!callId) return;
        const room = `call:${callId}`;
        socket.join(room);
        // Tell peers already in the room that someone arrived.
        // Convention: the EXISTING peer initiates the WebRTC offer (deterministic, avoids glare).
        socket.to(room).emit('call:peer-joined', { userId, role: socket.userRole });
      });

      socket.on('webrtc:offer', ({ callId, sdp }: { callId: string; sdp: unknown }) => {
        socket.to(`call:${callId}`).emit('webrtc:offer', { sdp, from: userId });
      });

      socket.on('webrtc:answer', ({ callId, sdp }: { callId: string; sdp: unknown }) => {
        socket.to(`call:${callId}`).emit('webrtc:answer', { sdp, from: userId });
      });

      socket.on('webrtc:ice', ({ callId, candidate }: { callId: string; candidate: unknown }) => {
        socket.to(`call:${callId}`).emit('webrtc:ice', { candidate, from: userId });
      });

      socket.on('call:leave', ({ callId }: { callId: string }) => {
        const room = `call:${callId}`;
        socket.to(room).emit('call:peer-left', { userId });
        socket.leave(room);
      });

      // ---- In-call chat (relayed via the call room) ----
      socket.on('chat:message', ({ callId, message }: { callId: string; message: string }) => {
        if (!callId || !message?.trim()) return;
        socket.to(`call:${callId}`).emit('chat:message', {
          from: userId,
          message: message.trim().slice(0, 2000),
          timestamp: new Date().toISOString(),
        });
      });

      socket.on('disconnecting', () => {
        // Notify any call rooms this socket was in
        for (const room of socket.rooms) {
          if (room.startsWith('call:')) {
            socket.to(room).emit('call:peer-left', { userId });
          }
        }
      });
    });

    logger.info('Socket.IO initialized (signaling + push)');
  }

  /** Push an event to a specific user's room (no-op if socket layer not initialized). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.io?.to(`user:${userId}`).emit(event, payload);
  }

  async close(): Promise<void> {
    if (this.io) {
      await new Promise<void>((resolve) => this.io!.close(() => resolve()));
      this.io = null;
    }
  }
}

export const SocketService = new SocketServiceImpl();
