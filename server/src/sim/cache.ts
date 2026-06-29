import type { Ant } from "../../../shared/types";
import { CONFIG } from "../config";
import { SpatialGrid } from "./spatial";
import type { World } from "./world";

function numericAntId(id: string): number {
  const numericId = Number(id.replace("ant-", ""));
  return Number.isFinite(numericId) ? numericId : 0;
}

export const tickCache = {
  activeForagers: 0,
  activeNurses: 0,
  activeDiggers: 0,
  activeAndTransitioningForagers: 0,
  undergroundDiggers: 0,
  undergroundNurses: 0,
  undergroundExitingAnts: [] as Ant[],
  surfaceAnts: [] as Ant[],
  surfaceAntGrid: new SpatialGrid<Ant>(2.0),
  worldSurfaceAnts: [] as Ant[],
  worldSurfaceAntGrid: new SpatialGrid<Ant>(2.0),
  worldLiveAntsCount: 0,
  queenGuardIds: new Set<string>(),
  liveAntsCount: 0
};

export function updateTickCache(world: World): void {
  let activeForagers = 0;
  let activeNurses = 0;
  let activeDiggers = 0;
  let activeAndTransitioningForagers = 0;
  let undergroundDiggers = 0;
  let undergroundNurses = 0;
  let liveAntsCount = 0;
  const surfaceAnts: Ant[] = [];
  const idleUndergroundAnts: Ant[] = [];
  const undergroundExitingAnts: Ant[] = [];

  const ants = world.ants;
  const len = ants.length;
  for (let i = 0; i < len; i += 1) {
    const ant = ants[i];
    if (ant.state === "dead") {
      continue;
    }

    liveAntsCount += 1;

    if (ant.layer === "surface") {
      surfaceAnts.push(ant);

      if (ant.state === "search" && ant.carrying <= 0 && ant.job !== "nurse" && ant.job !== "dig") {
        activeForagers += 1;
        activeAndTransitioningForagers += 1;
      }
      if (ant.job === "nurse" && ant.state === "return") {
        activeNurses += 1;
      }
      if (ant.job === "dig" && ant.state === "return") {
        activeDiggers += 1;
      }
    } else if (ant.layer === "underground") {
      if (ant.state === "toEntrance") {
        activeAndTransitioningForagers += 1;
        undergroundExitingAnts.push(ant);
      }
      if (ant.state === "carryBrood" || ant.state === "feed") {
        activeNurses += 1;
        undergroundNurses += 1;
      }
      if (ant.state === "dig" || ant.state === "carryDirt" || ant.carryingDirt) {
        activeDiggers += 1;
        undergroundDiggers += 1;
      }
      if (ant.state === "idle" && ant.carrying <= 0) {
        idleUndergroundAnts.push(ant);
      }
    }
  }

  // Вычисляем queenGuardIds
  const guardIds = new Set<string>();
  if (world.underground.brood.length === 0) {
    idleUndergroundAnts.sort((a, b) => numericAntId(a.id) - numericAntId(b.id));
    const guardCount = Math.min(idleUndergroundAnts.length, CONFIG.maxNurses);
    for (let i = 0; i < guardCount; i += 1) {
      guardIds.add(idleUndergroundAnts[i].id);
    }
  }
  undergroundExitingAnts.sort((a, b) => numericAntId(a.id) - numericAntId(b.id));

  tickCache.activeForagers = activeForagers;
  tickCache.activeNurses = activeNurses;
  tickCache.activeDiggers = activeDiggers;
  tickCache.activeAndTransitioningForagers = activeAndTransitioningForagers;
  tickCache.undergroundDiggers = undergroundDiggers;
  tickCache.undergroundNurses = undergroundNurses;
  tickCache.undergroundExitingAnts = undergroundExitingAnts;
  tickCache.surfaceAnts = surfaceAnts;
  tickCache.surfaceAntGrid.rebuild(surfaceAnts);
  tickCache.queenGuardIds = guardIds;
  tickCache.liveAntsCount = liveAntsCount;
}

export function updateWorldSurfaceCache(world: World): void {
  let liveAntsCount = 0;
  const surfaceAnts: Ant[] = [];
  const ants = world.ants;
  const len = ants.length;
  for (let i = 0; i < len; i += 1) {
    const ant = ants[i];
    if (ant.state === "dead") {
      continue;
    }

    liveAntsCount += 1;
    if (ant.layer === "surface") {
      surfaceAnts.push(ant);
    }
  }

  tickCache.worldSurfaceAnts = surfaceAnts;
  tickCache.worldSurfaceAntGrid.rebuild(surfaceAnts);
  tickCache.worldLiveAntsCount = liveAntsCount;
}
