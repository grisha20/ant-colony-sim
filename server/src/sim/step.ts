import { CONFIG } from "../config";
import { computeDirectives, createFitnessState, updateFitness } from "../ai/controller";
import { recordAndEvolve, saveGenome } from "../ai/genome";
import { stepAnt } from "./ant";
import { updateBrood, updateQueen } from "./brood";
import { syncColonyStats } from "./colony";
import { updateEnemies } from "./enemy";
import { respawnCarrion, restartColony, type World } from "./world";

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

function removeDeadAndSyncLayerLists(world: World): void {
  world.ants = world.ants.filter((ant) => ant.state !== "dead");
  world.underground.ants = world.ants.filter((ant) => ant.layer === "underground").map((ant) => ant.id);
}

function recordReignAndEvolve(world: World): void {
  world.genomeState.generationsRun += 1;
  recordAndEvolve(world.genomeState, world.genomeState.current, world.fitness.score);
  saveGenome(world.genomeState).catch((error: unknown) => {
    console.warn(`Could not save genome: ${(error as Error).message}`);
  });
  world.colony.generation = world.genomeState.current.generation;
  world.colony.generationsRun = world.genomeState.generationsRun;
  world.colony.bestFitness = world.genomeState.bestFitness;
}

function promotePrincess(world: World): boolean {
  const princess = world.underground.princesses.shift();
  if (!princess) {
    return false;
  }

  world.underground.queen = {
    pos: { ...world.underground.queenChamber },
    alive: true,
    layCooldown: CONFIG.broodLayCooldownTicks,
    starve: 0,
    stress: 0,
    hp: CONFIG.queenMaxHp,
    age: 0
  };
  world.fitness = createFitnessState();
  world.directives = computeDirectives(world, world.genomeState.current);
  return true;
}

function evolveAfterQueenDeath(world: World): boolean {
  if (world.underground.queen.alive) {
    return false;
  }

  recordReignAndEvolve(world);
  if (promotePrincess(world)) {
    return false;
  }

  restartColony(world);
  return true;
}

export function step(world: World): void {
  world.tick += 1;
  world.directives = computeDirectives(world, world.genomeState.current);

  respawnCarrion(world);
  scentFoodSources(world);

  for (const ant of world.ants) {
    stepAnt(world, ant);
  }

  updateEnemies(world);
  updateQueen(world);
  updateBrood(world);
  removeDeadAndSyncLayerLists(world);
  updateFitness(world);

  if (evolveAfterQueenDeath(world)) {
    return;
  }

  world.pheromones.food.evaporateAndDiffuse(CONFIG.pheromoneEvaporation, CONFIG.pheromoneDiffusion);
  world.pheromones.home.evaporateAndDiffuse(CONFIG.pheromoneEvaporation, CONFIG.pheromoneDiffusion);

  syncColonyStats(
    world.colony,
    world.ants.length,
    world.underground.brood.filter((brood) => brood.stage === "egg").length,
    world.underground.brood.filter((brood) => brood.stage === "larva").length,
    world.underground.foodStorage,
    world.underground.queen.alive,
    world.underground.queen.stress,
    world.underground.queen.age,
    world.underground.princesses.length,
    world.genomeState.bestFitness,
    world.spiderGenomeState.current.generation,
    world.genomeState.generationsRun,
    world.spiderGenomeState.generationsRun
  );
}
