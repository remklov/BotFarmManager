// ============================================
// Farm Manager Bot - Main Bot Class
// ============================================

import { ApiClient } from '../api/client';
import { FarmService, TractorService, SiloService, MarketService, SeedService, FuelService } from '../services';
import { BotConfig, AvailableTask, BatchActionUnit } from '../types';
import { Logger } from '../utils/logger';

export class FarmBot {
    private api: ApiClient;
    private farmService: FarmService;
    private tractorService: TractorService;
    private siloService: SiloService;
    private marketService: MarketService;
    private seedService: SeedService;
    private fuelService: FuelService;
    private logger: Logger;
    private config: BotConfig;
    private isRunning: boolean = false;
    private intervalId: NodeJS.Timeout | null = null;

    constructor(config: BotConfig) {
        this.config = config;
        this.logger = new Logger('FarmBot', config.debug);
        this.api = new ApiClient(config.phpSessionId!, this.logger);

        // Inicializar serviços
        this.farmService = new FarmService(this.api, this.logger);
        this.tractorService = new TractorService(this.api, this.logger);
        this.siloService = new SiloService(this.api, this.logger);
        this.marketService = new MarketService(this.api, this.logger);
        this.seedService = new SeedService(this.api, this.logger);
        this.fuelService = new FuelService(this.api, this.logger);
    }

    /**
     * Inicia o bot
     */
    async start(): Promise<void> {
        this.logger.info('🚀 Iniciando Farm Manager Bot...');
        this.logger.info(`Intervalo de verificação: ${this.config.checkIntervalMs / 1000}s`);
        this.logger.info(`Limite de venda do silo: ${this.config.siloSellThreshold}%`);

        this.isRunning = true;

        // Executar primeira vez imediatamente
        await this.runCycle();

        // Configurar intervalo
        this.intervalId = setInterval(async () => {
            if (this.isRunning) {
                await this.runCycle();
            }
        }, this.config.checkIntervalMs);

        this.logger.success('Bot iniciado com sucesso!');
    }

    /**
     * Para o bot
     */
    stop(): void {
        this.logger.info('⏹️ Parando Farm Manager Bot...');
        this.isRunning = false;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.logger.success('Bot parado.');
    }

    /**
     * Executa um ciclo completo de verificação e ação
     */
    async runCycle(): Promise<void> {
        this.logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.info(`🔄 Iniciando ciclo - ${new Date().toLocaleString('pt-BR')}`);

        try {
            // 0. Verificar e comprar combustível se necessário
            await this.fuelService.checkAndBuyFuel();

            // 1. Verificar e executar colheitas
            await this.checkAndExecuteHarvesting();

            // 2. Verificar e executar semeaduras
            await this.checkAndExecuteSeeding();

            // 3. Verificar e executar cultivo (arar/limpar)
            await this.checkAndExecuteCultivating();

            // 4. Verificar e vender produtos do silo
            await this.checkAndSellProducts();

            this.logger.info('✅ Ciclo concluído');
        } catch (error) {
            this.logger.error('Erro durante ciclo', error as Error);
        }
    }

    /**
     * Verifica e executa colheitas pendentes
     */
    private async checkAndExecuteHarvesting(): Promise<void> {
        this.logger.debugLog('Verificando colheitas disponíveis...');

        const tasks = await this.farmService.getHarvestingTasks();

        if (tasks.length === 0) {
            this.logger.debugLog('Nenhuma colheita disponível');
            return;
        }

        this.logger.task(`${tasks.length} colheita(s) disponível(is)`);

        for (const task of tasks) {
            await this.executeTask(task);
        }
    }

    /**
     * Verifica e executa semeaduras pendentes (com Smart Seeding)
     */
    private async checkAndExecuteSeeding(): Promise<void> {
        this.logger.debugLog('Verificando semeaduras disponíveis...');

        const tasks = await this.farmService.getSeedingTasks();

        if (tasks.length === 0) {
            this.logger.debugLog('Nenhuma semeadura disponível');
            return;
        }

        this.logger.task(`${tasks.length} semeadura(s) disponível(is)`);

        for (const task of tasks) {
            // Smart Seeding: encontrar melhor semente e garantir estoque
            this.logger.info(`🌱 Preparando Smart Seeding para "${task.farmlandName}"...`);

            const bestSeed = await this.seedService.prepareForSeeding(task.farmlandId, task.area);

            if (bestSeed) {
                this.logger.info(
                    `🌾 Semente selecionada: ${bestSeed.cropName} ` +
                    `(Score: ${bestSeed.score}, ${bestSeed.requiredAmount}kg)`
                );
                // Passar cropId para a tarefa
                (task as any).cropId = bestSeed.cropId;
            } else {
                this.logger.warn(`Não foi possível preparar sementes para ${task.farmlandName}`);
                continue;
            }

            await this.executeTask(task);
        }
    }

    /**
     * Verifica e executa tarefas de cultivo (arar, limpar)
     */
    private async checkAndExecuteCultivating(): Promise<void> {
        this.logger.debugLog('Verificando cultivos disponíveis...');

        const tasks = await this.farmService.getCultivatingTasks();

        if (tasks.length === 0) {
            this.logger.debugLog('Nenhum cultivo disponível');
            return;
        }

        this.logger.task(`${tasks.length} cultivo(s) disponível(is)`);

        for (const task of tasks) {
            await this.executeTask(task);
        }
    }

    /**
     * Executa uma tarefa específica
     */
    private async executeTask(task: AvailableTask): Promise<boolean> {
        this.logger.task(
            `Executando ${task.type} em "${task.farmlandName}" (${task.area}ha)`
        );

        try {
            // Obter equipamento disponível para esta fazenda para o tipo de operação desejado
            this.logger.debugLog(`Buscando equipamento para farmlandId: ${task.farmlandId}, opType: ${task.type}`);
            const equipment = await this.tractorService.getEquipmentForFarmland(task.farmlandId, task.type);

            this.logger.debugLog(`Equipamento encontrado: ${JSON.stringify(equipment)}`);

            if (!equipment) {
                this.logger.warn(`Nenhum equipamento disponível para ${task.farmlandName}`);
                return false;
            }

            // Verificar se o tipo de operação do equipamento corresponde
            if (equipment.opType !== task.type) {
                this.logger.debugLog(
                    `Equipamento disponível é para ${equipment.opType}, mas tarefa é ${task.type}`
                );
            }

            // Verificar tempo máximo de operação (6 horas = 21600 segundos)
            const MAX_OPERATION_HOURS = 6;
            const MAX_OPERATION_SECONDS = MAX_OPERATION_HOURS * 3600;

            if (equipment.estimatedDuration > MAX_OPERATION_SECONDS) {
                const estimatedHours = (equipment.estimatedDuration / 3600).toFixed(1);
                this.logger.warn(
                    `⏱️ Operação em "${task.farmlandName}" ignorada: tempo estimado de ${estimatedHours}h excede o limite de ${MAX_OPERATION_HOURS}h. ` +
                    `Considere usar equipamento mais rápido (atual: ${equipment.haHour} ha/h).`
                );
                return false;
            }

            // Construir dados para a ação batch
            const farmlandIds: Record<string, number> = {
                [String(task.userFarmlandId)]: task.userFarmlandId,
            };

            const units = this.tractorService.buildBatchUnits(
                equipment.tractorId,
                equipment.implementId
            );

            this.logger.debugLog(`farmlandIds: ${JSON.stringify(farmlandIds)}`);
            this.logger.debugLog(`units: ${JSON.stringify(units)}`);

            // Executar ação - harvest usa endpoint diferente!
            let result;
            if (task.type === 'harvesting') {
                result = await this.api.startHarvestAction(
                    task.userFarmlandId,
                    equipment.tractorId
                );
            } else {
                // Para seeding, incluir o cropId selecionado pelo Smart Seeding
                const cropId = (task as any).cropId;

                result = await this.api.startBatchAction(
                    task.type,
                    farmlandIds,
                    units,
                    true,
                    false,
                    cropId
                );
            }

            this.logger.debugLog(`Resultado da ação: ${JSON.stringify(result)}`);

            if (result.failed === 0) {
                const taskResult = result.result?.[String(task.userFarmlandId)];
                this.logger.success(
                    `${task.type} iniciado em "${task.farmlandName}" - Tempo estimado: ${taskResult?.opTimeRemain || 'N/A'}s`
                );
                return true;
            } else {
                const errorMsg = result.errors?.join(', ') || 'Erro desconhecido';
                this.logger.warn(
                    `Falha ao executar ${task.type} em "${task.farmlandName}": ${errorMsg}`
                );
                return false;
            }
        } catch (error) {
            this.logger.error(
                `Erro ao executar ${task.type} em "${task.farmlandName}"`,
                error as Error
            );
            return false;
        }
    }

    /**
     * Verifica silo e vende produtos acima do limite
     */
    private async checkAndSellProducts(): Promise<void> {
        this.logger.debugLog('Verificando silo...');

        try {
            // Log do status do silo
            await this.siloService.logSiloStatus();

            // Obter produtos acima do limite
            const productsToSell = await this.siloService.getProductsAboveThreshold(
                this.config.siloSellThreshold
            );

            if (productsToSell.length === 0) {
                this.logger.debugLog(
                    `Nenhum produto acima de ${this.config.siloSellThreshold}% para vender`
                );
                return;
            }

            this.logger.silo(
                `${productsToSell.length} produto(s) acima de ${this.config.siloSellThreshold}% para vender`
            );

            // Vender cada produto
            const results = await this.marketService.sellMultipleProducts(
                productsToSell.map(p => ({ id: p.id, name: p.name }))
            );

            // Resumo das vendas
            const summary = this.marketService.summarizeSales(results);

            if (summary.successCount > 0) {
                this.logger.market(
                    `Vendas concluídas: ${summary.totalSold.toLocaleString()}kg vendidos, ` +
                    `receita total: $${summary.totalIncome.toLocaleString()}`
                );
            }
        } catch (error) {
            this.logger.error('Erro ao verificar/vender produtos', error as Error);
        }
    }

    /**
     * Executa um ciclo manualmente (útil para debug)
     */
    async manualCycle(): Promise<void> {
        await this.runCycle();
    }

    /**
     * Retorna status atual do bot
     */
    getStatus(): { isRunning: boolean; config: BotConfig } {
        return {
            isRunning: this.isRunning,
            config: this.config,
        };
    }
}
