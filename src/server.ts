// ============================================
// Farm Manager Bot - Web Server
// ============================================

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { FarmBot } from './bot/FarmBot';
import { ApiClient } from './api/client';
import { BotConfig } from './types';
import { Logger, getLogBuffer, clearLogBuffer } from './utils/logger';

const logger = new Logger('Server');

let currentBot: FarmBot | null = null;
let botRunning = false;
let configLoader: (() => Promise<BotConfig | null>) | null = null;
let debugApiClient: ApiClient | null = null;

const MASTER_DATA_FILE = path.join(process.cwd(), 'farm-data.json');

// Master data structure
interface FarmlandDetails {
    city: string;
    country: string;
    farmlandColor: string;
    harvestCycles: number;
    maxHarvestCycles: number;
    canIrrigate: boolean;
    isIrrigating: boolean;
    canHarvest: boolean;
    canSeed: boolean;
    canFertilize: boolean;
    canPlow: boolean;
    canClear: boolean;
    lastFetched: string;
}

interface CropData {
    id: number;
    name: string;
    type: string;
    img: string;
    kgPerHa: number;
    yieldPerHa: number;
    seedCost: number;
    unlocked: boolean;
    cropValueRating: number;
    growTime: number;
}

interface MasterFarmData {
    lastUpdated: string;
    crops: Record<string, CropData>;
    farms: Record<string, {
        id: number;
        name: string;
        countryCode: string;
        tractorCount: number;
        fields: Record<string, {
            id: number;
            farmlandId: number;
            farmlandName: string;
            area: number;
            status: string;
            opType: string | null;
            cropName: string | null;
            cropId: number | null;
            cropImg: string | null;
            pctCompleted: number | null;
            timeRemain: number | null;
            isMaturing: boolean;
            complexityIndex: number | null;
            details?: FarmlandDetails;
            configuredCropId?: number | null;
        }>;
    }>;
}

export function loadMasterData(): MasterFarmData {
    try {
        if (fs.existsSync(MASTER_DATA_FILE)) {
            const data = fs.readFileSync(MASTER_DATA_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            // Ensure crops field exists for backwards compatibility
            if (!parsed.crops) {
                parsed.crops = {};
            }
            return parsed;
        }
    } catch (error) {
        logger.warn('Could not load master data file, starting fresh');
    }
    return { lastUpdated: '', crops: {}, farms: {} };
}

export function saveMasterData(data: MasterFarmData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(MASTER_DATA_FILE, JSON.stringify(data, null, 2));
}

export function mergeFarmData(
    masterData: MasterFarmData,
    cultivatingResponse: any,
    seedingResponse: any,
    pendingResponse: any
): MasterFarmData {
    // First, extract farm names from cultivating response (master source for farm names)
    const cultivatingFarmNames: Record<string, string> = {};
    if (cultivatingResponse?.farms) {
        for (const [farmId, farm] of Object.entries(cultivatingResponse.farms) as [string, any][]) {
            if (farm.name) {
                cultivatingFarmNames[farmId] = farm.name;
            }
        }
    }

    // Process farm info from cultivating and seeding responses
    const farmInfoSources = [cultivatingResponse, seedingResponse];

    for (const response of farmInfoSources) {
        if (response?.farms) {
            for (const [farmId, farm] of Object.entries(response.farms) as [string, any][]) {
                if (!masterData.farms[farmId]) {
                    // Use cultivating response name as master, fallback to current response name
                    const farmName = cultivatingFarmNames[farmId] || farm.name || `Farm ${farmId}`;
                    masterData.farms[farmId] = {
                        id: Number(farmId),
                        name: farmName,
                        countryCode: farm.countryCode || '',
                        tractorCount: farm.tractorCount || 0,
                        fields: {}
                    };
                } else {
                    // Update farm info but only update name from cultivating response
                    if (cultivatingFarmNames[farmId]) {
                        masterData.farms[farmId].name = cultivatingFarmNames[farmId];
                    }
                    if (farm.countryCode) masterData.farms[farmId].countryCode = farm.countryCode;
                    if (farm.tractorCount) masterData.farms[farmId].tractorCount = farm.tractorCount;
                }

                // Extract fields from farmlands
                if (farm.farmlands) {
                    for (const [state, stateData] of Object.entries(farm.farmlands) as [string, any][]) {
                        if (stateData?.data) {
                            for (const [fieldKey, field] of Object.entries(stateData.data) as [string, any][]) {
                                const fieldId = String(field.farmlandId || fieldKey);
                                // Preserve existing configuredCropId and details
                                const existingField = masterData.farms[farmId].fields[fieldId];
                                masterData.farms[farmId].fields[fieldId] = {
                                    id: field.id,
                                    farmlandId: field.farmlandId,
                                    farmlandName: field.farmlandName || '',
                                    area: field.area || 0,
                                    status: state,
                                    opType: null,
                                    cropName: null,
                                    cropId: null,
                                    cropImg: null,
                                    pctCompleted: null,
                                    timeRemain: null,
                                    isMaturing: false,
                                    complexityIndex: field.complexityIndex || null,
                                    details: existingField?.details,
                                    configuredCropId: existingField?.configuredCropId
                                };
                            }
                        }
                    }
                }
            }
        }
    }

    // Then merge pending data (operating + maturing)
    if (pendingResponse?.farmlands) {
        const pendingCategories = ['operating', 'maturing'];

        for (const category of pendingCategories) {
            const farmlands = pendingResponse.farmlands[category];
            if (farmlands) {
                for (const [fieldId, field] of Object.entries(farmlands) as [string, any][]) {
                    const farmId = String(field.farmId);

                    // Ensure farm exists
                    if (!masterData.farms[farmId]) {
                        masterData.farms[farmId] = {
                            id: Number(farmId),
                            name: `Farm ${farmId}`,
                            countryCode: '',
                            tractorCount: 0,
                            fields: {}
                        };
                    }

                    // Update or create field, preserving existing configuredCropId and details
                    const existingField = masterData.farms[farmId].fields[fieldId];
                    masterData.farms[farmId].fields[fieldId] = {
                        id: field.id,
                        farmlandId: field.farmlandId,
                        farmlandName: field.farmlandName || '',
                        area: field.area || 0,
                        status: category,
                        opType: field.opType || null,
                        cropName: field.cropName || null,
                        cropId: field.cropId || null,
                        cropImg: field.cropImg || null,
                        pctCompleted: field.pctCompleted || null,
                        timeRemain: field.timeRemain || null,
                        isMaturing: field.isMaturing === 1,
                        complexityIndex: field.complexityIndex || null,
                        details: existingField?.details,
                        configuredCropId: existingField?.configuredCropId
                    };
                }
            }
        }
    }

    return masterData;
}

export function mergeCropData(masterData: MasterFarmData, marketResponse: any): MasterFarmData {
    if (marketResponse?.seed && Array.isArray(marketResponse.seed)) {
        for (const seed of marketResponse.seed) {
            masterData.crops[String(seed.id)] = {
                id: seed.id,
                name: seed.name,
                type: seed.type,
                img: seed.img,
                kgPerHa: seed.kgPerHa,
                yieldPerHa: seed.yieldPerHa,
                seedCost: seed.seedCost,
                unlocked: seed.unlocked === 1,
                cropValueRating: seed.cropValueRating,
                growTime: seed.growTime
            };
        }
    }
    return masterData;
}

export function getConfiguredCropForFarmland(farmlandId: number): number | null {
    const masterData = loadMasterData();
    for (const farm of Object.values(masterData.farms)) {
        for (const field of Object.values(farm.fields)) {
            if (field.farmlandId === farmlandId && field.configuredCropId) {
                return field.configuredCropId;
            }
        }
    }
    return null;
}

export function setConfigLoader(loader: () => Promise<BotConfig | null>): void {
    configLoader = loader;
}

export function createServer(port: number = 3000): express.Application {
    const app = express();

    app.use(express.json());
    // Serve static files from src/public (works from both src/ and dist/)
    app.use(express.static(path.join(process.cwd(), 'src', 'public')));

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

    // POST /api/debug/pending - Fetch all tab data, merge, and save to master JSON
    app.post('/api/debug/pending', async (_req: Request, res: Response) => {
        if (!configLoader) {
            res.status(500).json({ error: 'Config loader not set' });
            return;
        }

        try {
            const config = await configLoader();

            if (!config || !config.phpSessionId) {
                res.status(500).json({ error: 'No valid session available' });
                return;
            }

            // Create or reuse debug API client
            if (!debugApiClient) {
                debugApiClient = new ApiClient(config.phpSessionId, logger);
            }

            // Fetch all endpoints
            logger.info('Fetching cultivating tab data...');
            const cultivatingData = await debugApiClient.getCultivatingTab();

            logger.info('Fetching seeding tab data...');
            const seedingData = await debugApiClient.getSeedingTab();

            logger.info('Fetching pending tab data...');
            const pendingData = await debugApiClient.getPendingTab();

            logger.info('Fetching market seeds data...');
            const marketData = await debugApiClient.getMarketSeeds();

            // Load existing master data
            let masterData = loadMasterData();

            // Merge all data
            logger.info('Merging farm data...');
            masterData = mergeFarmData(masterData, cultivatingData, seedingData, pendingData);
            masterData = mergeCropData(masterData, marketData);

            // Save master data
            saveMasterData(masterData);

            // Log summary
            const farmCount = Object.keys(masterData.farms).length;
            const fieldCount = Object.values(masterData.farms).reduce(
                (sum, farm) => sum + Object.keys(farm.fields).length, 0
            );
            const cropCount = Object.keys(masterData.crops).length;
            logger.success(`Master data saved: ${farmCount} farms, ${fieldCount} fields, ${cropCount} crops`);

            res.json({
                success: true,
                filename: 'farm-data.json',
                data: masterData
            });
        } catch (error) {
            logger.error('Failed to fetch farm data', error as Error);
            res.status(500).json({ error: 'Failed to fetch farm data' });
        }
    });

    // GET /api/farms - Get current master farm data
    app.get('/api/farms', (_req: Request, res: Response) => {
        try {
            const masterData = loadMasterData();
            res.json(masterData);
        } catch (error) {
            logger.error('Failed to load farm data', error as Error);
            res.status(500).json({ error: 'Failed to load farm data' });
        }
    });

    // PUT /api/farmland/:farmlandId/config - Set crop configuration for a farmland
    app.put('/api/farmland/:farmlandId/config', (req: Request, res: Response) => {
        try {
            const farmlandId = parseInt(req.params.farmlandId, 10);
            if (isNaN(farmlandId)) {
                res.status(400).json({ error: 'Invalid farmland ID' });
                return;
            }

            const { cropId } = req.body;
            // cropId can be null to clear the configuration
            const configuredCropId = cropId === null ? null : (typeof cropId === 'number' ? cropId : parseInt(cropId, 10));

            if (cropId !== null && isNaN(configuredCropId as number)) {
                res.status(400).json({ error: 'Invalid crop ID' });
                return;
            }

            const masterData = loadMasterData();
            let found = false;

            for (const farm of Object.values(masterData.farms)) {
                for (const field of Object.values(farm.fields)) {
                    if (field.farmlandId === farmlandId) {
                        field.configuredCropId = configuredCropId;
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }

            if (!found) {
                res.status(404).json({ error: 'Farmland not found' });
                return;
            }

            saveMasterData(masterData);

            const cropName = configuredCropId ? masterData.crops[String(configuredCropId)]?.name : null;
            logger.info(`Configured farmland ${farmlandId} to use crop: ${cropName || 'auto (cleared)'}`);

            res.json({ success: true, farmlandId, configuredCropId, cropName });
        } catch (error) {
            logger.error('Failed to set farmland config', error as Error);
            res.status(500).json({ error: 'Failed to set farmland config' });
        }
    });

    // GET /api/silo - Get silo data
    app.get('/api/silo', async (_req: Request, res: Response) => {
        if (!configLoader) {
            res.status(500).json({ error: 'Config loader not set' });
            return;
        }

        try {
            const config = await configLoader();
            if (!config || !config.phpSessionId) {
                res.status(500).json({ error: 'No valid session available' });
                return;
            }

            if (!debugApiClient) {
                debugApiClient = new ApiClient(config.phpSessionId, logger);
            }

            const siloData = await debugApiClient.getSiloTab();
            res.json(siloData);
        } catch (error) {
            logger.error('Failed to fetch silo data', error as Error);
            res.status(500).json({ error: 'Failed to fetch silo data' });
        }
    });

    // POST /api/silo/sell/:cropId - Sell a product from silo
    app.post('/api/silo/sell/:cropId', async (req: Request, res: Response) => {
        if (!configLoader) {
            res.status(500).json({ error: 'Config loader not set' });
            return;
        }

        try {
            const cropId = parseInt(req.params.cropId, 10);
            if (isNaN(cropId)) {
                res.status(400).json({ error: 'Invalid crop ID' });
                return;
            }

            const config = await configLoader();
            if (!config || !config.phpSessionId) {
                res.status(500).json({ error: 'No valid session available' });
                return;
            }

            if (!debugApiClient) {
                debugApiClient = new ApiClient(config.phpSessionId, logger);
            }

            const result = await debugApiClient.sellProduct(cropId, 'all');

            if (result.success === 1) {
                logger.success(`Sold ${result.amount?.toLocaleString() || 0}kg of ${result.cropData?.name || 'product'} for $${result.income?.toLocaleString() || 0}`);
            }

            res.json(result);
        } catch (error) {
            logger.error('Failed to sell product', error as Error);
            res.status(500).json({ error: 'Failed to sell product' });
        }
    });

    // GET /api/farmland/:farmlandId/details - Get details for a specific farmland
    app.get('/api/farmland/:farmlandId/details', async (req: Request, res: Response) => {
        if (!configLoader) {
            res.status(500).json({ error: 'Config loader not set' });
            return;
        }

        try {
            const farmlandId = parseInt(req.params.farmlandId, 10);
            if (isNaN(farmlandId)) {
                res.status(400).json({ error: 'Invalid farmland ID' });
                return;
            }

            const config = await configLoader();
            if (!config || !config.phpSessionId) {
                res.status(500).json({ error: 'No valid session available' });
                return;
            }

            if (!debugApiClient) {
                debugApiClient = new ApiClient(config.phpSessionId, logger);
            }

            const details = await debugApiClient.getFarmlandDetails(farmlandId);

            // Update master data with fetched details
            const masterData = loadMasterData();
            for (const farm of Object.values(masterData.farms)) {
                for (const [fieldId, field] of Object.entries(farm.fields)) {
                    if (field.farmlandId === farmlandId) {
                        field.details = {
                            city: details.city,
                            country: details.country,
                            farmlandColor: details.farmlandColor,
                            harvestCycles: details.farmland.harvestCycles,
                            maxHarvestCycles: details.farmland.maxHarvestCycles,
                            canIrrigate: details.farmland.canIrrigate === 1,
                            isIrrigating: details.isIrrigating === 1,
                            canHarvest: details.canHarvest === 1,
                            canSeed: details.canSeed === 1,
                            canFertilize: details.canFertilize === 1,
                            canPlow: details.canPlow === 1,
                            canClear: details.canClear === 1,
                            lastFetched: new Date().toISOString()
                        };
                        break;
                    }
                }
            }
            saveMasterData(masterData);

            res.json(details);
        } catch (error) {
            logger.error('Failed to fetch farmland details', error as Error);
            res.status(500).json({ error: 'Failed to fetch farmland details' });
        }
    });

    // POST /api/farms/fetch-missing-details - Fetch details for all farmlands missing details
    app.post('/api/farms/fetch-missing-details', async (_req: Request, res: Response) => {
        if (!configLoader) {
            res.status(500).json({ error: 'Config loader not set' });
            return;
        }

        try {
            const config = await configLoader();
            if (!config || !config.phpSessionId) {
                res.status(500).json({ error: 'No valid session available' });
                return;
            }

            if (!debugApiClient) {
                debugApiClient = new ApiClient(config.phpSessionId, logger);
            }

            const masterData = loadMasterData();
            let fetchedCount = 0;

            for (const farm of Object.values(masterData.farms)) {
                for (const field of Object.values(farm.fields)) {
                    if (!field.details) {
                        try {
                            logger.info(`Fetching details for field ${field.farmlandName} (${field.farmlandId})...`);
                            const details = await debugApiClient.getFarmlandDetails(field.farmlandId);
                            field.details = {
                                city: details.city,
                                country: details.country,
                                farmlandColor: details.farmlandColor,
                                harvestCycles: details.farmland.harvestCycles,
                                maxHarvestCycles: details.farmland.maxHarvestCycles,
                                canIrrigate: details.farmland.canIrrigate === 1,
                                isIrrigating: details.isIrrigating === 1,
                                canHarvest: details.canHarvest === 1,
                                canSeed: details.canSeed === 1,
                                canFertilize: details.canFertilize === 1,
                                canPlow: details.canPlow === 1,
                                canClear: details.canClear === 1,
                                lastFetched: new Date().toISOString()
                            };
                            fetchedCount++;
                            // Add small delay to avoid rate limiting
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } catch (err) {
                            logger.warn(`Failed to fetch details for field ${field.farmlandId}: ${(err as Error).message}`);
                        }
                    }
                }
            }

            saveMasterData(masterData);
            logger.success(`Fetched details for ${fetchedCount} fields`);

            res.json({
                success: true,
                fetchedCount,
                data: masterData
            });
        } catch (error) {
            logger.error('Failed to fetch missing details', error as Error);
            res.status(500).json({ error: 'Failed to fetch missing details' });
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
