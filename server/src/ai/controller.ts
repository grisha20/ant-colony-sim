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
  aggression: number;
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

function isWithinRadius(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= radius * radius;
}

export function computeDirectives(world: World, genome: Genome): ColonyDirectives {
  const workerCount = Math.max(1, world.ants.length);
  const fullStoragePressure = world.underground.foodStorage >= CONFIG.queenMinFoodReserve * 2 ? 0.85 : 1;
  const hasKnownFoodTarget = !!world.colony.activeFoodTargetId;
  const hasBrood = world.underground.brood.length > 0;
  const spiderNearNest = world.enemies.some((enemy) => {
    if (enemy.type !== "spider" || enemy.hp <= 0) {
      return false;
    }

    return isWithinRadius(enemy.pos, world.surface.entrance, CONFIG.spiderNearNestRadius);
  });
  const nurseTarget = hasBrood ? Math.min(CONFIG.maxNurses, workerCount) : 0;
  const availableForSearch = Math.max(1, workerCount - nurseTarget);
  const rawActiveTarget = hasKnownFoodTarget
    ? Math.max(CONFIG.minForagers, Math.round(workerCount * CONFIG.foragerFraction))
    : availableForSearch;
  const maxActiveForagers = hasKnownFoodTarget ? CONFIG.maxForagers : CONFIG.maxSearchAssistants;
  const minActiveForagers = hasKnownFoodTarget ? CONFIG.minForagers : Math.min(CONFIG.startingScouts, workerCount);
  const activeTarget = clamp(
    Math.round(rawActiveTarget * (spiderNearNest ? CONFIG.spiderNearNestPenalty : 1)),
    Math.min(minActiveForagers, workerCount),
    Math.min(maxActiveForagers, workerCount)
  );
  const maxNurses = clamp(
    Math.min(Math.round(workerCount * genome.genes.nurseFraction), nurseTarget),
    0,
    Math.min(CONFIG.maxDirectiveNurses, nurseTarget)
  );
  const hasDigNeed = world.underground.digTasks.some((task) => task.status !== "done");
  const hasCriticalDigNeed = world.underground.digTasks.some(
    (task) =>
      task.status !== "done" &&
      (task.roomType === "egg" || task.roomType === "nursery" || task.roomType === "storage")
  );
  const diggersWhenFoodKnown = hasKnownFoodTarget && !hasCriticalDigNeed ? 1 : CONFIG.startingMiners;
  const minDiggersWhenNeeded = hasDigNeed ? Math.min(diggersWhenFoodKnown, workerCount) : 0;
  const diggerTarget = clamp(
    Math.max(minDiggersWhenNeeded, Math.round(workerCount * genome.genes.digFraction)),
    0,
    hasKnownFoodTarget && !hasCriticalDigNeed ? Math.min(1, CONFIG.maxDiggers) : CONFIG.maxDiggers
  );
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
    queenRearThreshold,
    aggression: clamp(
      genome.genes.aggression +
        (!hasKnownFoodTarget && world.underground.foodStorage <= CONFIG.warHungerThreshold ? 0.35 : 0) +
        (world.underground.queen.starve > 0 ? Math.min(0.3, world.underground.queen.starve * 0.04) : 0),
      CONFIG.genomeGeneBounds.aggression.min,
      CONFIG.genomeGeneBounds.aggression.max
    )
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
