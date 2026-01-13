// ============================================
// Farm Manager Bot - Types & Interfaces
// ============================================

// ============================================
// Base Response Types
// ============================================

export interface BaseResponse {
    BT: string;
    deal?: unknown[];
}

// ============================================
// Tractor Types
// ============================================

export interface TractorData {
    id: number;
    location: number;
    haHour: number;
    fuelHour: number;
    opType: string;
    inUse: number;
    farmlandId: number;
    opTimes: Record<string, number>;
}

export interface TractorCategory {
    count: number;
    data: Record<string, TractorData>;
}

export interface FarmTractors {
    tractorCount: number;
    plowing?: TractorCategory;
    clearing?: TractorCategory;
    seeding?: TractorCategory;
    harvesting?: TractorCategory;
}

// ============================================
// Farmland Types
// ============================================

export type FarmlandState =
    | 'raw'
    | 'cleared'
    | 'plowed'
    | 'seeded'
    | 'growing'
    | 'matured'
    | 'harvesting';

export type OperationType =
    | 'plowing'
    | 'clearing'
    | 'seeding'
    | 'harvesting'
    | 'fertilizing';

export interface FarmlandData {
    id: number;
    farmlandId: number;
    farmlandName: string;
    area: number;
    cropYield: number;
    complexityIndex: number;
    farmId: number;
    farmlandState: FarmlandState;
    previousSeed?: {
        img: string;
        name: string;
        hasPrevious: number;
    };
}

export interface FarmlandCategory {
    typeCount: number;
    farmId: number;
    tractors: number;
    canCultivate: number;
    nextState: string;
    data: Record<string, FarmlandData>;
}

export interface FarmFarmlands {
    raw?: FarmlandCategory;
    cleared?: FarmlandCategory;
    plowed?: FarmlandCategory;
    seeded?: FarmlandCategory;
    growing?: FarmlandCategory;
    matured?: FarmlandCategory;
}

// ============================================
// Farm Types
// ============================================

export interface Farm {
    name: string;
    countryCode: string;
    tractorCount: number;
    farmlandCount: number;
    farmlands: FarmFarmlands;
}

// ============================================
// Seed Types
// ============================================

export interface SeedInfo {
    id: number;
    amount: number;
    remainingCapacity: number;
    bushels: number;
    img: string;
    name: string;
    kgPerHa: number;
    siloImg: string;
}

// ============================================
// Cultivating Tab Response
// ============================================

export interface CultivatingTabResponse extends BaseResponse {
    data: {
        seeding: number;
        farmlands: number;
        sumArea: number;
    };
    implementChangeData: {
        total: number;
        swap: number;
        attach: number;
        types: OperationType[] | Record<string, number>;
    };
    farms: Record<string, Farm>;
    tractors: Record<string, FarmTractors>;
    count: {
        pending: number;
        cultivate: number;
        harvesting: number;
        seed: number;
        silo: number;
    };
    fertilizingUnlocked: number;
    disableFertilizing: number;
}

// ============================================
// Seeding Tab Response
// ============================================

export interface SeedingTabResponse extends BaseResponse {
    data: {
        hasSeed: number;
        seeding: number;
        farmlands: number;
        sumArea: number;
    };
    seed: Record<string, SeedInfo>;
    implementChangeData: {
        total: number;
        swap: number;
        attach: number;
        types: Record<string, number>;
    };
    farms: Record<string, Farm>;
    tractors: Record<string, FarmTractors>;
    count: {
        pending: number;
        cultivate: number;
        harvesting: number;
        seed: number;
        silo: number;
    };
    fertilizingUnlocked: number;
    disableFertilizing: number;
}

// ============================================
// Harvest Tab Response
// ============================================

export interface HarvestTabResponse extends BaseResponse {
    // Harvest tab pode retornar vazio quando não há colheita
    data?: {
        farmlands: number;
        sumArea: number;
    };
    farms?: Record<string, Farm>;
    tractors?: Record<string, FarmTractors>;
}

// ============================================
// Pending Tab Response
// ============================================

export interface PendingFarmland {
    id: number;
    farmlandId: number;
    farmlandName: string;
    area: number;
    opType: string;
    opTimeRemain: number;
    opPct: number;
    farmId: number;
}

export interface PendingTabResponse extends BaseResponse {
    farmlands: {
        operating: Record<string, PendingFarmland> | null;
        maturing: Record<string, PendingFarmland> | null;
    };
    canIrrigate: number;
    irrigateCount: number;
    checklist: boolean;
}

// ============================================
// Silo Types
// ============================================

export interface SiloProduct {
    id: number;
    amount: number;
    remainingCapacity: number;
    bushels: number;
    img: string;
    name: string;
    growedImg: string;
    siloImg: string;
    pctFull: number;
}

export interface CropSilo {
    siloCapacity: number;
    totalHolding: number;
    totalHoldingBushels: number;
    holding: Record<string, SiloProduct>;
    pctFull: number;
}

export interface SiloTabResponse extends BaseResponse {
    cropSilo: CropSilo;
    increase: {
        small: { cost: number; capacity: number };
        medium: { cost: number; capacity: number };
    };
}

// ============================================
// Market Types
// ============================================

export interface CropValue {
    priceIncrease: number;
    cropValuePer1k: number;
    cropValueRating: number;
}

export interface CropValuesResponse extends BaseResponse {
    cropValues: Record<string, CropValue>;
    history: Record<string, number[]>;
}

export interface SellProductResponse extends BaseResponse {
    cropId: number;
    brokerage: number;
    valuePer1k: number;
    cropMultiplier: number;
    cropValueRating: number;
    cropData: {
        id: number;
        name: string;
        type: string;
        cropValue: number;
    };
    checklist: boolean;
    success: number;
    income: number;
    amount: number;
    remaining: number;
}

// ============================================
// Farmland Details
// ============================================

export interface EquipmentUnit {
    id?: number;
    heavyId?: number;
    haHour: number;
    hours?: number;
    harvestType?: number;
    img: string;
    wear?: number;
    implementId?: number;
}

export interface EquipmentCategory {
    data: {
        available: number;
        maxUnitsToUse: number;
        selectedUnits: number;
        sumHaHour: number;
        ci: number;
        opDuration: number;
        nextUnitAvailableIn?: number;
    };
    units?: EquipmentUnit[];
}

export interface FarmlandDetailsResponse {
    id: number;
    userFarmlandId: number;
    farmId: number;
    farmName: string;
    farmlandId: number;
    farmlandName: string;
    farmlandColor: string;
    city: string;
    country: string;
    countryCode: string;
    area: number;
    machinesOperating: number;
    isIrrigating: number;
    userCultivateCount: number;
    farmland: {
        isSeeding: number;
        isHarvesting: number;
        harvestCycles: number;
        maxHarvestCycles: number;
        outputState: string;
        opType: string;
        isCultivating: number;
        isGrowing: number;
        canIrrigate: number;
        maturedIn: number;
        isPendingOp: number;
        isPendingMaturing: number;
        isMatured: number;
        complexityIndex: number;
        farmlandState: FarmlandState;
        cropImg: string | null;
        cropName: string | null;
        cropId: number;
    };
    instantCompleteCost: number;
    equipment: {
        clearing: EquipmentCategory;
        plowing: EquipmentCategory;
        fertilizing: EquipmentCategory;
        seeding: EquipmentCategory;
        harvesting: EquipmentCategory;
    };
    operations: {
        opTimeRemain: number;
        opStartIn: number;
        opPct: number;
        growTimeRemain: number;
        growPct: number;
    };
    canHarvest: number;
    canSeed: number;
    canFertilize: number;
    canPlow: number;
    canClear: number;
}

// ============================================
// Action Types
// ============================================

export interface BatchActionUnit {
    tractorId: number;
    implementId?: number;
}

export interface BatchActionResult {
    success: number;
    type: string;
    farmlandId: number;
    userFarmlandId: number;
    farmId: number;
    opTimeRemain: number;
    opStartIn: number;
    opPctPerSec: number;
    farmlandState: FarmlandState;
    opType: string;
    growTimeRemain: number;
    growPctPerSec: number;
    farmlandNextOpState: string;
    opStart: number;
    opEnd: number;
    growEnd: number;
    harvestEnd: number;
}

export interface BatchActionResponse extends BaseResponse {
    isHeavy: number;
    opEnd: number;
    addHours: number;
    farmlandId: number;
    newWear: number;
    hectare: Record<string, number>;
    checklist: number;
    sumCultivated: number;
    operationType: string;
    failed: number;
    result: Record<string, BatchActionResult>;
    income: number;
    sumExpense: number;
    fuelUsed: number;
    unitsOperating: number;
    now: number;
    errors: string[];
}

// ============================================
// Auth Types
// ============================================

export interface AuthCredentials {
    email: string;
    password: string;
}

// ============================================
// Bot Configuration
// ============================================

export interface BotConfig {
    phpSessionId?: string;
    credentials?: AuthCredentials;
    androidToken?: string; // Para login via guest Android token
    checkIntervalMs: number;
    siloSellThreshold: number;
    debug: boolean;
}

// ============================================
// Task Types (for bot logic)
// ============================================

export interface AvailableTask {
    type: OperationType;
    farmId: number;
    farmlandId: number;
    userFarmlandId: number;
    area: number;
    complexityIndex: number;
    farmlandName: string;
}

export interface AvailableTractor {
    id: number;
    farmId: number;
    haHour: number;
    opType: string;
    implementId?: number;
}

// ============================================
// Smart Seeding Types
// ============================================

export interface CropScore {
    id: number;
    nameLatin: string;
    category: string;
    img: string;
    score: number;
}

export interface FarmlandDataResponse extends BaseResponse {
    farmland: {
        id: number;
        farmlandId: number;
        farmlandState: string;
        farmlandName: string;
        area: number;
        cropId: number;
    };
    city: {
        city: string;
        country: string;
        climate: string;
    };
    cropScores: Record<string, CropScore>;
}

export interface MarketSeed {
    id: number;
    name: string;
    type: string;
    img: string;
    kgPerHa: number;
    yieldPerHa: number;
    seedCost: number;
    unlocked: number;
    canAfford: number;
    cropValueRating: number;
    growTime: number;
}

export interface MarketResponse extends BaseResponse {
    user: {
        account: number;
        points: number;
    };
    silo: {
        siloCapacity: number;
        totalHolding: number;
    };
    seed: MarketSeed[];
}

export interface BuySeedResponse extends BaseResponse {
    success: number;
    amount: number;
    cost: number;
    remaining: number;
}

export interface SeedInventory {
    id: number;
    amount: number;
    remainingCapacity: number;
    name: string;
    kgPerHa: number;
}

