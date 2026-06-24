import type { Ant, Brood, Colony, Enemy, FoodSource, PheromoneSnapshot, Surface, Underground, Vec2, WorldSnapshot } from "../../../shared/types";
import { computeDirectives, createFitnessState, type ColonyDirectives, type FitnessState } from "../ai/controller";
import type { GenomeState } from "../ai/genome";
import type { SpiderGenomeState } from "../ai/spiderGenome";
import { CONFIG } from "../config";
import { createColony, syncColonyStats } from "./colony";
import { createSpider, syncEnemyIdCounter } from "./enemy";
import { PheromoneGrid } from "./pheromone";
import { createUnderground, syncBroodIdCounter } from "./underground";

export type ColonyRuntime = {
  id: string;
  color: "dark" | "red";
  surfaceEntrance: Vec2;
  underground: Underground;
  colony: Colony;
  ants: Ant[];
  genomeState: GenomeState;
  directives: ColonyDirectives;
  fitness: FitnessState;
  homePheromone: PheromoneGrid;
};

export type World = Omit<WorldSnapshot, "pheromones" | "colonies"> & {
  colonies: ColonyRuntime[];
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
    const distanceFromNestA = Math.hypot(pos.x - CONFIG.surfaceEntrance.x, pos.y - CONFIG.surfaceEntrance.y);
    const distanceFromNestB = Math.hypot(pos.x - CONFIG.surfaceEntranceB.x, pos.y - CONFIG.surfaceEntranceB.y);
    if (distanceFromNestA >= minNestDistance && distanceFromNestB >= minNestDistance) {
      return pos;
    }
  }

  return { x: CONFIG.mapWidth - 8, y: 8 };
}

function makeFoodSources(): FoodSource[] {
  const area = CONFIG.mapWidth * CONFIG.mapHeight;
  const sourceCount = Math.max(6, Math.round(area / 3600));
  const minNestDistance = Math.min(CONFIG.mapWidth, CONFIG.mapHeight) * 0.16;
  const sources: FoodSource[] = [];

  while (sources.length < sourceCount) {
    const pos = randomSurfacePosAwayFromNest(minNestDistance);

    sources.push({
      id: `food-${nextFoodSourceId}`,
      pos,
      amount: 40 + Math.random() * 40
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

export function createWorkerAnt(
  pos: { x: number; y: number },
  layer: "surface" | "underground" = "underground",
  colonyId = "colony-1"
): Ant {
  const id = `ant-${nextAntId}`;
  nextAntId += 1;

  return {
    id,
    colonyId,
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

function makeDefaultDirectives(): ColonyDirectives {
  return {
    maxNurses: CONFIG.maxConcurrentNurses,
    forageWander: CONFIG.randomWander,
    spiderAttackStorage: CONFIG.starveStorageThreshold,
    layReserve: CONFIG.queenMinFoodReserve,
    refuelThreshold: CONFIG.refuelEnergyThreshold,
    spiderAvoidRadius: CONFIG.spiderAvoidRadius,
    foragerTarget: CONFIG.minForagers,
    activeTarget: CONFIG.minForagers,
    nurseTarget: 0
  };
}

export function createColonyRuntime(
  id: string,
  color: "dark" | "red",
  surfaceEntrance: Vec2,
  genomeState: GenomeState,
  spiderGenomeState: SpiderGenomeState
): ColonyRuntime {
  const colony = createColony(
    id,
    genomeState.current.generation,
    genomeState.generationsRun,
    genomeState.bestFitness,
    spiderGenomeState.current.generation,
    spiderGenomeState.generationsRun
  );
  const underground = createUnderground();
  const ants = Array.from({ length: CONFIG.startingWorkers }, () => createWorkerAnt(CONFIG.queenPos, "underground", id));
  underground.ants = ants.map((ant) => ant.id);
  const runtime: ColonyRuntime = {
    id,
    color,
    surfaceEntrance,
    underground,
    colony,
    ants,
    genomeState,
    directives: makeDefaultDirectives(),
    fitness: createFitnessState(),
    homePheromone: new PheromoneGrid(CONFIG.mapWidth, CONFIG.mapHeight)
  };
  syncColonyStatsForRuntime(runtime);
  return runtime;
}

export function colonyWorldView(world: World, runtime: ColonyRuntime): World {
  return {
    ...world,
    surface: {
      ...world.surface,
      entrance: runtime.surfaceEntrance,
      entrances: world.surface.entrances
    },
    underground: runtime.underground,
    colony: runtime.colony,
    ants: runtime.ants,
    genomeState: runtime.genomeState,
    directives: runtime.directives,
    fitness: runtime.fitness,
    pheromones: {
      width: world.pheromones.width,
      height: world.pheromones.height,
      food: world.pheromones.food,
      home: runtime.homePheromone
    }
  };
}

export function syncColonyStatsForRuntime(runtime: ColonyRuntime): void {
  syncColonyStats(
    runtime.colony,
    runtime.ants.length,
    runtime.underground.brood.filter((brood) => brood.stage === "egg").length,
    runtime.underground.brood.filter((brood) => brood.stage === "larva").length,
    runtime.underground.foodStorage,
    runtime.underground.queen.alive,
    runtime.underground.queen.stress,
    runtime.underground.queen.age,
    runtime.underground.princesses.length,
    runtime.genomeState.bestFitness,
    runtime.colony.spiderGeneration,
    runtime.genomeState.generationsRun,
    runtime.colony.spiderGenerationsRun
  );
}

export function syncWorldLegacyFields(world: World): void {
  const primary = world.colonies[0];
  if (!primary) {
    return;
  }
  world.underground = primary.underground;
  world.colony = primary.colony;
  world.genomeState = primary.genomeState;
  world.directives = primary.directives;
  world.fitness = primary.fitness;
  world.ants = world.colonies.flatMap((colony) => colony.ants);
  world.surface.entrance = primary.surfaceEntrance;
  world.surface.entrances = world.colonies.map((colony) => colony.surfaceEntrance);
  world.pheromones.home = primary.homePheromone;
}

export function createWorld(
  genomeState: GenomeState,
  spiderGenomeState: SpiderGenomeState,
  genomeStateB: GenomeState = genomeState
): World {
  const surface: Surface = {
    width: CONFIG.mapWidth,
    height: CONFIG.mapHeight,
    entrance: CONFIG.surfaceEntrance,
    entrances: [CONFIG.surfaceEntrance, CONFIG.surfaceEntranceB],
    foodSources: makeFoodSources(),
    carrion: makeCarrionSources()
  };
  const enemies = [createSpider()];
  const colonies = [
    createColonyRuntime("colony-1", "dark", CONFIG.surfaceEntrance, genomeState, spiderGenomeState),
    createColonyRuntime("colony-2", "red", CONFIG.surfaceEntranceB, genomeStateB, spiderGenomeState)
  ];

  const world: World = {
    tick: 0,
    surface,
    underground: colonies[0].underground,
    colony: colonies[0].colony,
    colonies,
    genomeState,
    spiderGenomeState,
    directives: colonies[0].directives,
    fitness: colonies[0].fitness,
    spiderFitness: createSpiderFitnessState(),
    ants: colonies.flatMap((colony) => colony.ants),
    enemies,
    pheromones: {
      width: CONFIG.mapWidth,
      height: CONFIG.mapHeight,
      food: new PheromoneGrid(CONFIG.mapWidth, CONFIG.mapHeight),
      home: colonies[0].homePheromone
    }
  };
  for (const colony of colonies) {
    colony.directives = computeDirectives(colonyWorldView(world, colony), colony.genomeState.current);
  }
  syncWorldLegacyFields(world);
  return world;
}

export function worldFromSnapshot(
  snapshot: WorldSnapshot,
  genomeState: GenomeState,
  spiderGenomeState: SpiderGenomeState,
  genomeStateB: GenomeState = genomeState
): World {
  if (!snapshot.colonies?.length) {
    return createWorld(genomeState, spiderGenomeState, genomeStateB);
  }

  const snapshotAnts = snapshot.colonies.flatMap((colony) => colony.ants);
  const maxAntId = snapshotAnts.reduce((max, ant) => {
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
  const genomeStates = [genomeState, genomeStateB];
  const colonies = snapshot.colonies.map((colonySnapshot, index): ColonyRuntime => {
    const underground = normalizeUndergroundSnapshot(colonySnapshot.underground);
    syncBroodIdCounter(underground.brood);
    const runtime: ColonyRuntime = {
      id: colonySnapshot.id,
      color: colonySnapshot.color,
      surfaceEntrance: snapshot.surface.entrances?.[index] ?? (index === 0 ? CONFIG.surfaceEntrance : CONFIG.surfaceEntranceB),
      underground,
      colony: {
        ...colonySnapshot.colony,
        generation: genomeStates[index]?.current.generation ?? genomeState.current.generation,
        generationsRun: genomeStates[index]?.generationsRun ?? genomeState.generationsRun,
        bestFitness: genomeStates[index]?.bestFitness ?? genomeState.bestFitness,
        spiderGeneration: spiderGenomeState.current.generation,
        spiderGenerationsRun: spiderGenomeState.generationsRun
      },
      ants: colonySnapshot.ants.map((ant) => ({ ...ant, colonyId: colonySnapshot.id })),
      genomeState: genomeStates[index] ?? genomeState,
      directives: makeDefaultDirectives(),
      fitness: createFitnessState(),
      homePheromone: new PheromoneGrid(snapshot.pheromones.width, snapshot.pheromones.height, index === 0 ? snapshot.pheromones.home : undefined)
    };
    syncColonyStatsForRuntime(runtime);
    return runtime;
  });
  const enemies = normalizeEnemies(snapshot);
  syncEnemyIdCounter(enemies, snapshot.tick);

  const world: World = {
    ...snapshot,
    surface: {
      ...snapshot.surface,
      carrion,
      entrances: snapshot.surface.entrances ?? colonies.map((colony) => colony.surfaceEntrance)
    },
    colony: colonies[0].colony,
    underground: colonies[0].underground,
    colonies,
    enemies,
    genomeState,
    spiderGenomeState,
    directives: colonies[0].directives,
    fitness: colonies[0].fitness,
    spiderFitness: createSpiderFitnessState(),
    ants: snapshotAnts,
    pheromones: {
      width: snapshot.pheromones.width,
      height: snapshot.pheromones.height,
      food: new PheromoneGrid(snapshot.pheromones.width, snapshot.pheromones.height, snapshot.pheromones.food),
      home: colonies[0].homePheromone
    }
  };
  for (const colony of world.colonies) {
    colony.directives = computeDirectives(colonyWorldView(world, colony), colony.genomeState.current);
  }
  syncWorldLegacyFields(world);
  return world;
}

export function restartColony(world: World): void {
  const freshWorld = createWorld(
    world.colonies[0]?.genomeState ?? world.genomeState,
    world.spiderGenomeState,
    world.colonies[1]?.genomeState ?? world.genomeState
  );
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
    hoard: enemy.hoard ?? 0,
    sprintLeft: enemy.sprintLeft ?? CONFIG.spiderSprintTicks,
    tiredLeft: enemy.tiredLeft ?? 0
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
      layCooldown: underground.queen.layCooldown ?? CONFIG.broodLayCooldownTicks,
      stress: underground.queen.stress ?? 0,
      hp: underground.queen.hp ?? CONFIG.queenMaxHp,
      age: underground.queen.age ?? 0
    },
    brood:
      underground.brood?.map((brood) => ({
        ...brood,
        location: brood.location === "queen" ? "queen" : "nursery",
        isPrincess: brood.isPrincess ?? false
      })) ??
      (underground.eggs ?? []).map(
        (egg): Brood => ({
          id: egg.id.replace("egg-", "brood-"),
          stage: "egg",
          location: "nursery",
          pos: egg.pos,
          progress: egg.maturity,
          isPrincess: false
        })
      ),
    entrance: underground.entrance ?? CONFIG.undergroundEntrance,
    junction: underground.junction ?? CONFIG.undergroundJunction,
    queenChamber,
    nursery,
    storage: underground.storage ?? CONFIG.storagePos,
    barracksA: underground.barracksA ?? CONFIG.barracksAPos,
    barracksB: underground.barracksB ?? CONFIG.barracksBPos,
    princesses: underground.princesses ?? []
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
    colonies: world.colonies.map((colony) => ({
      id: colony.id,
      color: colony.color,
      underground: colony.underground,
      colony: colony.colony,
      ants: colony.ants
    })),
    ants: world.ants,
    enemies: world.enemies,
    pheromones
  };
}
