// ============================================
// Farm Manager Bot - Logger Utility
// ============================================

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
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

    log(message: string): void {
        console.log(this.formatMessage('INFO', message));
    }

    info(message: string): void {
        console.log(this.formatMessage('INFO', message));
    }

    warn(message: string): void {
        console.warn(this.formatMessage('WARN', message));
    }

    error(message: string, error?: Error): void {
        console.error(this.formatMessage('ERROR', message));
        if (error) {
            console.error(error.stack || error.message);
        }
    }

    debugLog(message: string): void {
        if (this.debug) {
            console.log(this.formatMessage('DEBUG', message));
        }
    }

    success(message: string): void {
        console.log(this.formatMessage('SUCCESS', `✅ ${message}`));
    }

    task(message: string): void {
        console.log(this.formatMessage('TASK', `🚜 ${message}`));
    }

    silo(message: string): void {
        console.log(this.formatMessage('SILO', `🌾 ${message}`));
    }

    market(message: string): void {
        console.log(this.formatMessage('MARKET', `💰 ${message}`));
    }

    fuel(message: string): void {
        console.log(this.formatMessage('FUEL', `⛽ ${message}`));
    }
}

export const logger = new Logger();
