// ============================================
// Farm Manager Bot - Seed Service
// ============================================

import { ApiClient } from '../api/client';
import { CropScore, MarketSeed, SeedInventory } from '../types';
import { Logger } from '../utils/logger';
import { getConfiguredCropForFarmland } from '../server';

export interface BestSeedResult {
    cropId: number;
    cropName: string;
    score: number;
    kgPerHa: number;
    seedCost: number;
    requiredAmount: number;
    currentStock: number;
    needToBuy: number;
}

export class SeedService {
    private api: ApiClient;
    private logger: Logger;

    constructor(api: ApiClient, logger: Logger) {
        this.api = api;
        this.logger = logger;
    }

    /**
     * Determines the best seed for a farm based on:
     * 1. Configured crop for this farmland (if set)
     * 2. Land cropScores
     * 3. Unlocked seeds in the market
     * 4. Ability to purchase
     */
    async getBestSeedForFarmland(farmlandId: number, area: number, forceSeedName?: string): Promise<BestSeedResult | null> {
        this.logger.debugLog(`[SeedService] Searching for best seed for farmlandId: ${farmlandId}, area: ${area}ha`);

        // 0. Check for configured crop for this farmland
        const configuredCropId = getConfiguredCropForFarmland(farmlandId);
        if (configuredCropId) {
            this.logger.info(`🌱 Using configured crop (ID: ${configuredCropId}) for farmland ${farmlandId}`);
        }

        // 1. Get cropScores from land
        const farmlandData = await this.api.getFarmlandData(farmlandId);

        if (!farmlandData.cropScores) {
            this.logger.warn('[SeedService] Could not get cropScores from land');
            return null;
        }

        const cropScores = farmlandData.cropScores as Record<string, CropScore>;
        this.logger.debugLog(`[SeedService] Found ${Object.keys(cropScores).length} cropScores`);

        // 2. Get available seeds from market
        const marketData = await this.api.getMarketSeeds();

        if (!marketData.seed || !Array.isArray(marketData.seed)) {
            this.logger.warn('[SeedService] Could not get seeds from market');
            return null;
        }

        const marketSeeds = marketData.seed as MarketSeed[];

        // Create map of unlocked seeds by ID
        const unlockedSeeds = new Map<number, MarketSeed>();
        for (const seed of marketSeeds) {
            if (seed.unlocked === 1 && seed.canAfford === 1) {
                unlockedSeeds.set(seed.id, seed);
            }
        }
        this.logger.debugLog(`[SeedService] ${unlockedSeeds.size} unlocked and available seeds`);

        // 3. Sort cropScores by score (highest first)
        const sortedScores = Object.entries(cropScores)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.score - a.score);

        // 4. Check for configured crop first (highest priority)
        if (configuredCropId) {
            for (const crop of sortedScores) {
                if (crop.id === configuredCropId) {
                    const marketSeed = unlockedSeeds.get(crop.id);

                    if (marketSeed) {
                        const requiredAmount = Math.ceil(area * marketSeed.kgPerHa);
                        const currentStock = await this.getSeedStock(crop.id);
                        const needToBuy = Math.max(0, requiredAmount - currentStock);

                        this.logger.info(
                            `🌱 Configured seed: ${crop.name} (Score: ${crop.score}) - ` +
                            `Needed: ${requiredAmount}kg, Stock: ${currentStock}kg, Buy: ${needToBuy}kg`
                        );

                        return {
                            cropId: crop.id,
                            cropName: crop.name,
                            score: crop.score,
                            kgPerHa: marketSeed.kgPerHa,
                            seedCost: marketSeed.seedCost,
                            requiredAmount,
                            currentStock,
                            needToBuy,
                        };
                    } else {
                        this.logger.warn(`[SeedService] Configured crop ${crop.name} (ID: ${configuredCropId}) is not available in market`);
                    }
                }
            }
            // If configured crop not found in cropScores, log warning and fall through to normal logic
            this.logger.warn(`[SeedService] Configured crop ID ${configuredCropId} not found, falling back to auto selection`);
        }

        // 5. Find the best available seed
        if (forceSeedName) {
            this.logger.info(`🌱 Forcing seed: ${forceSeedName}`);
            for (const crop of sortedScores) {
                if (crop.name === forceSeedName) {
                    const marketSeed = unlockedSeeds.get(crop.id);
    
                    if (marketSeed) {
                        // Calculate required amount
                        const requiredAmount = Math.ceil(area * marketSeed.kgPerHa);
    
                        // Check current stock
                        const currentStock = await this.getSeedStock(crop.id);
                        const needToBuy = Math.max(0, requiredAmount - currentStock);
    
                        this.logger.info(
                            `🌱 Forced seed: ${crop.name} (Score: ${crop.score}) - ` +
                            `Needed: ${requiredAmount}kg, Stock: ${currentStock}kg, Buy: ${needToBuy}kg`
                        );
    
                        return {
                            cropId: crop.id,
                            cropName: crop.name,
                            score: crop.score,
                            kgPerHa: marketSeed.kgPerHa,
                            seedCost: marketSeed.seedCost,
                            requiredAmount,
                            currentStock,
                            needToBuy,
                        };
                    }
                }
            }
        } else {
            // Otherwise return the best seed from the market
            for (const crop of sortedScores) {
                const marketSeed = unlockedSeeds.get(crop.id);

                if (marketSeed) {
                    // Calculate required amount
                    const requiredAmount = Math.ceil(area * marketSeed.kgPerHa);

                    // Check current stock
                    const currentStock = await this.getSeedStock(crop.id);
                    const needToBuy = Math.max(0, requiredAmount - currentStock);

                    this.logger.info(
                        `🌱 Best seed: ${crop.name} (Score: ${crop.score}) - ` +
                        `Needed: ${requiredAmount}kg, Stock: ${currentStock}kg, Buy: ${needToBuy}kg`
                    );

                    return {
                        cropId: crop.id,
                        cropName: crop.name,
                        score: crop.score,
                        kgPerHa: marketSeed.kgPerHa,
                        seedCost: marketSeed.seedCost,
                        requiredAmount,
                        currentStock,
                        needToBuy,
                    };
                }
            }
        }        

        this.logger.warn('[SeedService] No suitable seed found');
        return null;
    }

    /**
     * Checks current stock of a seed
     */
    async getSeedStock(cropId: number): Promise<number> {
        try {
            const response = await this.api.getSeedingTab();

            if (response.seed && response.seed[String(cropId)]) {
                return response.seed[String(cropId)].amount || 0;
            }

            return 0;
        } catch (error) {
            this.logger.debugLog(`[SeedService] Error checking stock for cropId ${cropId}`);
            return 0;
        }
    }

    /**
     * Buys seeds if necessary
     */
    async ensureSeedAvailable(cropId: number, requiredAmount: number): Promise<boolean> {
        const currentStock = await this.getSeedStock(cropId);
        const needToBuy = Math.max(0, requiredAmount - currentStock);

        if (needToBuy === 0) {
            this.logger.debugLog(`[SeedService] Stock sufficient (${currentStock}kg)`);
            return true;
        }

        // Get seed name from seeding tab response
        let seedName = `cropId ${cropId}`;
        try {
            const response = await this.api.getSeedingTab();
            if (response.seed && response.seed[String(cropId)]) {
                seedName = response.seed[String(cropId)].name || seedName;
            }
        } catch (error) {
            // If we can't get the name, use the default
            this.logger.debugLog(`[SeedService] Could not get seed name for cropId ${cropId}`);
        }

        this.logger.info(`💰 Buying ${needToBuy}kg of ${seedName} seeds (cropId: ${cropId})...`);

        try {
            const result = await this.api.buySeeds(cropId, needToBuy);

            if (result.success === 1) {
                this.logger.success(`✅ Purchase completed: ${result.amount}kg of ${seedName} for $${result.cost}`);
                return true;
            } else {
                this.logger.warn(`[SeedService] Seed purchase failed`);
                return false;
            }
        } catch (error) {
            this.logger.error('[SeedService] Error buying seeds', error as Error);
            return false;
        }
    }

    /**
     * Complete flow: finds best seed and ensures availability
     */
    async prepareForSeeding(farmlandId: number, area: number, forceSeedName?: string): Promise<BestSeedResult | null> {
        // 1. Find best seed
        const bestSeed = await this.getBestSeedForFarmland(farmlandId, area, forceSeedName);

        if (!bestSeed) {
            return null;
        }

        // 2. Ensure we have enough seeds
        if (bestSeed.needToBuy > 0) {
            const purchased = await this.ensureSeedAvailable(bestSeed.cropId, bestSeed.requiredAmount);

            if (!purchased) {
                this.logger.warn('[SeedService] Could not purchase necessary seeds');
                return null;
            }
        }

        return bestSeed;
    }
}
