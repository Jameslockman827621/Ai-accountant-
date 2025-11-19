export declare enum LogLevel {
    DEBUG = "debug",
    INFO = "info",
    WARN = "warn",
    ERROR = "error"
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
declare class Logger {
    private serviceName;
    private minLevel;
    constructor(serviceName: string, minLevel?: LogLevel);
    private shouldLog;
    private log;
    debug(message: string, metadata?: Record<string, unknown>): void;
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, error?: unknown, metadata?: Record<string, unknown>): void;
}
export declare function createLogger(serviceName: string, minLevel?: LogLevel): Logger;
export {};
//# sourceMappingURL=logger.d.ts.map