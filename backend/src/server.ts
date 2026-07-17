
import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import path from 'path';
import mongoose from 'mongoose';

import Database from './utils/database';
import logger, { morganStream } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { KeepAliveService } from './services/KeepAliveService';
import { SocketService } from './services/SocketService';
import { startEventConsumers, stopEventConsumers } from './services/EventBus';
import { startJobWorkers, stopJobWorkers } from './services/JobQueueService';
import { getRedis, closeRedis } from './utils/redis';
import { requestId, httpMetrics, metricsHandler, vitalsHandler } from './middleware/observability';

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

async function startServer() {
  try {
    
    // Create Express app
    const app = express();

    // Behind Render's load balancer, the client IP arrives in X-Forwarded-For.
    // Trust the first proxy hop so req.ip is the real client (not the LB) — this is
    // what express-rate-limit needs to key limits correctly. '1' (not `true`) so a
    // client can't spoof the header to dodge rate limiting.
    app.set('trust proxy', 1);

    // Setup CORS - this fixes your CORS issue!
    const corsOptions = {
      origin: function (origin, callback) {
        const allowedOrigins = [
          CLIENT_URL,
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:3002',
          // New SymptoBridge AI frontend (static site + the combined service origin)
          'https://symptobridge.onrender.com',
          'https://symptobridge-ai.onrender.com',
          // Legacy origins kept so the old deployment keeps working during migration
          'https://ai-doctor-qc2b.onrender.com',
          'https://aidoc.onrender.com'
        ].filter(Boolean); // Remove any undefined values
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // Allow the explicit list, plus any of our Render deployments (*.onrender.com),
        // so renaming/adding a service never breaks CORS.
        const isRenderHost = /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin);
        if (allowedOrigins.indexOf(origin) !== -1 || isRenderHost) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With', 'Accept', 'sec-ch-ua-platform', 'Referer', 'User-Agent', 'sec-ch-ua', 'sec-ch-ua-mobile'],
      exposedHeaders: ['Set-Cookie'],
      optionsSuccessStatus: 200,
      preflightContinue: false
    };
    app.use(cors(corsOptions));
    
    // Security middleware
    app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    }));
    
    // Request parsing middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(cookieParser());
    app.use(compression());
    
    // Logging middleware
    if (NODE_ENV !== 'test') {
      app.use(morgan('combined', { stream: morganStream }));
    }

    // Observability: request IDs + Prometheus HTTP metrics
    app.use(requestId);
    app.use(httpMetrics);
    app.get('/metrics', metricsHandler);
    app.post('/api/vitals', vitalsHandler);

    // Rate limiting — Redis-backed when available so limits hold across instances;
    // falls back to the in-memory store (single-instance only) without REDIS_URL.
    const redis = getRedis();
    const globalRateLimit = rateLimit({
      windowMs: 1 * 60 * 1000,
      max: NODE_ENV === 'production' ? 300 : 10000,
      message: { success: false, error: 'Too many requests from this IP' },
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => NODE_ENV === 'development',
      ...(redis
        ? { store: new RedisStore({ sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as any, prefix: 'rl:' }) }
        : {}),
    });
    app.use('/api', globalRateLimit);
    
    // Health check route (before database connection).
    // `database` reflects the live mongoose connection state — previously it
    // was a hardcoded string, which made the admin System panel lie.
    app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        message: 'SymptoBridge AI backend is running',
        environment: NODE_ENV,
        port: PORT,
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        keepAlive: KeepAliveService.getStatus()
      });
    });
    
    // Connect to database
    await Database.connect();
    
    // Import and setup routes AFTER database connection
    try {
      const authRoutes = await import('./routes/auth');
      const aiRoutes = await import('./routes/ai');
      const appointmentRoutes = await import('./routes/appointments');
      const paymentRoutes = await import('./routes/payments');
      const notificationRoutes = await import('./routes/notifications');
      const videoCallRoutes = await import('./routes/video-calls');
      const userRoutes = await import('./routes/users');
      const medicalRecordRoutes = await import('./routes/medical-records');
      const prescriptionRoutes = await import('./routes/prescriptions');
      const reportRoutes = await import('./routes/reports');
      const adminSpecializationRoutes = await import('./routes/admin-specializations');
      const auditRoutes = await import('./routes/audit');

      app.use('/api/auth', authRoutes.default);
      app.use('/api/ai', aiRoutes.default);
      app.use('/api/appointments', appointmentRoutes.default);
      app.use('/api/payments', paymentRoutes.default);
      app.use('/api/notifications', notificationRoutes.default);
      app.use('/api/video-calls', videoCallRoutes.default);
      app.use('/api/users', userRoutes.default);
      app.use('/api/medical-records', medicalRecordRoutes.default);
      app.use('/api/prescriptions', prescriptionRoutes.default);
      app.use('/api/reports', reportRoutes.default);
      app.use('/api/admin', adminSpecializationRoutes.default);
      app.use('/api/audit', auditRoutes.default);
    } catch (routeError) {
      console.error('❌ Error loading routes:', routeError);
      throw routeError;
    }
    
    // Serve static files from frontend build (for production)
    if (NODE_ENV === 'production') {
      const frontendStaticPath = path.join(__dirname, '../../frontend/out');
      
      // Serve Next.js static assets with proper MIME types
      app.use('/_next', express.static(path.join(frontendStaticPath, '_next'), {
        setHeaders: (res, path) => {
          if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
          } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
          }
        }
      }));
      
      // Serve all static files from the out directory
      app.use('/', express.static(frontendStaticPath, {
        setHeaders: (res, path) => {
          if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
          } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
          }
        }
      }));
      
      // Handle SPA routing - serve index.html for all non-API routes
      app.get('*', (req, res) => {
        if (!req.path.startsWith('/api/')) {
          res.sendFile(path.join(frontendStaticPath, 'index.html'));
        }
      });
    }
    
    // Error handling middleware (must be last)
    app.use(notFoundHandler);
    app.use(errorHandler);
    
    // Start HTTP server with Socket.IO attached (signaling + real-time push)
    const httpServer = http.createServer(app);
    SocketService.init(httpServer);

    // Start domain-event consumers (Redis Streams groups, or in-process fallback)
    startEventConsumers();

    // Start the BullMQ job queue + worker (reminders, waitlist expiry)
    startJobWorkers();

    await new Promise<void>((resolve, reject) => {
      const server = httpServer.listen(PORT, () => {
        logger.info(`Server running on port ${PORT} in ${NODE_ENV} mode`);
        logger.info(`Health check: http://localhost:${PORT}/health`);

        // Graceful shutdown handlers
        const gracefulShutdown = (signal: string) => {
          KeepAliveService.stop();
          stopEventConsumers();
          stopJobWorkers().catch(() => {});
          SocketService.close().catch(() => {});
          server.close(() => {
            closeRedis().catch(() => {});
            Database.disconnect?.();
            process.exit(0);
          });
        };
        
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
          console.error('Uncaught Exception:', error);
          logger.error('Uncaught Exception:', error);
          gracefulShutdown('UNCAUGHT_EXCEPTION');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
          console.error('Unhandled Rejection at:', promise, 'reason:', reason);
          logger.error('Unhandled Rejection:', { reason, promise });
          gracefulShutdown('UNHANDLED_REJECTION');
        });
        
        // Start keep-alive service to prevent cold starts
        KeepAliveService.start();
        
        resolve(); // Resolve the Promise now that server is listening
      });
      
      server.on('error', (err) => {
        console.error('❌ Server error:', err);
        logger.error('Server error:', err);
        reject(err);
      });
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('Stack trace:', error.stack);
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
if (require.main === module) {
  startServer()
    .then(() => {
      // Keep the process alive - the server is now listening
    })
    .catch(error => {
      console.error('❌ Server startup failed:', error);
      process.exit(1);
    });
}

export default { startServer }; 