import type { Genome } from "./genome";
import { CONFIG } from "../config";
import type { World } from "../sim/world";

export type ColonyDirectives = {
  maxNurses: number;
  forageWander: number;
  spiderAttackStorage: number;
  layReserve: number;
  refuelThreshold: number;
  spiderAvoidRadius: number;
  foragerTarget: number;
  activeTarget: number;
  nurseTarget: number;
  diggerTarget: number;
  queenRearThreshold: number;
};

export type FitnessState = {
  survivalTicks: number;
  peakPopulation: number;
  totalFoodDeposited: number;
  populationIntegral: number;
  spidersKilled: number;
  score: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeDirectives(world: World, genome: Genome): ColonyDirectives {
  const workerCount = Math.max(1, world.ants.length);
  const fullStoragePressure = world.underground.foodStorage >= CONFIG.queenMinFoodReserve * 2 ? 0.85 : 1;
  const surfaceFood = world.surface.foodSources.reduce((total, source) => total + Math.max(0, source.amount), 0);
  const hasSurfaceFood = surfaceFood > 0;
  const hasBrood = world.underground.brood.length > 0;
  const nearestSpiderDistance = world.enemies.reduce((nearest, enemy) => {
    if (enemy.type !== "spider" || enemy.hp <= 0) {
      return nearest;
    }

    return Math.min(nearest, Math.hypot(enemy.pos.x - world.surface.entrance.x, enemy.pos.y - world.surface.entrance.y));
  }, Number.POSITIVE_INFINITY);
  const spiderNearNest = nearestSpiderDistance <= CONFIG.spiderNearNestRadius;
  const nurseTarget = hasBrood ? Math.min(CONFIG.maxNurses, workerCount) : 0;
  const rawActiveTarget = hasSurfaceFood
    ? Math.max(CONFIG.minForagers, workerCount - nurseTarget)
    : Math.round(workerCount * CONFIG.scoutFraction);
  const activeTarget = clamp(
    Math.round(rawActiveTarget * (spiderNearNest ? CONFIG.spiderNearNestPenalty : 1)),
    Math.min(CONFIG.minForagers, workerCount),
    Math.min(CONFIG.maxForagers, workerCount)
  );
  const maxNurses = clamp(
    Math.min(Math.round(workerCount * genome.genes.nurseFraction), nurseTarget),
    0,
    Math.min(CONFIG.maxDirectiveNurses, nurseTarget)
  );
  const diggerTarget = clamp(Math.round(workerCount * genome.genes.digFraction), 0, CONFIG.maxDiggers);
  const queenRearThreshold = clamp(85 - genome.genes.queenRearBias * 50, 35, 85);

  return {
    maxNurses,
    forageWander: clamp(
      genome.genes.forageSpread * fullStoragePressure,
      CONFIG.genomeGeneBounds.forageSpread.min,
      CONFIG.genomeGeneBounds.forageSpread.max
    ),
    spiderAttackStorage: clamp(
      genome.genes.spiderAttackStorage,
      CONFIG.genomeGeneBounds.spiderAttackStorage.min,
      CONFIG.genomeGeneBounds.spiderAttackStorage.max
    ),
    layReserve: clamp(genome.genes.layReserve, CONFIG.genomeGeneBounds.layReserve.min, CONFIG.genomeGeneBounds.layReserve.max),
    refuelThreshold: clamp(
      genome.genes.refuelThreshold,
      CONFIG.genomeGeneBounds.refuelThreshold.min,
      CONFIG.genomeGeneBounds.refuelThreshold.max
    ),
    spiderAvoidRadius: clamp(
      genome.genes.spiderAvoid,
      CONFIG.genomeGeneBounds.spiderAvoid.min,
      CONFIG.genomeGeneBounds.spiderAvoid.max
    ),
    foragerTarget: activeTarget,
    activeTarget,
    nurseTarget,
    diggerTarget,
    queenRearThreshold
  };
}

export function createFitnessState(): FitnessState {
  return {
    survivalTicks: 0,
    peakPopulation: 0,
    totalFoodDeposited: 0,
    populationIntegral: 0,
    spidersKilled: 0,
    score: 0
  };
}

export function updateFitness(world: World): void {
  const population = world.ants.length + world.underground.brood.length;
  world.fitness.survivalTicks += 1;
  world.fitness.peakPopulation = Math.max(world.fitness.peakPopulation, population);
  world.fitness.populationIntegral += population;
  const averagePopulation = world.fitness.populationIntegral / Math.max(1, world.fitness.survivalTicks);
  world.fitness.score =
    world.fitness.totalFoodDeposited * CONFIG.fitnessFoodWeight +
    world.fitness.spidersKilled * CONFIG.fitnessSpiderWeight +
    averagePopulation * CONFIG.fitnessAvgPopWeight +
    world.fitness.survivalTicks * CONFIG.fitnessSurviveWeight +
    world.fitness.populationIntegral * CONFIG.fitnessPopWeight;
}
