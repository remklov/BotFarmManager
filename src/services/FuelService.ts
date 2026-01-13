// ============================================
// Farm Manager Bot - Fuel Service
// ============================================

import { ApiClient } from '../api/client';
import { FuelSiloResponse, BuyFuelResponse } from '../types';
import { Logger } from '../utils/logger';

// Configurações de combustível
const FUEL_MIN_LEVEL = 1000; // Mínimo de litros para manter
const FUEL_PRICE_THRESHOLD = 1000; // Preço considerado "baixo" para comprar

export class FuelService {
    private api: ApiClient;
    private logger: Logger;

    constructor(api: ApiClient, logger: Logger) {
        this.api = api;
        this.logger = logger;
    }

    /**
     * Obtém status completo do silo de combustível
     */
    async getFuelStatus(): Promise<FuelSiloResponse> {
        return this.api.getFuelSilo();
    }

    /**
     * Verifica se precisa comprar combustível
     * Retorna true se:
     * - Combustível está abaixo de 1000L
     * - OU preço atual está abaixo de 1000 (bom preço)
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

        // Verificar se está abaixo do mínimo
        if (currentLevel < FUEL_MIN_LEVEL) {
            return {
                shouldBuy: true,
                reason: `Combustível baixo (${currentLevel}L < ${FUEL_MIN_LEVEL}L)`,
                currentLevel,
                currentPrice,
                maxCanBuy: remainingCapacity,
            };
        }

        // Verificar se o preço está bom para encher
        if (currentPrice < FUEL_PRICE_THRESHOLD && remainingCapacity > 0) {
            return {
                shouldBuy: true,
                reason: `Preço baixo ($${currentPrice}/1000L < $${FUEL_PRICE_THRESHOLD})`,
                currentLevel,
                currentPrice,
                maxCanBuy: remainingCapacity,
            };
        }

        return {
            shouldBuy: false,
            reason: 'Combustível OK',
            currentLevel,
            currentPrice,
            maxCanBuy: remainingCapacity,
        };
    }

    /**
     * Compra combustível
     */
    async buyFuel(amount: number): Promise<BuyFuelResponse> {
        return this.api.buyFuel(amount);
    }

    /**
     * Verifica e compra combustível automaticamente se necessário
     * Retorna true se comprou, false se não precisou
     */
    async checkAndBuyFuel(): Promise<boolean> {
        const check = await this.shouldBuyFuel();

        this.logger.fuel(
            `Combustível: ${check.currentLevel.toLocaleString()}L | ` +
            `Preço: $${check.currentPrice.toLocaleString()}/1000L`
        );

        if (!check.shouldBuy) {
            this.logger.debugLog(`[Fuel] ${check.reason}`);
            return false;
        }

        this.logger.info(`⛽ ${check.reason}`);

        // Calcular quanto comprar
        // Se está baixo, comprar até o mínimo + margem
        // Se preço está bom, encher o tanque
        let amountToBuy: number;

        if (check.currentLevel < FUEL_MIN_LEVEL) {
            // Comprar para ficar com 2000L (margem de segurança)
            const targetLevel = 2000;
            amountToBuy = Math.min(targetLevel - check.currentLevel, check.maxCanBuy);
        } else {
            // Preço bom - encher o tanque
            amountToBuy = check.maxCanBuy;
        }

        if (amountToBuy <= 0) {
            this.logger.warn('Silo de combustível está cheio');
            return false;
        }

        try {
            const result = await this.buyFuel(amountToBuy);

            if (result.success) {
                this.logger.success(
                    `⛽ Comprado ${result.amount.toLocaleString()}L de combustível por $${result.cost.toLocaleString()}`
                );
                return true;
            } else {
                this.logger.warn('Falha ao comprar combustível');
                return false;
            }
        } catch (error) {
            this.logger.error('Erro ao comprar combustível', error as Error);
            return false;
        }
    }

    /**
     * Loga status do combustível
     */
    async logFuelStatus(): Promise<void> {
        const status = await this.getFuelStatus();
        const silo = status.fuelSilo;

        this.logger.fuel(
            `Combustível: ${silo.siloHolding.toLocaleString()}L / ${silo.siloCapacity.toLocaleString()}L (${silo.pctFull.toFixed(1)}%) | ` +
            `Preço atual: $${status.fuelCost.toLocaleString()}/1000L`
        );
    }
}
