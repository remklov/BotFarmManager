// ============================================
// Farm Manager Bot - Main Bot Class
// ============================================

import { ApiClient } from '../api/client';
import { FarmService, TractorService, SiloService, MarketService, SeedService, FuelService } from '../services';
import { BotConfig, AvailableTask, BatchActionUnit } from '../types';
import { Logger } from '../utils/logger';

export class FarmBot {
    private api: ApiClient;
    private farmService: FarmService;
    private tractorService: TractorService;
    private siloService: SiloService;
    private marketService: MarketService;
    private seedService: SeedService;
    private fuelService: FuelService;
    private logger: Logger;
    private config: BotConfig;
    private isRunning: boolean = false;
    private intervalId: NodeJS.Timeout | null = null;

    

    constructor(config: BotConfig) {
        this.config = config;
        this.logger = new Logger('FarmBot', config.debug);
        this.api = new ApiClient(config.phpSessionId!, this.logger);

        // Initialize services
        this.farmService = new FarmService(this.api, this.logger);
        this.tractorService = new TractorService(this.api, this.logger);
        this.siloService = new SiloService(this.api, this.logger);
        this.marketService = new MarketService(this.api, this.siloService, this.logger);
        this.seedService = new SeedService(this.api, this.logger);
        this.fuelService = new FuelService(this.api, this.logger);
    }

    /**
     * Starts the bot
     */
    async start(): Promise<void> {
        this.logger.info('🚀 Starting Farm Manager Bot...');
        this.logger.info(`Check interval: ${this.config.checkIntervalMs / 1000}s`);
        this.logger.info(`Silo sell threshold: ${this.config.siloSellThreshold}%`);

        this.isRunning = true;

        // Execute first time immediately
        await this.runCycle();

        // Set up interval
        this.intervalId = setInterval(async () => {
            if (this.isRunning) {
                await this.runCycle();
            }
        }, this.config.checkIntervalMs);

        this.logger.success('Bot started successfully!');
    }

    /**
     * Stops the bot
     */
    stop(): void {
        this.logger.info('⏹️ Stopping Farm Manager Bot...');
        this.isRunning = false;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.logger.success('Bot stopped.');
    }

    /**
     * Executes a complete cycle of checking and actions
     */
    async runCycle(): Promise<void> {
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info(`🔄 Starting cycle - ${new Date().toLocaleString('en-US')}`);

        try {
            // 0. Check and buy fuel if necessary
            await this.fuelService.checkAndBuyFuel();

            // 1. Check and execute harvests
            await this.checkAndExecuteHarvesting();

            // 2. Check and execute seeding
            await this.checkAndExecuteSeeding();

            // 3. Check and execute cultivation (plow/clear)
            await this.checkAndExecuteCultivating();

            // 4. Check and sell silo products
            await this.checkAndSellProducts();

            this.logger.info('✅ Cycle completed');
        } catch (error) {
            this.logger.error('Error during cycle', error as Error);
        }
    }

    /**
     * Checks and executes pending harvests
     */
    private async checkAndExecuteHarvesting(): Promise<void> {
        this.logger.debugLog('Checking available harvests...');

        const tasks = await this.farmService.getHarvestingTasks();

        if (tasks.length === 0) {
            this.logger.debugLog('No harvests available');
            return;
        }

        this.logger.task(`${tasks.length} harvest(s) available`);

        for (const task of tasks) {
            await this.executeTask(task);
        }
    }

    /**
     * Checks and executes pending seeding (with Smart Seeding)
     */
    private async checkAndExecuteFertilizing(): Promise<void> {
        this.logger.debugLog('Checking available seeding...');

        const tasks = await this.farmService.getFertilizingTasks();

        if (tasks.length === 0) {
            this.logger.debugLog('No fertilizing available');
            return;
        }

        this.logger.task(`${tasks.length} fertilizing(s) available`);

        for (const task of tasks) {
            // Smart Seeding: find best seed and ensure stock
            this.logger.info(`🌱 Preparing Smart Fertilizing for "${task.farmlandName}"...`);

            const bestSeed = await this.seedService.prepareForSeeding(task.farmlandId, task.area, this.config.forceSeedName);
            const fertilizerAmount = 25; //await this.fertilizerService.getAmoutForSeed(bestSeed);

            if (fertilizerAmount) {
                this.logger.info(
                    `🌾 Fertilizer Amount: ${fertilizerAmount}kg)`
                );
                // Pass cropId to the task
                (task as any).fertilizerAmount = fertilizerAmount;
            } else {
                this.logger.warn(`Could not prepare seeds for ${task.farmlandName}`);
                continue;
            }

            await this.executeTask(task);
        }
    }

    /**
     * Checks and executes pending seeding (with Smart Seeding)
     */
    private async checkAndExecuteSeeding(): Promise<void> {
        this.logger.debugLog('Checking available seeding...');

        const tasks = await this.farmService.getSeedingTasks();

        if (tasks.length === 0) {
            this.logger.debugLog('No seeding available');
            return;
        }

        this.logger.task(`${tasks.length} seeding(s) available`);

        for (const task of tasks) {
            // Smart Seeding: find best seed and ensure stock
            this.logger.info(`🌱 Preparing Smart Seeding for "${task.farmlandName}"...`);

            const bestSeed = await this.seedService.prepareForSeeding(task.farmlandId, task.area, this.config.forceSeedName);

            if (bestSeed) {
                this.logger.info(
                    `🌾 Seed selected: ${bestSeed.cropName} ` +
                    `(Score: ${bestSeed.score}, ${bestSeed.requiredAmount}kg)`
                );
                // Pass cropId to the task
                (task as any).cropId = bestSeed.cropId;
            } else {
                this.logger.warn(`Could not prepare seeds for ${task.farmlandName}`);
                continue;
            }

            await this.executeTask(task);
        }
    }

    /**
     * Checks and executes cultivation tasks (plow, clear)
     */
    private async checkAndExecuteCultivating(): Promise<void> {
        this.logger.debugLog('Checking available cultivation...');

        const tasks = await this.farmService.getCultivatingTasks();

        if (tasks.length === 0) {
            this.logger.debugLog('No cultivation available');
            return;
        }

        this.logger.task(`${tasks.length} cultivation(s) available`);

        for (const task of tasks) {
            await this.executeTask(task);
        }
    }

    /**
     * Executes a specific task
     */
    private async executeTask(task: AvailableTask): Promise<boolean> {
        this.logger.task(
            `Executing ${task.type} on "${task.farmlandName}" (${task.area}ha)`
        );

        try {
            // For seeding, plowing and fertilizing, use the new multi-tractor method
            if (task.type === 'seeding' || task.type === 'plowing' || task.type === 'fertilizing') {
                return this.executeMultiTractorTask(task);
            }

            // For harvesting, use method with multiple harvesters and idle verification
            if (task.type === 'harvesting') {
                return this.executeMultiHarvesterTask(task);
            }

            // For clearing, use simple logic (single equipment)
            return this.executeSingleTractorTask(task);
        } catch (error) {
            this.logger.error(
                `Error executing ${task.type} on "${task.farmlandName}"`,
                error as Error
            );
            return false;
        }
    }

    /**
     * Executes a task with multiple tractors (seeding/plowing)
     */
    private async executeMultiTractorTask(task: AvailableTask): Promise<boolean> {
        // Get optimized tractors
        const optimal = await this.tractorService.getOptimalTractorsForOperation(
            task.farmlandId,
            task.farmId,
            task.area,
            task.complexityIndex,
            task.type as 'seeding' | 'plowing' | 'fertilizing',
            this.config.maxTractorsPerOp,
            this.config.maxIdleTimeMinutes
        );

        if (!optimal || optimal.tractors.length === 0) {
            this.logger.warn(`No tractors available for ${task.farmlandName}`);
            return false;
        }

        // Check maximum operation time (6 hours = 21600 seconds)
        const MAX_OPERATION_HOURS = 6;
        const MAX_OPERATION_SECONDS = MAX_OPERATION_HOURS * 3600;

        if (optimal.estimatedDuration > MAX_OPERATION_SECONDS) {
            const estimatedHours = (optimal.estimatedDuration / 3600).toFixed(1);
            this.logger.warn(
                `⏱️ Operation on "${task.farmlandName}" ignored: estimated time of ${estimatedHours}h exceeds limit of ${MAX_OPERATION_HOURS}h.`
            );
            return false;
        }

        // Build data for batch action
        const farmlandIds: Record<string, number> = {
            [String(task.userFarmlandId)]: task.userFarmlandId,
        };

        const units = this.tractorService.buildMultiBatchUnits(optimal.tractors);

        this.logger.debugLog(`farmlandIds: ${JSON.stringify(farmlandIds)}`);
        this.logger.debugLog(`units: ${JSON.stringify(units)}`);

        // For seeding, include the cropId selected by Smart Seeding
        const cropId = (task as any).cropId;
        
        // For fertilizing, include the amount selected by Smart Fertilizing
        const fertilizerAmount = (task as any).fertilizerAmount

        const result = await this.api.startBatchAction(
            task.type,
            farmlandIds,
            units,
            true,
            false,
            cropId,
            fertilizerAmount
        );

        this.logger.debugLog(`Resultado da ação: ${JSON.stringify(result)}`);

        if (result.failed === 0) {
            const taskResult = result.result?.[String(task.userFarmlandId)];
            const timeMinutes = Math.ceil((taskResult?.opTimeRemain || 0) / 60);
            this.logger.success(
                `${task.type} started on "${task.farmlandName}" with ${optimal.tractors.length} tractor(s) - ~${timeMinutes}min`
            );
            return true;
        } else {
            const errorMsg = result.errors?.join(', ') || 'Unknown error';
            this.logger.warn(
                `Failed to execute ${task.type} on "${task.farmlandName}": ${errorMsg}`
            );
            return false;
        }
    }

    /**
     * Executes a harvest task with multiple harvesters
     * Considers idle verification (maturing fields)
     */
    private async executeMultiHarvesterTask(task: AvailableTask): Promise<boolean> {
        // Get optimized harvesters with idle verification
        const optimal = await this.tractorService.getOptimalTractorsForOperation(
            task.farmlandId,
            task.farmId,
            task.area,
            task.complexityIndex,
            'harvesting',
            this.config.maxTractorsPerOp,
            this.config.maxIdleTimeMinutes
        );

        if (!optimal || optimal.tractors.length === 0) {
            this.logger.warn(`No harvesters available for ${task.farmlandName}`);
            return false;
        }

        // Check maximum operation time (6 hours = 21600 seconds)
        const MAX_OPERATION_HOURS = 6;
        const MAX_OPERATION_SECONDS = MAX_OPERATION_HOURS * 3600;

        if (optimal.estimatedDuration > MAX_OPERATION_SECONDS) {
            const estimatedHours = (optimal.estimatedDuration / 3600).toFixed(1);
            this.logger.warn(
                `⏱️ Harvest on "${task.farmlandName}" ignored: estimated time of ${estimatedHours}h exceeds limit of ${MAX_OPERATION_HOURS}h.`
            );
            return false;
        }

        // For harvest, use the specific endpoint with one harvester
        // (The harvest API doesn't support multiple harvesters per operation on the same endpoint)
        const bestHarvester = optimal.tractors[0];

        const result = await this.api.startHarvestAction(
            task.userFarmlandId,
            bestHarvester.tractorId
        );

        this.logger.debugLog(`Resultado da colheita: ${JSON.stringify(result)}`);

        if (result.failed === 0) {
            const taskResult = result.result?.[String(task.userFarmlandId)];
            const timeMinutes = Math.ceil((taskResult?.opTimeRemain || 0) / 60);
            this.logger.success(
                `🌾 Harvest started on "${task.farmlandName}" - ~${timeMinutes}min`
            );

            // Record harvest in 6-hour cache
            this.farmService.recordHarvest(task.userFarmlandId);

            return true;
        } else {
            const errorMsg = result.errors?.join(', ') || 'Unknown error';
            this.logger.warn(
                `Failed to harvest "${task.farmlandName}": ${errorMsg}`
            );
            return false;
        }
    }

    /**
     * Executes a task with single tractor (clearing)
     */
    private async executeSingleTractorTask(task: AvailableTask): Promise<boolean> {
        // Get available equipment
        const equipment = await this.tractorService.getEquipmentForFarmland(task.farmlandId, task.type);

        if (!equipment) {
            this.logger.warn(`No equipment available for ${task.farmlandName}`);
            return false;
        }

        // Check maximum operation time (6 hours = 21600 seconds)
        const MAX_OPERATION_HOURS = 6;
        const MAX_OPERATION_SECONDS = MAX_OPERATION_HOURS * 3600;

        if (equipment.estimatedDuration > MAX_OPERATION_SECONDS) {
            const estimatedHours = (equipment.estimatedDuration / 3600).toFixed(1);
            this.logger.warn(
                `⏱️ Operation on "${task.farmlandName}" ignored: estimated time of ${estimatedHours}h exceeds limit of ${MAX_OPERATION_HOURS}h.`
            );
            return false;
        }

        // Build data for batch action
        const farmlandIds: Record<string, number> = {
            [String(task.userFarmlandId)]: task.userFarmlandId,
        };

        const units = this.tractorService.buildBatchUnits(
            equipment.tractorId,
            equipment.implementId
        );

        // Execute action - harvest uses different endpoint!
        let result;
        if (task.type === 'harvesting') {
            result = await this.api.startHarvestAction(
                task.userFarmlandId,
                equipment.tractorId
            );
        } else {
            result = await this.api.startBatchAction(
                task.type,
                farmlandIds,
                units,
                true,
                false
            );
        }

        this.logger.debugLog(`Resultado da ação: ${JSON.stringify(result)}`);

        if (result.failed === 0) {
            const taskResult = result.result?.[String(task.userFarmlandId)];
            this.logger.success(
                `${task.type} started on "${task.farmlandName}" - Estimated time: ${taskResult?.opTimeRemain || 'N/A'}s`
            );

            // Record harvest in 6-hour cache
            if (task.type === 'harvesting') {
                this.farmService.recordHarvest(task.userFarmlandId);
            }

            return true;
        } else {
            const errorMsg = result.errors?.join(', ') || 'Unknown error';
            this.logger.warn(
                `Failed to execute ${task.type} on "${task.farmlandName}": ${errorMsg}`
            );
            return false;
        }
    }

    /**
     * Checks silo and sells products above threshold
     */
    private async checkAndSellProducts(): Promise<void> {
        this.logger.debugLog('Checking silo...');

        try {
            // Log silo status
            await this.siloService.logSiloStatus();

            // Get products to Sell
            const productsToSell = await this.marketService.getProductsToSell(
                this.config.siloSellThreshold
            );

            if (productsToSell.length === 0) {
                this.logger.debugLog(
                    `No products above ${this.config.siloSellThreshold}% to sell`
                );
                return;
            }

            // Sell each product
            const results = await this.marketService.sellMultipleProducts(
                productsToSell.map(p => ({ id: p.id, name: p.name }))
            );

            // Sales summary
            const summary = this.marketService.summarizeSales(results);

            if (summary.successCount > 0) {
                this.logger.market(
                    `Sales completed: ${summary.totalSold.toLocaleString()}kg sold, ` +
                    `total revenue: $${summary.totalIncome.toLocaleString()}`
                );
            }
        } catch (error) {
            this.logger.error('Error checking/selling products', error as Error);
        }
    }

    /**
     * Executes a cycle manually (useful for debugging)
     */
    async manualCycle(): Promise<void> {
        await this.runCycle();
    }

    /**
     * Test harvesting - checks and executes available harvests
     */
    async testHarvesting(): Promise<void> {
        await this.checkAndExecuteHarvesting();
    }

    /**
     * Test seeding - checks and executes available seeding tasks
     */
    async testSeeding(): Promise<void> {
        await this.checkAndExecuteSeeding();
    }

    /**
     * Test plowing - checks and executes available plowing tasks
     */
    async testPlowing(): Promise<void> {
        const tasks = await this.farmService.getCultivatingTasks();
        const plowingTasks = tasks.filter(task => task.type === 'plowing');
        
        if (plowingTasks.length === 0) {
            this.logger.info('No plowing tasks available');
            return;
        }

        this.logger.task(`${plowingTasks.length} plowing task(s) available`);

        for (const task of plowingTasks) {
            await this.executeTask(task);
        }
    }

    /**
     * Test fertilizing - checks for available fertilizing tasks
     * Note: Fertilizing is not yet fully implemented
     */
    async testFertilizing(): Promise<void> {
        const tasks = await this.farmService.getFertilizingTasks();
        const fertilizingTasks = tasks.filter(task => task.type === 'fertilizing');
        
        if (fertilizingTasks.length === 0) {
            this.logger.info('No fertilizing tasks available');
            return;
        }

        this.logger.task(`${fertilizingTasks.length} fertilizing task(s) available`);

        for (const task of fertilizingTasks) {
            await this.executeTask(task);
        }
    }

    /**
     * Returns current bot status
     */
    getStatus(): { isRunning: boolean; config: BotConfig } {
        return {
            isRunning: this.isRunning,
            config: this.config,
        };
    }
}
