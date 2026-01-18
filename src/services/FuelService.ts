// ============================================
// Farm Manager Bot - Fuel Service
// ============================================

import { ApiClient } from '../api/client';
import { FuelSiloResponse, BuyFuelResponse } from '../types';
import { Logger } from '../utils/logger';

// Fuel configuration
const FUEL_MIN_LEVEL = 1000; // Minimum liters to maintain
const FUEL_PRICE_THRESHOLD = 1000; // Price considered "low" to buy

export class FuelService {
    private api: ApiClient;
    private logger: Logger;

    constructor(api: ApiClient, logger: Logger) {
        this.api = api;
        this.logger = logger;
    }

    /**
     * Gets complete fuel silo status
     */
    async getFuelStatus(): Promise<FuelSiloResponse> {
        return this.api.getFuelSilo();
    }

    /**
     * Checks if fuel needs to be purchased
     * Returns true if:
     * - Fuel is below 1000L
     * - OR current price is below 1000 (good price)
     */
    async shouldBuyFuel(): Promise<{
        shouldBuy: boolean;
        reason: string;
        currentLevel: number;
        currentPrice: number;
        maxCanBuy: number;
    }> {
        const status = await this.getFuelStatus();
        const currentLevel = status.fuelSilo.siloHolding;
        const currentPrice = status.fuelCost;
        const remainingCapacity = status.fuelSilo.remainingCapacity;

        // Check if below minimum
        if (currentLevel < FUEL_MIN_LEVEL) {
            return {
                shouldBuy: true,
                reason: `Fuel low (${currentLevel}L < ${FUEL_MIN_LEVEL}L)`,
                currentLevel,
                currentPrice,
                maxCanBuy: remainingCapacity,
            };
        }

        // Check if price is good to fill up
        if (currentPrice < FUEL_PRICE_THRESHOLD && remainingCapacity > 0) {
            return {
                shouldBuy: true,
                reason: `Low price ($${currentPrice}/1000L < $${FUEL_PRICE_THRESHOLD})`,
                currentLevel,
                currentPrice,
                maxCanBuy: remainingCapacity,
            };
        }

        return {
            shouldBuy: false,
            reason: 'Fuel OK',
            currentLevel,
            currentPrice,
            maxCanBuy: remainingCapacity,
        };
    }

    /**
     * Buys fuel
     */
    async buyFuel(amount: number): Promise<BuyFuelResponse> {
        return this.api.buyFuel(amount);
    }

    /**
     * Checks and buys fuel automatically if necessary
     * Returns true if bought, false if not needed
     */
    async checkAndBuyFuel(): Promise<boolean> {
        const status = await this.getFuelStatus();
        const currentLevel = status.fuelSilo.siloHolding;
        const currentPrice = status.fuelCost;
        const remainingCapacity = status.fuelSilo.remainingCapacity;
        const accountBalance = status.user.account;

        // Log status with balance
        this.logger.fuel(
            `Fuel: ${currentLevel.toLocaleString()}L | ` +
            `Price: $${currentPrice.toLocaleString()}/1000L | ` +
            `💰 Balance: $${accountBalance.toLocaleString()}`
        );

        // Check if needs to buy
        let shouldBuy = false;
        let reason = '';

        if (currentLevel < FUEL_MIN_LEVEL) {
            shouldBuy = true;
            reason = `Fuel low (${currentLevel}L < ${FUEL_MIN_LEVEL}L)`;
        } else if (currentPrice < FUEL_PRICE_THRESHOLD && remainingCapacity > 0) {
            shouldBuy = true;
            reason = `Low price ($${currentPrice}/1000L < $${FUEL_PRICE_THRESHOLD})`;
        }

        if (!shouldBuy) {
            this.logger.debugLog(`[Fuel] Fuel OK`);
            return false;
        }

        this.logger.info(`⛽ ${reason}`);

        // Calculate how much to buy
        // If low, buy up to minimum + margin
        // If price is good, fill the tank
        let amountToBuy: number;

        if (currentLevel < FUEL_MIN_LEVEL) {
            // Buy to reach 2000L (safety margin)
            const targetLevel = 2000;
            amountToBuy = Math.min(targetLevel - currentLevel, remainingCapacity);
        } else {
            // Good price - fill the tank
            amountToBuy = remainingCapacity;
        }

        if (amountToBuy <= 0) {
            this.logger.warn('Fuel silo is full');
            return false;
        }

        try {
            const result = await this.buyFuel(amountToBuy);

            if (result.success) {
                this.logger.success(
                    `⛽ Bought ${result.amount.toLocaleString()}L of fuel for $${result.cost.toLocaleString()}`
                );
                return true;
            } else {
                this.logger.warn('Failed to buy fuel');
                return false;
            }
        } catch (error) {
            this.logger.error('Error buying fuel', error as Error);
            return false;
        }
    }

    /**
     * Logs fuel status
     */
    async logFuelStatus(): Promise<void> {
        const status = await this.getFuelStatus();
        const silo = status.fuelSilo;

        this.logger.fuel(
            `Fuel: ${silo.siloHolding.toLocaleString()}L / ${silo.siloCapacity.toLocaleString()}L (${silo.pctFull.toFixed(1)}%) | ` +
            `Current price: $${status.fuelCost.toLocaleString()}/1000L`
        );
    }
}
