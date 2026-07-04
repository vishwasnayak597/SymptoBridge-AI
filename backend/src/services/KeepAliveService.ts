/**
 * Internal Keep-Alive Service
 * Runs within the existing aiDoc backend to prevent cold starts
 */

import https from 'https';
import http from 'http';

interface KeepAliveConfig {
  PING_INTERVAL: number;
  ENDPOINTS: string[];
  BUSINESS_HOURS: {
    START: number;
    END: number;
  };
  TIMEOUT: number;
}

export class KeepAliveService {
  private static config: KeepAliveConfig = {
    PING_INTERVAL: (process.env.KEEP_ALIVE_INTERVAL ? parseInt(process.env.KEEP_ALIVE_INTERVAL) : 3) * 60 * 1000, // 3 minutes default
    ENDPOINTS: [
      process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/health` : 'https://symptobridge-ai.onrender.com/health',
      process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/api/auth/me` : 'https://symptobridge-ai.onrender.com/api/auth/me',
      // Keep the ML triage service warm too, so the first triage isn't a 50s cold start
      `${process.env.ML_SERVICE_URL || 'https://symptobridge-ml.onrender.com'}/health`
    ],
    BUSINESS_HOURS: {
      START: 6,  // 6 AM UTC
      END: 23    // 11 PM UTC
    },
    TIMEOUT: 15000 // 15 seconds
  };

  private static interval: NodeJS.Timeout | null = null;

  /**
   * Start the keep-alive service
   */
  static start(): void {
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
   * Stop the keep-alive service
   */
  static stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Check if we're in business hours
   */
  private static isBusinessHours(): boolean {
    const hour = new Date().getUTCHours();
    return hour >= this.config.BUSINESS_HOURS.START && hour <= this.config.BUSINESS_HOURS.END;
  }

  /**
   * Ping all endpoints
   */
  private static async pingEndpoints(): Promise<void> {
    const timestamp = new Date().toISOString();

    if (!this.isBusinessHours()) {
      return;
    }


    const results = await Promise.all(
      this.config.ENDPOINTS.map(url => this.pingSingleEndpoint(url))
    );

    const successCount = results.filter(Boolean).length;
  }

  /**
   * Ping a single endpoint
   */
  private static pingSingleEndpoint(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http;
      const timestamp = new Date().toISOString();

      const request = protocol.get(url, { timeout: this.config.TIMEOUT }, (res) => {
        const status = res.statusCode;
        if (status && status >= 200 && status < 500) {
          // Accept 200-499 (including 401 for auth endpoints)
          resolve(true);
        } else {
          resolve(false);
        }
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
   * Get service status
   */
  static getStatus(): object {
    return {
      running: this.interval !== null,
      config: {
        intervalMinutes: this.config.PING_INTERVAL / 60000,
        businessHours: this.config.BUSINESS_HOURS,
        endpoints: this.config.ENDPOINTS.length
      },
      currentHour: new Date().getUTCHours(),
      isBusinessHours: this.isBusinessHours()
    };
  }
}
