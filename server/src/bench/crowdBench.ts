import { loadGenome } from "../ai/genome";
import { loadSpiderGenome } from "../ai/spiderGenome";
import { CONFIG } from "../config";
import { loadWorldSnapshot } from "../state/snapshot";
import { step } from "../sim/step";
import { createWorld, syncWorldLegacyFields, toSnapshot, worldFromSnapshot, type World } from "../sim/world";

const TARGET_ANTS = 600;
const WARMUP_STEPS = 30;
const MEASURE_STEPS = 120;
const RUNS = 5;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function cloneWorld(baseSnapshot: ReturnType<typeof toSnapshot>, world: World): World {
  return worldFromSnapshot(
    JSON.parse(JSON.stringify(baseSnapshot)) as ReturnType<typeof toSnapshot>,
    world.genomeState,
    world.spiderGenomeState,
    world.colonies[1]?.genomeState ?? world.genomeState
  );
}

function setupCrowd(world: World): void {
  const center = { x: world.surface.width / 2, y: world.surface.height / 2 };
  const perColony = Math.floor(TARGET_ANTS / world.colonies.length);
  let nextId = 1;

  world.surface.foodSources = [
    {
      id: "crowd-food-1",
      pos: { x: center.x, y: center.y },
      amount: 10000,
      kind: "food",
      createdAt: world.tick
    }
  ];
  world.surface.carrion = [];
  world.surface.debris = [];
  world.enemies = [
    {
      id: "crowd-spider-1",
      type: "spider",
      pos: { x: center.x + 3, y: center.y + 3 },
      hp: CONFIG.spiderMaxHp,
      maxHp: CONFIG.spiderMaxHp,
      hunger: CONFIG.spiderHungryThreshold,
      lair: { x: center.x + 8, y: center.y + 8 },
      carrying: 0,
      hoard: 0,
      sprintLeft: CONFIG.spiderSprintTicks,
      tiredLeft: 0
    }
  ];

  for (const colony of world.colonies) {
    const template = colony.ants[0];
    if (!template) {
      continue;
    }

    colony.ants = [];
    colony.underground.ants = [];
    for (let index = 0; index < perColony; index += 1) {
      const angle = index * 2.399963229728653;
      const ring = Math.floor(index / 32);
      const radius = 1.5 + (ring % 9) * 0.75;
      const jitter = ((index % 7) - 3) * 0.06;
      colony.ants.push({
        ...template,
        id: `crowd-ant-${nextId}`,
        colonyId: colony.id,
        layer: "surface",
        state: index % 5 === 0 ? "fight" : "search",
        job: "forage",
        carrying: 0,
        carryingDirt: false,
        carryingDebris: null,
        pos: {
          x: center.x + Math.cos(angle) * radius + jitter,
          y: center.y + Math.sin(angle) * radius - jitter
        },
        heading: { x: Math.cos(angle), y: Math.sin(angle) },
        energy: 700,
        surfaceExitCooldown: 0,
        undergroundExitCooldown: 0
      });
      nextId += 1;
    }
  }

  syncWorldLegacyFields(world);
}

function measureRun(baseSnapshot: ReturnType<typeof toSnapshot>, loadedWorld: World, seed: number): number {
  Math.random = makeRandom(seed);
  const world = cloneWorld(baseSnapshot, loadedWorld);
  setupCrowd(world);

  for (let i = 0; i < WARMUP_STEPS; i += 1) {
    step(world);
  }

  const start = performance.now();
  for (let i = 0; i < MEASURE_STEPS; i += 1) {
    step(world);
  }
  const totalMs = performance.now() - start;
  return totalMs / MEASURE_STEPS;
}

const originalRandom = Math.random;
try {
  const genome = await loadGenome();
  const genomeB = await loadGenome(CONFIG.genomeFileB);
  const spiderGenome = await loadSpiderGenome();
  const loadedWorld = (await loadWorldSnapshot(genome, spiderGenome, genomeB)) ?? createWorld(genome, spiderGenome, genomeB);
  const baseSnapshot = toSnapshot(loadedWorld, false);
  const results: number[] = [];

  console.log(`Crowd benchmark: ${TARGET_ANTS} ants, warmup=${WARMUP_STEPS}, steps=${MEASURE_STEPS}, runs=${RUNS}`);
  for (let run = 0; run < RUNS; run += 1) {
    const avgStepMs = measureRun(baseSnapshot, loadedWorld, 12345);
    results.push(avgStepMs);
    console.log(`run ${run + 1}: ${avgStepMs.toFixed(2)} ms/step`);
  }

  const min = Math.min(...results);
  const max = Math.max(...results);
  const avg = results.reduce((sum, value) => sum + value, 0) / results.length;
  console.log(JSON.stringify({
    targetAnts: TARGET_ANTS,
    warmupSteps: WARMUP_STEPS,
    measureSteps: MEASURE_STEPS,
    runs: RUNS,
    avgStepMs: Number(avg.toFixed(2)),
    minStepMs: Number(min.toFixed(2)),
    maxStepMs: Number(max.toFixed(2)),
    spreadMs: Number((max - min).toFixed(2))
  }, null, 2));
} finally {
  Math.random = originalRandom;
}
