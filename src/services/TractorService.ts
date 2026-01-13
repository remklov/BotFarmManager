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
     * Obtém todos os tratores disponíveis (não em uso) de todas as farms
     */
    async getAvailableTractors(): Promise<AvailableTractor[]> {
        const response = await this.api.getCultivatingTab();
        return this.extractAvailableTractors(response.tractors);
    }

    /**
     * Obtém tratores disponíveis para um tipo de operação específico
     */
    async getTractorsForOperation(opType: OperationType): Promise<AvailableTractor[]> {
        const allTractors = await this.getAvailableTractors();
        return allTractors.filter(t => t.opType === opType);
    }

    /**
     * Obtém tratores disponíveis em uma farm específica
     */
    async getTractorsInFarm(farmId: number): Promise<AvailableTractor[]> {
        const allTractors = await this.getAvailableTractors();
        return allTractors.filter(t => t.farmId === farmId);
    }

    /**
     * Extrai tratores disponíveis da resposta da API
     */
    private extractAvailableTractors(
        tractors: Record<string, FarmTractors>
    ): AvailableTractor[] {
        const available: AvailableTractor[] = [];

        for (const [farmId, farmTractors] of Object.entries(tractors)) {
            // Verificar tratores de plowing
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

            // Verificar tratores de clearing
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

            // Verificar tratores de seeding
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

            // Verificar tratores de harvesting
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
     * Busca o melhor trator disponível para uma operação em uma farm
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

        // Retorna o trator com maior haHour (mais rápido)
        return compatibleTractors.reduce((best, current) =>
            current.haHour > best.haHour ? current : best
        );
    }

    /**
     * Obtém detalhes de equipamento para uma fazenda para uma operação específica
     */
    async getEquipmentForFarmland(farmlandId: number, desiredOpType?: string): Promise<{
        tractorId: number;
        implementId?: number;
        opType: string;
        haHour: number;
        estimatedDuration: number; // em segundos
    } | null> {
        const details = await this.api.getFarmlandDetails(farmlandId);

        // Remover geometry do log (muito grande)
        const { geometry, ...detailsWithoutGeometry } = details as any;
        this.logger.debugLog(`[FarmlandDetails] Response para farmlandId ${farmlandId}: ${JSON.stringify(detailsWithoutGeometry, null, 2)}`);

        // Verificar qual operação está disponível e retornar o equipamento
        const equipment = details.equipment;

        if (!equipment) {
            this.logger.debugLog('[FarmlandDetails] Nenhum equipamento encontrado');
            return null;
        }

        // Para seeding e plowing, usar o endpoint específico que retorna tratores com implementos
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

        // Para harvesting e clearing, usar a lógica antiga (eles têm id direto)
        if (desiredOpType === 'harvesting' || desiredOpType === 'clearing') {
            const opEquipment = equipment[desiredOpType];

            if (!opEquipment?.data?.available || opEquipment.data.available === 0) {
                this.logger.debugLog(`[Equipment] Nenhum equipamento de ${desiredOpType} disponível`);
                return null;
            }

            const units = opEquipment.units;
            if (!units || units.length === 0) {
                this.logger.debugLog(`[Equipment] Nenhum unit de ${desiredOpType} encontrado`);
                return null;
            }

            // Ordenar por haHour e pegar o melhor
            const sortedUnits = [...units].sort((a, b) => (b.haHour || 0) - (a.haHour || 0));
            const bestUnit = sortedUnits[0];
            const tractorId = bestUnit.id || bestUnit.heavyId || 0;

            if (tractorId === 0) {
                this.logger.debugLog(`[Equipment] ${desiredOpType} não tem tractorId válido`);
                return null;
            }

            this.logger.debugLog(`[Equipment] Selecionado para ${desiredOpType}: trator ${tractorId}, haHour ${bestUnit.haHour}`);

            return {
                tractorId,
                opType: desiredOpType,
                haHour: bestUnit.haHour || 0,
                estimatedDuration: opEquipment.data.opDuration || 0,
            };
        }

        // Se não especificou tipo, tentar todos em ordem
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
     * Busca equipamento usando os endpoints específicos farmland-action-seed/plow
     * que retornam os tratores com implementos já associados
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
            // Chamar o endpoint específico
            const response = opType === 'seeding'
                ? await this.api.getFarmlandActionSeed(farmlandId, farmId, area, complexityIndex)
                : await this.api.getFarmlandActionPlow(farmlandId, farmId, area, complexityIndex);

            this.logger.debugLog(`[${opType}] Resposta do endpoint: tractors=${response.tractors?.length || 0}`);

            if (!response.tractors || response.tractors.length === 0) {
                this.logger.debugLog(`[${opType}] Nenhum trator disponível`);
                return null;
            }

            // Filtrar apenas tratores do tipo correto e que não estão pendentes
            const availableTractors = response.tractors.filter((t: any) =>
                t.type === opType && !t.isPending && t.hasImplement
            );

            if (availableTractors.length === 0) {
                this.logger.warn(`[${opType}] Nenhum trator com implemento de ${opType} disponível`);
                return null;
            }

            // Ordenar por haHour (maior = mais rápido)
            availableTractors.sort((a: any, b: any) => (b.haHour || 0) - (a.haHour || 0));

            const bestTractor = availableTractors[0];

            this.logger.debugLog(`[${opType}] Tratores disponíveis ordenados: ${JSON.stringify(availableTractors.map((t: any) => ({ id: t.id, name: t.tractorName, haHour: t.haHour })))}`);
            this.logger.debugLog(`[${opType}] Melhor trator: ${bestTractor.tractorName} (id: ${bestTractor.id}, haHour: ${bestTractor.haHour}, implement: ${bestTractor.implementId})`);

            // Usar opDuration do equipment se disponível
            const opDuration = equipment[opType]?.data?.opDuration || 0;

            return {
                tractorId: bestTractor.id,
                implementId: bestTractor.implementId,
                opType,
                haHour: bestTractor.haHour,
                estimatedDuration: opDuration,
            };
        } catch (error) {
            this.logger.error(`Erro ao buscar equipamento de ${opType}`, error as Error);
            return null;
        }
    }

    /**
     * Extrai equipamento para um tipo de operação específico
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

        // Ordenar units por haHour decrescente (maior = mais rápido = melhor)
        const sortedUnits = [...units].sort((a, b) => (b.haHour || 0) - (a.haHour || 0));

        this.logger.debugLog(`[Equipment] Units para ${opType} ordenados por haHour: ${JSON.stringify(sortedUnits.map(u => ({ id: u.id || u.heavyId, haHour: u.haHour })))}`);

        // Selecionar o melhor equipamento (primeiro da lista ordenada)
        const unit = sortedUnits[0];

        // Para harvesting e clearing, usar id ou heavyId diretamente
        let tractorId = unit.id || unit.heavyId || 0;
        const implementId = unit.implementId;
        const unitHaHour = unit.haHour || 0;

        // Para seeding e plowing (que usam implementos), o tractorId vem da lista de tratores
        if (tractorId === 0 && implementId) {
            // Buscar o melhor trator disponível para este tipo de operação na mesma farm
            const farmTractors = availableTractors
                .filter(t => t.opType === opType && t.farmId === farmId)
                .sort((a, b) => b.haHour - a.haHour); // Ordenar por haHour decrescente

            if (farmTractors.length > 0) {
                tractorId = farmTractors[0].id;
                this.logger.debugLog(`[Equipment] Melhor trator ${tractorId} (${farmTractors[0].haHour} ha/h) para ${opType} via lista de tratores`);
            } else {
                // Tentar o melhor trator do mesmo tipo em qualquer farm
                const anyTractors = availableTractors
                    .filter(t => t.opType === opType)
                    .sort((a, b) => b.haHour - a.haHour);

                if (anyTractors.length > 0) {
                    tractorId = anyTractors[0].id;
                    this.logger.debugLog(`[Equipment] Usando melhor trator ${tractorId} (${anyTractors[0].haHour} ha/h) de outra farm para ${opType}`);
                }
            }
        }

        if (tractorId === 0) {
            this.logger.debugLog(`[Equipment] ${opType} não tem tractorId válido`);
            return null;
        }

        // Usar opDuration da API ou calcular estimativa
        const estimatedDuration = opEquipment.data.opDuration || 0;

        this.logger.debugLog(`[Equipment] Selecionado para ${opType}: trator ${tractorId}, haHour ${unitHaHour}, duração estimada ${estimatedDuration}s (${(estimatedDuration / 3600).toFixed(1)}h)`);

        return {
            tractorId,
            implementId,
            opType,
            haHour: unitHaHour,
            estimatedDuration,
        };
    }

    /**
     * Prepara os dados de unidades para uma ação batch
     */
    buildBatchUnits(tractorId: number, implementId?: number): Record<string, BatchActionUnit> {
        const unit: BatchActionUnit = { tractorId };
        if (implementId) {
            unit.implementId = implementId;
        }
        return { [String(tractorId)]: unit };
    }
}
