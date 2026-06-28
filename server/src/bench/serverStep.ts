import { loadGenome } from "../ai/genome";
import { loadSpiderGenome } from "../ai/spiderGenome";
import { CONFIG } from "../config";
import { loadWorldSnapshot } from "../state/snapshot";
import { step } from "../sim/step";
import { createWorld, syncWorldLegacyFields, toSnapshot, worldFromSnapshot, type World } from "../sim/world";

const TARGETS = [160, 320, 640, 1000] as const;
const STEPS = 20;

function time<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  console.log(`${label}: ${ms.toFixed(2)}ms`);
  return result;
}

function measureMs(label: string, fn: () => void): number {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  console.log(`${label}: ${ms.toFixed(2)}ms`);
  return ms;
}

function cloneWorld(baseSnapshot: ReturnType<typeof toSnapshot>, world: World): World {
  return worldFromSnapshot(JSON.parse(JSON.stringify(baseSnapshot)) as ReturnType<typeof toSnapshot>, world.genomeState, world.spiderGenomeState, world.colonies[1]?.genomeState ?? world.genomeState);
}

function spreadSurfaceAnts(world: World, totalAnts: number): void {
  const perColony = Math.max(1, Math.floor(totalAnts / world.colonies.length));
  let nextId = 1;

  for (const colony of world.colonies) {
    const template = colony.ants[0];
    if (!template) {
      continue;
    }

    colony.ants = [];
    for (let index = 0; index < perColony; index += 1) {
      const angle = index * 2.399963229728653;
      colony.ants.push({
        ...template,
        id: `bench-ant-${nextId}`,
        colonyId: colony.id,
        layer: "surface",
        state: "search",
        job: "forage",
        carrying: 0,
        carryingDirt: false,
        carryingDebris: null,
        pos: {
          x: 2 + Math.random() * (world.surface.width - 4),
          y: 2 + Math.random() * (world.surface.height - 4)
        },
        heading: { x: Math.cos(angle), y: Math.sin(angle) },
        energy: 700
      });
      nextId += 1;
    }
  }

  syncWorldLegacyFields(world);
}

const genome = await loadGenome();
const genomeB = await loadGenome(CONFIG.genomeFileB);
const spiderGenome = await loadSpiderGenome();
const loadedWorld = (await loadWorldSnapshot(genome, spiderGenome, genomeB)) ?? createWorld(genome, spiderGenome, genomeB);
const baseSnapshot = toSnapshot(loadedWorld, true);

console.log(`Benchmark steps per target: ${STEPS}`);

for (const target of TARGETS) {
  const world = cloneWorld(baseSnapshot, loadedWorld);
  spreadSurfaceAnts(world, target);

  const totalMs = measureMs(`${target} ants / ${STEPS} steps`, () => {
    for (let index = 0; index < STEPS; index += 1) {
      step(world);
    }
  });

  const snapshotNoPheromones = time(`${target} ants / toSnapshot(false)`, () => toSnapshot(world, false));
  const snapshotWithPheromones = time(`${target} ants / toSnapshot(true)`, () => toSnapshot(world, true));
  const noPheromoneBytes = time(`${target} ants / JSON(false)`, () => Buffer.byteLength(JSON.stringify(snapshotNoPheromones)));
  const pheromoneBytes = time(`${target} ants / JSON(true)`, () => Buffer.byteLength(JSON.stringify(snapshotWithPheromones)));

  console.log(
    JSON.stringify(
      {
        target,
        actualAnts: world.ants.length,
        avgStepMs: Number((totalMs / STEPS).toFixed(2)),
        noPheromoneBytes,
        pheromoneBytes,
        foodSparseCells: Array.isArray((snapshotWithPheromones.pheromones.food as { i?: unknown }).i)
          ? (snapshotWithPheromones.pheromones.food as { i: unknown[] }).i.length
          : 0,
        homeSparseCells: Array.isArray((snapshotWithPheromones.pheromones.home as { i?: unknown }).i)
          ? (snapshotWithPheromones.pheromones.home as { i: unknown[] }).i.length
          : 0
      },
      null,
      2
    )
  );
}
