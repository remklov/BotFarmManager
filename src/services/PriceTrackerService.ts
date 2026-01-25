// ============================================
// Farm Manager Bot - Price Tracker Service
// Tracks crop prices over time (10 days history)
// Uses CSV format for efficient storage
// ============================================

import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/logger';
import { ApiClient } from '../api/client';
import { ConfigManager } from '../config/ConfigManager';
import { AuthService } from './AuthService';

const PRICE_HISTORY_FILE = path.join(process.cwd(), 'price-history.csv');
const PRICE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY_DAYS = 10;
const MAX_HISTORY_MS = MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;

// Parsed row from CSV
interface PriceRow {
    timestamp: string;
    prices: Record<string, number>;  // cropId -> price
}

class PriceTrackerServiceClass {
    private logger: Logger;
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private apiClient: ApiClient | null = null;

    constructor() {
        this.logger = new Logger('PriceTracker');
    }

    /**
     * Parse CSV file into structured data
     */
    private parseCSV(): { cropIds: string[]; rows: PriceRow[] } {
        const cropIds: string[] = [];
        const rows: PriceRow[] = [];

        try {
            if (!fs.existsSync(PRICE_HISTORY_FILE)) {
                return { cropIds, rows };
            }

            const content = fs.readFileSync(PRICE_HISTORY_FILE, 'utf-8');
            const lines = content.trim().split('\n');

            if (lines.length === 0) {
                return { cropIds, rows };
            }

            // Parse header (timestamp,cropId1,cropId2,...)
            const header = lines[0].split(',');
            for (let i = 1; i < header.length; i++) {
                cropIds.push(header[i]);
            }

            // Parse data rows
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',');
                if (values.length < 2) continue;

                const timestamp = values[0];
                const prices: Record<string, number> = {};

                for (let j = 1; j < values.length && j <= cropIds.length; j++) {
                    const price = parseFloat(values[j]);
                    if (!isNaN(price)) {
                        prices[cropIds[j - 1]] = price;
                    }
                }

                rows.push({ timestamp, prices });
            }
        } catch (error) {
            this.logger.warn('Could not parse price history CSV, starting fresh');
        }

        return { cropIds, rows };
    }

    /**
     * Write CSV file from structured data
     */
    private writeCSV(cropIds: string[], rows: PriceRow[]): void {
        // Build header
        const header = ['timestamp', ...cropIds].join(',');

        // Build data rows
        const dataLines = rows.map(row => {
            const values = [row.timestamp];
            for (const cropId of cropIds) {
                values.push(row.prices[cropId]?.toString() || '');
            }
            return values.join(',');
        });

        const content = [header, ...dataLines].join('\n');
        fs.writeFileSync(PRICE_HISTORY_FILE, content);
    }

    /**
     * Append a single row to CSV (efficient for normal operation)
     */
    private appendRow(cropIds: string[], prices: Record<string, number>): void {
        const timestamp = new Date().toISOString();
        const values = [timestamp];

        for (const cropId of cropIds) {
            values.push(prices[cropId]?.toString() || '');
        }

        const line = values.join(',') + '\n';

        // If file doesn't exist, create with header
        if (!fs.existsSync(PRICE_HISTORY_FILE)) {
            const header = ['timestamp', ...cropIds].join(',') + '\n';
            fs.writeFileSync(PRICE_HISTORY_FILE, header + line);
        } else {
            fs.appendFileSync(PRICE_HISTORY_FILE, line);
        }
    }

    /**
     * Clean up old price data (older than 10 days)
     */
    private cleanupOldData(): number {
        const { cropIds, rows } = this.parseCSV();
        const cutoffTime = Date.now() - MAX_HISTORY_MS;

        const filteredRows = rows.filter(row =>
            new Date(row.timestamp).getTime() > cutoffTime
        );

        const removed = rows.length - filteredRows.length;

        if (removed > 0) {
            this.writeCSV(cropIds, filteredRows);
            this.logger.debugLog(`Cleaned up ${removed} old price entries`);
        }

        return removed;
    }

    /**
     * Get or create an API client for price fetching
     */
    private async getApiClient(): Promise<ApiClient | null> {
        if (this.apiClient) {
            return this.apiClient;
        }

        // Get first enabled account for price fetching
        const account = ConfigManager.getAccounts().find(a => a.enabled);
        if (!account) {
            this.logger.warn('No enabled account available for price fetching');
            return null;
        }

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
                this.apiClient = new ApiClient(phpSessionId, this.logger);
                return this.apiClient;
            }
        } catch (error) {
            this.logger.error('Failed to create API client for price tracking', error as Error);
        }

        return null;
    }

    /**
     * Fetch current prices and add to history
     */
    async fetchAndStorePrices(): Promise<boolean> {
        const apiClient = await this.getApiClient();
        if (!apiClient) {
            this.logger.error('Cannot fetch prices - no API client available');
            return false;
        }

        try {
            this.logger.info('Fetching current crop prices...');

            // Get actual crop values (sell prices)
            const cropValuesResponse = await apiClient.getCropValues();

            if (!cropValuesResponse?.cropValues) {
                this.logger.warn('No crop values received');
                return false;
            }

            // Get current crop IDs from response
            const newCropIds = Object.keys(cropValuesResponse.cropValues).sort((a, b) => parseInt(a) - parseInt(b));

            // Build prices map
            const prices: Record<string, number> = {};
            for (const [cropId, cropValue] of Object.entries(cropValuesResponse.cropValues)) {
                prices[cropId] = cropValue.cropValuePer1k;
            }

            // Check if we need to add new columns (new crops discovered)
            const { cropIds: existingCropIds, rows } = this.parseCSV();
            const hasNewCrops = newCropIds.some(id => !existingCropIds.includes(id));

            if (hasNewCrops || existingCropIds.length === 0) {
                // Need to rewrite CSV with new columns
                const allCropIds = [...new Set([...existingCropIds, ...newCropIds])].sort((a, b) => parseInt(a) - parseInt(b));

                // Add new row
                rows.push({
                    timestamp: new Date().toISOString(),
                    prices
                });

                this.writeCSV(allCropIds, rows);
                this.logger.info(`Added ${newCropIds.length - existingCropIds.length} new crop columns to price history`);
            } else {
                // Just append the new row (efficient)
                this.appendRow(existingCropIds, prices);
            }

            // Periodic cleanup (every ~24 hours worth of data points)
            const { rows: currentRows } = this.parseCSV();
            if (currentRows.length > 0 && currentRows.length % 48 === 0) {
                this.cleanupOldData();
            }

            this.logger.success(`Stored prices for ${newCropIds.length} crops`);
            return true;
        } catch (error) {
            this.logger.error('Failed to fetch and store prices', error as Error);
            return false;
        }
    }

    /**
     * Start the price tracking scheduler
     */
    start(): void {
        if (this.isRunning) {
            this.logger.warn('Price tracker is already running');
            return;
        }

        this.logger.info('Starting price tracker...');
        this.logger.info(`Will fetch prices every ${PRICE_CHECK_INTERVAL_MS / 60000} minutes`);
        this.logger.info(`Storing history for ${MAX_HISTORY_DAYS} days`);

        this.isRunning = true;

        // Fetch immediately on start
        this.fetchAndStorePrices().catch(err => {
            this.logger.error('Initial price fetch failed', err);
        });

        // Schedule periodic fetches
        this.intervalId = setInterval(() => {
            this.fetchAndStorePrices().catch(err => {
                this.logger.error('Scheduled price fetch failed', err);
            });
        }, PRICE_CHECK_INTERVAL_MS);

        this.logger.success('Price tracker started');
    }

    /**
     * Stop the price tracking scheduler
     */
    stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.logger.info('Stopping price tracker...');

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        this.apiClient = null;
        this.logger.success('Price tracker stopped');
    }

    /**
     * Check if the tracker is running
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Get price statistics for a crop
     */
    getCropStats(cropId: string): {
        current: number | null;
        min: number | null;
        max: number | null;
        avg: number | null;
        trend: 'up' | 'down' | 'stable' | null;
        priceCount: number;
    } | null {
        const { rows } = this.parseCSV();

        // Extract prices for this crop
        const prices: number[] = [];
        for (const row of rows) {
            if (row.prices[cropId] !== undefined) {
                prices.push(row.prices[cropId]);
            }
        }

        if (prices.length === 0) {
            return null;
        }

        const current = prices[prices.length - 1];
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;

        // Calculate trend (compare last 6 hours avg to previous 6 hours)
        let trend: 'up' | 'down' | 'stable' | null = null;
        if (prices.length >= 12) { // At least 6 hours of data (12 x 30min)
            const recentPrices = prices.slice(-12);
            const olderPrices = prices.slice(-24, -12);

            if (olderPrices.length > 0) {
                const recentAvg = recentPrices.reduce((s, p) => s + p, 0) / recentPrices.length;
                const olderAvg = olderPrices.reduce((s, p) => s + p, 0) / olderPrices.length;
                const change = (recentAvg - olderAvg) / olderAvg;

                if (change > 0.02) trend = 'up';
                else if (change < -0.02) trend = 'down';
                else trend = 'stable';
            }
        }

        return {
            current,
            min,
            max,
            avg,
            trend,
            priceCount: prices.length
        };
    }

    /**
     * Get all crop statistics
     */
    getAllCropStats(): Record<string, {
        name: string;
        type: string;
        current: number | null;
        min: number | null;
        max: number | null;
        avg: number | null;
        percentFromLow: number | null;
        trend: 'up' | 'down' | 'stable' | null;
    }> {
        const { cropIds } = this.parseCSV();
        const result: Record<string, any> = {};

        // Get crop names from farm data (first enabled account)
        const account = ConfigManager.getAccounts().find(a => a.enabled);
        let cropNames: Record<string, { name: string; type: string }> = {};

        if (account) {
            try {
                const farmDataFile = path.join(process.cwd(), 'farm-data.json');
                if (fs.existsSync(farmDataFile)) {
                    const farmData = JSON.parse(fs.readFileSync(farmDataFile, 'utf-8'));
                    const accountData = farmData.accounts?.[account.id];
                    if (accountData?.crops) {
                        for (const [id, crop] of Object.entries(accountData.crops) as [string, any][]) {
                            cropNames[id] = { name: crop.name, type: crop.type };
                        }
                    }
                }
            } catch (e) {
                // Ignore errors reading farm data
            }
        }

        for (const cropId of cropIds) {
            const stats = this.getCropStats(cropId);
            if (stats && stats.current !== null) {
                const percentFromLow = stats.min !== null && stats.min > 0
                    ? ((stats.current - stats.min) / stats.min) * 100
                    : null;

                result[cropId] = {
                    name: cropNames[cropId]?.name || `Crop ${cropId}`,
                    type: cropNames[cropId]?.type || 'unknown',
                    current: stats.current,
                    min: stats.min,
                    max: stats.max,
                    avg: stats.avg,
                    percentFromLow,
                    trend: stats.trend
                };
            }
        }

        return result;
    }

    /**
     * Get price history for a specific crop
     */
    getCropPriceHistory(cropId: string): { timestamp: string; price: number }[] {
        const { rows } = this.parseCSV();

        return rows
            .filter(row => row.prices[cropId] !== undefined)
            .map(row => ({
                timestamp: row.timestamp,
                price: row.prices[cropId]
            }));
    }

    /**
     * Get summary statistics
     */
    getSummary(): {
        totalCrops: number;
        totalPricePoints: number;
        oldestData: string | null;
        newestData: string | null;
        isRunning: boolean;
    } {
        const { cropIds, rows } = this.parseCSV();

        let oldestTimestamp: string | null = null;
        let newestTimestamp: string | null = null;

        if (rows.length > 0) {
            oldestTimestamp = rows[0].timestamp;
            newestTimestamp = rows[rows.length - 1].timestamp;
        }

        // Count total price points (non-empty cells)
        let totalPricePoints = 0;
        for (const row of rows) {
            totalPricePoints += Object.keys(row.prices).length;
        }

        return {
            totalCrops: cropIds.length,
            totalPricePoints,
            oldestData: oldestTimestamp,
            newestData: newestTimestamp,
            isRunning: this.isRunning
        };
    }

    /**
     * Force cleanup of old data
     */
    forceCleanup(): number {
        return this.cleanupOldData();
    }
}

// Export singleton instance
export const PriceTrackerService = new PriceTrackerServiceClass();
