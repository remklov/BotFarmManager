// ============================================
// Farm Manager Bot - Logger Utility
// ============================================

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

export interface LogEntry {
    timestamp: string;
    prefix: string;
    level: string;
    message: string;
}

// Global log buffer for web interface
const LOG_BUFFER_SIZE = 200;
const logBuffer: LogEntry[] = [];

export function getLogBuffer(): LogEntry[] {
    return [...logBuffer];
}

export function clearLogBuffer(): void {
    logBuffer.length = 0;
}

function addToBuffer(entry: LogEntry): void {
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_SIZE) {
        logBuffer.shift();
    }
}

export class Logger {
    private debug: boolean;
    private prefix: string;

    constructor(prefix: string = 'FarmBot', debug: boolean = false) {
        this.prefix = prefix;
        this.debug = debug;
    }

    private formatTime(): string {
        return new Date().toISOString();
    }

    private formatMessage(level: string, message: string): string {
        return `[${this.formatTime()}] [${this.prefix}] [${level}] ${message}`;
    }

    private logAndBuffer(level: string, message: string, consoleMethod: 'log' | 'warn' | 'error' = 'log'): void {
        const timestamp = this.formatTime();
        const formatted = `[${timestamp}] [${this.prefix}] [${level}] ${message}`;
        console[consoleMethod](formatted);
        addToBuffer({ timestamp, prefix: this.prefix, level, message });
    }

    log(message: string): void {
        this.logAndBuffer('INFO', message);
    }

    info(message: string): void {
        this.logAndBuffer('INFO', message);
    }

    warn(message: string): void {
        this.logAndBuffer('WARN', message, 'warn');
    }

    error(message: string, error?: Error): void {
        this.logAndBuffer('ERROR', message, 'error');
        if (error) {
            console.error(error.stack || error.message);
            addToBuffer({ timestamp: this.formatTime(), prefix: this.prefix, level: 'ERROR', message: error.stack || error.message });
        }
    }

    debugLog(message: string): void {
        if (this.debug) {
            this.logAndBuffer('DEBUG', message);
        }
    }

    success(message: string): void {
        this.logAndBuffer('SUCCESS', message);
    }

    task(message: string): void {
        this.logAndBuffer('TASK', message);
    }

    silo(message: string): void {
        this.logAndBuffer('SILO', message);
    }

    market(message: string): void {
        this.logAndBuffer('MARKET', message);
    }

    fuel(message: string): void {
        this.logAndBuffer('FUEL', message);
    }
}

export const logger = new Logger();
