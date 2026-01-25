// ============================================
// Farm Manager Bot - Bot Orchestrator
// Manages running bots for multiple accounts
// ============================================

import { FarmBot } from './FarmBot';
import { BotConfig } from '../types';
import { Logger } from '../utils/logger';
import { ConfigManager, AccountConfig } from '../config/ConfigManager';
import { AuthService } from '../services/AuthService';

export interface AccountBotStatus {
    accountId: string;
    accountName: string;
    enabled: boolean;
    authenticated: boolean;
    lastCycleTime: string | null;
    nextCycleTime: string | null;
    cycleCount: number;
    error: string | null;
}

export interface OrchestratorStatus {
    running: boolean;
    accounts: AccountBotStatus[];
    totalCycles: number;
    startedAt: string | null;
}

interface AccountSession {
    accountId: string;
    config: BotConfig;
    bot: FarmBot;
    lastCycle: Date | null;
    nextCycle: Date | null;
    cycleCount: number;
    error: string | null;
}

export class BotOrchestrator {
    private logger: Logger;
    private sessions: Map<string, AccountSession> = new Map();
    private isRunning: boolean = false;
    private mainLoopTimeout: NodeJS.Timeout | null = null;
    private startedAt: Date | null = null;
    private totalCycles: number = 0;

    constructor() {
        this.logger = new Logger('Orchestrator');
    }

    /**
     * Start the orchestrator - authenticates all enabled accounts and begins cycling
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('Orchestrator is already running');
            return;
        }

        this.logger.info('🚀 Starting Bot Orchestrator...');
        this.isRunning = true;
        this.startedAt = new Date();
        this.totalCycles = 0;

        // Get all enabled accounts
        const accounts = ConfigManager.getAccounts().filter(acc => acc.enabled);

        if (accounts.length === 0) {
            this.logger.warn('No enabled accounts found!');
            this.isRunning = false;
            return;
        }

        this.logger.info(`Found ${accounts.length} enabled account(s)`);

        // Authenticate all accounts
        for (const account of accounts) {
            await this.authenticateAndSetupAccount(account);
        }

        const authenticatedCount = this.sessions.size;
        if (authenticatedCount === 0) {
            this.logger.error('No accounts could be authenticated!');
            this.isRunning = false;
            return;
        }

        this.logger.success(`${authenticatedCount} account(s) authenticated successfully`);

        // Start the main loop
        this.runMainLoop();
    }

    /**
     * Stop the orchestrator
     */
    stop(): void {
        this.logger.info('⏹️ Stopping Bot Orchestrator...');
        this.isRunning = false;

        if (this.mainLoopTimeout) {
            clearTimeout(this.mainLoopTimeout);
            this.mainLoopTimeout = null;
        }

        // Stop all bots
        for (const [accountId, session] of this.sessions) {
            this.logger.info(`Stopping bot for account: ${session.bot['config']?.accountName || accountId}`);
        }

        this.sessions.clear();
        this.startedAt = null;
        this.logger.success('Orchestrator stopped.');
    }

    /**
     * Get current status of the orchestrator
     */
    getStatus(): OrchestratorStatus {
        const accounts: AccountBotStatus[] = [];

        // Get all accounts from config
        const allAccounts = ConfigManager.getAccounts();

        for (const account of allAccounts) {
            const session = this.sessions.get(account.id);

            accounts.push({
                accountId: account.id,
                accountName: account.name,
                enabled: account.enabled,
                authenticated: session !== undefined,
                lastCycleTime: session?.lastCycle?.toISOString() || null,
                nextCycleTime: session?.nextCycle?.toISOString() || null,
                cycleCount: session?.cycleCount || 0,
                error: session?.error || null
            });
        }

        return {
            running: this.isRunning,
            accounts,
            totalCycles: this.totalCycles,
            startedAt: this.startedAt?.toISOString() || null
        };
    }

    /**
     * Authenticate an account and set up its bot
     */
    private async authenticateAndSetupAccount(account: AccountConfig): Promise<boolean> {
        this.logger.info(`Authenticating account: ${account.name}...`);

        try {
            const config = await this.authenticateAccount(account);

            if (!config) {
                this.logger.error(`Failed to authenticate account: ${account.name}`);
                return false;
            }

            // Create bot instance for this account
            const bot = new FarmBot(config);

            this.sessions.set(account.id, {
                accountId: account.id,
                config,
                bot,
                lastCycle: null,
                nextCycle: new Date(), // Run immediately
                cycleCount: 0,
                error: null
            });

            ConfigManager.markAccountUsed(account.id);
            this.logger.success(`Account authenticated: ${account.name}`);
            return true;
        } catch (error) {
            this.logger.error(`Error authenticating account ${account.name}`, error as Error);
            return false;
        }
    }

    /**
     * Authenticate an account and return BotConfig
     */
    private async authenticateAccount(account: AccountConfig): Promise<BotConfig | null> {
        const { auth, settings } = account;
        let phpSessionId: string | undefined;
        let savedAccessToken: string | undefined;

        const authService = new AuthService();

        try {
            switch (auth.type) {
                case 'email':
                    if (!auth.email || !auth.password) {
                        this.logger.error('Email authentication requires email and password');
                        return null;
                    }
                    this.logger.info(`Logging in with email: ${auth.email}...`);
                    phpSessionId = await authService.login(auth.email, auth.password);
                    break;

                case 'androidToken':
                    if (!auth.androidToken) {
                        this.logger.error('Android token authentication requires androidToken');
                        return null;
                    }
                    this.logger.info('Logging in with Android token...');
                    phpSessionId = await authService.loginWithAndroidToken(auth.androidToken);
                    savedAccessToken = auth.androidToken;
                    break;

                case 'session':
                    if (!auth.sessionId) {
                        this.logger.error('Session authentication requires sessionId');
                        return null;
                    }
                    this.logger.info('Using manual session ID...');
                    phpSessionId = auth.sessionId;
                    break;

                case 'guest':
                    this.logger.info('Creating new guest account...');
                    const result = await authService.registerGuestAndLogin();
                    phpSessionId = result.phpSessionId;
                    savedAccessToken = result.accessToken;
                    this.logger.info(`New account created! User ID: ${result.userId}`);

                    // Update the account with the new token
                    ConfigManager.updateAccount(account.id, {
                        auth: {
                            ...auth,
                            type: 'androidToken',
                            androidToken: result.accessToken
                        }
                    });
                    this.logger.info('Account updated with new access token');
                    break;

                default:
                    this.logger.error(`Unknown auth type: ${auth.type}`);
                    return null;
            }
        } catch (error) {
            this.logger.error(`Authentication failed for account ${account.name}`, error as Error);
            return null;
        }

        return {
            phpSessionId,
            accountId: account.id,
            accountName: account.name,
            credentials: auth.type === 'email' && auth.email && auth.password
                ? { email: auth.email, password: auth.password }
                : undefined,
            androidToken: savedAccessToken,
            checkIntervalMinMs: settings.checkIntervalMinMs,
            checkIntervalMaxMs: settings.checkIntervalMaxMs,
            pauseAtNight: settings.pauseAtNight,
            siloSellThreshold: settings.siloSellThreshold,
            disableMaxTaskDuration: settings.disableMaxTaskDuration,
            debug: settings.debug,
            maxTractorsPerOp: settings.maxTractorsPerOp,
            maxIdleTimeMinutes: settings.maxIdleTimeMinutes,
            forceSeedName: settings.forceSeedName,
        };
    }

    /**
     * Main loop that cycles through all accounts
     */
    private async runMainLoop(): Promise<void> {
        if (!this.isRunning) return;

        const now = new Date();

        // Find accounts that need to run their cycle
        for (const [accountId, session] of this.sessions) {
            if (!this.isRunning) break;

            // Check if it's time for this account's cycle
            if (session.nextCycle && now >= session.nextCycle) {
                await this.runAccountCycle(accountId, session);
            }
        }

        // Schedule next check (check every 10 seconds for any account that needs to run)
        if (this.isRunning) {
            this.mainLoopTimeout = setTimeout(() => this.runMainLoop(), 10000);
        }
    }

    /**
     * Run a cycle for a specific account
     */
    private async runAccountCycle(accountId: string, session: AccountSession): Promise<void> {
        const accountName = session.config.accountName || accountId;

        this.logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        this.logger.info(`🔄 Running cycle for account: ${accountName}`);

        try {
            // Run the bot cycle
            await session.bot.runCycle();

            session.lastCycle = new Date();
            session.cycleCount++;
            session.error = null;
            this.totalCycles++;

            // Calculate next cycle time based on account settings
            const minInterval = session.config.checkIntervalMinMs;
            const maxInterval = session.config.checkIntervalMaxMs;
            const nextInterval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;

            session.nextCycle = new Date(Date.now() + nextInterval);

            this.logger.info(`✅ Cycle complete for ${accountName}. Next cycle in ${Math.round(nextInterval / 1000)}s`);

        } catch (error) {
            session.error = (error as Error).message;
            session.lastCycle = new Date();

            // Still schedule next cycle even on error
            const retryInterval = 60000; // Retry in 1 minute on error
            session.nextCycle = new Date(Date.now() + retryInterval);

            this.logger.error(`Error in cycle for ${accountName}`, error as Error);
            this.logger.info(`Will retry in ${retryInterval / 1000}s`);
        }
    }

    /**
     * Add a new account to the running orchestrator
     */
    async addAccount(accountId: string): Promise<boolean> {
        if (this.sessions.has(accountId)) {
            this.logger.warn(`Account ${accountId} is already active`);
            return false;
        }

        const account = ConfigManager.getAccount(accountId);
        if (!account) {
            this.logger.error(`Account ${accountId} not found`);
            return false;
        }

        if (!account.enabled) {
            this.logger.warn(`Account ${accountId} is not enabled`);
            return false;
        }

        return await this.authenticateAndSetupAccount(account);
    }

    /**
     * Remove an account from the running orchestrator
     */
    removeAccount(accountId: string): boolean {
        const session = this.sessions.get(accountId);
        if (!session) {
            return false;
        }

        this.sessions.delete(accountId);
        this.logger.info(`Removed account ${accountId} from orchestrator`);
        return true;
    }

    /**
     * Check if the orchestrator is running
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Get the API client for a specific account (for debug endpoints)
     */
    getApiClientForAccount(accountId: string): any {
        const session = this.sessions.get(accountId);
        if (session) {
            return (session.bot as any).api;
        }
        return null;
    }
}

// Export singleton instance
export const orchestrator = new BotOrchestrator();
