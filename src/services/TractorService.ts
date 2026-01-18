// ============================================
// Farm Manager Bot - Tractor Service
// ============================================

import { ApiClient } from '../api/client';
import {
    CultivatingTabResponse,
    SeedingTabResponse,
    TractorData,
    FarmTractors,
    AvailableTractor,
    OperationType,
    BatchActionUnit,
} from '../types';
import { Logger } from '../utils/logger';

export class TractorService {
    private api: ApiClient;
    private logger: Logger;

    constructor(api: ApiClient, logger: Logger) {
        this.api = api;
        this.logger = logger;
    }

    /**
     * Gets all available tractors (not in use) from all farms
     */
    async getAvailableTractors(): Promise<AvailableTractor[]> {
        const response = await this.api.getCultivatingTab();
        return this.extractAvailableTractors(response.tractors);
    }

    /**
     * Gets available tractors for a specific operation type
     */
    async getTractorsForOperation(opType: OperationType): Promise<AvailableTractor[]> {
        const allTractors = await this.getAvailableTractors();
        return allTractors.filter(t => t.opType === opType);
    }

    /**
     * Gets available tractors in a specific farm
     */
    async getTractorsInFarm(farmId: number): Promise<AvailableTractor[]> {
        const allTractors = await this.getAvailableTractors();
        return allTractors.filter(t => t.farmId === farmId);
    }

    /**
     * Extracts available tractors from API response
     */
    private extractAvailableTractors(
        tractors: Record<string, FarmTractors>
    ): AvailableTractor[] {
        const available: AvailableTractor[] = [];

        for (const [farmId, farmTractors] of Object.entries(tractors)) {
            // Check plowing tractors
            if (farmTractors.plowing) {
                for (const [id, tractor] of Object.entries(farmTractors.plowing.data)) {
                    if (tractor.inUse === 0) {
                        available.push({
                            id: tractor.id,
                            farmId: Number(farmId),
                            haHour: tractor.haHour,
                            opType: 'plowing',
                        });
                    }
                }
            }

            // Check clearing tractors
            if (farmTractors.clearing) {
                for (const [id, tractor] of Object.entries(farmTractors.clearing.data)) {
                    if (tractor.inUse === 0) {
                        available.push({
                            id: tractor.id,
                            farmId: Number(farmId),
                            haHour: tractor.haHour,
                            opType: 'clearing',
                        });
                    }
                }
            }

            // Check seeding tractors
            if (farmTractors.seeding) {
                for (const [id, tractor] of Object.entries(farmTractors.seeding.data)) {
                    if (tractor.inUse === 0) {
                        available.push({
                            id: tractor.id,
                            farmId: Number(farmId),
                            haHour: tractor.haHour,
                            opType: 'seeding',
                        });
                    }
                }
            }

            // Check harvesting tractors
            if (farmTractors.harvesting) {
                for (const [id, tractor] of Object.entries(farmTractors.harvesting.data)) {
                    if (tractor.inUse === 0) {
                        available.push({
                            id: tractor.id,
                            farmId: Number(farmId),
                            haHour: tractor.haHour,
                            opType: 'harvesting',
                        });
                    }
                }
            }
        }

        return available;
    }

    /**
     * Searches for the best available tractor for an operation in a farm
     */
    async getBestTractorForTask(
        farmId: number,
        opType: OperationType
    ): Promise<AvailableTractor | null> {
        const tractors = await this.getTractorsInFarm(farmId);
        const compatibleTractors = tractors.filter(t => t.opType === opType);

        if (compatibleTractors.length === 0) {
            return null;
        }

        // Returns the tractor with highest haHour (fastest)
        return compatibleTractors.reduce((best, current) =>
            current.haHour > best.haHour ? current : best
        );
    }

    /**
     * Gets equipment details for a farm for a specific operation
     */
    async getEquipmentForFarmland(farmlandId: number, desiredOpType?: string): Promise<{
        tractorId: number;
        implementId?: number;
        opType: string;
        haHour: number;
        estimatedDuration: number; // in seconds
    } | null> {
        const details = await this.api.getFarmlandDetails(farmlandId);

        // Remove geometry from log (too large)
        const { geometry, ...detailsWithoutGeometry } = details as any;
        this.logger.debugLog(`[FarmlandDetails] Response for farmlandId ${farmlandId}: ${JSON.stringify(detailsWithoutGeometry, null, 2)}`);

        // Check which operation is available and return equipment
        const equipment = details.equipment;

        if (!equipment) {
            this.logger.debugLog('[FarmlandDetails] No equipment found');
            return null;
        }

        // For seeding and plowing, use the specific endpoint that returns tractors with implements
        if (desiredOpType === 'seeding' || desiredOpType === 'plowing') {
            return this.getEquipmentFromActionEndpoint(
                desiredOpType,
                farmlandId,
                details.farmId,
                details.area,
                details.farmland.complexityIndex,
                equipment
            );
        }

        // For harvesting and clearing, use old logic (they have direct id)
        if (desiredOpType === 'harvesting' || desiredOpType === 'clearing') {
            const opEquipment = equipment[desiredOpType];

            if (!opEquipment?.data?.available || opEquipment.data.available === 0) {
                this.logger.debugLog(`[Equipment] No ${desiredOpType} equipment available`);
                return null;
            }

            const units = opEquipment.units;
            if (!units || units.length === 0) {
                this.logger.debugLog(`[Equipment] No ${desiredOpType} units found`);
                return null;
            }

            // Sort by haHour and get the best
            const sortedUnits = [...units].sort((a, b) => (b.haHour || 0) - (a.haHour || 0));
            const bestUnit = sortedUnits[0];
            const tractorId = bestUnit.id || bestUnit.heavyId || 0;

            if (tractorId === 0) {
                this.logger.debugLog(`[Equipment] ${desiredOpType} does not have valid tractorId`);
                return null;
            }

            this.logger.debugLog(`[Equipment] Selected for ${desiredOpType}: tractor ${tractorId}, haHour ${bestUnit.haHour}`);

            return {
                tractorId,
                opType: desiredOpType,
                haHour: bestUnit.haHour || 0,
                estimatedDuration: opEquipment.data.opDuration || 0,
            };
        }

        // If type not specified, try all in order
        const opOrder = ['harvesting', 'clearing', 'plowing', 'seeding'];
        for (const opType of opOrder) {
            const result = await this.getEquipmentForFarmland(farmlandId, opType);
            if (result) {
                return result;
            }
        }

        return null;
    }

    /**
     * Searches for equipment using specific endpoints farmland-action-seed/plow
     * that return tractors with implements already associated
     */
    private async getEquipmentFromActionEndpoint(
        opType: 'seeding' | 'plowing',
        farmlandId: number,
        farmId: number,
        area: number,
        complexityIndex: number,
        equipment: any
    ): Promise<{
        tractorId: number;
        implementId?: number;
        opType: string;
        haHour: number;
        estimatedDuration: number;
    } | null> {
        try {
            // Call the specific endpoint
            const response = opType === 'seeding'
                ? await this.api.getFarmlandActionSeed(farmlandId, farmId, area, complexityIndex)
                : await this.api.getFarmlandActionPlow(farmlandId, farmId, area, complexityIndex);

            this.logger.debugLog(`[${opType}] Endpoint response: tractors=${response.tractors?.length || 0}`);

            if (!response.tractors || response.tractors.length === 0) {
                this.logger.debugLog(`[${opType}] No tractors available`);
                return null;
            }

            // Filter only tractors of correct type and not pending
            const availableTractors = response.tractors.filter((t: any) =>
                t.type === opType && !t.isPending && t.hasImplement
            );

            if (availableTractors.length === 0) {
                this.logger.warn(`[${opType}] No tractors with ${opType} implement available`);
                return null;
            }

            // Sort by haHour (highest = fastest)
            availableTractors.sort((a: any, b: any) => (b.haHour || 0) - (a.haHour || 0));

            const bestTractor = availableTractors[0];

            this.logger.debugLog(`[${opType}] Available tractors sorted: ${JSON.stringify(availableTractors.map((t: any) => ({ id: t.id, name: t.tractorName, haHour: t.haHour })))}`);
            this.logger.debugLog(`[${opType}] Best tractor: ${bestTractor.tractorName} (id: ${bestTractor.id}, haHour: ${bestTractor.haHour}, implement: ${bestTractor.implementId})`);

            // Use opDuration from equipment if available
            const opDuration = equipment[opType]?.data?.opDuration || 0;

            return {
                tractorId: bestTractor.id,
                implementId: bestTractor.implementId,
                opType,
                haHour: bestTractor.haHour,
                estimatedDuration: opDuration,
            };
        } catch (error) {
            this.logger.error(`Error searching for ${opType} equipment`, error as Error);
            return null;
        }
    }

    /**
     * Extracts equipment for a specific operation type
     */
    private getEquipmentForOpType(
        equipment: any,
        opType: string,
        availableTractors: AvailableTractor[],
        farmId: number
    ): { tractorId: number; implementId?: number; opType: string; haHour: number; estimatedDuration: number } | null {
        const opEquipment = equipment[opType];

        if (!opEquipment?.data?.available || opEquipment.data.available === 0) {
            return null;
        }

        const units = opEquipment.units;
        if (!units || units.length === 0) {
            return null;
        }

        // Sort units by haHour descending (highest = fastest = best)
        const sortedUnits = [...units].sort((a, b) => (b.haHour || 0) - (a.haHour || 0));

        this.logger.debugLog(`[Equipment] Units for ${opType} sorted by haHour: ${JSON.stringify(sortedUnits.map(u => ({ id: u.id || u.heavyId, haHour: u.haHour })))}`);

        // Select the best equipment (first in sorted list)
        const unit = sortedUnits[0];

        // For harvesting and clearing, use id or heavyId directly
        let tractorId = unit.id || unit.heavyId || 0;
        const implementId = unit.implementId;
        const unitHaHour = unit.haHour || 0;

        // For seeding and plowing (which use implements), tractorId comes from tractor list
        if (tractorId === 0 && implementId) {
            // Search for the best available tractor for this operation type in the same farm
            const farmTractors = availableTractors
                .filter(t => t.opType === opType && t.farmId === farmId)
                .sort((a, b) => b.haHour - a.haHour); // Sort by haHour descending

            if (farmTractors.length > 0) {
                tractorId = farmTractors[0].id;
                this.logger.debugLog(`[Equipment] Best tractor ${tractorId} (${farmTractors[0].haHour} ha/h) for ${opType} via tractor list`);
            } else {
                // Try the best tractor of the same type in any farm
                const anyTractors = availableTractors
                    .filter(t => t.opType === opType)
                    .sort((a, b) => b.haHour - a.haHour);

                if (anyTractors.length > 0) {
                    tractorId = anyTractors[0].id;
                    this.logger.debugLog(`[Equipment] Using best tractor ${tractorId} (${anyTractors[0].haHour} ha/h) from another farm for ${opType}`);
                }
            }
        }

        if (tractorId === 0) {
            this.logger.debugLog(`[Equipment] ${opType} does not have valid tractorId`);
            return null;
        }

        // Use opDuration from API or calculate estimate
        const estimatedDuration = opEquipment.data.opDuration || 0;

        this.logger.debugLog(`[Equipment] Selected for ${opType}: tractor ${tractorId}, haHour ${unitHaHour}, estimated duration ${estimatedDuration}s (${(estimatedDuration / 3600).toFixed(1)}h)`);

        return {
            tractorId,
            implementId,
            opType,
            haHour: unitHaHour,
            estimatedDuration,
        };
    }

    /**
     * Prepares unit data for a batch action
     */
    buildBatchUnits(tractorId: number, implementId?: number): Record<string, BatchActionUnit> {
        const unit: BatchActionUnit = { tractorId };
        if (implementId) {
            unit.implementId = implementId;
        }
        return { [String(tractorId)]: unit };
    }

    /**
     * Prepares data for multiple units for a batch action
     */
    buildMultiBatchUnits(tractors: { tractorId: number; implementId?: number }[]): Record<string, BatchActionUnit> {
        const units: Record<string, BatchActionUnit> = {};
        for (const tractor of tractors) {
            const unit: BatchActionUnit = { tractorId: tractor.tractorId };
            if (tractor.implementId) {
                unit.implementId = tractor.implementId;
            }
            units[String(tractor.tractorId)] = unit;
        }
        return units;
    }

    /**
     * Gets optimized tractors for an operation, considering:
     * - Multiple tractors (up to maxTractors)
     * - Auto-implement (attach available implements)
     * - Idle time of other fields
     */
    async getOptimalTractorsForOperation(
        farmlandId: number,
        farmId: number,
        area: number,
        complexityIndex: number,
        opType: 'seeding' | 'plowing' | 'harvesting' | 'clearing' | 'fertilizing',
        maxTractors: number = 4,
        maxIdleTimeMinutes: number = 30
    ): Promise<{
        tractors: { tractorId: number; implementId?: number; haHour: number }[];
        totalHaHour: number;
        estimatedDuration: number;
        opType: string;
    } | null> {
        try {
            // 1. Search for available tractors for this operation
            let response: any;
            if (opType === 'seeding') {
                response = await this.api.getFarmlandActionSeed(farmlandId, farmId, area, complexityIndex);
            } else if (opType === 'plowing') {
                response = await this.api.getFarmlandActionPlow(farmlandId, farmId, area, complexityIndex);
            } else if (opType === 'harvesting') {
                // For harvesting: search for available harvesters and apply idle verification
                const equipment = await this.getEquipmentForFarmland(farmlandId, opType);
                if (!equipment) return null;

                // Build list of available harvesters
                const harvesters: { tractorId: number; implementId?: number; haHour: number }[] = [
                    { tractorId: equipment.tractorId, implementId: equipment.implementId, haHour: equipment.haHour }
                ];

                // TODO: In a future implementation, search for all available harvesters
                // For now, use only the best harvester found

                // Check pending operations (maturing fields) to avoid leaving them idle
                const pendingOps = await this.getPendingOperationsInFarm(farmId);
                const maturingFields = pendingOps.filter(op => op.opType === 'harvesting');

                if (maturingFields.length > 0 && harvesters.length > 0) {
                    // Check if any field will need a harvester soon
                    const estimatedDuration = equipment.estimatedDuration;

                    for (const maturing of maturingFields) {
                        const timeUntilMature = maturing.opTimeRemain;
                        const potentialIdleTime = estimatedDuration - timeUntilMature;

                        if (potentialIdleTime > maxIdleTimeMinutes * 60 && potentialIdleTime > 0) {
                            this.logger.info(
                                `⚠️ Field "${maturing.farmlandName}" will need harvest in ` +
                                `${Math.ceil(timeUntilMature / 60)}min. Considering this in allocation.`
                            );
                        }
                    }
                }

                this.logger.debugLog(
                    `[Harvester] Using harvester ${equipment.tractorId} ` +
                    `(${equipment.haHour} ha/h, ~${Math.ceil(equipment.estimatedDuration / 60)}min)`
                );

                return {
                    tractors: harvesters,
                    totalHaHour: equipment.haHour,
                    estimatedDuration: equipment.estimatedDuration,
                    opType,
                };
            } else {
                // For clearing, use simple logic (single equipment)
                const equipment = await this.getEquipmentForFarmland(farmlandId, opType);
                if (!equipment) return null;
                return {
                    tractors: [{ tractorId: equipment.tractorId, implementId: equipment.implementId, haHour: equipment.haHour }],
                    totalHaHour: equipment.haHour,
                    estimatedDuration: equipment.estimatedDuration,
                    opType,
                };
            }

            if (!response.tractors || response.tractors.length === 0) {
                this.logger.debugLog(`[MultiTractor] No tractors available for ${opType}`);
                return null;
            }

            // 2. Filter tractors of correct type and not pending
            const availableTractors = response.tractors.filter((t: any) =>
                t.type === opType && !t.isPending && t.hasImplement
            );

            // 3. Check available implements for auto-attach
            const availableImplements = (response.implements || []).filter((i: any) =>
                i.type === opType && i.available > 0
            );

            // 4. Tractors without implement but that can receive one
            const tractorsWithoutImplement = response.tractors.filter((t: any) =>
                t.type !== opType && !t.isPending && !t.hasImplement
            );

            // 5. Build list of usable tractors
            const usableTractors: { tractorId: number; implementId?: number; haHour: number }[] = [];

            // First, add tractors that already have the correct implement
            for (const tractor of availableTractors) {
                if (usableTractors.length >= maxTractors) break;
                usableTractors.push({
                    tractorId: tractor.id,
                    implementId: tractor.implementId,
                    haHour: tractor.haHour,
                });
            }

            // Then, try to attach available implements to tractors without implement
            for (const implement of availableImplements) {
                if (usableTractors.length >= maxTractors) break;

                // Find a tractor that can use this implement
                const compatibleTractor = response.tractors.find((t: any) =>
                    !t.isPending &&
                    t.hp >= implement.minHp &&
                    !usableTractors.some(u => u.tractorId === t.id)
                );

                if (compatibleTractor) {
                    this.logger.info(`🔧 Auto-attach: Attaching "${implement.name}" to tractor "${compatibleTractor.tractorName}"`);
                    usableTractors.push({
                        tractorId: compatibleTractor.id,
                        implementId: implement.id,
                        haHour: implement.haHour,
                    });
                }
            }

            if (usableTractors.length === 0) {
                this.logger.debugLog(`[MultiTractor] No usable tractors for ${opType}`);
                return null;
            }

            // 6. Sort by haHour (highest first)
            usableTractors.sort((a, b) => b.haHour - a.haHour);

            // 7. Check pending operations to avoid leaving fields idle
            const pendingOps = await this.getPendingOperationsInFarm(farmId);

            // Calculate how many tractors we can use without leaving fields idle for too long
            let tractorsToUse = usableTractors.slice(0, maxTractors);

            if (pendingOps.length > 0 && tractorsToUse.length > 1) {
                // Calculate operation time with N tractors (haHour already considers complexity)
                const totalHaHour = tractorsToUse.reduce((sum, t) => sum + t.haHour, 0);
                const operationTimeSeconds = (area / totalHaHour) * 3600;

                // Check if any pending operation will need a tractor
                for (const pending of pendingOps) {
                    const timeUntilNeedsTractor = pending.opTimeRemain; // seconds
                    const potentialIdleTime = operationTimeSeconds - timeUntilNeedsTractor;

                    if (potentialIdleTime > maxIdleTimeMinutes * 60) {
                        // Reduce number of tractors so operation finishes faster? No!
                        // Actually, we need to reserve at least 1 tractor for the pending field
                        if (tractorsToUse.length > 1) {
                            this.logger.info(
                                `⚠️ Field "${pending.farmlandName}" will need a tractor in ${Math.ceil(timeUntilNeedsTractor / 60)}min. ` +
                                `Reserving 1 tractor for it.`
                            );
                            tractorsToUse = tractorsToUse.slice(0, tractorsToUse.length - 1);
                        }
                        break;
                    }
                }
            }

            // 8. Calculate final totals
            const finalTotalHaHour = tractorsToUse.reduce((sum, t) => sum + t.haHour, 0);
            // Note: haHour already considers terrain complexity, don't multiply by complexityIndex
            const estimatedDuration = Math.ceil((area / finalTotalHaHour) * 3600);

            this.logger.info(
                `🚜 Multi-tractor: Using ${tractorsToUse.length} tractor(s) for ${opType} ` +
                `(${finalTotalHaHour} ha/h total, ~${Math.ceil(estimatedDuration / 60)}min)`
            );

            return {
                tractors: tractorsToUse,
                totalHaHour: finalTotalHaHour,
                estimatedDuration,
                opType,
            };
        } catch (error) {
            this.logger.error(`Error getting optimized tractors for ${opType}`, error as Error);
            return null;
        }
    }

    /**
     * Gets pending operations (in progress) in a farm
     */
    private async getPendingOperationsInFarm(farmId: number): Promise<{
        farmlandId: number;
        farmlandName: string;
        opType: string;
        opTimeRemain: number;
    }[]> {
        try {
            const pending = await this.api.getPendingTab();
            const operations: { farmlandId: number; farmlandName: string; opType: string; opTimeRemain: number }[] = [];

            if (pending.farmlands?.operating) {
                for (const [id, op] of Object.entries(pending.farmlands.operating)) {
                    if (op.farmId === farmId) {
                        operations.push({
                            farmlandId: op.farmlandId,
                            farmlandName: op.farmlandName,
                            opType: op.opType,
                            opTimeRemain: op.opTimeRemain,
                        });
                    }
                }
            }

            if (pending.farmlands?.maturing) {
                for (const [id, op] of Object.entries(pending.farmlands.maturing)) {
                    if (op.farmId === farmId) {
                        operations.push({
                            farmlandId: op.farmlandId,
                            farmlandName: op.farmlandName,
                            opType: 'harvesting', // Vai precisar colher
                            opTimeRemain: op.opTimeRemain,
                        });
                    }
                }
            }

            return operations;
        } catch (error) {
            this.logger.debugLog(`[PendingOps] Error searching for pending operations: ${error}`);
            return [];
        }
    }
}

