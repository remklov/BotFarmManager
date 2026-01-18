// ============================================
// Farm Manager Bot - Farm Service
// ============================================

import { ApiClient } from '../api/client';
import {
    CultivatingTabResponse,
    SeedingTabResponse,
    HarvestTabResponse,
    FarmlandData,
    AvailableTask,
    FarmlandState,
    Farm,
} from '../types';
import { Logger } from '../utils/logger';

// Constant: minimum time between harvests (6 hours in milliseconds)
const MIN_HARVEST_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class FarmService {
    private api: ApiClient;
    private logger: Logger;

    // Harvest cache: userFarmlandId -> timestamp of last harvest
    private harvestCache: Map<number, number> = new Map();

    constructor(api: ApiClient, logger: Logger) {
        this.api = api;
        this.logger = logger;
    }

    /**
     * Records a harvest performed for the 6-hour filter
     */
    recordHarvest(userFarmlandId: number): void {
        this.harvestCache.set(userFarmlandId, Date.now());
        this.logger.debugLog(`[HarvestCache] Harvest recorded for userFarmlandId ${userFarmlandId}`);
    }

    /**
     * Checks if a harvest can be performed (6 hours have passed since the last one)
     */
    canHarvest(userFarmlandId: number): boolean {
        const lastHarvest = this.harvestCache.get(userFarmlandId);
        if (!lastHarvest) {
            return true; // Never harvested in this session
        }

        const elapsed = Date.now() - lastHarvest;
        return elapsed >= MIN_HARVEST_INTERVAL_MS;
    }

    /**
     * Returns how much time is left until can harvest again (in minutes)
     */
    getTimeUntilCanHarvest(userFarmlandId: number): number {
        const lastHarvest = this.harvestCache.get(userFarmlandId);
        if (!lastHarvest) {
            return 0;
        }

        const elapsed = Date.now() - lastHarvest;
        const remaining = MIN_HARVEST_INTERVAL_MS - elapsed;
        return Math.max(0, Math.ceil(remaining / (60 * 1000))); // in minutes
    }

    /**
     * Gets all available tasks for cultivation (plow, clear)
     */
    async getCultivatingTasks(): Promise<AvailableTask[]> {
        const response = await this.api.getCultivatingTab();
        this.logger.debugLog(`[Cultivating] Response: ${JSON.stringify(response, null, 2)}`);

        if (!response.farms) {
            this.logger.debugLog('[Cultivating] No farms found in response');
            return [];
        }
        return this.extractTasksFromFarms(response.farms, 'cultivating');
    }

    /**
     * Gets all available tasks for seeding
     */
    async getFertilizingTasks(): Promise<AvailableTask[]> {
        const response = await this.api.getCultivatingTab();
        this.logger.debugLog(`[Fertilizing] Response: ${JSON.stringify(response, null, 2)}`);

        if (!response.farms) {
            this.logger.debugLog('[Fertilizing] No farms found in response');
            return [];
        }
        return this.extractTasksFromFarms(response.farms, 'fertilizing');
    }

    /**
     * Gets all available tasks for seeding
     */
    async getSeedingTasks(): Promise<AvailableTask[]> {
        const response = await this.api.getSeedingTab();
        //this.logger.debugLog(`[Seeding] Response: ${JSON.stringify(response, null, 2)}`);

        if (!response.farms) {
            this.logger.debugLog('[Seeding] No farms found in response');
            return [];
        }
        return this.extractTasksFromFarms(response.farms, 'seeding');
    }

    /**
     * Gets all available tasks for harvest
     * The Harvest response structure is different from other tabs!
     */
    async getHarvestingTasks(): Promise<AvailableTask[]> {
        const response = await this.api.getHarvestTab();
        this.logger.debugLog(`[Harvest] Response: ${JSON.stringify(response, null, 2)}`);

        if (!response.farms) {
            this.logger.debugLog('[Harvest] No farms found in response');
            return [];
        }

        return this.extractHarvestTasks(response.farms);
    }

    /**
     * Extracts harvest tasks from API response
     * Structure: farms[farmId].farmlands[cropTypeId].data[farmlandId]
     * Applies 6-hour filter to avoid harvesting recently harvested fields
     */
    private extractHarvestTasks(farms: Record<string, any>): AvailableTask[] {
        const tasks: AvailableTask[] = [];

        for (const [farmId, farm] of Object.entries(farms)) {
            const farmlands = (farm as any).farmlands;

            if (!farmlands) continue;

            // farmlands are grouped by crop type (1, 2, etc), not by state
            for (const [cropTypeId, cropFarmlands] of Object.entries(farmlands)) {
                const cropData = cropFarmlands as any;

                if (!cropData.data || cropData.canHarvest !== 1) {
                    continue;
                }

                for (const [farmlandId, farmland] of Object.entries(cropData.data)) {
                    const fl = farmland as any;

                    if (fl.canHarvest === 1) {
                        // Check 6-hour filter
                        if (!this.canHarvest(fl.id)) {
                            const timeRemaining = this.getTimeUntilCanHarvest(fl.id);
                            this.logger.debugLog(
                                `[Harvest] ⏱️ Ignoring "${fl.farmlandName}" - last harvest less than 6h ago (${timeRemaining}min remaining)`
                            );
                            continue;
                        }

                        this.logger.debugLog(`[Harvest] Found harvest: ${fl.farmlandName} (${fl.area}ha)`);
                        tasks.push({
                            type: 'harvesting',
                            farmId: Number(farmId),
                            farmlandId: fl.farmlandId,
                            userFarmlandId: fl.id,
                            area: fl.area,
                            complexityIndex: fl.complexityIndex || 1,
                            farmlandName: fl.farmlandName,
                        });
                    }
                }
            }
        }

        return tasks;
    }

    /**
     * Extracts available tasks from a farms response (cultivating/seeding)
     */
    private extractTasksFromFarms(
        farms: Record<string, Farm>,
        taskType: 'cultivating' | 'seeding' | 'fertilizing'
    ): AvailableTask[] {
        const tasks: AvailableTask[] = [];

        for (const [farmId, farm] of Object.entries(farms)) {
            const farmlands = farm.farmlands;
            this.logger.debugLog(`[Seeding] Response: ${JSON.stringify(farm, null, 2)}`);

            if (taskType === 'cultivating') {
                // For cultivation: check "cleared" fields (need plowing)
                if (farmlands.cleared) {
                    for (const [id, farmland] of Object.entries(farmlands.cleared.data)) {
                        if (farmlands.cleared.canCultivate > 0) {
                            tasks.push({
                                type: 'plowing',
                                farmId: Number(farmId),
                                farmlandId: farmland.farmlandId,
                                userFarmlandId: farmland.id,
                                area: farmland.area,
                                complexityIndex: farmland.complexityIndex,
                                farmlandName: farmland.farmlandName,
                            });
                        }
                    }
                }
                // Also check "raw" fields that need clearing
                if (farmlands.raw) {
                    for (const [id, farmland] of Object.entries((farmlands as any).raw.data)) {
                        const fl = farmland as FarmlandData;
                        if ((farmlands as any).raw.canCultivate > 0) {
                            tasks.push({
                                type: 'clearing',
                                farmId: Number(farmId),
                                farmlandId: fl.farmlandId,
                                userFarmlandId: fl.id,
                                area: fl.area,
                                complexityIndex: fl.complexityIndex,
                                farmlandName: fl.farmlandName,
                            });
                        }
                    }
                }
            } else if (taskType === 'seeding') {
                // For seeding: check "fertilized" fields (ready for fertilizing)
                if (farmlands.fertilized) {
                    for (const [id, farmland] of Object.entries(farmlands.fertilized.data)) {
                        if (farmlands.fertilized.canCultivate > 0) {
                            tasks.push({
                                type: 'seeding',
                                farmId: Number(farmId),
                                farmlandId: farmland.farmlandId,
                                userFarmlandId: farmland.id,
                                area: farmland.area,
                                complexityIndex: farmland.complexityIndex,
                                farmlandName: farmland.farmlandName,
                            });
                        }
                    }
                }

               // For seeding: check "plowed" fields (ready for seeding)
               if (farmlands.plowed) {
                for (const [id, farmland] of Object.entries(farmlands.plowed.data)) {
                    if (farmlands.plowed.canCultivate > 0) {
                        tasks.push({
                            type: 'seeding',
                            farmId: Number(farmId),
                            farmlandId: farmland.farmlandId,
                            userFarmlandId: farmland.id,
                            area: farmland.area,
                            complexityIndex: farmland.complexityIndex,
                            farmlandName: farmland.farmlandName,
                        });
                    }
                }
            
            }
            } else if (taskType === 'fertilizing') {
                // For fertilizing: check "plowed" fields (ready for fertilizing)
                if (farmlands.plowed) {
                    for (const [id, farmland] of Object.entries(farmlands.plowed.data)) {
                        if (farmlands.plowed.canCultivate > 0) {
                            tasks.push({
                                type: 'fertilizing',
                                farmId: Number(farmId),
                                farmlandId: farmland.farmlandId,
                                userFarmlandId: farmland.id,
                                area: farmland.area,
                                complexityIndex: farmland.complexityIndex,
                                farmlandName: farmland.farmlandName,
                            });
                        }
                    }
                }
            }
        }

        return tasks;
    }

    /**
     * Gets pending task counters
     */
    async getTaskCounts(): Promise<{
        pending: number;
        cultivate: number;
        harvesting: number;
        seed: number;
        silo: number;
    }> {
        const response = await this.api.getCultivatingTab();
        return response.count;
    }

    /**
     * Gets details of a specific farm
     */
    async getFarmlandDetails(farmlandId: number) {
        return this.api.getFarmlandDetails(farmlandId);
    }
}
