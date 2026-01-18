// ============================================
// Farm Manager Bot - API Client
// ============================================

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
    BaseResponse,
    CultivatingTabResponse,
    SeedingTabResponse,
    HarvestTabResponse,
    PendingTabResponse,
    SiloTabResponse,
    CropValuesResponse,
    SellProductResponse,
    FarmlandDetailsResponse,
    BatchActionResponse,
    BatchActionUnit,
    FuelSiloResponse,
    BuyFuelResponse,
} from '../types';
import { Logger } from '../utils/logger';

const BASE_URL = 'https://farm-app.trophyapi.com/api';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G973F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.146 Mobile Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'sec-ch-ua-platform': '"Android"',
    'x-requested-with': 'XMLHttpRequest',
    'sec-ch-ua': '"Android WebView";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'sec-ch-ua-mobile': '?1',
    'Origin': 'https://farm-app.trophyapi.com',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'Referer': 'https://farm-app.trophyapi.com/index.php',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Priority': 'u=1, i',
};

export class ApiClient {
    private client: AxiosInstance;
    private sessionId: string;
    private currentBT: string = '';
    private logger: Logger;

    constructor(sessionId: string, logger: Logger) {
        this.sessionId = sessionId;
        this.logger = logger;

        this.client = axios.create({
            baseURL: BASE_URL,
            headers: {
                ...DEFAULT_HEADERS,
                Cookie: `device=android; PHPSESSID=${sessionId}`,
            },
        });
    }

    private updateBT(response: BaseResponse): void {
        if (response.BT) {
            this.currentBT = response.BT;
            this.logger.debugLog(`BT token updated: ${this.currentBT.substring(0, 8)}...`);
        }
    }

    private buildFormData(data: Record<string, string | number | undefined>): URLSearchParams {
        const params = new URLSearchParams();

        // Always include BT if available
        if (this.currentBT) {
            params.append('BT', this.currentBT);
        }

        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined) {
                params.append(key, String(value));
            }
        }

        return params;
    }

    // ============================================
    // Tab Endpoints
    // ============================================

    async getCultivatingTab(): Promise<CultivatingTabResponse> {
        const formData = this.buildFormData({
            checklist: 'undefined',
            disableFertilizing: 'none',
            view: 'cultivating',
            implementAction: 0,
        });

        const response = await this.client.post<CultivatingTabResponse>(
            '/farmland-status-bar.php',
            formData,
            { params: { checklist: 'undefined', disableFertilizing: 'none', view: 'cultivating', implementAction: 0 } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    async getSeedingTab(): Promise<SeedingTabResponse> {
        const formData = this.buildFormData({
            checklist: 'undefined',
            disableFertilizing: 'none',
            view: 'seeding',
            implementAction: 0,
        });

        const response = await this.client.post<SeedingTabResponse>(
            '/farmland-status-bar.php',
            formData,
            { params: { checklist: 'undefined', disableFertilizing: 'none', view: 'seeding', implementAction: 0 } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    async getHarvestTab(): Promise<HarvestTabResponse> {
        const formData = this.buildFormData({
            checklist: 'undefined',
        });

        const response = await this.client.post<HarvestTabResponse>(
            '/farmland-status-bar-harvest.php',
            formData,
            { params: { checklist: 'undefined' } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    async getPendingTab(): Promise<PendingTabResponse> {
        const formData = this.buildFormData({});

        const response = await this.client.post<PendingTabResponse>(
            '/farmland-status-bar-pending.php',
            formData
        );

        this.updateBT(response.data);
        return response.data;
    }

    async getSiloTab(): Promise<SiloTabResponse> {
        const formData = this.buildFormData({});

        const response = await this.client.post<SiloTabResponse>(
            '/farmland-status-bar-silo.php',
            formData
        );

        this.updateBT(response.data);
        return response.data;
    }

    // ============================================
    // Market Endpoints
    // ============================================

    async getCropValues(): Promise<CropValuesResponse> {
        const formData = this.buildFormData({
            cropId: 0,
            lastId: 0,
            currentCropMultiplier: 'undefined',
        });

        const response = await this.client.post<CropValuesResponse>(
            '/get-crop-values.php',
            formData,
            { params: { cropId: 0, lastId: 0, currentCropMultiplier: 'undefined' } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    async sellProduct(cropId: number, sellType: 'all' | 'half' = 'all'): Promise<SellProductResponse> {
        const formData = this.buildFormData({
            action: 'sell',
            cropId,
            sellType,
        });

        const response = await this.client.post<SellProductResponse>(
            '/market-details.php',
            formData,
            { params: { action: 'sell', cropId, sellType } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    // ============================================
    // Farmland Endpoints
    // ============================================

    async getFarmlandDetails(farmlandId: number): Promise<FarmlandDetailsResponse> {
        const formData = this.buildFormData({
            id: farmlandId,
        });

        const response = await this.client.post<FarmlandDetailsResponse>(
            '/user-farmland-details.php',
            formData,
            { params: { id: farmlandId } }
        );

        return response.data;
    }

    /**
     * Gets available tractors for seeding operation on a specific field
     */
    async getFarmlandActionSeed(farmlandId: number, farmId: number, area: number, complexityIndex: number): Promise<any> {
        const formData = this.buildFormData({
            farmlandId,
            farmId,
            area,
            complexityIndex,
        });

        const response = await this.client.post(
            '/farmland-action-seed.php',
            formData,
            { params: { farmlandId, farmId, area, complexityIndex } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    /**
     * Gets available tractors for plowing operation on a specific field
     */
    async getFarmlandActionPlow(farmlandId: number, farmId: number, area: number, complexityIndex: number): Promise<any> {
        const formData = this.buildFormData({
            farmlandId,
            farmId,
            area,
            complexityIndex,
        });

        const response = await this.client.post(
            '/farmland-action-plow.php',
            formData,
            { params: { farmlandId, farmId, area, complexityIndex } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    // ============================================
    // Action Endpoints
    // ============================================

    async startBatchAction(
        opType: string,
        farmlandIds: Record<string, number>,
        units: Record<string, BatchActionUnit>,
        single: boolean = true,
        usingWorkers: boolean = false,
        cropId?: number,
        fertilizerAmount?: number
    ): Promise<BatchActionResponse> {
        const formData = new URLSearchParams();
        formData.append('opType', opType);
        formData.append('single', single ? '1' : '0');
        formData.append('farmlandIds', JSON.stringify(farmlandIds));
        formData.append('usingWorkers', usingWorkers ? '1' : '0');
        formData.append('units', JSON.stringify(units));

        // For seeding, include the cropId
        if (cropId !== undefined) {
            formData.append('cropId', String(cropId));
        }

        // For fertilizing, include the amount
        if (fertilizerAmount !== undefined) {
            formData.append('fertilizerAmount', String(fertilizerAmount));
        }

        if (this.currentBT) {
            formData.append('BT', this.currentBT);
        }

        this.logger.debugLog(`farmlandIds: ${JSON.stringify(farmlandIds)}`);

        const response = await this.client.post<BatchActionResponse>(
            '/farmland-batch-action-start.php',
            formData
        );

        this.updateBT(response.data);
        return response.data;
    }

    /**
     * Specific endpoint for harvest (uses different format!)
     */
    async startHarvestAction(
        userFarmlandId: number,
        harvesterId: number,
        single: boolean = true
    ): Promise<BatchActionResponse> {
        const formData = new URLSearchParams();
        formData.append('single', single ? '1' : '0');
        formData.append('farmlandIds', String(userFarmlandId));
        formData.append('units', String(harvesterId));

        if (this.currentBT) {
            formData.append('BT', this.currentBT);
        }

        this.logger.debugLog(`[Harvest API] farmlandIds: ${userFarmlandId}, units: ${harvesterId}`);

        const response = await this.client.post<BatchActionResponse>(
            '/farmland-batch-action-harvest.php',
            formData,
            { params: { single: single ? 1 : 0, farmlandIds: userFarmlandId, units: harvesterId } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    async plowAction(
        farmId: number,
        area: number,
        complexityIndex: number
    ): Promise<unknown> {
        const formData = this.buildFormData({
            farmId,
            area,
            complexityIndex,
        });

        const response = await this.client.post(
            '/farmland-action-plow.php',
            formData,
            { params: { farmId, area, complexityIndex } }
        );

        if (response.data.BT) {
            this.updateBT(response.data);
        }
        return response.data;
    }

    // ============================================
    // Smart Seeding Endpoints
    // ============================================

    async getFarmlandData(gisId: number): Promise<any> {
        const formData = this.buildFormData({
            gisId,
        });

        const response = await this.client.post(
            '/user-farmland-data.php',
            formData,
            { params: { gisId } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    async getMarketSeeds(): Promise<any> {
        const formData = this.buildFormData({});

        const response = await this.client.post(
            '/market.php',
            formData
        );

        this.updateBT(response.data);
        return response.data;
    }

    async buySeeds(cropId: number, amount: number): Promise<any> {
        const formData = this.buildFormData({
            action: 'buy',
            cropId,
            amount,
        });

        const response = await this.client.post(
            '/market-seed-details.php',
            formData,
            { params: { action: 'buy', cropId, amount } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    // ============================================
    // Fuel Endpoints
    // ============================================

    async getFuelSilo(): Promise<FuelSiloResponse> {
        const formData = this.buildFormData({
            type: 'fuel',
        });

        const response = await this.client.post<FuelSiloResponse>(
            '/user-silo.php',
            formData,
            { params: { type: 'fuel' } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    async buyFuel(amount: number): Promise<BuyFuelResponse> {
        const formData = this.buildFormData({
            amount,
        });

        const response = await this.client.post<BuyFuelResponse>(
            '/silo-fuel-buy.php',
            formData,
            { params: { amount } }
        );

        this.updateBT(response.data);
        return response.data;
    }

    // ============================================
    // Utility Methods
    // ============================================

    getCurrentBT(): string {
        return this.currentBT;
    }

    setBT(bt: string): void {
        this.currentBT = bt;
    }
}
