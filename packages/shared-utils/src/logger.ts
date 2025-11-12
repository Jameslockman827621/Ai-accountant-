export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  service?: string;
  tenantId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  error?: Error;
}

class Logger {
  private serviceName: string;
  private minLevel: LogLevel;

  constructor(serviceName: string, minLevel: LogLevel = LogLevel.INFO) {
    this.serviceName = serviceName;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const logLine = {
      ...entry,
      service: this.serviceName,
      timestamp: entry.timestamp.toISOString(),
      error: entry.error
        ? {
            name: entry.error.name,
            message: entry.error.message,
            stack: entry.error.stack,
          }
        : undefined,
    };

    const output = JSON.stringify(logLine);
    const consoleMethod =
      entry.level === LogLevel.ERROR
        ? console.error
        : entry.level === LogLevel.WARN
        ? console.warn
        : entry.level === LogLevel.DEBUG
        ? console.debug
        : console.log;

    consoleMethod(output);
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date(),
    };
    if (metadata) {
      entry.metadata = metadata;
    }
    this.log(entry);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level: LogLevel.INFO,
      message,
      timestamp: new Date(),
    };
    if (metadata) {
      entry.metadata = metadata;
    }
    this.log(entry);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level: LogLevel.WARN,
      message,
      timestamp: new Date(),
    };
    if (metadata) {
      entry.metadata = metadata;
    }
    this.log(entry);
  }

  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level: LogLevel.ERROR,
      message,
      timestamp: new Date(),
    };
    if (error) {
      entry.error = error;
    }
    if (metadata) {
      entry.metadata = metadata;
    }
    this.log(entry);
  }
}

export function createLogger(serviceName: string, minLevel?: LogLevel): Logger {
  return new Logger(serviceName, minLevel);
}
