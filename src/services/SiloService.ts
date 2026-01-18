// ============================================
// Farm Manager Bot - Silo Service
// ============================================

import { ApiClient } from '../api/client';
import { MarketService } from './MarketService';
import { SiloTabResponse, SiloProduct } from '../types';
import { Logger } from '../utils/logger';

export interface ProductToSell {
    id: number;
    name: string;
    pctFull: number;
    amount: number;
    relativePrice: number;
}

export class SiloService {
    private api: ApiClient;
    private logger: Logger;
    private marketService: MarketService;

    constructor(api: ApiClient, MarketService: MarketService, logger: Logger) {
        this.api = api;
        this.marketService = MarketService;
        this.logger = logger;
    }

    /**
     * Gets complete silo status
     */
    async getSiloStatus(): Promise<SiloTabResponse> {
        return this.api.getSiloTab();
    }

    /**
     * Checks total silo capacity
     */
    async getSiloCapacity(): Promise<{
        capacity: number;
        totalHolding: number;
        pctFull: number;
    }> {
        const silo = await this.getSiloStatus();
        return {
            capacity: silo.cropSilo.siloCapacity,
            totalHolding: silo.cropSilo.totalHolding,
            pctFull: silo.cropSilo.pctFull,
        };
    }

    /**
     * Gets all products stored in the silo
     */
    async getStoredProducts(): Promise<SiloProduct[]> {
        const silo = await this.getSiloStatus();
        return Object.values(silo.cropSilo.holding);
    }

    /**
     * Gets products above a percentage threshold
     */
    async getProductsAboveThreshold(threshold: number): Promise<ProductToSell[]> {
        const silo = await this.getSiloStatus();
        const productsToSell: ProductToSell[] = [];

        for (const [id, product] of Object.entries(silo.cropSilo.holding)) {
            if (product.pctFull >= threshold) {
                productsToSell.push({
                    id: product.id,
                    name: product.name,
                    pctFull: product.pctFull,
                    amount: product.amount,
                    relativePrice: 0,
                });
            }
        }

        if (productsToSell.length > 0) {
            this.logger.silo(
                `${productsToSell.length} product(s) above ${threshold}% to sell`
            );
        }
        return productsToSell;
    }

    /**
     * Gets products with good price
     */
    async getProductsWithGoodPrice(): Promise<ProductToSell[]> {
        const silo = await this.getSiloStatus();
        const productsToSell: ProductToSell[] = [];

        for (const [id, product] of Object.entries(silo.cropSilo.holding)) {
            // Implement logic to check if the product has a good price
            if (product.pctFull > 0.01) {
                const currentPrice = await this.marketService.getCropValue(product.id);
                if (currentPrice && currentPrice.cropValuePer1k > 5500) {
                    this.logger.silo(`${product.name} has a good price: ${currentPrice.cropValuePer1k}`);
                    productsToSell.push({
                        id: product.id,
                        name: product.name,
                        pctFull: product.pctFull,
                        amount: product.amount,
                        relativePrice: 0,
                    });
                }
            }
        }

        if (productsToSell.length > 0) {
            this.logger.silo(
                `${productsToSell.length} product(s) with good market price to sell`
            );
        }
        return productsToSell;
    }

    /**
     * Gets products to sell
     */
    async getProductsToSell(threshold: number): Promise<ProductToSell[]> {
        const aboveThreshold = await this.getProductsAboveThreshold(threshold);
        const goodPrice = await this.getProductsWithGoodPrice();

        return [...aboveThreshold, ...goodPrice];
    }
    

    /**
     * Checks if any product is above the threshold
     */
    async hasProductsOverThreshold(threshold: number): Promise<boolean> {
        const products = await this.getProductsAboveThreshold(threshold);
        return products.length > 0;
    }

    /**
     * Gets a specific product by ID
     */
    async getProductById(productId: number): Promise<SiloProduct | null> {
        const products = await this.getStoredProducts();
        return products.find(p => p.id === productId) || null;
    }

    /**
     * Logs silo status
     */
    async logSiloStatus(): Promise<void> {
        const products = await this.getStoredProducts();

        // Calculate totals based on individual capacity of each grain
        let totalStored = 0;
        let totalCapacity = 0;

        for (const product of products) {
            const productCapacity = product.amount + product.remainingCapacity;
            totalStored += product.amount;
            totalCapacity += productCapacity;
        }

        const totalPct = totalCapacity > 0 ? (totalStored / totalCapacity) * 100 : 0;

        this.logger.silo(
            `Total Silo: ${totalStored.toLocaleString()}kg stored`
        );

        for (const product of products) {
            const productCapacity = product.amount + product.remainingCapacity;
            this.logger.silo(
                `  - ${product.name}: ${product.amount.toLocaleString()}kg / ${productCapacity.toLocaleString()}kg (${product.pctFull.toFixed(2)}%)`
            );
        }
    }
}
