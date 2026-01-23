// ============================================
// Farm Manager Bot - Entry Point
// ============================================

import 'dotenv/config';
import * as readline from 'readline';
import { FarmBot } from './bot/FarmBot';
import { BotConfig } from './types';
import { Logger } from './utils/logger';
import { AuthService } from './services/AuthService';

const logger = new Logger('Main');
let currentBot: FarmBot | null = null;
let rl: readline.Interface | null = null;

// Display menu options
function displayMenu(): void {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('   🌾 Farm Manager Bot v1.0.0');
    console.log('   Automating your farms with intelligence!');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('Please select an option:');
    console.log('  1. Test Authentication');
    console.log('  2. Run Bot');
    console.log('  3. Get Crop Data');
    console.log('  4. Exit');
    console.log('');
}

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
            logger.info('🤖 Attempting login via Android token...');
            phpSessionId = await authService.loginWithAndroidToken(androidToken);
            savedAccessToken = androidToken;
        } catch (error) {
            logger.error('Login via Android token failed', error as Error);
            return null;
        }
    } else if (manualSessionId) {
        logger.info('📋 Using manual PHPSESSID from .env');
        phpSessionId = manualSessionId;
    } else if (createNewGuest) {
        const authService = new AuthService();
        try {
            logger.info('🆕 Creating new guest account...');
            const result = await authService.registerGuestAndLogin();
            phpSessionId = result.phpSessionId;
            savedAccessToken = result.accessToken;
            logger.info(`🎮 New account created! User ID: ${result.userId}`);
            logger.info(`💾 Save the token for future use: ${result.accessToken}`);
        } catch (error) {
            logger.error('Failed to create guest account', error as Error);
            return null;
        }
    } else {
        logger.error('❌ No credentials configured!');
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
        androidToken: savedAccessToken, // Save for possible re-authentication
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

// Test authentication
async function testAuthentication(): Promise<void> {
    logger.info('🔐 Testing authentication...\n');
    
    const config = await loadConfig();
    
    if (!config || !config.phpSessionId) {
        logger.error('❌ Authentication failed - no valid session obtained');
        return;
    }
    
    logger.success('✅ Authentication successful!');
    logger.info(`Session ID: ${config.phpSessionId.substring(0, 8)}...`);
    
    if (config.androidToken) {
        logger.info(`Android Token: ${config.androidToken.substring(0, 20)}...`);
    }
    
    if (config.credentials) {
        logger.info(`Logged in with email: ${config.credentials.email}`);
    }
    
    logger.info('\n✅ Authentication test completed');
}


// Get Crop Data
async function getCropData(): Promise<void> {
    
    const config = await loadConfig();
    
    if (!config || !config.phpSessionId) {
        logger.error('❌ Cannot test seeding - authentication failed');
        return;
    }
    
    logger.info(`Debug mode: ${config.debug ? 'ON' : 'OFF'}`);
    
    const bot = new FarmBot(config);
    
    try {
        await bot.getCropData();
    } catch (error) {
        logger.error('Error getting crop data', error as Error);
    }
}

// Run bot
async function runBot(): Promise<void> {
    logger.info('🚀 Starting Farm Manager Bot...\n');
    
    const config = await loadConfig();
    
    if (!config || !config.phpSessionId) {
        logger.error('❌ Cannot start bot - authentication failed');
        return;
    }
    
    logger.info(`Debug mode: ${config.debug ? 'ON' : 'OFF'}`);
    
    // Pause readline interface while bot is running
    if (rl) {
        rl.pause();
    }
    
    currentBot = new FarmBot(config);
    
    // Graceful shutdown handler for bot
    const shutdown = () => {
        logger.info('\n📴 Received shutdown signal...');
        if (currentBot) {
            currentBot.stop();
            currentBot = null;
        }
        logger.info('Bot stopped. Returning to menu...\n');
        
        // Resume readline interface
        if (rl) {
            rl.resume();
        }
        
        showMenu();
    };
    
    // Remove any existing handlers
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    
    // Set new handlers
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    
    try {
        await currentBot.start();
    } catch (error) {
        logger.error('Fatal error starting bot', error as Error);
        currentBot = null;
        
        // Resume readline interface on error
        if (rl) {
            rl.resume();
        }
    }
}

// Handle menu selection
async function handleMenuSelection(choice: string): Promise<void> {
    const trimmedChoice = choice.trim();
    
    switch (trimmedChoice) {
        case '1':
            await testAuthentication();
            showMenu();
            break;
        case '2':
            await runBot();
            showMenu();
            break;
        case '3':
            await getCropData();
        case '4':
            logger.info('👋 Goodbye!');
            if (rl) {
                rl.close();
            }
            process.exit(0);
            break;
        default:
            logger.warn(`Invalid option: ${trimmedChoice}`);
            logger.info('Please select 1, 2, 3, or 4');
            showMenu();
            break;
    }
}

// Show menu and wait for input
function showMenu(): void {
    if (!rl) {
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    }
    
    displayMenu();
    
    rl.question('Enter your choice: ', async (answer) => {
        await handleMenuSelection(answer);
    });
}

// Main function
async function main(): Promise<void> {
    // Show menu on startup
    showMenu();
}

// Execute
main().catch((error) => {
    logger.error('Unhandled error', error);
    if (rl) {
        rl.close();
    }
    process.exit(1);
});
