// ============================================
// Farm Manager Bot - Web Server
// ============================================

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { ApiClient } from './api/client';
import { Logger, getLogBuffer, clearLogBuffer } from './utils/logger';
import { ConfigManager, AccountAuth, DEFAULT_ACCOUNT_SETTINGS } from './config/ConfigManager';
import { orchestrator } from './bot/BotOrchestrator';
import { AuthService } from './services/AuthService';
import { PriceTrackerService } from './services/PriceTrackerService';
import { MarketService } from './services/MarketService';
import { SiloService } from './services/SiloService';

const logger = new Logger('Server');

// Debug API clients for each account (for manual data fetching)
const debugApiClients: Map<string, { client: ApiClient; sessionId: string }> = new Map();

// Helper to get or create debug API client for an account
async function getDebugApiClient(accountId?: string): Promise<ApiClient | null> {
    // If orchestrator is running, try to get the client from it
    if (orchestrator.isActive() && accountId) {
        const client = orchestrator.getApiClientForAccount(accountId);
        if (client) return client;
    }

    // Fall back to creating a new client for the account
    const targetAccountId = accountId || ConfigManager.getAccounts().find(a => a.enabled)?.id;
    if (!targetAccountId) return null;

    const account = ConfigManager.getAccount(targetAccountId);
    if (!account) return null;

    // Check if we have a cached client with valid session
    const cached = debugApiClients.get(targetAccountId);
    if (cached) return cached.client;

    // Create new client by authenticating
    try {
        const authService = new AuthService();
        let phpSessionId: string | undefined;

        switch (account.auth.type) {
            case 'androidToken':
                if (account.auth.androidToken) {
                    phpSessionId = await authService.loginWithAndroidToken(account.auth.androidToken);
                }
                break;
            case 'email':
                if (account.auth.email && account.auth.password) {
                    phpSessionId = await authService.login(account.auth.email, account.auth.password);
                }
                break;
            case 'session':
                phpSessionId = account.auth.sessionId;
                break;
        }

        if (phpSessionId) {
            const client = new ApiClient(phpSessionId, logger);
            debugApiClients.set(targetAccountId, { client, sessionId: phpSessionId });
            return client;
        }
    } catch (error) {
        logger.error(`Failed to create debug client for account ${targetAccountId}`, error as Error);
    }

    return null;
}

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

interface FarmField {
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
}

interface Farm {
    id: number;
    name: string;
    countryCode: string;
    tractorCount: number;
    fields: Record<string, FarmField>;
}

// Account-specific farm data (includes crops since unlock status varies per account)
interface AccountFarmData {
    lastUpdated: string;
    crops: Record<string, CropData>;  // Account-specific - unlocked status varies
    farms: Record<string, Farm>;
}

// Main data structure with multi-account support
interface MasterFarmData {
    version: string;
    accounts: Record<string, AccountFarmData>;  // Account-specific data
}

// Legacy structure for migration (v1 - single account)
interface LegacyMasterFarmDataV1 {
    lastUpdated: string;
    crops: Record<string, CropData>;
    farms: Record<string, Farm>;
}

// Legacy structure for migration (v2 - multi-account with global crops)
interface LegacyMasterFarmDataV2 {
    version: string;
    crops: Record<string, CropData>;  // Global crops
    accounts: Record<string, { lastUpdated: string; farms: Record<string, Farm> }>;
}

export function loadMasterData(): MasterFarmData {
    try {
        if (fs.existsSync(MASTER_DATA_FILE)) {
            const data = fs.readFileSync(MASTER_DATA_FILE, 'utf-8');
            const parsed = JSON.parse(data);

            // Check if this is the new v3 format (accounts have crops)
            if (parsed.version === '3.0.0' && parsed.accounts) {
                return parsed as MasterFarmData;
            }

            // Check if this is v2 format (has version, accounts, and global crops)
            if (parsed.version && parsed.accounts && parsed.crops) {
                logger.info('Migrating farm-data.json from v2 to v3 (per-account crops)...');
                const legacyV2 = parsed as LegacyMasterFarmDataV2;

                // Move global crops to each account
                const migrated: MasterFarmData = {
                    version: '3.0.0',
                    accounts: {}
                };

                for (const [accountId, accountData] of Object.entries(legacyV2.accounts)) {
                    migrated.accounts[accountId] = {
                        lastUpdated: accountData.lastUpdated,
                        crops: { ...legacyV2.crops },  // Copy global crops to each account
                        farms: accountData.farms
                    };
                }

                saveMasterData(migrated);
                logger.success('Migration to v3 complete. Crops are now per-account.');
                return migrated;
            }

            // Check if this is v2 format without crops yet
            if (parsed.version && parsed.accounts && !parsed.crops) {
                // Already v3 or close to it, just ensure structure
                const migrated: MasterFarmData = {
                    version: '3.0.0',
                    accounts: {}
                };

                for (const [accountId, accountData] of Object.entries(parsed.accounts) as [string, any][]) {
                    migrated.accounts[accountId] = {
                        lastUpdated: accountData.lastUpdated || '',
                        crops: accountData.crops || {},
                        farms: accountData.farms || {}
                    };
                }

                saveMasterData(migrated);
                return migrated;
            }

            // Migrate from legacy v1 format (single account)
            logger.info('Migrating farm-data.json from v1 to v3...');
            const legacyV1 = parsed as LegacyMasterFarmDataV1;
            const activeAccount = ConfigManager.getActiveAccount();
            const accountId = activeAccount?.id || 'default';

            const migrated: MasterFarmData = {
                version: '3.0.0',
                accounts: {
                    [accountId]: {
                        lastUpdated: legacyV1.lastUpdated || new Date().toISOString(),
                        crops: legacyV1.crops || {},
                        farms: legacyV1.farms || {}
                    }
                }
            };

            saveMasterData(migrated);
            logger.success(`Migration to v3 complete. Farm data assigned to account: ${accountId}`);
            return migrated;
        }
    } catch (error) {
        logger.warn('Could not load master data file, starting fresh');
    }
    return { version: '3.0.0', accounts: {} };
}

export function saveMasterData(data: MasterFarmData): void {
    fs.writeFileSync(MASTER_DATA_FILE, JSON.stringify(data, null, 2));
}

// Get farm data for a specific account
export function getAccountFarmData(accountId: string): AccountFarmData {
    const masterData = loadMasterData();
    if (!masterData.accounts[accountId]) {
        masterData.accounts[accountId] = {
            lastUpdated: '',
            crops: {},
            farms: {}
        };
    }
    // Ensure crops exists for existing accounts
    if (!masterData.accounts[accountId].crops) {
        masterData.accounts[accountId].crops = {};
    }
    return masterData.accounts[accountId];
}

// Save farm data for a specific account
export function saveAccountFarmData(accountId: string, farmData: AccountFarmData): void {
    const masterData = loadMasterData();
    farmData.lastUpdated = new Date().toISOString();
    masterData.accounts[accountId] = farmData;
    saveMasterData(masterData);
}

export function mergeFarmData(
    accountFarmData: AccountFarmData,
    cultivatingResponse: any,
    seedingResponse: any,
    pendingResponse: any
): AccountFarmData {
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
                if (!accountFarmData.farms[farmId]) {
                    // Use cultivating response name as master, fallback to current response name
                    const farmName = cultivatingFarmNames[farmId] || farm.name || `Farm ${farmId}`;
                    accountFarmData.farms[farmId] = {
                        id: Number(farmId),
                        name: farmName,
                        countryCode: farm.countryCode || '',
                        tractorCount: farm.tractorCount || 0,
                        fields: {}
                    };
                } else {
                    // Update farm info but only update name from cultivating response
                    if (cultivatingFarmNames[farmId]) {
                        accountFarmData.farms[farmId].name = cultivatingFarmNames[farmId];
                    }
                    if (farm.countryCode) accountFarmData.farms[farmId].countryCode = farm.countryCode;
                    if (farm.tractorCount) accountFarmData.farms[farmId].tractorCount = farm.tractorCount;
                }

                // Extract fields from farmlands
                if (farm.farmlands) {
                    for (const [state, stateData] of Object.entries(farm.farmlands) as [string, any][]) {
                        if (stateData?.data) {
                            for (const [fieldKey, field] of Object.entries(stateData.data) as [string, any][]) {
                                const fieldId = String(field.farmlandId || fieldKey);
                                // Preserve existing configuredCropId and details
                                const existingField = accountFarmData.farms[farmId].fields[fieldId];
                                accountFarmData.farms[farmId].fields[fieldId] = {
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
                    if (!accountFarmData.farms[farmId]) {
                        accountFarmData.farms[farmId] = {
                            id: Number(farmId),
                            name: `Farm ${farmId}`,
                            countryCode: '',
                            tractorCount: 0,
                            fields: {}
                        };
                    }

                    // Update or create field, preserving existing configuredCropId and details
                    const existingField = accountFarmData.farms[farmId].fields[fieldId];
                    accountFarmData.farms[farmId].fields[fieldId] = {
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

    return accountFarmData;
}

export function mergeCropData(accountId: string, marketResponse: any): void {
    const accountFarmData = getAccountFarmData(accountId);
    if (marketResponse?.seed && Array.isArray(marketResponse.seed)) {
        for (const seed of marketResponse.seed) {
            accountFarmData.crops[String(seed.id)] = {
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
        saveAccountFarmData(accountId, accountFarmData);
    }
}

export function getConfiguredCropForFarmland(accountId: string, farmlandId: number): number | null {
    const accountFarmData = getAccountFarmData(accountId);
    for (const farm of Object.values(accountFarmData.farms)) {
        for (const field of Object.values(farm.fields)) {
            if (field.farmlandId === farmlandId && field.configuredCropId) {
                return field.configuredCropId;
            }
        }
    }
    return null;
}

export function createServer(port: number = 3000): express.Application {
    const app = express();

    app.use(express.json());
    // Serve static files from src/public (works from both src/ and dist/)
    app.use(express.static(path.join(process.cwd(), 'src', 'public')));

    // GET /api/status - Returns bot running state and account statuses
    app.get('/api/status', (_req: Request, res: Response) => {
        const status = orchestrator.getStatus();
        res.json({
            running: status.running,
            status: status.running ? 'Running' : 'Stopped',
            accounts: status.accounts,
            totalCycles: status.totalCycles,
            startedAt: status.startedAt
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

    // POST /api/start - Starts the orchestrator for all enabled accounts
    app.post('/api/start', async (_req: Request, res: Response) => {
        if (orchestrator.isActive()) {
            res.status(400).json({ error: 'Bot is already running' });
            return;
        }

        try {
            // Check if there are any enabled accounts
            const enabledAccounts = ConfigManager.getAccounts().filter(a => a.enabled);
            if (enabledAccounts.length === 0) {
                res.status(400).json({ error: 'No enabled accounts found. Please enable at least one account.' });
                return;
            }

            // Start orchestrator in background (don't await)
            orchestrator.start().catch((error) => {
                logger.error('Orchestrator error', error);
            });

            logger.info('Orchestrator started via web interface');
            res.json({
                success: true,
                message: `Starting bot for ${enabledAccounts.length} account(s)`,
                accounts: enabledAccounts.map(a => a.name)
            });
        } catch (error) {
            logger.error('Failed to start orchestrator', error as Error);
            res.status(500).json({ error: 'Failed to start bot' });
        }
    });

    // POST /api/stop - Stops the orchestrator
    app.post('/api/stop', (_req: Request, res: Response) => {
        if (!orchestrator.isActive()) {
            res.status(400).json({ error: 'Bot is not running' });
            return;
        }

        try {
            orchestrator.stop();

            logger.info('Orchestrator stopped via web interface');
            res.json({ success: true, message: 'Bot stopped' });
        } catch (error) {
            logger.error('Failed to stop orchestrator', error as Error);
            res.status(500).json({ error: 'Failed to stop bot' });
        }
    });

    // POST /api/debug/pending - Fetch all tab data, merge, and save to master JSON
    app.post('/api/debug/pending', async (req: Request, res: Response) => {
        try {
            const requestedAccountId = req.query.accountId as string;

            // Validate account exists
            if (requestedAccountId && !ConfigManager.getAccount(requestedAccountId)) {
                res.status(400).json({ error: 'Account not found' });
                return;
            }

            // Determine which account to use
            const accountId = requestedAccountId || ConfigManager.getAccounts().find(a => a.enabled)?.id;
            if (!accountId) {
                res.status(400).json({ error: 'No enabled account configured' });
                return;
            }

            const apiClient = await getDebugApiClient(accountId);
            if (!apiClient) {
                res.status(500).json({ error: 'No valid session available for this account' });
                return;
            }

            // Fetch all endpoints
            logger.info(`Fetching data for account: ${ConfigManager.getAccount(accountId)?.name || accountId}...`);
            logger.info('Fetching cultivating tab data...');
            const cultivatingData = await apiClient.getCultivatingTab();

            logger.info('Fetching seeding tab data...');
            const seedingData = await apiClient.getSeedingTab();

            logger.info('Fetching pending tab data...');
            const pendingData = await apiClient.getPendingTab();

            logger.info('Fetching market seeds data...');
            const marketData = await apiClient.getMarketSeeds();

            // Load existing account farm data
            let accountFarmData = getAccountFarmData(accountId);

            // Merge farm data for this account
            logger.info('Merging farm data...');
            accountFarmData = mergeFarmData(accountFarmData, cultivatingData, seedingData, pendingData);
            saveAccountFarmData(accountId, accountFarmData);

            // Merge crop data for this account
            mergeCropData(accountId, marketData);

            // Reload account data for response
            accountFarmData = getAccountFarmData(accountId);

            // Log summary
            const farmCount = Object.keys(accountFarmData.farms).length;
            const fieldCount = Object.values(accountFarmData.farms).reduce(
                (sum, farm) => sum + Object.keys(farm.fields).length, 0
            );
            const cropCount = Object.keys(accountFarmData.crops).length;
            logger.success(`Data saved for ${ConfigManager.getAccount(accountId)?.name || accountId}: ${farmCount} farms, ${fieldCount} fields, ${cropCount} crops`);

            // Return data in format expected by frontend
            res.json({
                success: true,
                filename: 'farm-data.json',
                data: {
                    lastUpdated: accountFarmData.lastUpdated,
                    crops: accountFarmData.crops,
                    farms: accountFarmData.farms
                }
            });
        } catch (error) {
            logger.error('Failed to fetch farm data', error as Error);
            res.status(500).json({ error: 'Failed to fetch farm data' });
        }
    });

    // GET /api/farms - Get farm data for specified account
    app.get('/api/farms', (req: Request, res: Response) => {
        try {
            // Use query param accountId or fall back to first enabled account
            const accountId = req.query.accountId as string || ConfigManager.getAccounts().find(a => a.enabled)?.id;
            if (!accountId) {
                res.json({ lastUpdated: '', crops: {}, farms: {} });
                return;
            }

            const accountFarmData = getAccountFarmData(accountId);

            // Return in format expected by frontend
            res.json({
                lastUpdated: accountFarmData.lastUpdated,
                crops: accountFarmData.crops,
                farms: accountFarmData.farms
            });
        } catch (error) {
            logger.error('Failed to load farm data', error as Error);
            res.status(500).json({ error: 'Failed to load farm data' });
        }
    });

    // PUT /api/farmland/:farmlandId/config - Set crop configuration for a farmland
    app.put('/api/farmland/:farmlandId/config', (req: Request, res: Response) => {
        try {
            const { cropId, accountId: bodyAccountId } = req.body;
            const accountId = bodyAccountId || req.query.accountId as string || ConfigManager.getAccounts().find(a => a.enabled)?.id;
            if (!accountId) {
                res.status(400).json({ error: 'No account specified' });
                return;
            }

            const farmlandId = parseInt(req.params.farmlandId, 10);
            if (isNaN(farmlandId)) {
                res.status(400).json({ error: 'Invalid farmland ID' });
                return;
            }

            // cropId can be null to clear the configuration
            const configuredCropId = cropId === null ? null : (typeof cropId === 'number' ? cropId : parseInt(cropId, 10));

            if (cropId !== null && isNaN(configuredCropId as number)) {
                res.status(400).json({ error: 'Invalid crop ID' });
                return;
            }

            const accountFarmData = getAccountFarmData(accountId);
            let found = false;

            for (const farm of Object.values(accountFarmData.farms)) {
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

            saveAccountFarmData(accountId, accountFarmData);

            const cropName = configuredCropId ? accountFarmData.crops[String(configuredCropId)]?.name : null;
            logger.info(`Configured farmland ${farmlandId} to use crop: ${cropName || 'auto (cleared)'}`);

            res.json({ success: true, farmlandId, configuredCropId, cropName });
        } catch (error) {
            logger.error('Failed to set farmland config', error as Error);
            res.status(500).json({ error: 'Failed to set farmland config' });
        }
    });

    // GET /api/silo - Get silo data for specified account
    app.get('/api/silo', async (req: Request, res: Response) => {
        try {
            const accountId = req.query.accountId as string || ConfigManager.getAccounts().find(a => a.enabled)?.id;
            if (!accountId) {
                res.status(400).json({ error: 'No account specified' });
                return;
            }

            const apiClient = await getDebugApiClient(accountId);
            if (!apiClient) {
                res.status(500).json({ error: 'No valid session available for this account' });
                return;
            }

            const siloData = await apiClient.getSiloTab();
            res.json(siloData);
        } catch (error) {
            logger.error('Failed to fetch silo data', error as Error);
            res.status(500).json({ error: 'Failed to fetch silo data' });
        }
    });

    // POST /api/silo/sell/:cropId - Sell a product from silo
    app.post('/api/silo/sell/:cropId', async (req: Request, res: Response) => {
        try {
            const accountId = req.query.accountId as string || ConfigManager.getAccounts().find(a => a.enabled)?.id;
            const cropId = parseInt(req.params.cropId, 10);
            if (isNaN(cropId)) {
                res.status(400).json({ error: 'Invalid crop ID' });
                return;
            }

            const apiClient = await getDebugApiClient(accountId);
            if (!apiClient) {
                res.status(500).json({ error: 'No valid session available' });
                return;
            }

            const result = await apiClient.sellProduct(cropId, 'all');

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
        try {
            const accountId = req.query.accountId as string || ConfigManager.getAccounts().find(a => a.enabled)?.id;
            if (!accountId) {
                res.status(400).json({ error: 'No account specified' });
                return;
            }

            const farmlandId = parseInt(req.params.farmlandId, 10);
            if (isNaN(farmlandId)) {
                res.status(400).json({ error: 'Invalid farmland ID' });
                return;
            }

            const apiClient = await getDebugApiClient(accountId);
            if (!apiClient) {
                res.status(500).json({ error: 'No valid session available for this account' });
                return;
            }

            const details = await apiClient.getFarmlandDetails(farmlandId);

            // Update account farm data with fetched details
            const accountFarmData = getAccountFarmData(accountId);
            for (const farm of Object.values(accountFarmData.farms)) {
                for (const field of Object.values(farm.fields)) {
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
            saveAccountFarmData(accountId, accountFarmData);

            res.json(details);
        } catch (error) {
            logger.error('Failed to fetch farmland details', error as Error);
            res.status(500).json({ error: 'Failed to fetch farmland details' });
        }
    });

    // POST /api/farms/fetch-missing-details - Fetch details for all farmlands missing details
    app.post('/api/farms/fetch-missing-details', async (req: Request, res: Response) => {
        try {
            const accountId = req.query.accountId as string || ConfigManager.getAccounts().find(a => a.enabled)?.id;
            if (!accountId) {
                res.status(400).json({ error: 'No account specified' });
                return;
            }

            const apiClient = await getDebugApiClient(accountId);
            if (!apiClient) {
                res.status(500).json({ error: 'No valid session available for this account' });
                return;
            }

            const accountFarmData = getAccountFarmData(accountId);
            let fetchedCount = 0;

            for (const farm of Object.values(accountFarmData.farms)) {
                for (const field of Object.values(farm.fields)) {
                    if (!field.details) {
                        try {
                            logger.info(`Fetching details for field ${field.farmlandName} (${field.farmlandId})...`);
                            const details = await apiClient.getFarmlandDetails(field.farmlandId);
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

            saveAccountFarmData(accountId, accountFarmData);
            logger.success(`Fetched details for ${fetchedCount} fields`);

            res.json({
                success: true,
                fetchedCount,
                data: {
                    lastUpdated: accountFarmData.lastUpdated,
                    crops: accountFarmData.crops,
                    farms: accountFarmData.farms
                }
            });
        } catch (error) {
            logger.error('Failed to fetch missing details', error as Error);
            res.status(500).json({ error: 'Failed to fetch missing details' });
        }
    });

    // ============================================
    // Configuration API Endpoints
    // ============================================

    // GET /api/config - Get full configuration
    app.get('/api/config', (_req: Request, res: Response) => {
        try {
            const config = ConfigManager.getConfig();
            // Mask sensitive data in response
            const safeConfig = {
                ...config,
                accounts: Object.fromEntries(
                    Object.entries(config.accounts).map(([id, acc]) => [
                        id,
                        {
                            ...acc,
                            auth: maskAuthData(acc.auth)
                        }
                    ])
                )
            };
            res.json(safeConfig);
        } catch (error) {
            logger.error('Failed to get config', error as Error);
            res.status(500).json({ error: 'Failed to get configuration' });
        }
    });

    // GET /api/config/accounts - Get all accounts
    app.get('/api/config/accounts', (_req: Request, res: Response) => {
        try {
            const accounts = ConfigManager.getAccounts().map(acc => ({
                ...acc,
                auth: maskAuthData(acc.auth)
            }));
            res.json({ accounts });
        } catch (error) {
            logger.error('Failed to get accounts', error as Error);
            res.status(500).json({ error: 'Failed to get accounts' });
        }
    });

    // GET /api/config/accounts/:id - Get specific account
    app.get('/api/config/accounts/:id', (req: Request, res: Response) => {
        try {
            const account = ConfigManager.getAccount(req.params.id);
            if (!account) {
                res.status(404).json({ error: 'Account not found' });
                return;
            }
            res.json({
                ...account,
                auth: maskAuthData(account.auth)
            });
        } catch (error) {
            logger.error('Failed to get account', error as Error);
            res.status(500).json({ error: 'Failed to get account' });
        }
    });

    // POST /api/config/accounts - Create new account
    app.post('/api/config/accounts', (req: Request, res: Response) => {
        try {
            const { name, auth, settings } = req.body;

            if (!name || !auth || !auth.type) {
                res.status(400).json({ error: 'Name and auth.type are required' });
                return;
            }

            const account = ConfigManager.createAccount(name, auth as AccountAuth, settings);
            res.json({
                success: true,
                account: {
                    ...account,
                    auth: maskAuthData(account.auth)
                }
            });
        } catch (error) {
            logger.error('Failed to create account', error as Error);
            res.status(500).json({ error: 'Failed to create account' });
        }
    });

    // PUT /api/config/accounts/:id - Update account
    app.put('/api/config/accounts/:id', (req: Request, res: Response) => {
        try {
            const accountId = req.params.id;
            const updates = req.body;

            const account = ConfigManager.updateAccount(accountId, updates);
            res.json({
                success: true,
                account: {
                    ...account,
                    auth: maskAuthData(account.auth)
                }
            });
        } catch (error) {
            logger.error('Failed to update account', error as Error);
            res.status(500).json({ error: (error as Error).message });
        }
    });

    // DELETE /api/config/accounts/:id - Delete account
    app.delete('/api/config/accounts/:id', (req: Request, res: Response) => {
        try {
            ConfigManager.deleteAccount(req.params.id);
            res.json({ success: true });
        } catch (error) {
            logger.error('Failed to delete account', error as Error);
            res.status(500).json({ error: (error as Error).message });
        }
    });

    // POST /api/config/accounts/:id/activate - Set active account
    app.post('/api/config/accounts/:id/activate', (req: Request, res: Response) => {
        try {
            ConfigManager.setActiveAccount(req.params.id);
            res.json({ success: true, activeAccountId: req.params.id });
        } catch (error) {
            logger.error('Failed to set active account', error as Error);
            res.status(500).json({ error: (error as Error).message });
        }
    });

    // GET /api/config/active - Get active account
    app.get('/api/config/active', (_req: Request, res: Response) => {
        try {
            const account = ConfigManager.getActiveAccount();
            if (!account) {
                res.json({ account: null });
                return;
            }
            res.json({
                account: {
                    ...account,
                    auth: maskAuthData(account.auth)
                }
            });
        } catch (error) {
            logger.error('Failed to get active account', error as Error);
            res.status(500).json({ error: 'Failed to get active account' });
        }
    });

    // PUT /api/config/global - Update global settings
    app.put('/api/config/global', (req: Request, res: Response) => {
        try {
            const settings = ConfigManager.updateGlobalSettings(req.body);
            res.json({ success: true, globalSettings: settings });
        } catch (error) {
            logger.error('Failed to update global settings', error as Error);
            res.status(500).json({ error: 'Failed to update global settings' });
        }
    });

    // POST /api/config/import-env - Import configuration from .env
    app.post('/api/config/import-env', (_req: Request, res: Response) => {
        try {
            const account = ConfigManager.importFromEnv();
            if (!account) {
                res.status(400).json({ error: 'No credentials found in .env file' });
                return;
            }
            res.json({
                success: true,
                account: {
                    ...account,
                    auth: maskAuthData(account.auth)
                }
            });
        } catch (error) {
            logger.error('Failed to import from .env', error as Error);
            res.status(500).json({ error: 'Failed to import from .env' });
        }
    });

    // GET /api/config/defaults - Get default settings
    app.get('/api/config/defaults', (_req: Request, res: Response) => {
        res.json({
            settings: DEFAULT_ACCOUNT_SETTINGS
        });
    });

    // ============================================
    // Price Tracker API Endpoints
    // ============================================

    // GET /api/prices/status - Get price tracker status
    app.get('/api/prices/status', (_req: Request, res: Response) => {
        try {
            const summary = PriceTrackerService.getSummary();
            res.json(summary);
        } catch (error) {
            logger.error('Failed to get price tracker status', error as Error);
            res.status(500).json({ error: 'Failed to get price tracker status' });
        }
    });

    // GET /api/prices/stats - Get all crop price statistics
    app.get('/api/prices/stats', (_req: Request, res: Response) => {
        try {
            const stats = PriceTrackerService.getAllCropStats();
            res.json({ stats });
        } catch (error) {
            logger.error('Failed to get price stats', error as Error);
            res.status(500).json({ error: 'Failed to get price stats' });
        }
    });

    // GET /api/prices/crop/:cropId - Get price history for a specific crop
    app.get('/api/prices/crop/:cropId', (req: Request, res: Response) => {
        try {
            const cropId = req.params.cropId;
            const history = PriceTrackerService.getCropPriceHistory(cropId);
            const stats = PriceTrackerService.getCropStats(cropId);

            if (!stats) {
                res.status(404).json({ error: 'No price data for this crop' });
                return;
            }

            res.json({
                cropId,
                stats,
                history
            });
        } catch (error) {
            logger.error('Failed to get crop price history', error as Error);
            res.status(500).json({ error: 'Failed to get crop price history' });
        }
    });

    // POST /api/prices/fetch - Manually trigger price fetch
    app.post('/api/prices/fetch', async (_req: Request, res: Response) => {
        try {
            const success = await PriceTrackerService.fetchAndStorePrices();
            if (success) {
                res.json({ success: true, message: 'Prices fetched and stored' });
            } else {
                res.status(500).json({ error: 'Failed to fetch prices' });
            }
        } catch (error) {
            logger.error('Failed to fetch prices', error as Error);
            res.status(500).json({ error: 'Failed to fetch prices' });
        }
    });

    // POST /api/prices/start - Start the price tracker
    app.post('/api/prices/start', (_req: Request, res: Response) => {
        try {
            if (PriceTrackerService.isActive()) {
                res.status(400).json({ error: 'Price tracker is already running' });
                return;
            }
            PriceTrackerService.start();
            res.json({ success: true, message: 'Price tracker started' });
        } catch (error) {
            logger.error('Failed to start price tracker', error as Error);
            res.status(500).json({ error: 'Failed to start price tracker' });
        }
    });

    // POST /api/prices/stop - Stop the price tracker
    app.post('/api/prices/stop', (_req: Request, res: Response) => {
        try {
            if (!PriceTrackerService.isActive()) {
                res.status(400).json({ error: 'Price tracker is not running' });
                return;
            }
            PriceTrackerService.stop();
            res.json({ success: true, message: 'Price tracker stopped' });
        } catch (error) {
            logger.error('Failed to stop price tracker', error as Error);
            res.status(500).json({ error: 'Failed to stop price tracker' });
        }
    });

    // GET /api/debug/crop-value/:cropId - Debug endpoint to get crop value using MarketService
    app.get('/api/debug/crop-value/:cropId', async (req: Request, res: Response) => {
        try {
            const cropId = parseInt(req.params.cropId, 10);
            if (isNaN(cropId)) {
                res.status(400).json({ error: 'Invalid crop ID' });
                return;
            }

            const accountId = req.query.accountId as string || ConfigManager.getAccounts().find(a => a.enabled)?.id;
            if (!accountId) {
                res.status(400).json({ error: 'No account specified' });
                return;
            }

            const apiClient = await getDebugApiClient(accountId);
            if (!apiClient) {
                res.status(500).json({ error: 'No valid session available for this account' });
                return;
            }

            // Create MarketService to use getCropValue
            const siloService = new SiloService(apiClient, logger);
            const marketService = new MarketService(apiClient, siloService, logger);

            // Get the specific crop value
            const cropValue = await marketService.getCropValue(cropId);

            // Also get all crop values for comparison
            const allCropValues = await marketService.getCropValues();

            // Get crop name from farm data
            const accountFarmData = getAccountFarmData(accountId);
            const cropData = accountFarmData.crops[String(cropId)];

            logger.info(`Debug crop value for ${cropData?.name || `Crop ${cropId}`}: ${JSON.stringify(cropValue)}`);

            res.json({
                cropId,
                cropName: cropData?.name || `Crop ${cropId}`,
                cropValue,
                allCropValues,
                seedCostFromFarmData: cropData?.seedCost,
                cropValueRatingFromFarmData: cropData?.cropValueRating
            });
        } catch (error) {
            logger.error('Failed to get crop value', error as Error);
            res.status(500).json({ error: 'Failed to get crop value' });
        }
    });

    // Start the server
    app.listen(port, () => {
        logger.info(`Web server running at http://localhost:${port}`);

        // Auto-start price tracker if there are enabled accounts
        const enabledAccounts = ConfigManager.getAccounts().filter(a => a.enabled);
        if (enabledAccounts.length > 0) {
            logger.info('Auto-starting price tracker...');
            PriceTrackerService.start();
        }
    });

    return app;
}

// Helper function to mask sensitive auth data
function maskAuthData(auth: AccountAuth): AccountAuth {
    const masked = { ...auth };
    if (masked.androidToken) {
        masked.androidToken = masked.androidToken.substring(0, 8) + '...' + masked.androidToken.substring(masked.androidToken.length - 4);
    }
    if (masked.password) {
        masked.password = '********';
    }
    if (masked.sessionId) {
        masked.sessionId = masked.sessionId.substring(0, 8) + '...';
    }
    return masked;
}

// Graceful shutdown helper
export function stopBot(): void {
    if (orchestrator.isActive()) {
        orchestrator.stop();
    }
    if (PriceTrackerService.isActive()) {
        PriceTrackerService.stop();
    }
}
