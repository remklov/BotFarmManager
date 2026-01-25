// ============================================
// Farm Manager Bot - Configuration Manager
// ============================================

import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/logger';

const logger = new Logger('ConfigManager');

// ============================================
// Configuration Types
// ============================================

export type AuthType = 'androidToken' | 'email' | 'session' | 'guest';

export interface AccountAuth {
    type: AuthType;
    androidToken?: string;
    email?: string;
    password?: string;
    sessionId?: string;
}

export interface AccountSettings {
    checkIntervalMinMs: number;
    checkIntervalMaxMs: number;
    pauseAtNight: boolean;
    siloSellThreshold: number;
    disableMaxTaskDuration: boolean;
    debug: boolean;
    maxTractorsPerOp: number;
    maxIdleTimeMinutes: number;
    forceSeedName?: string;
}

export interface AccountConfig {
    id: string;
    name: string;
    enabled: boolean;
    auth: AccountAuth;
    settings: AccountSettings;
    lastUsed?: string;
}

export interface GlobalSettings {
    port: number;
}

export interface AppConfig {
    version: string;
    activeAccountId: string | null;
    accounts: Record<string, AccountConfig>;
    globalSettings: GlobalSettings;
}

// ============================================
// Default Values
// ============================================

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
    checkIntervalMinMs: 120000,
    checkIntervalMaxMs: 300000,
    pauseAtNight: false,
    siloSellThreshold: 90,
    disableMaxTaskDuration: false,
    debug: false,
    maxTractorsPerOp: 4,
    maxIdleTimeMinutes: 30,
    forceSeedName: undefined
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
    port: 3000
};

const CONFIG_FILE = path.join(process.cwd(), 'config.json');
const CONFIG_VERSION = '1.0.0';

// ============================================
// Configuration Manager
// ============================================

class ConfigManagerClass {
    private config: AppConfig;
    private configPath: string;

    constructor() {
        this.configPath = CONFIG_FILE;
        this.config = this.loadConfig();
    }

    /**
     * Load configuration from file or create default
     */
    private loadConfig(): AppConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                const parsed = JSON.parse(data) as AppConfig;

                // Ensure all required fields exist
                if (!parsed.accounts) parsed.accounts = {};
                if (!parsed.globalSettings) parsed.globalSettings = { ...DEFAULT_GLOBAL_SETTINGS };
                if (!parsed.version) parsed.version = CONFIG_VERSION;

                logger.info(`Loaded configuration with ${Object.keys(parsed.accounts).length} account(s)`);
                return parsed;
            }
        } catch (error) {
            logger.warn(`Could not load config file, creating default: ${(error as Error).message}`);
        }

        // Return default config
        return {
            version: CONFIG_VERSION,
            activeAccountId: null,
            accounts: {},
            globalSettings: { ...DEFAULT_GLOBAL_SETTINGS }
        };
    }

    /**
     * Save configuration to file
     */
    saveConfig(): void {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
            logger.debugLog('Configuration saved');
        } catch (error) {
            logger.error('Failed to save configuration', error as Error);
            throw error;
        }
    }

    /**
     * Get the full configuration
     */
    getConfig(): AppConfig {
        return this.config;
    }

    /**
     * Get global settings
     */
    getGlobalSettings(): GlobalSettings {
        return this.config.globalSettings;
    }

    /**
     * Update global settings
     */
    updateGlobalSettings(settings: Partial<GlobalSettings>): GlobalSettings {
        this.config.globalSettings = {
            ...this.config.globalSettings,
            ...settings
        };
        this.saveConfig();
        return this.config.globalSettings;
    }

    /**
     * Get all accounts
     */
    getAccounts(): AccountConfig[] {
        return Object.values(this.config.accounts);
    }

    /**
     * Get account by ID
     */
    getAccount(accountId: string): AccountConfig | null {
        return this.config.accounts[accountId] || null;
    }

    /**
     * Get active account
     */
    getActiveAccount(): AccountConfig | null {
        if (!this.config.activeAccountId) return null;
        return this.config.accounts[this.config.activeAccountId] || null;
    }

    /**
     * Set active account
     */
    setActiveAccount(accountId: string | null): void {
        if (accountId && !this.config.accounts[accountId]) {
            throw new Error(`Account ${accountId} not found`);
        }
        this.config.activeAccountId = accountId;
        this.saveConfig();
        logger.info(`Active account set to: ${accountId || 'none'}`);
    }

    /**
     * Generate a unique account ID
     */
    private generateAccountId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `acc_${timestamp}_${random}`;
    }

    /**
     * Create a new account
     */
    createAccount(name: string, auth: AccountAuth, settings?: Partial<AccountSettings>): AccountConfig {
        const id = this.generateAccountId();

        const account: AccountConfig = {
            id,
            name,
            enabled: true,
            auth,
            settings: {
                ...DEFAULT_ACCOUNT_SETTINGS,
                ...settings
            }
        };

        this.config.accounts[id] = account;

        // If this is the first account, make it active
        if (Object.keys(this.config.accounts).length === 1) {
            this.config.activeAccountId = id;
        }

        this.saveConfig();
        logger.info(`Created new account: ${name} (${id})`);
        return account;
    }

    /**
     * Update an existing account
     */
    updateAccount(accountId: string, updates: Partial<Omit<AccountConfig, 'id'>>): AccountConfig {
        const account = this.config.accounts[accountId];
        if (!account) {
            throw new Error(`Account ${accountId} not found`);
        }

        // Merge updates
        if (updates.name !== undefined) account.name = updates.name;
        if (updates.enabled !== undefined) account.enabled = updates.enabled;
        if (updates.auth) {
            // Only update auth fields that have actual values (not undefined/empty)
            // This prevents overwriting existing credentials with empty values
            const authUpdates: Partial<AccountAuth> = { type: updates.auth.type };
            if (updates.auth.androidToken) authUpdates.androidToken = updates.auth.androidToken;
            if (updates.auth.email) authUpdates.email = updates.auth.email;
            if (updates.auth.password) authUpdates.password = updates.auth.password;
            if (updates.auth.sessionId) authUpdates.sessionId = updates.auth.sessionId;
            account.auth = { ...account.auth, ...authUpdates };
        }
        if (updates.settings) {
            account.settings = { ...account.settings, ...updates.settings };
        }

        this.saveConfig();
        logger.info(`Updated account: ${account.name} (${accountId})`);
        return account;
    }

    /**
     * Delete an account
     */
    deleteAccount(accountId: string): void {
        if (!this.config.accounts[accountId]) {
            throw new Error(`Account ${accountId} not found`);
        }

        const accountName = this.config.accounts[accountId].name;
        delete this.config.accounts[accountId];

        // If this was the active account, clear it
        if (this.config.activeAccountId === accountId) {
            const remainingAccounts = Object.keys(this.config.accounts);
            this.config.activeAccountId = remainingAccounts.length > 0 ? remainingAccounts[0] : null;
        }

        this.saveConfig();
        logger.info(`Deleted account: ${accountName} (${accountId})`);
    }

    /**
     * Import configuration from .env values (for migration)
     */
    importFromEnv(): AccountConfig | null {
        const androidToken = process.env.ANDROID_ACCESS_TOKEN;
        const email = process.env.FARM_EMAIL;
        const password = process.env.FARM_PASSWORD;
        const sessionId = process.env.PHPSESSID;
        const createGuest = process.env.CREATE_NEW_GUEST === 'true';

        let auth: AccountAuth | null = null;
        let name = 'Imported Account';

        if (email && password) {
            auth = { type: 'email', email, password };
            name = `Account (${email})`;
        } else if (androidToken) {
            auth = { type: 'androidToken', androidToken };
            name = 'Android Account';
        } else if (sessionId) {
            auth = { type: 'session', sessionId };
            name = 'Session Account';
        } else if (createGuest) {
            auth = { type: 'guest' };
            name = 'Guest Account';
        }

        if (!auth) {
            logger.warn('No authentication found in .env to import');
            return null;
        }

        const settings: Partial<AccountSettings> = {
            checkIntervalMinMs: parseInt(process.env.CHECK_INTERVAL_MIN_MS || '120000', 10),
            checkIntervalMaxMs: parseInt(process.env.CHECK_INTERVAL_MAX_MS || '300000', 10),
            pauseAtNight: process.env.PAUSE_AT_NIGHT === 'true',
            siloSellThreshold: parseInt(process.env.SILO_SELL_THRESHOLD || '90', 10),
            disableMaxTaskDuration: process.env.DISABLE_MAX_TASK_DURATION === 'true',
            debug: process.env.DEBUG === 'true',
            maxTractorsPerOp: parseInt(process.env.MAX_TRACTORS_PER_OP || '4', 10),
            maxIdleTimeMinutes: parseInt(process.env.MAX_IDLE_TIME_MINUTES || '30', 10),
            forceSeedName: process.env.FORCE_SEED_NAME || undefined
        };

        return this.createAccount(name, auth, settings);
    }

    /**
     * Mark account as recently used
     */
    markAccountUsed(accountId: string): void {
        const account = this.config.accounts[accountId];
        if (account) {
            account.lastUsed = new Date().toISOString();
            this.saveConfig();
        }
    }
}

// Export singleton instance
export const ConfigManager = new ConfigManagerClass();
