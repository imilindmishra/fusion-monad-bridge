/**
 * Logger utility for the Fusion Monad Bridge backend services
 */
export class Logger {
    private context: string;
    private colors = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m'
    };

    constructor(context: string) {
        this.context = context;
    }

    /**
     * Log info level message
     */
    info(message: string, ...args: any[]): void {
        this.log('INFO', message, this.colors.green, args);
    }

    /**
     * Log debug level message
     */
    debug(message: string, ...args: any[]): void {
        if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV === 'development') {
            this.log('DEBUG', message, this.colors.cyan, args);
        }
    }

    /**
     * Log warning level message
     */
    warn(message: string, ...args: any[]): void {
        this.log('WARN', message, this.colors.yellow, args);
    }

    /**
     * Log error level message
     */
    error(message: string, error?: any, ...args: any[]): void {
        let fullMessage = message;
        if (error) {
            if (error instanceof Error) {
                fullMessage += ` - ${error.message}`;
                if (process.env.NODE_ENV === 'development' && error.stack) {
                    fullMessage += `\nStack: ${error.stack}`;
                }
            } else {
                fullMessage += ` - ${JSON.stringify(error)}`;
            }
        }
        this.log('ERROR', fullMessage, this.colors.red, args);
    }

    /**
     * Core logging method
     */
    private log(level: string, message: string, color: string, args: any[]): void {
        const timestamp = new Date().toISOString();
        const prefix = `${color}[${timestamp}] [${level}] [${this.context}]${this.colors.reset}`;
        
        if (args.length > 0) {
            console.log(`${prefix} ${message}`, ...args);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }

    /**
     * Create a child logger with additional context
     */
    child(additionalContext: string): Logger {
        return new Logger(`${this.context}:${additionalContext}`);
    }

    /**
     * Log structured data
     */
    structured(level: 'info' | 'debug' | 'warn' | 'error', data: object): void {
        const timestamp = new Date().toISOString();
        const structuredLog = {
            timestamp,
            level: level.toUpperCase(),
            context: this.context,
            ...data
        };

        const color = this.getColorForLevel(level);
        console.log(`${color}${JSON.stringify(structuredLog, null, 2)}${this.colors.reset}`);
    }

    /**
     * Get color for log level
     */
    private getColorForLevel(level: string): string {
        switch (level) {
            case 'info': return this.colors.green;
            case 'debug': return this.colors.cyan;
            case 'warn': return this.colors.yellow;
            case 'error': return this.colors.red;
            default: return this.colors.reset;
        }
    }

    /**
     * Time a function execution
     */
    async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
        const start = Date.now();
        this.debug(`Starting: ${label}`);
        
        try {
            const result = await fn();
            const duration = Date.now() - start;
            this.debug(`Completed: ${label} (${duration}ms)`);
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            this.error(`Failed: ${label} (${duration}ms)`, error);
            throw error;
        }
    }

    /**
     * Log performance metrics
     */
    metrics(operation: string, metrics: {
        duration?: number;
        gasUsed?: string;
        blockNumber?: number;
        transactionHash?: string;
        [key: string]: any;
    }): void {
        this.structured('info', {
            type: 'metrics',
            operation,
            ...metrics
        });
    }
}
