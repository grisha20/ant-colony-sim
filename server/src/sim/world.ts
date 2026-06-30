import {
  CURRENT_PROTOCOL_VERSION,
  CURRENT_SNAPSHOT_VERSION,
  type Ant,
  type Brood,
  type Colony,
  type Debris,
  type Enemy,
  type FoodSource,
  type DurableWorldSnapshot,
  type NetworkWorldSnapshot,
  type NetworkViewState,
  type PheromoneSnapshot,
  type Surface,
  type Underground,
  type Vec2,
  type WorldSnapshot
} from "../../../shared/types";
import { computeDirectives, createFitnessState, type ColonyDirectives, type FitnessState } from "../ai/controller";
import type { GenomeState } from "../ai/genome";
import type { SpiderGenomeState } from "../ai/spiderGenome";
import { CONFIG } from "../config";
import { createColony, syncColonyStats } from "./colony";
import { createSpider, syncEnemyIdCounter } from "./enemy";
import { PheromoneGrid } from "./pheromone";
import { createUnderground, ensureDiggableUnderground, syncBroodIdCounter } from "./underground";

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

export type World = Omit<WorldSnapshot, "snapshotVersion" | "protocolVersion" | "pheromones" | "colonies"> & {
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
const MAX_SURFACE_DEBRIS = 80;
const MAX_SNAPSHOT_STORAGE_ROOMS = 15;
const MAX_SURFACE_FOOD_SOURCES = 40;
const FOOD_MERGE_RADIUS = 4;
const LEGACY_ANT_CORPSE_AMOUNT = 16;

function distanceSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function isWithinRadius(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): boolean {
  return distanceSq(a, b) <= radius * radius;
}

function randomSurfacePosAwayFromNest(minNestDistance: number): { x: number; y: number } {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pos = {
      x: 3 + Math.random() * (CONFIG.mapWidth - 6),
      y: 3 + Math.random() * (CONFIG.mapHeight - 6)
    };
    if (!isWithinRadius(pos, CONFIG.surfaceEntrance, minNestDistance) && !isWithinRadius(pos, CONFIG.surfaceEntranceB, minNestDistance)) {
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
      amount: 40 + Math.random() * 40,
      kind: "food"
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
    amount: CONFIG.carrionAmount * (0.75 + Math.random() * 0.5),
    kind: "carrion"
  };
  nextCarrionId += 1;
  return source;
}

function makeCarrionSources(): FoodSource[] {
  return Array.from({ length: CONFIG.carrionCount }, () => makeCarrionSource());
}

function makeDebrisSources(entrances: Vec2[]): Debris[] {
  const debris: Debris[] = [];
  const debrisCount = 8;
  let nextDebrisId = 1;

  for (let i = 0; i < debrisCount; i++) {
    let pos = { x: 0, y: 0 };
    let valid = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      pos = {
        x: 3 + Math.random() * (CONFIG.mapWidth - 6),
        y: 3 + Math.random() * (CONFIG.mapHeight - 6)
      };

      let minDistanceSq = Infinity;
      for (const ent of entrances) {
        const distSq = distanceSq(pos, ent);
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
        }
      }

      if (minDistanceSq >= 25 * 25) {
        valid = true;
        break;
      }
    }

    debris.push({
      id: `debris-${nextDebrisId}`,
      type: Math.random() < 0.5 ? "pebble" : "leaf",
      pos
    });
    nextDebrisId += 1;
  }

  return debris;
}

function normalizeSurfaceDebris(surface: Surface, entrances: Vec2[]): Debris[] {
  const debris = surface.debris ?? makeDebrisSources(entrances);
  if (debris.length <= MAX_SURFACE_DEBRIS) {
    return debris;
  }

  const kept = new Map<string, Debris>();
  for (const item of debris) {
    let nearestEntranceDistanceSq = Number.POSITIVE_INFINITY;
    for (const entrance of entrances) {
      nearestEntranceDistanceSq = Math.min(nearestEntranceDistanceSq, distanceSq(item.pos, entrance));
    }

    const bucket = `${Math.floor(item.pos.x / 8)}:${Math.floor(item.pos.y / 8)}:${item.type}`;
    if (nearestEntranceDistanceSq >= 3 * 3 && nearestEntranceDistanceSq <= 24 * 24 && !kept.has(bucket)) {
      kept.set(bucket, item);
    }

    if (kept.size >= MAX_SURFACE_DEBRIS) {
      break;
    }
  }

  if (kept.size < MAX_SURFACE_DEBRIS) {
    for (const item of debris) {
      kept.set(item.id, item);
      if (kept.size >= MAX_SURFACE_DEBRIS) {
        break;
      }
    }
  }

  console.warn(`Trimmed surface debris from ${debris.length} to ${kept.size} while loading snapshot`);
  return Array.from(kept.values());
}

function mergeFoodSources(sources: FoodSource[]): FoodSource[] {
  const merged: FoodSource[] = [];
  for (const source of sources) {
    if (source.amount <= 0) {
      continue;
    }

    let target: FoodSource | null = null;
    for (const existing of merged) {
      if (
        (existing.kind ?? "food") === (source.kind ?? "food") &&
        isWithinRadius(existing.pos, source.pos, FOOD_MERGE_RADIUS)
      ) {
        target = existing;
        break;
      }
    }

    if (target) {
      const total = target.amount + source.amount;
      target.pos = {
        x: (target.pos.x * target.amount + source.pos.x * source.amount) / total,
        y: (target.pos.y * target.amount + source.pos.y * source.amount) / total
      };
      target.amount = total;
    } else {
      merged.push({ ...source, pos: { ...source.pos } });
    }
  }

  return merged
    .sort((a, b) => b.amount - a.amount)
    .slice(0, MAX_SURFACE_FOOD_SOURCES);
}

function normalizeFoodKind(source: FoodSource, fallback: NonNullable<FoodSource["kind"]>): FoodSource {
  return {
    ...source,
    kind: source.kind ?? fallback
  };
}

function normalizeCarrionKind(source: FoodSource): FoodSource {
  if (source.kind) {
    return source;
  }

  if (source.amount <= LEGACY_ANT_CORPSE_AMOUNT) {
    return {
      ...source,
      amount: Math.min(source.amount, CONFIG.antCorpseFood),
      kind: "antCorpse"
    };
  }

  return {
    ...source,
    kind: "carrion"
  };
}

function compactStorageRooms(underground: Underground): void {
  const storageRooms = underground.rooms.filter((room) => room.type === "storage");
  if (storageRooms.length <= MAX_SNAPSHOT_STORAGE_ROOMS) {
    return;
  }

  const totalCapacity = Math.max(
    Math.ceil(underground.foodStorage),
    storageRooms.reduce((total, room) => total + room.capacity, 0)
  );
  const keptStorage = storageRooms.slice(0, MAX_SNAPSHOT_STORAGE_ROOMS).map((room, index) => ({
    ...room,
    capacity:
      Math.floor(totalCapacity / MAX_SNAPSHOT_STORAGE_ROOMS) +
      (index < totalCapacity % MAX_SNAPSHOT_STORAGE_ROOMS ? 1 : 0),
    used: 0
  }));

  underground.rooms = [
    ...underground.rooms.filter((room) => room.type !== "storage"),
    ...keptStorage
  ];
  underground.digTasks = underground.digTasks.filter(
    (task) => task.roomType !== "storage" || task.status !== "done"
  );
  underground.roomsVersion = (underground.roomsVersion ?? 1) + 1;
  underground.digTasksVersion = (underground.digTasksVersion ?? 1) + 1;
  console.warn(`Compacted storage rooms from ${storageRooms.length} to ${keptStorage.length} while loading snapshot`);
}

export function respawnDebris(world: World): void {
  if (!world.surface.debris) {
    world.surface.debris = [];
  }

  if (world.surface.debris.length >= 15) {
    return;
  }

  if (world.tick % 600 === 0 && Math.random() < 0.15) {
    const entrances = world.colonies.map((c) => c.surfaceEntrance);
    let pos = { x: 0, y: 0 };
    let valid = false;

    for (let attempt = 0; attempt < 80; attempt++) {
      pos = {
        x: 3 + Math.random() * (CONFIG.mapWidth - 6),
        y: 3 + Math.random() * (CONFIG.mapHeight - 6)
      };

      let minDistanceSq = Infinity;
      for (const ent of entrances) {
        const distSq = distanceSq(pos, ent);
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
        }
      }

      if (minDistanceSq >= 25 * 25) {
        valid = true;
        break;
      }
    }

    const nextDebrisId = Math.random().toString(36).substr(2, 9);
    world.surface.debris.push({
      id: `debris-${nextDebrisId}`,
      type: Math.random() < 0.5 ? "pebble" : "leaf",
      pos
    });
  }
}

export function respawnCarrion(world: World): void {
  world.surface.carrion = world.surface.carrion.filter((source) => source.amount > 0);
  if (CONFIG.carrionDecayEveryTicks > 0 && world.tick > 0 && world.tick % CONFIG.carrionDecayEveryTicks === 0) {
    for (const source of world.surface.carrion) {
      if (source.kind === "antCorpse" || source.kind === "carrion") {
        source.amount = Math.max(0, source.amount * (1 - CONFIG.carrionDecayFraction));
      }
    }
    for (const colony of world.colonies) {
      for (const source of colony.underground.carrion) {
        if (source.kind === "antCorpse" || source.kind === "carrion") {
          source.amount = Math.max(0, source.amount * (1 - CONFIG.carrionDecayFraction));
        }
      }
    }
  }
  if (CONFIG.carrionRespawnEveryTicks <= 0 || world.tick % CONFIG.carrionRespawnEveryTicks !== 0) {
    return;
  }

  if (world.surface.carrion.length < CONFIG.carrionCount) {
    world.surface.carrion.push(makeCarrionSource());
  }
}

export function addAntCorpse(world: World, ant: Ant): FoodSource {
  const source: FoodSource = {
    id: `carrion-${nextCarrionId}`,
    pos: { ...ant.pos },
    amount: CONFIG.antCorpseFood * Math.max(0.35, ant.strength ?? 1),
    kind: "antCorpse",
    createdAt: world.tick
  };
  nextCarrionId += 1;
  if (ant.layer === "underground") {
    world.underground.carrion.push(source);
  } else {
    world.surface.carrion.push(source);
  }
  return source;
}

export function growFoodSources(world: World): void {
  world.surface.foodSources = mergeFoodSources(world.surface.foodSources);
  if (CONFIG.foodGrowEveryTicks <= 0 || world.tick % CONFIG.foodGrowEveryTicks !== 0) {
    return;
  }

  for (const source of world.surface.foodSources) {
    source.amount = Math.min(CONFIG.playerFoodAmount, source.amount + CONFIG.foodGrowAmount * 0.35);
  }

  if (world.surface.foodSources.length < CONFIG.maxFoodSources) {
    const minNestDistance = Math.min(CONFIG.mapWidth, CONFIG.mapHeight) * 0.16;
    const pos = randomSurfacePosAwayFromNest(minNestDistance);
    addFoodSource(world, pos.x, pos.y, CONFIG.foodGrowAmount * (0.75 + Math.random() * 0.5));
  }
}

export function addFoodSource(
  world: World,
  x: number,
  y: number,
  amount: number,
  kind: FoodSource["kind"] = "food"
): FoodSource {
  const pos = {
    x: Math.max(1.5, Math.min(world.surface.width - 1.5, x)),
    y: Math.max(1.5, Math.min(world.surface.height - 1.5, y))
  };
  for (const existing of world.surface.foodSources) {
    if (
      existing.amount > 0 &&
      (existing.kind ?? "food") === kind &&
      isWithinRadius(existing.pos, pos, FOOD_MERGE_RADIUS)
    ) {
      const total = existing.amount + amount;
      existing.pos = {
        x: (existing.pos.x * existing.amount + pos.x * amount) / total,
        y: (existing.pos.y * existing.amount + pos.y * amount) / total
      };
      existing.amount = total;
      return existing;
    }
  }

  const source: FoodSource = {
    id: `food-${nextFoodSourceId}`,
    pos,
    amount,
    kind,
    createdAt: world.tick
  };
  nextFoodSourceId += 1;
  world.surface.foodSources.push(source);
  return source;
}

export function createWorkerAnt(
  pos: { x: number; y: number },
  layer: "surface" | "underground" = "underground",
  colonyId = "colony-1",
  strength = 1
): Ant {
  const id = `ant-${nextAntId}`;
  nextAntId += 1;

  return {
    id,
    colonyId,
    role: "worker",
    strength,
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
    nurseTarget: 0,
    diggerTarget: Math.min(CONFIG.maxDiggers, CONFIG.startingMiners),
    queenRearThreshold: CONFIG.queenRearStressThreshold,
    aggression: 0.3
  };
}

export function createColonyRuntime(
  id: string,
  color: "dark" | "red",
  surfaceEntrance: Vec2,
  genomeState: GenomeState,
  spiderGenomeState: SpiderGenomeState,
  foundedTick = 0
): ColonyRuntime {
  const colony = createColony(
    id,
    foundedTick,
    genomeState.current.generation,
    genomeState.generationsRun,
    genomeState.bestFitness,
    spiderGenomeState.current.generation,
    spiderGenomeState.generationsRun
  );
  const underground = createUnderground(id);
  const ants = Array.from({ length: CONFIG.startingWorkers + CONFIG.startingMiners }, () => createWorkerAnt(underground.queenChamber, "underground", id));
  for (let index = 0; index < ants.length; index += 1) {
    if (index < CONFIG.startingScouts) {
      ants[index].job = "forage";
      ants[index].forageRole = "scout";
    } else if (index < CONFIG.startingScouts + CONFIG.startingNurses) {
      ants[index].job = "nurse";
    } else if (index >= CONFIG.startingWorkers) {
      ants[index].preferredTask = "dig";
    }
  }
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
    runtime.ants.filter((ant) => ant.forageRole === "scout" && ant.state !== "dead").length,
    runtime.ants.filter((ant) => ant.job === "nurse" && ant.state !== "dead").length,
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
  const entrances = [CONFIG.surfaceEntrance, CONFIG.surfaceEntranceB];
  const surface: Surface = {
    width: CONFIG.mapWidth,
    height: CONFIG.mapHeight,
    entrance: CONFIG.surfaceEntrance,
    entrances,
    foodSources: makeFoodSources(),
    carrion: makeCarrionSources(),
    debris: makeDebrisSources(entrances)
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
  const snapshotVersion = snapshot.snapshotVersion ?? 1;
  if (snapshotVersion > CURRENT_SNAPSHOT_VERSION) {
    console.warn(
      `Snapshot version ${snapshotVersion} is newer than supported ${CURRENT_SNAPSHOT_VERSION}; trying best-effort load.`
    );
  }

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
  const foodSources = mergeFoodSources(snapshot.surface.foodSources.map((source) => normalizeFoodKind(source, "food")));
  const carrion = (snapshot.surface.carrion ?? makeCarrionSources()).map((source) => normalizeCarrionKind(source));
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
        population: {
          ...colonySnapshot.colony.population,
          scouts: colonySnapshot.colony.population.scouts ?? 0,
          nurses: colonySnapshot.colony.population.nurses ?? 0
        },
        foundedTick: colonySnapshot.colony.foundedTick ?? 0,
        knownFood: colonySnapshot.colony.knownFood ?? [],
        activeFoodTargetId: colonySnapshot.colony.activeFoodTargetId,
        generation: genomeStates[index]?.current.generation ?? genomeState.current.generation,
        generationsRun: genomeStates[index]?.generationsRun ?? genomeState.generationsRun,
        bestFitness: genomeStates[index]?.bestFitness ?? genomeState.bestFitness,
        spiderGeneration: spiderGenomeState.current.generation,
        spiderGenerationsRun: spiderGenomeState.generationsRun
      },
      ants: colonySnapshot.ants.map((ant) => ({
        ...ant,
        colonyId: colonySnapshot.id,
        strength: ant.strength ?? 1,
        dirtLoad: ant.dirtLoad ?? 0
      })),
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
  const entrances = snapshot.surface.entrances ?? colonies.map((colony) => colony.surfaceEntrance);
  const debris = normalizeSurfaceDebris(snapshot.surface, entrances);

  const world: World = {
    ...snapshot,
    surface: {
      ...snapshot.surface,
      foodSources,
      carrion,
      entrances,
      debris
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
  const normalized: Underground = ensureDiggableUnderground({
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
        location: brood.location === "queen" ? "queen" : brood.location === "egg" ? "egg" : "nursery",
        isPrincess: brood.isPrincess ?? false
      })) ??
      (underground.eggs ?? []).map(
        (egg): Brood => ({
          id: egg.id.replace("egg-", "brood-"),
          stage: "egg",
          location: "egg",
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
    princesses: underground.princesses ?? [],
    carrion: (underground.carrion ?? []).map((source) => normalizeCarrionKind(source))
  });

  compactStorageRooms(normalized);
  return normalized;
}

export function toSnapshot(world: World, includePheromones = true): WorldSnapshot {
  const pheromones: PheromoneSnapshot = includePheromones
    ? {
        width: world.pheromones.width,
        height: world.pheromones.height,
        food: world.pheromones.food.toSparse(),
        home: world.pheromones.home.toSparse()
      }
    : {
        width: world.pheromones.width,
        height: world.pheromones.height,
        food: { i: [], v: [] },
        home: { i: [], v: [] }
      };

  return {
    snapshotVersion: CURRENT_SNAPSHOT_VERSION,
    protocolVersion: CURRENT_PROTOCOL_VERSION,
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

export function toDurableSnapshot(world: World): DurableWorldSnapshot {
  return toSnapshot(world, false);
}

function lightweightUnderground(underground: Underground): Underground {
  return {
    ...underground,
    grid: [],
    rooms: [],
    digTasks: [],
    brood: [],
    carrion: [],
    princesses: [],
    ants: []
  };
}

function normalizeNetworkView(view?: Partial<NetworkViewState>): NetworkViewState {
  return {
    mode: view?.mode === "underground" ? "underground" : "surface",
    undergroundColonyIndex: Math.max(0, Math.min(1, Math.floor(view?.undergroundColonyIndex ?? 0)))
  };
}

export function toNetworkSnapshot(world: World, includePheromones = true, view?: Partial<NetworkViewState>): NetworkWorldSnapshot {
  const networkView = normalizeNetworkView(view);
  const isUndergroundView = networkView.mode === "underground";
  const selectedColony = world.colonies[networkView.undergroundColonyIndex] ?? world.colonies[0];
  const ants = isUndergroundView
    ? selectedColony.ants.filter((ant) => ant.layer === "underground")
    : world.ants.filter((ant) => ant.layer === "surface");
  const snapshot = toSnapshot(world, includePheromones && !isUndergroundView);

  return {
    ...snapshot,
    networkView,
    underground: isUndergroundView ? selectedColony.underground : lightweightUnderground(world.underground),
    colony: isUndergroundView ? selectedColony.colony : world.colony,
    colonies: world.colonies.map((colony, index) => {
      const includeFullUnderground = isUndergroundView && index === networkView.undergroundColonyIndex;
      return {
        id: colony.id,
        color: colony.color,
        underground: includeFullUnderground ? colony.underground : lightweightUnderground(colony.underground),
        colony: colony.colony,
        ants: []
      };
    }),
    ants
  };
}
