import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import client from 'prom-client';

/**
 * Observability middleware:
 *  - Request ID: one UUID per request, echoed in X-Request-Id and attached to req,
 *    so a single user action can be traced across services (it is also forwarded
 *    to the ML service by TriageService).
 *  - Prometheus metrics: default process metrics + an HTTP duration histogram
 *    labeled by method/route/status, exposed at GET /metrics.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// Real-user web vitals (LCP/CLS/FID/TTFB/INP), reported by the frontend's
// reportWebVitals hook. Values arrive in the metric's native unit
// (milliseconds, except CLS which is unitless) — buckets sized for ms.
const webVitals = new client.Histogram({
  name: 'web_vitals_value',
  help: 'Real-user web vitals reported by the browser',
  labelNames: ['metric'] as const,
  buckets: [0.05, 0.1, 0.25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

const ALLOWED_VITALS = new Set(['LCP', 'CLS', 'FID', 'INP', 'TTFB', 'FCP']);

export function vitalsHandler(req: Request, res: Response): void {
  const { name, value } = (req.body ?? {}) as { name?: string; value?: number };
  if (typeof name === 'string' && ALLOWED_VITALS.has(name) && typeof value === 'number' && isFinite(value)) {
    webVitals.observe({ metric: name }, value);
  }
  // Always 204 — beacons don't retry, and bad input isn't worth an error path.
  res.status(204).end();
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // Use the matched route template (low cardinality), never the raw URL.
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.baseUrl || req.path.split('/').slice(0, 3).join('/') || 'unknown';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}

export async function metricsHandler(req: Request, res: Response): Promise<void> {
  // Optional shared-secret guard so a public Render URL doesn't expose metrics to everyone.
  const token = process.env.METRICS_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}` && req.query.token !== token) {
    res.status(401).send('unauthorized');
    return;
  }
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}
