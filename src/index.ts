// ============================================
// Farm Manager Bot - Entry Point
// ============================================

import 'dotenv/config';
import { Logger } from './utils/logger';
import { createServer, stopBot } from './server';
import { ConfigManager } from './config/ConfigManager';

const logger = new Logger('Main');

// Main function
async function main(): Promise<void> {
    const globalSettings = ConfigManager.getGlobalSettings();
    const port = parseInt(process.env.PORT || String(globalSettings.port), 10);

    logger.info('Farm Manager Bot v1.0.0 (Multi-Account)');
    logger.info('Starting web server...');

    // Check for accounts from .env if none configured
    const accounts = ConfigManager.getAccounts();
    if (accounts.length === 0) {
        logger.info('No accounts configured, checking .env for credentials...');
        const imported = ConfigManager.importFromEnv();
        if (imported) {
            logger.info(`Imported account from .env: ${imported.name}`);
        } else {
            logger.warn('No credentials found. Please configure accounts via the web interface.');
        }
    }

    // Log enabled accounts
    const enabledAccounts = ConfigManager.getAccounts().filter(a => a.enabled);
    if (enabledAccounts.length > 0) {
        logger.info(`Enabled accounts: ${enabledAccounts.map(a => a.name).join(', ')}`);
    } else {
        logger.warn('No enabled accounts. Enable accounts via the web interface to start the bot.');
    }

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
