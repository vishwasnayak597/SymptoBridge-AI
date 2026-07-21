/**
 * Backend keep-alive.
 *
 * Opt-in self-ping that holds THIS service awake during active hours so users
 * don't hit a cold start. It deliberately does NOT keep the ML service warm —
 * that's woken on login (see warmUpMlService) so it only runs when needed, which
 * keeps both services inside the shared free-tier instance-hour budget.
 */

import https from 'https';
import http from 'http';

interface KeepAliveConfig {
  PING_INTERVAL: number;
  ENDPOINTS: string[];
  // Active window expressed in IST (UTC+5:30). Outside it, the backend is left to
  // sleep so it isn't burning instance-hours overnight when nobody is around.
  ACTIVE_HOURS_IST: {
    START: number; // hour, inclusive
    END: number;   // hour, exclusive
  };
  TIMEOUT: number;
}

const IST_OFFSET_MINUTES = 5 * 60 + 30; // India is UTC+5:30 year-round (no DST)

export class KeepAliveService {
  private static config: KeepAliveConfig = {
    // Render sleeps a free service after ~15 min idle; ping well inside that.
    PING_INTERVAL: (process.env.KEEP_ALIVE_INTERVAL ? parseInt(process.env.KEEP_ALIVE_INTERVAL) : 10) * 60 * 1000,
    // Backend only — self-ping our own /health to stay awake.
    ENDPOINTS: [
      process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/health`
        : 'https://symptobridge-ai.onrender.com/health'
    ],
    ACTIVE_HOURS_IST: { START: 7, END: 23 }, // 7am–11pm IST
    TIMEOUT: 15000 // 15 seconds
  };

  private static interval: NodeJS.Timeout | null = null;

  /**
   * Start the keep-alive service.
   */
  static start(): void {
    // Opt-in only. On Render's free tier the whole workspace shares a monthly
    // instance-hour budget, and free services sleep when idle to conserve it.
    // Self-pinging defeats that, so enable this only where the hours are budgeted:
    //   KEEP_ALIVE_ENABLED=true
    if (process.env.KEEP_ALIVE_ENABLED !== 'true') {
      return;
    }

    if (this.interval) {
      return;
    }

    // Initial ping
    this.pingEndpoints();

    // Set up recurring pings
    this.interval = setInterval(() => {
      this.pingEndpoints();
    }, this.config.PING_INTERVAL);
  }

  /**
   * Stop the keep-alive service.
   */
  static stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Current minute-of-day in IST, derived from UTC so it's correct regardless of
   * the host's region (Render runs this box in Singapore).
   */
  private static istMinutesOfDay(): number {
    const now = new Date();
    return (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MINUTES) % (24 * 60);
  }

  /**
   * Are we inside the active IST window? Minute-precision so the 7:00 boundary is
   * exact even though IST is offset by a half hour from UTC.
   */
  private static isActiveWindow(): boolean {
    const minutes = this.istMinutesOfDay();
    return minutes >= this.config.ACTIVE_HOURS_IST.START * 60
        && minutes < this.config.ACTIVE_HOURS_IST.END * 60;
  }

  /**
   * Ping all endpoints (only during the active window).
   */
  private static async pingEndpoints(): Promise<void> {
    if (!this.isActiveWindow()) {
      return;
    }

    await Promise.all(this.config.ENDPOINTS.map(url => this.pingSingleEndpoint(url)));
  }

  /**
   * Ping a single endpoint.
   */
  private static pingSingleEndpoint(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http;
      const timestamp = new Date().toISOString();

      const request = protocol.get(url, { timeout: this.config.TIMEOUT }, (res) => {
        const status = res.statusCode;
        // Accept 200-499 (including 401 for auth endpoints) — any response means
        // the request reached the service, which is all keep-alive needs.
        resolve(!!status && status >= 200 && status < 500);
      });

      request.on('error', (err) => {
        console.error(`❌ [${timestamp}] ${url} - ${err.message}`);
        resolve(false);
      });

      request.on('timeout', () => {
        request.destroy();
        console.error(`⏰ [${timestamp}] ${url} - Timeout`);
        resolve(false);
      });

      request.setTimeout(this.config.TIMEOUT);
    });
  }

  /**
   * Get service status (surfaced in /health).
   */
  static getStatus(): object {
    return {
      running: this.interval !== null,
      config: {
        intervalMinutes: this.config.PING_INTERVAL / 60000,
        activeHoursIST: this.config.ACTIVE_HOURS_IST,
        endpoints: this.config.ENDPOINTS.length
      },
      isActiveWindow: this.isActiveWindow()
    };
  }
}
