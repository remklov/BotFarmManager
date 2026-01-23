// ============================================
// Farm Manager Bot - Entry Point
// ============================================

import 'dotenv/config';
import { BotConfig } from './types';
import { Logger } from './utils/logger';
import { AuthService } from './services/AuthService';
import { createServer, setConfigLoader, stopBot } from './server';

const logger = new Logger('Main');

// Load environment configuration
async function loadConfig(): Promise<BotConfig | null> {
    const email = process.env.FARM_EMAIL;
    const password = process.env.FARM_PASSWORD;
    const androidToken = process.env.ANDROID_ACCESS_TOKEN;
    const manualSessionId = process.env.PHPSESSID;
    const createNewGuest = process.env.CREATE_NEW_GUEST === 'true';
    const forceSeedName = process.env.FORCE_SEED_NAME;

    let phpSessionId: string | undefined;
    let savedAccessToken: string | undefined;

    // Priority: 1) email/password login, 2) Android token, 3) manual session, 4) create new guest account
    if (email && password) {
        const authService = new AuthService();
        try {
            phpSessionId = await authService.login(email, password);
        } catch (error) {
            logger.error('Automatic login failed', error as Error);
            return null;
        }
    } else if (androidToken) {
        const authService = new AuthService();
        try {
            logger.info('Attempting login via Android token...');
            phpSessionId = await authService.loginWithAndroidToken(androidToken);
            savedAccessToken = androidToken;
        } catch (error) {
            logger.error('Login via Android token failed', error as Error);
            return null;
        }
    } else if (manualSessionId) {
        logger.info('Using manual PHPSESSID from .env');
        phpSessionId = manualSessionId;
    } else if (createNewGuest) {
        const authService = new AuthService();
        try {
            logger.info('Creating new guest account...');
            const result = await authService.registerGuestAndLogin();
            phpSessionId = result.phpSessionId;
            savedAccessToken = result.accessToken;
            logger.info(`New account created! User ID: ${result.userId}`);
            logger.info(`Save the token for future use: ${result.accessToken}`);
        } catch (error) {
            logger.error('Failed to create guest account', error as Error);
            return null;
        }
    } else {
        logger.error('No credentials configured!');
        logger.error('Available options:');
        logger.error('  1. FARM_EMAIL + FARM_PASSWORD (login with account)');
        logger.error('  2. ANDROID_ACCESS_TOKEN (Android app token)');
        logger.error('  3. PHPSESSID (manual session)');
        logger.error('  4. CREATE_NEW_GUEST=true (create new account automatically)');
        return null;
    }

    return {
        phpSessionId,
        credentials: email && password ? { email, password } : undefined,
        androidToken: savedAccessToken,
        checkIntervalMinMs: parseInt(process.env.CHECK_INTERVAL_MIN_MS || '120000', 10),
        checkIntervalMaxMs: parseInt(process.env.CHECK_INTERVAL_MAX_MS || '600000', 10),
        pauseAtNight: process.env.PAUSE_AT_NIGHT  === 'true',
        siloSellThreshold: parseInt(process.env.SILO_SELL_THRESHOLD || '90', 10),
        disableMaxTaskDuration: process.env.DISABLE_MAX_TASK_DURATION === 'true',
        debug: process.env.DEBUG === 'true',
        maxTractorsPerOp: parseInt(process.env.MAX_TRACTORS_PER_OP || '4', 10),
        maxIdleTimeMinutes: parseInt(process.env.MAX_IDLE_TIME_MINUTES || '30', 10),
        forceSeedName: forceSeedName || undefined,
    };
}

// Main function
async function main(): Promise<void> {
    const port = parseInt(process.env.PORT || '3000', 10);

    logger.info('Farm Manager Bot v1.0.0');
    logger.info('Starting web server...');

    // Set the config loader for the server
    setConfigLoader(loadConfig);

    // Create and start the Express server
    createServer(port);

    // Graceful shutdown handling
    const shutdown = () => {
        logger.info('Received shutdown signal...');
        stopBot();
        logger.info('Goodbye!');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// Execute
main().catch((error) => {
    logger.error('Unhandled error', error);
    process.exit(1);
});
