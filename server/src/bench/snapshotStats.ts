import { readFile } from "node:fs/promises";
import { CONFIG } from "../config";
import type { WorldSnapshot } from "../../../shared/types";

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function emptyPheromones(snapshot: WorldSnapshot): WorldSnapshot {
  return {
    ...snapshot,
    pheromones: {
      width: snapshot.pheromones.width,
      height: snapshot.pheromones.height,
      food: { i: [], v: [] },
      home: { i: [], v: [] }
    }
  };
}

function sparseLength(value: unknown): number {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const maybeSparse = value as { i?: unknown };
  return Array.isArray(maybeSparse.i) ? maybeSparse.i.length : 0;
}

const raw = await readFile(CONFIG.snapshotFile, "utf8");
const snapshot = JSON.parse(raw) as WorldSnapshot;
const fullBytes = Buffer.byteLength(raw);
const noPheromoneBytes = jsonBytes(emptyPheromones(snapshot));
const antsByLayer = snapshot.ants.reduce<Record<string, number>>((counts, ant) => {
  counts[ant.layer] = (counts[ant.layer] ?? 0) + 1;
  return counts;
}, {});

const stats = {
  file: CONFIG.snapshotFile,
  snapshotVersion: snapshot.snapshotVersion ?? 1,
  protocolVersion: snapshot.protocolVersion ?? 1,
  tick: snapshot.tick,
  bytes: {
    full: fullBytes,
    withoutPheromones: noPheromoneBytes,
    pheromonesApprox: fullBytes - noPheromoneBytes
  },
  surface: {
    width: snapshot.surface.width,
    height: snapshot.surface.height,
    foodSources: snapshot.surface.foodSources.length,
    carrion: snapshot.surface.carrion.length,
    debris: snapshot.surface.debris?.length ?? 0
  },
  pheromones: {
    foodSparseCells: sparseLength(snapshot.pheromones.food),
    homeSparseCells: sparseLength(snapshot.pheromones.home)
  },
  ants: {
    total: snapshot.ants.length,
    byLayer: antsByLayer
  },
  colonies: snapshot.colonies.map((colony) => ({
    id: colony.id,
    ants: colony.ants.length,
    brood: colony.underground.brood.length,
    rooms: colony.underground.rooms.length,
    digTasks: colony.underground.digTasks.length,
    gridVersion: colony.underground.gridVersion ?? 1,
    roomsVersion: colony.underground.roomsVersion ?? 1,
    digTasksVersion: colony.underground.digTasksVersion ?? 1,
    foodStorage: Math.round(colony.underground.foodStorage),
    dirtMound: colony.underground.dirtMound
  })),
  enemies: snapshot.enemies.length
};

console.log(JSON.stringify(stats, null, 2));
