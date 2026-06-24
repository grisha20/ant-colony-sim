import { computeDirectives, createFitnessState, updateFitness } from "../ai/controller";
import { recordAndEvolve, saveGenome } from "../ai/genome";
import { CONFIG } from "../config";
import { stepAnt } from "./ant";
import { updateBrood, updateQueen } from "./brood";
import { updateEnemies } from "./enemy";
import { planNurseryIfNeeded, refreshDigTasks } from "./underground";
import {
  colonyWorldView,
  createColonyRuntime,
  respawnCarrion,
  syncColonyStatsForRuntime,
  syncWorldLegacyFields,
  type ColonyRuntime,
  type World
} from "./world";

function scentFoodSources(world: World): void {
  for (const source of world.surface.foodSources) {
    if (source.amount > 0) {
      const radius = CONFIG.foodSourceScentRadius;
      for (let y = Math.floor(source.pos.y - radius); y <= Math.ceil(source.pos.y + radius); y += 1) {
        for (let x = Math.floor(source.pos.x - radius); x <= Math.ceil(source.pos.x + radius); x += 1) {
          const distance = Math.hypot(source.pos.x - x, source.pos.y - y);
          if (distance <= radius) {
            const falloff = 1 - distance / radius;
            world.pheromones.food.add(x, y, CONFIG.foodSourceScent * falloff);
          }
        }
      }
    }
  }
}

function removeDeadAndSyncLayerLists(colony: ColonyRuntime): void {
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
  scentFoodSources(world);

  for (const colony of world.colonies) {
    const scopedWorld = colonyWorldView(world, colony);
    if (colony.underground.brood.some((brood) => brood.stage === "egg" && brood.location === "queen")) {
      planNurseryIfNeeded(colony.underground);
    }
    refreshDigTasks(colony.underground);
    colony.directives = computeDirectives(scopedWorld, colony.genomeState.current);
    for (const ant of colony.ants) {
      stepAnt(scopedWorld, ant);
    }
  }

  syncWorldLegacyFields(world);
  updateEnemies(world);

  for (const colony of world.colonies) {
    const scopedWorld = colonyWorldView(world, colony);
    updateQueen(scopedWorld);
    updateBrood(scopedWorld);
    refreshDigTasks(colony.underground);
    removeDeadAndSyncLayerLists(colony);
    updateFitness(scopedWorld);
    evolveAfterQueenDeath(world, colony);
    syncColonyStatsForRuntime(colony);
    colony.homePheromone.evaporateAndDiffuse(CONFIG.pheromoneEvaporation, CONFIG.pheromoneDiffusion);
  }

  world.pheromones.food.evaporateAndDiffuse(CONFIG.pheromoneEvaporation, CONFIG.pheromoneDiffusion);
  syncWorldLegacyFields(world);
}
