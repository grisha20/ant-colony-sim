import { computeDirectives, createFitnessState, updateFitness } from "../ai/controller";
import { recordAndEvolve, saveGenome } from "../ai/genome";
import { CONFIG } from "../config";
import { stepAnt, clearDeadAntPaths } from "./ant";
import { updateTickCache, updateWorldSurfaceCache } from "./cache";
import { profiler } from "../utils/profiler";
import { updateBrood, updateQueen } from "./brood";
import { updateEnemies } from "./enemy";
import { assignForageRoles, updateColonyFoodMemory } from "./foodMemory";
import { planEggRoomIfNeeded, planNurseryIfNeeded, planWaitingRoomIfNeeded, refreshDigTasks } from "./underground";
import {
  addAntCorpse,
  colonyWorldView,
  createColonyRuntime,
  growFoodSources,
  respawnCarrion,
  respawnDebris,
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
      const kind = source.kind ?? (source.id.startsWith("carrion-") ? "carrion" : "food");
      const scentMultiplier =
        kind === "antCorpse"
          ? CONFIG.antCorpseScentMultiplier
          : kind === "carrion"
            ? CONFIG.carrionScentMultiplier
            : 1;
      const sx = Math.floor(source.pos.x);
      const sy = Math.floor(source.pos.y);
      const len = offsets.length;
      for (let i = 0; i < len; i += 1) {
        const offset = offsets[i];
        world.pheromones.food.add(sx + offset.dx, sy + offset.dy, CONFIG.foodSourceScent * offset.falloff * 5 * scentMultiplier);
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

function assignNurseRoles(colony: ColonyRuntime): void {
  const queenEggs = colony.underground.brood.filter((brood) => brood.stage === "egg" && brood.location === "queen" && !brood.isPrincess).length;
  const nurseryLarvae = colony.underground.brood.filter((brood) => brood.stage === "larva" && brood.location === "nursery").length;
  const transportNurses = Math.min(2, Math.ceil(queenEggs / 4));
  const feedNurses = nurseryLarvae > 0 ? 1 : 0;
  const target = Math.min(CONFIG.maxNurses, Math.max(CONFIG.startingNurses, transportNurses + feedNurses));
  const nurses = colony.ants.filter((ant) => ant.state !== "dead" && ant.job === "nurse");

  for (const ant of nurses.slice(target)) {
    if (ant.state === "idle" && ant.carrying <= 0) {
      ant.job = "idle";
    }
  }

  const activeNurses = colony.ants.filter((ant) => ant.state !== "dead" && ant.job === "nurse").length;
  if (activeNurses >= target) {
    return;
  }

  const candidates = colony.ants
    .filter((ant) =>
      ant.state !== "dead" &&
      ant.layer === "underground" &&
      ant.state === "idle" &&
      ant.carrying <= 0 &&
      !ant.carryingDirt &&
      !ant.carryingDebris &&
      ant.job !== "dig" &&
      ant.forageRole !== "scout"
    )
    .sort((a, b) => Number(a.id.replace("ant-", "")) - Number(b.id.replace("ant-", "")));

  for (const ant of candidates.slice(0, target - activeNurses)) {
    ant.job = "nurse";
    ant.forageRole = undefined;
    ant.foundFoodSourceId = undefined;
  }
}

function restartColonyRuntime(world: World, colony: ColonyRuntime): void {
  const fresh = createColonyRuntime(
    colony.id,
    colony.color,
    colony.surfaceEntrance,
    colony.genomeState,
    world.spiderGenomeState,
    world.tick
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

  profiler.measure("phase.resources", () => {
    respawnCarrion(world);
    growFoodSources(world);
    respawnDebris(world);
  });
  if (world.tick % 5 === 0) {
    profiler.measure("phase.scentFoodSources", () => scentFoodSources(world));
  }

  profiler.measure("phase.colonies.step", () => {
    for (const colony of world.colonies) {
      const scopedWorld = colonyWorldView(world, colony);
      if (colony.underground.brood.some((brood) => brood.stage === "egg" && brood.location === "queen")) {
        planEggRoomIfNeeded(colony.underground);
      }
      if (colony.underground.brood.some((brood) => brood.stage === "egg" && brood.location === "egg")) {
        planNurseryIfNeeded(colony.underground);
      }
      planWaitingRoomIfNeeded(colony.underground, !!colony.colony.activeFoodTargetId && colony.ants.length > CONFIG.startingWorkers);
      refreshDigTasks(colony.underground);
      if (world.tick % 10 === 0) {
        updateColonyFoodMemory(scopedWorld);
      }
      colony.directives = computeDirectives(scopedWorld, colony.genomeState.current);
      assignNurseRoles(colony);
      assignForageRoles(scopedWorld);
      updateTickCache(scopedWorld);
      profiler.measure("stepAnt", () => {
        for (const ant of colony.ants) {
          stepAnt(scopedWorld, ant);
        }
      });
    }
  });

  syncWorldLegacyFields(world);
  profiler.measure("phase.updateWorldSurfaceCache", () => updateWorldSurfaceCache(world));
  profiler.measure("phase.updateEnemies", () => updateEnemies(world));

  profiler.measure("phase.colonies.after", () => {
    for (const colony of world.colonies) {
      const scopedWorld = colonyWorldView(world, colony);
      updateQueen(scopedWorld);
      updateBrood(scopedWorld);
      refreshDigTasks(colony.underground);
      removeDeadAndSyncLayerLists(world, colony);
      updateFitness(scopedWorld);
      evolveAfterQueenDeath(world, colony);
      syncColonyStatsForRuntime(colony);
    }
  });

  if (world.tick % 4 === 0) {
    const evap4 = Math.pow(CONFIG.pheromoneEvaporation, 4);
    const diff4 = Math.min(0.9, CONFIG.pheromoneDiffusion * 3.5);
    for (const colony of world.colonies) {
      profiler.measure("pheromone.diffuse", () => {
        colony.homePheromone.evaporateAndDiffuse(evap4, diff4);
      });
    }

    profiler.measure("pheromone.diffuse", () => {
      world.pheromones.food.evaporateAndDiffuse(evap4, diff4);
    });
  }
  if (world.tick % 500 === 0) {
    const activeIds = new Set(world.ants.map((a) => a.id));
    clearDeadAntPaths(activeIds);
  }

  syncWorldLegacyFields(world);
}
