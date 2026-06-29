import type { Ant, FoodSource, Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";
import type { World } from "./world";

type FoodTarget = {
  source: FoodSource;
  list: FoodSource[];
  index: number;
};

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function findSurfaceFoodById(world: World, id?: string): FoodTarget | null {
  if (!id) {
    return null;
  }

  for (const list of [world.surface.foodSources, world.surface.carrion]) {
    const index = list.findIndex((source) => source.id === id);
    if (index >= 0) {
      return { source: list[index], list, index };
    }
  }

  return null;
}

export function activeFoodTarget(world: World): FoodTarget | null {
  const target = findSurfaceFoodById(world, world.colony.activeFoodTargetId);
  if (!target || target.source.amount <= 0) {
    return null;
  }
  return target;
}

export function registerScoutFoodReport(world: World, ant: Ant): void {
  if (ant.forageRole !== "scout" || !ant.foundFoodSourceId) {
    ant.foundFoodSourceId = undefined;
    return;
  }

  const target = findSurfaceFoodById(world, ant.foundFoodSourceId);
  ant.foundFoodSourceId = undefined;
  if (!target || target.source.amount <= 0) {
    return;
  }

  const known = world.colony.knownFood.find((source) => source.id === target.source.id);
  if (known) {
    known.pos = { ...target.source.pos };
    known.lastSeenTick = world.tick;
    return;
  }

  world.colony.knownFood.push({
    id: target.source.id,
    pos: { ...target.source.pos },
    lastSeenTick: world.tick
  });
}

export function updateColonyFoodMemory(world: World): void {
  world.colony.knownFood = world.colony.knownFood
    .map((known) => {
      const target = findSurfaceFoodById(world, known.id);
      if (!target || target.source.amount <= 0) {
        return null;
      }
      return {
        id: target.source.id,
        pos: { ...target.source.pos },
        lastSeenTick: Math.max(known.lastSeenTick, target.source.createdAt ?? known.lastSeenTick)
      };
    })
    .filter((known): known is { id: string; pos: Vec2; lastSeenTick: number } => known !== null);

  let nearest: { id: string; distanceSq: number } | null = null;
  for (const known of world.colony.knownFood) {
    const dist = distanceSq(known.pos, world.surface.entrance);
    if (!nearest || dist < nearest.distanceSq) {
      nearest = { id: known.id, distanceSq: dist };
    }
  }

  world.colony.activeFoodTargetId = nearest?.id;
}

export function scoutLimitForColony(world: World): number {
  if (!world.colony.activeFoodTargetId) {
    return Math.min(CONFIG.maxScouts, world.directives.activeTarget);
  }

  return 0;
}

export function assignForageRoles(world: World): void {
  const scoutLimit = scoutLimitForColony(world);
  const hasActiveTarget = !!world.colony.activeFoodTargetId;
  const regularCandidates = world.ants
    .filter((ant) =>
      ant.state !== "dead" &&
      ant.job !== "nurse" &&
      !ant.carryingDebris &&
      !ant.carryingDirt &&
      (
        ant.forageRole === "scout" ||
        ant.job === "forage" ||
        ant.state === "search" ||
        ant.state === "toEntrance" ||
        ant.state === "carry" ||
        ant.carrying > 0 ||
        (hasActiveTarget && ant.carrying <= 0)
      )
    );
  const scoutCandidates = world.ants
    .filter((ant) =>
      ant.state !== "dead" &&
      ant.job !== "nurse" &&
      !ant.carryingDebris &&
      !ant.carryingDirt &&
      (ant.carrying <= 0 || ant.forageRole === "scout")
    )
    .sort((a, b) => {
      const aKeepScout = a.forageRole === "scout" && (a.carrying > 0 || !!a.foundFoodSourceId);
      const bKeepScout = b.forageRole === "scout" && (b.carrying > 0 || !!b.foundFoodSourceId);
      if (aKeepScout !== bKeepScout) {
        return aKeepScout ? -1 : 1;
      }
      const aAlreadyScout = a.forageRole === "scout";
      const bAlreadyScout = b.forageRole === "scout";
      if (aAlreadyScout !== bAlreadyScout) {
        return aAlreadyScout ? -1 : 1;
      }
      return Number(a.id.replace("ant-", "")) - Number(b.id.replace("ant-", ""));
    });

  const scoutIds = new Set(
    scoutCandidates
      .filter((ant) => ant.forageRole === "scout" && (ant.carrying > 0 || !!ant.foundFoodSourceId))
      .map((ant) => ant.id)
  );
  for (const ant of scoutCandidates) {
    if (scoutIds.size >= scoutLimit && !(ant.forageRole === "scout" && (ant.carrying > 0 || !!ant.foundFoodSourceId))) {
      break;
    }
    if (scoutIds.size < scoutLimit) {
      scoutIds.add(ant.id);
    }
  }
  const regularCandidateIds = new Set(regularCandidates.map((ant) => ant.id));
  for (const ant of world.ants) {
    if (ant.job === "nurse" || ant.job === "dig" || ant.state === "dead") {
      if (!scoutIds.has(ant.id)) {
        ant.forageRole = undefined;
        ant.foundFoodSourceId = undefined;
      }
    }
    if (scoutIds.has(ant.id)) {
      ant.job = "forage";
      ant.forageRole = "scout";
      ant.digTaskId = undefined;
      ant.digTarget = undefined;
      ant.digStandPos = undefined;
      ant.digProgress = undefined;
      ant.carryingDirt = false;
      ant.dirtLoad = 0;
      continue;
    }
    if (regularCandidateIds.has(ant.id)) {
      ant.job = "forage";
      ant.forageRole = "forager";
      ant.foundFoodSourceId = undefined;
      if (ant.state === "dig") {
        ant.state = "idle";
      }
      ant.digTaskId = undefined;
      ant.digTarget = undefined;
      ant.digStandPos = undefined;
      ant.digProgress = undefined;
    } else if (ant.carrying <= 0) {
      ant.forageRole = undefined;
      ant.foundFoodSourceId = undefined;
    }
  }
}
