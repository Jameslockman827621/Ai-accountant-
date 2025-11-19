"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = exports.LogLevel = void 0;
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "debug";
    LogLevel["INFO"] = "info";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
class Logger {
    serviceName;
    minLevel;
    constructor(serviceName, minLevel = LogLevel.INFO) {
        this.serviceName = serviceName;
        this.minLevel = minLevel;
    }
    shouldLog(level) {
        const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
        return levels.indexOf(level) >= levels.indexOf(this.minLevel);
    }
    log(entry) {
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
        const consoleMethod = entry.level === LogLevel.ERROR
            ? console.error
            : entry.level === LogLevel.WARN
                ? console.warn
                : entry.level === LogLevel.DEBUG
                    ? console.debug
                    : console.log;
        consoleMethod(output);
    }
    debug(message, metadata) {
        const entry = {
            level: LogLevel.DEBUG,
            message,
            timestamp: new Date(),
        };
        if (metadata) {
            entry.metadata = metadata;
        }
        this.log(entry);
    }
    info(message, metadata) {
        const entry = {
            level: LogLevel.INFO,
            message,
            timestamp: new Date(),
        };
        if (metadata) {
            entry.metadata = metadata;
        }
        this.log(entry);
    }
    warn(message, metadata) {
        const entry = {
            level: LogLevel.WARN,
            message,
            timestamp: new Date(),
        };
        if (metadata) {
            entry.metadata = metadata;
        }
        this.log(entry);
    }
    error(message, error, metadata) {
        const entry = {
            level: LogLevel.ERROR,
            message,
            timestamp: new Date(),
        };
        if (error instanceof Error) {
            entry.error = error;
        }
        else if (error !== undefined && error !== null) {
            const fallback = typeof error === 'string'
                ? error
                : (() => {
                    try {
                        return JSON.stringify(error);
                    }
                    catch {
                        return String(error);
                    }
                })();
            entry.error = new Error(fallback);
        }
        if (metadata) {
            entry.metadata = metadata;
        }
        this.log(entry);
    }
}
function createLogger(serviceName, minLevel) {
    return new Logger(serviceName, minLevel);
}
exports.createLogger = createLogger;
//# sourceMappingURL=logger.js.map