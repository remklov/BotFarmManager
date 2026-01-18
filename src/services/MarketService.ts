// ============================================
// Farm Manager Bot - Market Service
// ============================================

import { ApiClient } from '../api/client';
import { CropValue, CropValuesResponse, SellProductResponse } from '../types';
import { Logger } from '../utils/logger';
import { SiloService } from './SiloService';

export interface SellResult {
    success: boolean;
    productId: number;
    productName: string;
    amountSold: number;
    income: number;
    remaining: number;
}

export interface ProductToSell {
    id: number;
    name: string;
    pctFull: number;
    amount: number;
}

export class MarketService {
    private api: ApiClient;
    private logger: Logger;
    private siloService: SiloService;
    private cropNames: Map<number, string> = new Map();

    constructor(api: ApiClient, siloService: SiloService, logger: Logger) {
        this.api = api;
        this.siloService = siloService;
        this.logger = logger;
    }

    /**
     * Gets current values of all products in the market
     */
    async getCropValues(): Promise<Record<string, CropValue>> {
        const response = await this.api.getCropValues();
        return response.cropValues;
    }

    /**
     * Gets the value of a specific product
     */
    async getCropValue(cropId: number): Promise<CropValue | null> {
        const values = await this.getCropValues();
        return values[String(cropId)] || null;
    }

    /**
     * Sells all stock of a product
     */
    async sellProduct(cropId: number, productName?: string): Promise<SellResult> {
        try {
            const response = await this.api.sellProduct(cropId, 'all');

            const result: SellResult = {
                success: response.success === 1,
                productId: cropId,
                productName: response.cropData?.name || productName || `Crop ${cropId}`,
                amountSold: response.amount,
                income: response.income,
                remaining: response.remaining,
            };

            if (result.success) {
                this.logger.market(
                    `Sold ${result.amountSold.toLocaleString()}kg of ${result.productName} for $${result.income.toLocaleString()}`
                );
            } else {
                this.logger.warn(`Failed to sell ${result.productName}`);
            }

            return result;
        } catch (error) {
            this.logger.error(`Error selling product ${cropId}`, error as Error);
            return {
                success: false,
                productId: cropId,
                productName: productName || `Crop ${cropId}`,
                amountSold: 0,
                income: 0,
                remaining: 0,
            };
        }
    }

    /**
     * Sells multiple products
     */
    async sellMultipleProducts(
        products: Array<{ id: number; name: string }>
    ): Promise<SellResult[]> {
        const results: SellResult[] = [];

        for (const product of products) {
            const result = await this.sellProduct(product.id, product.name);
            results.push(result);

            // Small delay between sales to avoid rate limiting
            await this.delay(500);
        }

        return results;
    }

    /**
     * Calculates total value that would be obtained by selling a product
     */
    async estimateSaleValue(cropId: number, amount: number): Promise<number> {
        const value = await this.getCropValue(cropId);
        if (!value) return 0;

        // cropValuePer1k é o valor por 1000kg
        return (amount / 1000) * value.cropValuePer1k;
    }

    /**
     * Checks if it's a good time to sell (price rising)
     */
    async isPriceIncreasing(cropId: number): Promise<boolean> {
        const value = await this.getCropValue(cropId);
        return value?.priceIncrease === 1;
    }

    /**
     * Gets price history of a product
     */
    async getPriceHistory(cropId: number): Promise<number[]> {
        const response = await this.api.getCropValues();
        return response.history[String(cropId)] || [];
    }

    /**
     * Gets products with good price
     */
    async getProductsToSell(threshold: number): Promise<ProductToSell[]> {
        const silo = await this.siloService.getSiloStatus();
        const productsToSell: ProductToSell[] = [];

        this.logger.market(
            `Sell check if products can be sold...`
        );

        for (const [id, product] of Object.entries(silo.cropSilo.holding)) {
            // Implement logic to check if the product has a good price
            if (product.pctFull > 0.01) {
                const currentPrice = await this.getCropValue(product.id);
                const isGoodPrice = await this.isGoodPrice(product.id, product.pctFull);
                if (isGoodPrice || product.pctFull >= threshold) {
                    if (currentPrice) {
                        this.logger.market(
                            `Sell ${product.name} for ${currentPrice.cropValuePer1k}`
                        );
                    }
                    productsToSell.push({
                        id: product.id,
                        name: product.name,
                        pctFull: product.pctFull,
                        amount: product.amount
                    });
                }
            }
        }

        if (productsToSell.length > 0) {
            this.logger.market(
                `${productsToSell.length} product(s) to sell`
            );
        }
        return productsToSell;
    }

    /**
     * Tests if the current price is actually a good price, depending on the maxprice of the last 7 days
     */
    async isGoodPrice(cropId: number, siloPctFull: number): Promise<boolean> {
        const currentPrice = await this.getCropValue(cropId);
        if (currentPrice === null || currentPrice === undefined) {
            return true;
        }

        const maxPrice = await this.getMaxPrice(cropId, 7);
        const fillPercentage = siloPctFull * 100;
        const allowedDeviationPercent = fillPercentage / 4;
        const minAcceptablePrice = maxPrice * (1 - allowedDeviationPercent / 100);

        return currentPrice.cropValuePer1k >= minAcceptablePrice;
    }

    async getMaxPrice(cropId: number, lookBack: number): Promise<number> {
        return 6000;
    }

    /**
     * Summary of all sales
     */
    summarizeSales(results: SellResult[]): {
        totalSold: number;
        totalIncome: number;
        successCount: number;
        failedCount: number;
    } {
        return results.reduce(
            (acc, result) => ({
                totalSold: acc.totalSold + (result.success ? result.amountSold : 0),
                totalIncome: acc.totalIncome + result.income,
                successCount: acc.successCount + (result.success ? 1 : 0),
                failedCount: acc.failedCount + (result.success ? 0 : 1),
            }),
            { totalSold: 0, totalIncome: 0, successCount: 0, failedCount: 0 }
        );
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
