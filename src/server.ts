// ============================================
// Farm Manager Bot - Web Server
// ============================================

import express, { Request, Response } from 'express';
import path from 'path';
import { FarmBot } from './bot/FarmBot';
import { BotConfig } from './types';
import { Logger, getLogBuffer, clearLogBuffer } from './utils/logger';

const logger = new Logger('Server');

let currentBot: FarmBot | null = null;
let botRunning = false;
let configLoader: (() => Promise<BotConfig | null>) | null = null;

export function setConfigLoader(loader: () => Promise<BotConfig | null>): void {
    configLoader = loader;
}

export function createServer(port: number = 3000): express.Application {
    const app = express();

    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // GET /api/status - Returns bot running state
    app.get('/api/status', (_req: Request, res: Response) => {
        res.json({
            running: botRunning,
            status: botRunning ? 'Running' : 'Stopped'
        });
    });

    // GET /api/logs - Returns log buffer
    app.get('/api/logs', (req: Request, res: Response) => {
        const since = req.query.since as string | undefined;
        let logs = getLogBuffer();

        if (since) {
            logs = logs.filter(log => log.timestamp > since);
        }

        res.json({ logs });
    });

    // DELETE /api/logs - Clear log buffer
    app.delete('/api/logs', (_req: Request, res: Response) => {
        clearLogBuffer();
        res.json({ success: true });
    });

    // POST /api/start - Starts the bot
    app.post('/api/start', async (_req: Request, res: Response) => {
        if (botRunning) {
            res.status(400).json({ error: 'Bot is already running' });
            return;
        }

        if (!configLoader) {
            res.status(500).json({ error: 'Config loader not set' });
            return;
        }

        try {
            const config = await configLoader();

            if (!config || !config.phpSessionId) {
                res.status(500).json({ error: 'Authentication failed - no valid session' });
                return;
            }

            currentBot = new FarmBot(config);
            botRunning = true;

            // Start bot in background (don't await)
            currentBot.start().catch((error) => {
                logger.error('Bot error', error);
                botRunning = false;
                currentBot = null;
            });

            logger.info('Bot started via web interface');
            res.json({ success: true, message: 'Bot started' });
        } catch (error) {
            logger.error('Failed to start bot', error as Error);
            res.status(500).json({ error: 'Failed to start bot' });
        }
    });

    // POST /api/stop - Stops the bot
    app.post('/api/stop', (_req: Request, res: Response) => {
        if (!botRunning || !currentBot) {
            res.status(400).json({ error: 'Bot is not running' });
            return;
        }

        try {
            currentBot.stop();
            currentBot = null;
            botRunning = false;

            logger.info('Bot stopped via web interface');
            res.json({ success: true, message: 'Bot stopped' });
        } catch (error) {
            logger.error('Failed to stop bot', error as Error);
            res.status(500).json({ error: 'Failed to stop bot' });
        }
    });

    // Start the server
    app.listen(port, () => {
        logger.info(`Web server running at http://localhost:${port}`);
    });

    return app;
}

// Graceful shutdown helper
export function stopBot(): void {
    if (currentBot) {
        currentBot.stop();
        currentBot = null;
        botRunning = false;
    }
}
