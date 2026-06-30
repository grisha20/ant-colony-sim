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
  if (!ant.foundFoodSourceId) {
    ant.foundFoodSourceId = undefined;
    ant.foundFoodTrail = undefined;
    return;
  }

  const target = findSurfaceFoodById(world, ant.foundFoodSourceId);
  const trail = normalizeTrail(world.surface.entrance, target?.source.pos, ant.foundFoodTrail);
  ant.foundFoodSourceId = undefined;
  ant.foundFoodTrail = undefined;
  ant.scoutTrail = undefined;
  if (!target || target.source.amount <= 0) {
    return;
  }

  const known = world.colony.knownFood.find((source) => source.id === target.source.id);
  if (known) {
    known.pos = { ...target.source.pos };
    known.lastSeenTick = world.tick;
    if (!known.trail || (trail?.length ?? 0) >= known.trail.length) {
      known.trail = trail;
    }
    selectNearestKnownFood(world);
    return;
  }

  world.colony.knownFood.push({
    id: target.source.id,
    pos: { ...target.source.pos },
    lastSeenTick: world.tick,
    trail
  });
  selectNearestKnownFood(world);
}

export function updateColonyFoodMemory(world: World): void {
  const freshKnown: { id: string; pos: Vec2; lastSeenTick: number; trail?: Vec2[] }[] = [];
  for (const known of world.colony.knownFood) {
    const target = findSurfaceFoodById(world, known.id);
    if (!target || target.source.amount <= 0) {
      continue;
    }
    freshKnown.push({
      id: target.source.id,
      pos: { ...target.source.pos },
      lastSeenTick: Math.max(known.lastSeenTick, target.source.createdAt ?? known.lastSeenTick),
      trail: normalizeTrail(world.surface.entrance, target.source.pos, known.trail)
    });
  }
  world.colony.knownFood = freshKnown;

  selectNearestKnownFood(world);
}

function selectNearestKnownFood(world: World): void {
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
  const livingWorkers = world.ants.filter((ant) => ant.state !== "dead" && ant.job !== "nurse").length;
  const growthScouts = CONFIG.startingScouts + Math.floor(Math.max(0, livingWorkers - CONFIG.startingWorkers - CONFIG.startingMiners) / 4);
  return Math.min(CONFIG.maxScouts, CONFIG.scoutCount, growthScouts, livingWorkers);
}

export function assignForageRoles(world: World): void {
  const scoutLimit = scoutLimitForColony(world);
  const hasActiveTarget = !!world.colony.activeFoodTargetId;
  const activeTargetId = world.colony.activeFoodTargetId;
  const activeDiggers = world.ants.filter(
    (ant) => ant.state !== "dead" && (ant.state === "dig" || ant.state === "carryDirt" || ant.carryingDirt)
  ).length;
  const hasDigNeed = world.underground.digTasks.some((task) => task.status !== "done") || world.tick < 30;
  const shouldReserveDiggers = hasDigNeed;
  const availableWorkers = world.ants.filter(
    (ant) =>
      ant.state !== "dead" &&
      ant.job !== "nurse" &&
      !ant.carryingDebris &&
      !ant.carryingDirt
  ).length;
  const reserveTarget = hasActiveTarget && availableWorkers >= 16 ? Math.max(1, Math.ceil(availableWorkers * 0.1)) : 0;
  const digReserve = shouldReserveDiggers ? Math.min(world.directives.diggerTarget, CONFIG.startingMiners, Math.max(0, availableWorkers - scoutLimit - reserveTarget)) : 0;
  const foragerLimit = hasActiveTarget
    ? Math.max(0, Math.min(CONFIG.maxForagers, availableWorkers - scoutLimit - reserveTarget - digReserve))
    : Math.max(0, Math.min(CONFIG.maxSearchAssistants, availableWorkers - scoutLimit - digReserve));
  const regularCandidates = world.ants
    .filter((ant) =>
      ant.state !== "dead" &&
      ant.job !== "nurse" &&
      ant.job !== "dig" &&
      ant.state !== "dig" &&
      ant.state !== "carryDirt" &&
      !ant.carryingDebris &&
      !ant.carryingDirt &&
      (
        ant.forageRole === "scout" ||
        ant.job === "forage" ||
        ant.state === "search" ||
        ant.state === "toEntrance" ||
        ant.state === "carry" ||
        ant.carrying > 0 ||
        ant.carrying <= 0
      )
    );
  const scoutCandidates = world.ants
    .filter((ant) =>
      ant.state !== "dead" &&
      ant.job !== "nurse" &&
      ant.job !== "dig" &&
      ant.state !== "dig" &&
      ant.state !== "carryDirt" &&
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
  const foragerIds = new Set<string>();
  for (const ant of regularCandidates.sort((a, b) => {
    if (shouldReserveDiggers && a.preferredTask !== b.preferredTask) {
      return a.preferredTask === "dig" ? 1 : -1;
    }
    return Number(a.id.replace("ant-", "")) - Number(b.id.replace("ant-", ""));
  })) {
    if (scoutIds.has(ant.id) || foragerIds.size >= foragerLimit) {
      continue;
    }
    foragerIds.add(ant.id);
  }
  const diggerIds = new Set<string>();
  if (digReserve > 0) {
    for (const ant of regularCandidates.sort((a, b) => {
      if (a.preferredTask !== b.preferredTask) {
        return a.preferredTask === "dig" ? -1 : 1;
      }
      return Number(a.id.replace("ant-", "")) - Number(b.id.replace("ant-", ""));
    })) {
      if (scoutIds.has(ant.id) || foragerIds.has(ant.id) || ant.carrying > 0) {
        continue;
      }
      diggerIds.add(ant.id);
      if (diggerIds.size >= digReserve) {
        break;
      }
    }
  }
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
      if (!hasActiveTarget || ant.knownActiveFoodTargetId !== activeTargetId) {
        ant.knownActiveFoodTargetId = undefined;
      }
      ant.digTaskId = undefined;
      ant.digTarget = undefined;
      ant.digStandPos = undefined;
      ant.digProgress = undefined;
      ant.carryingDirt = false;
      ant.dirtLoad = 0;
      if (ant.state === "dig" || ant.state === "carryDirt") {
        ant.state = "idle";
      }
      continue;
    }
    if (regularCandidateIds.has(ant.id) && foragerIds.has(ant.id)) {
      ant.job = "forage";
      ant.forageRole = "forager";
      if (!hasActiveTarget) {
        ant.knownActiveFoodTargetId = undefined;
      } else if (
        activeTargetId &&
        (
          ant.layer === "underground" ||
          ant.state === "return" ||
          ant.state === "deposit" ||
          distanceSq(ant.pos, world.surface.entrance) <= 10 * 10
        )
      ) {
        ant.knownActiveFoodTargetId = activeTargetId;
      } else if (ant.knownActiveFoodTargetId !== activeTargetId) {
        ant.knownActiveFoodTargetId = undefined;
      }
      if (ant.carrying <= 0 && !ant.foundFoodSourceId) {
        ant.foundFoodSourceId = undefined;
        ant.foundFoodTrail = undefined;
        ant.scoutTrail = undefined;
      }
      if (ant.state === "dig") {
        ant.state = "idle";
      }
      if (hasActiveTarget && ant.layer === "underground" && ant.state === "idle") {
        ant.state = "toEntrance";
      }
      ant.digTaskId = undefined;
      ant.digTarget = undefined;
      ant.digStandPos = undefined;
      ant.digProgress = undefined;
    } else if (diggerIds.has(ant.id) && ant.carrying <= 0) {
      ant.forageRole = undefined;
      ant.foundFoodSourceId = undefined;
      ant.foundFoodTrail = undefined;
      ant.scoutTrail = undefined;
      ant.knownActiveFoodTargetId = undefined;
      ant.preferredTask = "dig";
      if (ant.layer === "underground" && (ant.state === "idle" || ant.state === "toEntrance" || ant.state === "search")) {
        ant.state = "idle";
      }
      if (ant.layer === "surface" && ant.state === "search") {
        ant.state = "return";
      }
      if (ant.job === "forage" || ant.job === "idle") {
        ant.job = "idle";
      }
    } else if (ant.carrying <= 0) {
      ant.forageRole = undefined;
      ant.foundFoodSourceId = undefined;
      ant.foundFoodTrail = undefined;
      ant.scoutTrail = undefined;
      ant.knownActiveFoodTargetId = undefined;
    }
  }
}

function normalizeTrail(entrance: Vec2, target: Vec2 | undefined, trail: Vec2[] | undefined): Vec2[] | undefined {
  if (!target) {
    return undefined;
  }
  const points = cleanTrailLoops(
    entrance,
    target,
    (trail ?? []).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  );
  const normalized: Vec2[] = [];
  const pushIfFar = (point: Vec2) => {
    const last = normalized[normalized.length - 1];
    if (!last || distanceSq(last, point) >= 2.25) {
      normalized.push({ x: point.x, y: point.y });
    }
  };
  pushIfFar(entrance);
  for (const point of points) {
    pushIfFar(point);
  }
  pushIfFar(target);
  return normalized.slice(-40);
}

function cleanTrailLoops(entrance: Vec2, target: Vec2, trail: Vec2[]): Vec2[] {
  const route = { x: target.x - entrance.x, y: target.y - entrance.y };
  const lenSq = Math.max(0.001, route.x * route.x + route.y * route.y);
  const len = Math.sqrt(lenSq);
  const normal = { x: -route.y / len, y: route.x / len };
  const cleaned: Vec2[] = [];
  let lastProgress = -0.08;

  for (const point of trail) {
    const rel = { x: point.x - entrance.x, y: point.y - entrance.y };
    const progress = (rel.x * route.x + rel.y * route.y) / lenSq;
    if (progress <= lastProgress + 0.08 || progress <= 0 || progress >= 1) {
      continue;
    }
    const lateral = Math.max(-5, Math.min(5, rel.x * normal.x + rel.y * normal.y));
    cleaned.push({
      x: entrance.x + route.x * progress + normal.x * lateral,
      y: entrance.y + route.y * progress + normal.y * lateral
    });
    lastProgress = progress;
  }

  return cleaned;
}
