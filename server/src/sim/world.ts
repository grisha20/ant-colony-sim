import type { Ant, Brood, Enemy, FoodSource, PheromoneSnapshot, Surface, Underground, WorldSnapshot } from "../../../shared/types";
import { computeDirectives, createFitnessState, type ColonyDirectives, type FitnessState } from "../ai/controller";
import type { GenomeState } from "../ai/genome";
import type { SpiderGenomeState } from "../ai/spiderGenome";
import { CONFIG } from "../config";
import { createColony, syncColonyStats } from "./colony";
import { createSpider, syncEnemyIdCounter } from "./enemy";
import { PheromoneGrid } from "./pheromone";
import { createUnderground, syncBroodIdCounter } from "./underground";

export type World = Omit<WorldSnapshot, "pheromones"> & {
  genomeState: GenomeState;
  spiderGenomeState: SpiderGenomeState;
  directives: ColonyDirectives;
  fitness: FitnessState;
  spiderFitness: {
    antsKilled: number;
    survivalTicks: number;
    score: number;
  };
  pheromones: {
    width: number;
    height: number;
    food: PheromoneGrid;
    home: PheromoneGrid;
  };
};

let nextAntId = 1;
let nextFoodSourceId = 0;
let nextCarrionId = 0;

function randomSurfacePosAwayFromNest(minNestDistance: number): { x: number; y: number } {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pos = {
      x: 3 + Math.random() * (CONFIG.mapWidth - 6),
      y: 3 + Math.random() * (CONFIG.mapHeight - 6)
    };
    const distanceFromNest = Math.hypot(pos.x - CONFIG.surfaceEntrance.x, pos.y - CONFIG.surfaceEntrance.y);
    if (distanceFromNest >= minNestDistance) {
      return pos;
    }
  }

  return { x: CONFIG.mapWidth - 8, y: 8 };
}

function makeFoodSources(): FoodSource[] {
  const area = CONFIG.mapWidth * CONFIG.mapHeight;
  const sourceCount = Math.max(5, Math.round(area / 5200));
  const minNestDistance = Math.min(CONFIG.mapWidth, CONFIG.mapHeight) * 0.16;
  const sources: FoodSource[] = [];

  while (sources.length < sourceCount) {
    const pos = randomSurfacePosAwayFromNest(minNestDistance);

    sources.push({
      id: `food-${nextFoodSourceId}`,
      pos,
      amount: 28 + Math.random() * 32
    });
    nextFoodSourceId += 1;
  }

  return sources;
}

function makeCarrionSource(): FoodSource {
  const minNestDistance = Math.min(CONFIG.mapWidth, CONFIG.mapHeight) * 0.12;
  const source: FoodSource = {
    id: `carrion-${nextCarrionId}`,
    pos: randomSurfacePosAwayFromNest(minNestDistance),
    amount: CONFIG.carrionAmount * (0.75 + Math.random() * 0.5)
  };
  nextCarrionId += 1;
  return source;
}

function makeCarrionSources(): FoodSource[] {
  return Array.from({ length: CONFIG.carrionCount }, () => makeCarrionSource());
}

export function respawnCarrion(world: World): void {
  world.surface.carrion = world.surface.carrion.filter((source) => source.amount > 0);
  if (CONFIG.carrionRespawnEveryTicks <= 0 || world.tick % CONFIG.carrionRespawnEveryTicks !== 0) {
    return;
  }

  if (world.surface.carrion.length < CONFIG.carrionCount) {
    world.surface.carrion.push(makeCarrionSource());
  }
}

export function addFoodSource(world: World, x: number, y: number, amount: number): FoodSource {
  const source: FoodSource = {
    id: `food-${nextFoodSourceId}`,
    pos: {
      x: Math.max(1.5, Math.min(world.surface.width - 1.5, x)),
      y: Math.max(1.5, Math.min(world.surface.height - 1.5, y))
    },
    amount
  };
  nextFoodSourceId += 1;
  world.surface.foodSources.push(source);
  return source;
}

export function createWorkerAnt(pos: { x: number; y: number }, layer: "surface" | "underground" = "underground"): Ant {
  const id = `ant-${nextAntId}`;
  nextAntId += 1;

  return {
    id,
    colonyId: "colony-1",
    role: "worker",
    layer,
    state: layer === "underground" ? "idle" : "search",
    pos: {
      x: pos.x + (Math.random() - 0.5) * 8,
      y: pos.y + (Math.random() - 0.5) * 8
    },
    energy: CONFIG.maxEnergy * (0.82 + Math.random() * 0.18),
    carrying: 0,
    heading: randomHeading()
  };
}

export function randomHeading(): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function createSpiderFitnessState(): World["spiderFitness"] {
  return {
    antsKilled: 0,
    survivalTicks: 0,
    score: 0
  };
}

export function createWorld(genomeState: GenomeState, spiderGenomeState: SpiderGenomeState): World {
  const colony = createColony(
    genomeState.current.generation,
    genomeState.generationsRun,
    genomeState.bestFitness,
    spiderGenomeState.current.generation,
    spiderGenomeState.generationsRun
  );
  const underground = createUnderground();
  const surface: Surface = {
    width: CONFIG.mapWidth,
    height: CONFIG.mapHeight,
    entrance: CONFIG.surfaceEntrance,
    foodSources: makeFoodSources(),
    carrion: makeCarrionSources()
  };
  const ants = Array.from({ length: CONFIG.startingWorkers }, () => createWorkerAnt(CONFIG.queenPos));
  const enemies = [createSpider()];

  underground.ants = ants.map((ant) => ant.id);
  syncColonyStats(
    colony,
    ants.length,
    underground.brood.filter((brood) => brood.stage === "egg").length,
    underground.brood.filter((brood) => brood.stage === "larva").length,
    underground.foodStorage,
    underground.queen.alive,
    genomeState.bestFitness,
    spiderGenomeState.current.generation,
    genomeState.generationsRun,
    spiderGenomeState.generationsRun
  );

  const world: World = {
    tick: 0,
    surface,
    underground,
    colony,
    genomeState,
    spiderGenomeState,
    directives: {
      maxNurses: CONFIG.maxConcurrentNurses,
      forageWander: CONFIG.randomWander,
      spiderAttackStorage: CONFIG.starveStorageThreshold,
      layReserve: CONFIG.queenMinFoodReserve,
      refuelThreshold: CONFIG.refuelEnergyThreshold,
      spiderAvoidRadius: CONFIG.spiderAvoidRadius,
      foragerTarget: CONFIG.minForagers,
      activeTarget: CONFIG.minForagers,
      nurseTarget: 0
    },
    fitness: createFitnessState(),
    spiderFitness: createSpiderFitnessState(),
    ants,
    enemies,
    pheromones: {
      width: CONFIG.mapWidth,
      height: CONFIG.mapHeight,
      food: new PheromoneGrid(CONFIG.mapWidth, CONFIG.mapHeight),
      home: new PheromoneGrid(CONFIG.mapWidth, CONFIG.mapHeight)
    }
  };
  world.directives = computeDirectives(world, genomeState.current);
  return world;
}

export function worldFromSnapshot(
  snapshot: WorldSnapshot,
  genomeState: GenomeState,
  spiderGenomeState: SpiderGenomeState
): World {
  const maxAntId = snapshot.ants.reduce((max, ant) => {
    const numeric = Number(ant.id.replace("ant-", ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  nextAntId = Math.max(nextAntId, maxAntId + 1);
  const maxFoodId = snapshot.surface.foodSources.reduce((max, source) => {
    const numeric = Number(source.id.replace("food-", ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  nextFoodSourceId = Math.max(nextFoodSourceId, maxFoodId + 1);
  const carrion = snapshot.surface.carrion ?? makeCarrionSources();
  const maxCarrionId = carrion.reduce((max, source) => {
    const numeric = Number(source.id.replace("carrion-", ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  nextCarrionId = Math.max(nextCarrionId, maxCarrionId + 1);
  const underground = normalizeUndergroundSnapshot(snapshot.underground);
  syncBroodIdCounter(underground.brood);
  const enemies = normalizeEnemies(snapshot);
  syncEnemyIdCounter(enemies, snapshot.tick);

  const world: World = {
    ...snapshot,
    surface: {
      ...snapshot.surface,
      carrion
    },
    colony: {
      ...snapshot.colony,
      generation: genomeState.current.generation,
      generationsRun: genomeState.generationsRun,
      bestFitness: genomeState.bestFitness,
      spiderGeneration: spiderGenomeState.current.generation,
      spiderGenerationsRun: spiderGenomeState.generationsRun
    },
    underground,
    enemies,
    genomeState,
    spiderGenomeState,
    directives: {
      maxNurses: CONFIG.maxConcurrentNurses,
      forageWander: CONFIG.randomWander,
      spiderAttackStorage: CONFIG.starveStorageThreshold,
      layReserve: CONFIG.queenMinFoodReserve,
      refuelThreshold: CONFIG.refuelEnergyThreshold,
      spiderAvoidRadius: CONFIG.spiderAvoidRadius,
      foragerTarget: CONFIG.minForagers,
      activeTarget: CONFIG.minForagers,
      nurseTarget: 0
    },
    fitness: createFitnessState(),
    spiderFitness: createSpiderFitnessState(),
    pheromones: {
      width: snapshot.pheromones.width,
      height: snapshot.pheromones.height,
      food: new PheromoneGrid(snapshot.pheromones.width, snapshot.pheromones.height, snapshot.pheromones.food),
      home: new PheromoneGrid(snapshot.pheromones.width, snapshot.pheromones.height, snapshot.pheromones.home)
    }
  };
  world.directives = computeDirectives(world, genomeState.current);
  return world;
}

export function restartColony(world: World): void {
  const freshWorld = createWorld(world.genomeState, world.spiderGenomeState);
  Object.assign(world, freshWorld);
}

function normalizeEnemies(snapshot: WorldSnapshot & { enemies?: Enemy[] }): Enemy[] {
  return (snapshot.enemies ?? []).map((enemy) => ({
    ...enemy,
    maxHp: enemy.maxHp ?? CONFIG.spiderMaxHp,
    hp: enemy.hp ?? CONFIG.spiderMaxHp,
    hunger: enemy.hunger ?? 0,
    lair: enemy.lair ?? {
      x: Math.max(1.5, Math.min(CONFIG.mapWidth - 1.5, CONFIG.surfaceEntrance.x + CONFIG.spiderLairMinDist)),
      y: CONFIG.surfaceEntrance.y
    },
    carrying: enemy.carrying ?? 0,
    hoard: enemy.hoard ?? 0
  }));
}

function normalizeUndergroundSnapshot(
  underground: Underground & {
    eggs?: Array<{ id: string; pos: { x: number; y: number }; maturity: number }>;
    feedingChamber?: { x: number; y: number };
  }
): Underground {
  const queenChamber = underground.queenChamber ?? underground.queen.pos ?? CONFIG.queenPos;
  const nursery = underground.nursery ?? CONFIG.nurseryPos;
  const normalized: Underground = {
    ...underground,
    queen: {
      ...underground.queen,
      starve: underground.queen.starve ?? 0,
      layCooldown: underground.queen.layCooldown ?? CONFIG.broodLayCooldownTicks
    },
    brood:
      underground.brood?.map((brood) => ({
        ...brood,
        location: brood.location === "queen" ? "queen" : "nursery"
      })) ??
      (underground.eggs ?? []).map(
        (egg): Brood => ({
          id: egg.id.replace("egg-", "brood-"),
          stage: "egg",
          location: "nursery",
          pos: egg.pos,
          progress: egg.maturity
        })
      ),
    entrance: underground.entrance ?? CONFIG.undergroundEntrance,
    junction: underground.junction ?? CONFIG.undergroundJunction,
    queenChamber,
    nursery,
    storage: underground.storage ?? CONFIG.storagePos,
    barracksA: underground.barracksA ?? CONFIG.barracksAPos,
    barracksB: underground.barracksB ?? CONFIG.barracksBPos
  };

  return normalized;
}

export function toSnapshot(world: World, includePheromones = true): WorldSnapshot {
  const pheromones: PheromoneSnapshot = includePheromones
    ? {
        width: world.pheromones.width,
        height: world.pheromones.height,
        food: world.pheromones.food.toArray(),
        home: world.pheromones.home.toArray()
      }
    : {
        width: world.pheromones.width,
        height: world.pheromones.height,
        food: [],
        home: []
      };

  return {
    tick: world.tick,
    surface: world.surface,
    underground: world.underground,
    colony: world.colony,
    ants: world.ants,
    enemies: world.enemies,
    pheromones
  };
}
