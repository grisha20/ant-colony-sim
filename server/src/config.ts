import path from "node:path";

const cwdName = path.basename(process.cwd()).toLowerCase();

export const CONFIG = {
  // Network.
  wsPort: Number(process.env.PORT ?? 8787),

  // The server is authoritative and advances the world 10 times per second.
  tickMs: 100,
  snapshotSaveEveryTicks: 20,
  // Феромонную сетку (самая тяжёлая часть снапшота) шлём не каждый тик, а реже.
  // Муравьи и HUD идут каждый тик; клиент переиспользует последние феромоны.
  pheromoneSendEveryTicks: 10,
  snapshotFile:
    process.env.SNAPSHOT_FILE ??
    path.resolve(process.cwd(), cwdName === "server" ? ".." : ".", "snapshot.json"),
  genomeFile:
    process.env.GENOME_FILE ??
    path.resolve(process.cwd(), cwdName === "server" ? ".." : ".", "genome.json"),
  spiderGenomeFile:
    process.env.SPIDER_GENOME_FILE ??
    path.resolve(process.cwd(), cwdName === "server" ? ".." : ".", "spider_genome.json"),

  // Surface is the only true grid in the first step.
  mapWidth: 240,
  mapHeight: 150,
  surfaceEntrance: { x: 120, y: 75 },

  // Underground is a fixed room scene, not a grid.
  undergroundWidth: 100,
  undergroundHeight: 70,
  undergroundEntrance: { x: 50, y: 6 },
  undergroundJunction: { x: 50, y: 30 },
  queenPos: { x: 22, y: 55 },
  nurseryPos: { x: 50, y: 55 },
  storagePos: { x: 78, y: 55 },
  barracksAPos: { x: 34, y: 42 },
  barracksBPos: { x: 66, y: 42 },

  startingWorkers: 2,
  startingEggs: 2,
  startingLarvae: 1,
  startingFoodStorage: 28,
  nestCapacity: 80,

  // Worker movement and state-machine balance.
  workerSurfaceSpeed: 1.05,
  workerUndergroundSpeed: 2.2,
  entranceRadiusSurface: 1.2,
  entranceRadiusUnderground: 2.5,
  undergroundNodeRadius: 2.6,
  foodPickupRadius: 1.35,
  maxEnergy: 900,
  energyDrainPerTick: 0.24,
  lowEnergyThreshold: 250,
  workerMealCost: 0.4,
  // Hungry surface workers return before they are starving, so a failed food trip does not become a death march.
  refuelEnergyThreshold: 420,
  randomWander: 0.35,
  defenseRadius: 10,
  defenseMaxHelpers: 6,
  antAlertRange: 10,
  antMobCount: 6,
  comfortableStorage: 120,
  minForagers: 6,
  maxForagers: 16,
  spiderNearNestPenalty: 0.55,
  spiderNearNestRadius: 18,

  // Pheromones live only on surface and are represented as two Float32Array grids.
  pheromoneEvaporation: 0.986,
  pheromoneDiffusion: 0.035,
  foodPheromoneDeposit: 8,
  homePheromoneDeposit: 4,
  foodSourceScent: 16,
  foodSourceScentRadius: 30,
  pheromoneGradientWeight: 2.0,

  // Queen and brood lifecycle.
  eggCost: 3,
  queenMinFoodReserve: 20,
  // How often the queen tries to lay a new egg under herself.
  broodLayCooldownTicks: 95,
  // Eggs only incubate after nurses carry them to the nursery.
  eggIncubationTicks: 260,
  // Larvae grow in the nursery while a nurse is present and food is available.
  larvaGrowthNeeded: 170,
  larvaFeedPerTick: 3,
  larvaFeedFoodCost: 0.04,
  // Queen meals come from storage; missed meals increment starve, and too many missed meals kill her.
  queenEatEveryTicks: 75,
  queenFoodPerMeal: 0.65,
  queenStarveBuffer: 18,
  // Brood work only starts when the colony has enough reserve, so food gathering cannot deadlock.
  nurseMinFoodReserve: 8,
  maxConcurrentNurses: 3,
  maxNurses: 2,
  maxDirectiveNurses: 2,
  scoutFraction: 0.5,
  foodDirectApproachRange: 12,

  // Player click on surface creates a finite food pile with this amount.
  playerFoodAmount: 80,
  carrionCount: 10,
  carrionAmount: 85,
  carrionRespawnEveryTicks: 900,

  // Surface spider: a wandering danger that becomes food only when the starving colony attacks it.
  spiderMaxHp: 800,
  spiderAttackRadius: 4,
  spiderDamagePerTick: 4.5,
  antDamagePerTick: 1.3,
  spiderAvoidRadius: 7,
  spiderCarcassFood: 140,
  spiderRespawnTicks: 600,
  spiderSpeed: 0.4,
  spiderChaseSpeed: 1.65,
  spiderHungerPerTick: 1,
  spiderCarrionEatPerTick: 18,
  spiderFedOnKill: 420,
  spiderHungryThreshold: 900,
  spiderStarveThreshold: 1350,
  spiderStarveBuffer: 260,
  spiderHungryAttackRadius: 5.5,
  spiderHungryDamage: 7,
  spiderChaseRange: 8,
  spiderEngageRange: 9,
  spiderLairMinDist: 25,
  spiderLairMaxDist: 55,
  spiderCarryAmount: 45,
  spiderHoardMax: 180,
  spiderHoardEatPerTick: 10,
  spiderMobRetreatCount: 2,
  spiderMobRetreatUtility: 2.4,
  spiderLowHpRetreatThreshold: 0.65,
  spiderLowHpRetreatUtility: 1.3,
  spiderKillWeight: 900,
  spiderSurviveWeight: 1,
  spiderLifeMaxTicks: 8000,
  spiderArchiveSize: 6,
  spiderTournamentSize: 3,
  spiderMutationRate: 0.15,
  spiderModeRepickPenalty: 0.15,
  // The colony attacks spiders only when visible surface food is essentially gone and storage is low.
  starveFoodThreshold: 3,
  starveStorageThreshold: 6,
  colonyDeathMinTicks: 120,
  generationMaxTicks: 6000,
  fitnessPopWeight: 0,
  fitnessFoodWeight: 4,
  fitnessSpiderWeight: 2500,
  fitnessAvgPopWeight: 25,
  fitnessSurviveWeight: 0.2,
  genomeArchiveSize: 6,
  genomeTournamentSize: 3,
  genomeMutationRate: 0.15,

  genomeGeneBounds: {
    nurseFraction: { min: 0.1, max: 0.6 },
    forageSpread: { min: 0.1, max: 0.6 },
    spiderAttackStorage: { min: 0, max: 60 },
    layReserve: { min: 10, max: 40 },
    refuelThreshold: { min: 200, max: 600 },
    spiderAvoid: { min: 4, max: 12 }
  },

  spiderGeneBounds: {
    aggression: { min: 0, max: 1 },
    ambushPreference: { min: 0, max: 1 },
    chaseTriggerDist: { min: 2, max: 14 },
    swarmCaution: { min: 1, max: 8 },
    entranceAffinity: { min: 0, max: 0.6 },
    patience: { min: 50, max: 400 },
    hungerAggroGain: { min: 0, max: 1 }
  }
} as const;
