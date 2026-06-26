import { computeDirectives, createFitnessState, updateFitness } from "../ai/controller";
import { recordAndEvolve, saveGenome } from "../ai/genome";
import { CONFIG } from "../config";
import { stepAnt } from "./ant";
import { profiler } from "../utils/profiler";
import { updateBrood, updateQueen } from "./brood";
import { updateEnemies } from "./enemy";
import { planEggRoomIfNeeded, planNurseryIfNeeded, refreshDigTasks } from "./underground";
import {
  addAntCorpse,
  colonyWorldView,
  createColonyRuntime,
  growFoodSources,
  respawnCarrion,
  syncColonyStatsForRuntime,
  syncWorldLegacyFields,
  type ColonyRuntime,
  type World
} from "./world";

let scentOffsets: { dx: number; dy: number; falloff: number }[] | null = null;

function getScentOffsets(radius: number): { dx: number; dy: number; falloff: number }[] {
  if (scentOffsets) {
    return scentOffsets;
  }
  scentOffsets = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius) {
        const falloff = 1 - distance / radius;
        scentOffsets.push({ dx, dy, falloff });
      }
    }
  }
  return scentOffsets;
}

function scentFoodSources(world: World): void {
  const radius = CONFIG.foodSourceScentRadius;
  const offsets = getScentOffsets(radius);

  for (const source of [...world.surface.foodSources, ...world.surface.carrion]) {
    if (source.amount > 0) {
      const sx = Math.floor(source.pos.x);
      const sy = Math.floor(source.pos.y);
      const len = offsets.length;
      for (let i = 0; i < len; i += 1) {
        const offset = offsets[i];
        world.pheromones.food.add(sx + offset.dx, sy + offset.dy, CONFIG.foodSourceScent * offset.falloff);
      }
    }
  }
}

function removeDeadAndSyncLayerLists(world: World, colony: ColonyRuntime): void {
  for (const ant of colony.ants) {
    if (ant.state === "dead") {
      addAntCorpse(colonyWorldView(world, colony), ant);
    }
  }
  colony.underground.carrion = colony.underground.carrion.filter((source) => source.amount > 0);
  colony.ants = colony.ants.filter((ant) => ant.state !== "dead");
  colony.underground.ants = colony.ants.filter((ant) => ant.layer === "underground").map((ant) => ant.id);
}

function genomeFileForColony(colony: ColonyRuntime): string {
  return colony.id === "colony-2" ? CONFIG.genomeFileB : CONFIG.genomeFile;
}

function recordReignAndEvolve(world: World, colony: ColonyRuntime): void {
  colony.genomeState.generationsRun += 1;
  recordAndEvolve(colony.genomeState, colony.genomeState.current, colony.fitness.score);
  saveGenome(colony.genomeState, genomeFileForColony(colony)).catch((error: unknown) => {
    console.warn(`Could not save genome: ${(error as Error).message}`);
  });
  colony.colony.generation = colony.genomeState.current.generation;
  colony.colony.generationsRun = colony.genomeState.generationsRun;
  colony.colony.bestFitness = colony.genomeState.bestFitness;

  if (world.colonies[0] === colony) {
    world.genomeState = colony.genomeState;
  }
}

function promotePrincess(world: World, colony: ColonyRuntime): boolean {
  const princess = colony.underground.princesses.shift();
  if (!princess) {
    return false;
  }

  colony.underground.queen = {
    pos: { ...colony.underground.queenChamber },
    alive: true,
    layCooldown: CONFIG.broodLayCooldownTicks,
    starve: 0,
    stress: 0,
    hp: CONFIG.queenMaxHp,
    age: 0
  };
  colony.fitness = createFitnessState();
  colony.directives = computeDirectives(colonyWorldView(world, colony), colony.genomeState.current);
  return true;
}

function restartColonyRuntime(world: World, colony: ColonyRuntime): void {
  const fresh = createColonyRuntime(
    colony.id,
    colony.color,
    colony.surfaceEntrance,
    colony.genomeState,
    world.spiderGenomeState
  );
  Object.assign(colony, fresh);
}

function evolveAfterQueenDeath(world: World, colony: ColonyRuntime): void {
  if (colony.underground.queen.alive) {
    return;
  }

  recordReignAndEvolve(world, colony);
  if (!promotePrincess(world, colony)) {
    restartColonyRuntime(world, colony);
  }
}

export function step(world: World): void {
  world.tick += 1;

  respawnCarrion(world);
  growFoodSources(world);
  scentFoodSources(world);

  for (const colony of world.colonies) {
    const scopedWorld = colonyWorldView(world, colony);
    if (colony.underground.brood.some((brood) => brood.stage === "egg" && brood.location === "queen")) {
      planEggRoomIfNeeded(colony.underground);
    }
    if (colony.underground.brood.some((brood) => brood.stage === "egg" && brood.location === "egg")) {
      planNurseryIfNeeded(colony.underground);
    }
    refreshDigTasks(colony.underground);
    colony.directives = computeDirectives(scopedWorld, colony.genomeState.current);
    profiler.measure("stepAnt", () => {
      for (const ant of colony.ants) {
        stepAnt(scopedWorld, ant);
      }
    });
  }

  syncWorldLegacyFields(world);
  updateEnemies(world);

  for (const colony of world.colonies) {
    const scopedWorld = colonyWorldView(world, colony);
    updateQueen(scopedWorld);
    updateBrood(scopedWorld);
    refreshDigTasks(colony.underground);
    removeDeadAndSyncLayerLists(world, colony);
    updateFitness(scopedWorld);
    evolveAfterQueenDeath(world, colony);
    syncColonyStatsForRuntime(colony);
    profiler.measure("pheromone.diffuse", () => {
      colony.homePheromone.evaporateAndDiffuse(CONFIG.pheromoneEvaporation, CONFIG.pheromoneDiffusion);
    });
  }

  profiler.measure("pheromone.diffuse", () => {
    world.pheromones.food.evaporateAndDiffuse(CONFIG.pheromoneEvaporation, CONFIG.pheromoneDiffusion);
  });
  syncWorldLegacyFields(world);
}
