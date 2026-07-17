import winston from 'winston';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Logging strategy: everything goes to stdout.
 *
 * In production the platform (Render/Docker/k8s) captures stdout and owns
 * retention/shipping — writing log FILES inside the container is an
 * anti-pattern there: the disk is ephemeral, files vanish on every deploy,
 * and nothing can read them. Dev gets a colorized human format; production
 * gets structured JSON (one object per line) so log tooling can parse it.
 */

const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleTransport = new winston.transports.Console({
  format: NODE_ENV === 'production' ? productionFormat : developmentFormat,
  level: LOG_LEVEL,
});

const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports: [consoleTransport],
  // Crashes must be visible where logs are collected — stdout — not buried
  // in files on a disk that gets wiped.
  exceptionHandlers: [consoleTransport],
  rejectionHandlers: [consoleTransport],
  exitOnError: false,
});

/**
 * Stream interface for Morgan HTTP logger
 */
export const morganStream = {
  write: (message: string): void => {
    logger.info(message.trim());
  },
};

export default logger;
