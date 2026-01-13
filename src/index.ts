// ============================================
// Farm Manager Bot - Entry Point
// ============================================

import 'dotenv/config';
import { FarmBot } from './bot/FarmBot';
import { BotConfig } from './types';
import { Logger } from './utils/logger';
import { AuthService } from './services/AuthService';

const logger = new Logger('Main');

// Carregar configuração do ambiente
async function loadConfig(): Promise<BotConfig> {
    const email = process.env.FARM_EMAIL;
    const password = process.env.FARM_PASSWORD;
    const androidToken = process.env.ANDROID_ACCESS_TOKEN;
    const manualSessionId = process.env.PHPSESSID;
    const createNewGuest = process.env.CREATE_NEW_GUEST === 'true';

    let phpSessionId: string | undefined;
    let savedAccessToken: string | undefined;

    // Prioridade: 1) login email/senha, 2) Android token, 3) sessão manual, 4) criar nova conta guest
    if (email && password) {
        const authService = new AuthService();
        try {
            phpSessionId = await authService.login(email, password);
        } catch (error) {
            logger.error('Falha no login automático', error as Error);
            process.exit(1);
        }
    } else if (androidToken) {
        const authService = new AuthService();
        try {
            logger.info('🤖 Tentando login via Android token...');
            phpSessionId = await authService.loginWithAndroidToken(androidToken);
            savedAccessToken = androidToken;
        } catch (error) {
            logger.error('Falha no login via Android token', error as Error);
            process.exit(1);
        }
    } else if (manualSessionId) {
        logger.info('📋 Usando PHPSESSID manual do .env');
        phpSessionId = manualSessionId;
    } else if (createNewGuest) {
        const authService = new AuthService();
        try {
            logger.info('🆕 Criando nova conta guest...');
            const result = await authService.registerGuestAndLogin();
            phpSessionId = result.phpSessionId;
            savedAccessToken = result.accessToken;
            logger.info(`🎮 Nova conta criada! User ID: ${result.userId}`);
            logger.info(`💾 Guarde o token para uso futuro: ${result.accessToken}`);
        } catch (error) {
            logger.error('Falha ao criar conta guest', error as Error);
            process.exit(1);
        }
    } else {
        logger.error('❌ Nenhuma credencial configurada!');
        logger.error('Opções disponíveis:');
        logger.error('  1. FARM_EMAIL + FARM_PASSWORD (login com conta)');
        logger.error('  2. ANDROID_ACCESS_TOKEN (token do app Android)');
        logger.error('  3. PHPSESSID (sessão manual)');
        logger.error('  4. CREATE_NEW_GUEST=true (criar nova conta automaticamente)');
        process.exit(1);
    }

    return {
        phpSessionId,
        credentials: email && password ? { email, password } : undefined,
        androidToken: savedAccessToken, // Guardar para possível re-autenticação
        checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || '120000', 10),
        siloSellThreshold: parseInt(process.env.SILO_SELL_THRESHOLD || '80', 10),
        debug: process.env.DEBUG === 'true',
        maxTractorsPerOp: parseInt(process.env.MAX_TRACTORS_PER_OP || '4', 10),
        maxIdleTimeMinutes: parseInt(process.env.MAX_IDLE_TIME_MINUTES || '30', 10),
    };
}

// Função principal
async function main(): Promise<void> {
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('   🌾 Farm Manager Bot v1.0.0');
    logger.info('   Automatizando suas fazendas com inteligência!');
    logger.info('═══════════════════════════════════════════════════════');

    const config = await loadConfig();
    logger.info(`Debug mode: ${config.debug ? 'ON' : 'OFF'}`);

    const bot = new FarmBot(config);

    // Graceful shutdown
    const shutdown = () => {
        logger.info('\n📴 Recebido sinal de encerramento...');
        bot.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        await bot.start();
    } catch (error) {
        logger.error('Erro fatal ao iniciar bot', error as Error);
        process.exit(1);
    }
}

// Executar
main().catch((error) => {
    logger.error('Erro não tratado', error);
    process.exit(1);
});
