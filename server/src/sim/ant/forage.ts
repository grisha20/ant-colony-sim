import type { Ant, Debris, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { profiler } from "../../utils/profiler";
import { activeFoodTarget } from "../foodMemory";
import type { World } from "../world";
import { randomHeading } from "../world";
import { distance, isWithinRadius, normalize, numericAntId } from "./utils";
import {
  applySpiderAvoidance,
  applySeparation,
  clampToSurface,
  isDugPos,
  moveSurfaceToward,
  moveUndergroundToward,
  surfaceMoveSpeed,
  tryCrossLayer
} from "./movement";
import {
  canUseStorageMeal,
  hasAvailableSurfaceFood,
  isColonyStarving
} from "./colony-state";
import { hasDugRoom } from "./brood";

export type SurfaceFoodTarget = {
  source: { id: string; pos: Vec2; amount: number; kind?: "food" | "carrion" | "antCorpse" | "spiderCarcass" };
  list: Array<{ id: string; pos: Vec2; amount: number; kind?: "food" | "carrion" | "antCorpse" | "spiderCarcass" }>;
  index: number;
};

function foodPriority(source: SurfaceFoodTarget["source"], starving: boolean): number {
  const kind = source.kind ?? "food";
  if (kind === "spiderCarcass") {
    return 1.2;
  }
  if (kind === "food") {
    return 1;
  }
  if (kind === "carrion") {
    return starving ? 0.72 : 0.38;
  }
  return starving ? 0.55 : 0.18;
}

function shouldReturnToNestDuringSearch(world: World, ant: Ant): boolean {
  if (ant.carrying > 0) {
    return false;
  }

  const seed = numericAntId(ant.id) + (ant.colonyId === "colony-2" ? 23 : 0);
  const distFromEntrance = distance(ant.pos, world.surface.entrance);
  const searchTicks = 620 + (seed % 360);
  const checkTicks = 150 + ((seed * 7) % 120);
  const cycleTicks = searchTicks + checkTicks;
  const shiftedTick = world.tick + seed * 41;
  const phase = shiftedTick % cycleTicks;
  const cycle = Math.floor(shiftedTick / cycleTicks);
  const nearEdge =
    ant.pos.x < 10 ||
    ant.pos.x > world.surface.width - 10 ||
    ant.pos.y < 10 ||
    ant.pos.y > world.surface.height - 10;
  const maxReach = Math.hypot(world.surface.width, world.surface.height) * 0.55;
  const excursionLimit = Math.min(
    maxReach,
    70 + (seed % 35) + (cycle % 7) * 34 + Math.min(90, world.tick * 0.012)
  );

  return (
    (phase >= searchTicks && distFromEntrance > 9) ||
    (nearEdge && distFromEntrance > 35) ||
    distFromEntrance > excursionLimit
  );
}

export function scoutDirection(world: World, ant: Ant): Vec2 {
  const seed = numericAntId(ant.id) + (ant.colonyId === "colony-2" ? 19 : 0);
  const sectorAngle = (seed * 2.399963229728653) % (Math.PI * 2);
  const sector = { x: Math.cos(sectorAngle), y: Math.sin(sectorAngle) };
  const fromEntrance = { x: ant.pos.x - world.surface.entrance.x, y: ant.pos.y - world.surface.entrance.y };
  const currentRadius = Math.max(0.01, Math.hypot(fromEntrance.x, fromEntrance.y));
  const radial = { x: fromEntrance.x / currentRadius, y: fromEntrance.y / currentRadius };
  const wave = {
    x: Math.cos(world.tick * 0.023 + seed * 0.71),
    y: Math.sin(world.tick * 0.017 + seed * 1.13)
  };
  if (shouldReturnToNestDuringSearch(world, ant)) {
    return normalize({
      x: world.surface.entrance.x - ant.pos.x + wave.x * 4,
      y: world.surface.entrance.y - ant.pos.y + wave.y * 4
    });
  }
  const edgeMargin = 8;
  const edge = {
    x: ant.pos.x < edgeMargin ? 1 : ant.pos.x > world.surface.width - edgeMargin ? -1 : 0,
    y: ant.pos.y < edgeMargin ? 1 : ant.pos.y > world.surface.height - edgeMargin ? -1 : 0
  };
  const outwardWeight = currentRadius < 10 ? 1.8 : 0.65;
  const lateralSign = seed % 2 === 0 ? 1 : -1;
  const lateral = { x: -radial.y * lateralSign, y: radial.x * lateralSign };
  return normalize({
    x: sector.x * 1.05 + radial.x * outwardWeight + lateral.x * 0.18 + wave.x * 0.7 + edge.x * 1.4,
    y: sector.y * 1.05 + radial.y * outwardWeight + lateral.y * 0.18 + wave.y * 0.7 + edge.y * 1.4
  });
}

export function nearestAvailableFood(world: World, ant: Ant): SurfaceFoodTarget | null {
  let nearest: SurfaceFoodTarget | null = null;
  let nearestScore = Number.POSITIVE_INFINITY;
  const starving = isColonyStarving(world);

  for (const list of [world.surface.foodSources, world.surface.carrion]) {
    list.forEach((source, index) => {
      if (source.amount <= 0) {
        return;
      }

      const sourceDistance = distance(ant.pos, source.pos);
      const score = sourceDistance / Math.max(0.05, foodPriority(source, starving));
      if (score < nearestScore) {
        nearestScore = score;
        nearest = { source, list, index };
      }
    });
  }

  return nearest;
}

export function pickupFoodIfReached(world: World, ant: Ant, target: SurfaceFoodTarget): boolean {
  const source = target.list[target.index];
  if (!source || source.amount <= 0 || !isWithinRadius(ant.pos, source.pos, CONFIG.foodPickupRadius)) {
    return false;
  }

  const amount = Math.min(source.amount, Math.max(0, ant.strength));
  source.amount = Math.max(0, source.amount - amount);
  ant.energy = CONFIG.maxEnergy;
  ant.carrying = amount;
  if (
    ant.forageRole === "scout" ||
    !world.colony.activeFoodTargetId ||
    ant.knownActiveFoodTargetId !== world.colony.activeFoodTargetId
  ) {
    ant.foundFoodSourceId = source.id;
    ant.foundFoodTrail = [...(ant.scoutTrail ?? []), { ...source.pos }];
  }
  ant.state = "carry";
  return true;
}

export function moveHungryToFood(world: World, ant: Ant): boolean {
  const food = nearestVisibleFood(world, ant);
  if (!food) {
    return false;
  }

  if (pickupFoodIfReached(world, ant, food)) {
    return true;
  }

  ant.state = "search";
  ant.job = "forage";
  moveSurfaceToward(world, ant, food.source.pos, !isColonyStarving(world));
  return true;
}

export function moveHungryHome(world: World, ant: Ant): void {
  ant.state = "return";
  ant.job = "forage";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
  tryCrossLayer(world, ant);
}

export function moveNurseHome(world: World, ant: Ant): void {
  ant.state = "return";
  ant.job = "nurse";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
  tryCrossLayer(world, ant);
}

export function moveDiggerHome(world: World, ant: Ant): void {
  ant.state = "return";
  ant.job = "dig";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
  tryCrossLayer(world, ant);
}

function moveSearchingLegacy(world: World, ant: Ant): void {
  ant.job = "forage";
  const speed = surfaceMoveSpeed(world, ant);
  const food = nearestAvailableFood(world, ant);
  if (food && pickupFoodIfReached(world, ant, food)) {
    return;
  }

  const isSuper = food && food.source.kind === "spiderCarcass";
  const approachRange = isSuper ? CONFIG.superFoodDirectApproachRange : CONFIG.foodDirectApproachRange;

  if (food && isWithinRadius(ant.pos, food.source.pos, approachRange)) {
    ant.state = "search";
    moveSurfaceToward(world, ant, food.source.pos, false);
    return;
  }

  world.pheromones.home.add(ant.pos.x, ant.pos.y, CONFIG.homePheromoneDeposit);

  // Проверяем, есть ли вообще еда на карте
  const foodAvailable = hasAvailableSurfaceFood(world);

  // Если еды нет, градиент феромонов еды не учитываем (чистая разведка)
  const gradient = profiler.measure("stepAnt.surface.pheromoneDirection", () =>
    foodAvailable
      ? world.pheromones.food.sampleGradient(ant.pos.x, ant.pos.y)
      : { x: 0, y: 0, strength: 0 }
  );

  const density = profiler.measure("stepAnt.surface.pheromoneDirection", () =>
    foodAvailable
      ? world.pheromones.food.getInterpolated(ant.pos.x, ant.pos.y)
      : 0
  );

  const jitter = randomHeading();
  const gradientPower = Math.min(2.5, gradient.strength) * CONFIG.pheromoneGradientWeight;
  const nearestFood = food?.source ?? null;
  const nearestFoodDistance = nearestFood ? distance(ant.pos, nearestFood.pos) : Number.POSITIVE_INFINITY;
  const sightRadius = isSuper ? CONFIG.superFoodSightRadius : CONFIG.antFoodSightRadius;
  const directFood =
    nearestFood && nearestFoodDistance <= sightRadius
      ? normalize({ x: nearestFood.pos.x - ant.pos.x, y: nearestFood.pos.y - ant.pos.y })
      : null;

  // Если не видим еду напрямую, но стоим на сильном феромоне — увеличиваем блуждание (локальный поиск)
  const wanderWeight = directFood
    ? world.directives.forageWander * 0.35
    : world.directives.forageWander * (1.0 + Math.min(3.0, density / 4.0));
  const scout = foodAvailable ? null : scoutDirection(world, ant);

  // Вычисляем желаемое направление на основе внешних сил
  const desired = normalize({
    x:
      gradient.x * gradientPower +
      (directFood?.x ?? 0) * 1.4 +
      (scout?.x ?? 0) * 1.35 +
      jitter.x * wanderWeight,
    y:
      gradient.y * gradientPower +
      (directFood?.y ?? 0) * 1.4 +
      (scout?.y ?? 0) * 1.35 +
      jitter.y * wanderWeight
  });

  const safeDesired = isColonyStarving(world)
    ? desired
    : profiler.measure("stepAnt.surface.spiderAvoid", () => applySpiderAvoidance(world, ant.pos, desired, speed));
  const finalDesired = profiler.measure("stepAnt.surface.separation", () => applySeparation(world, ant, safeDesired));

  // Плавная интерполяция к желаемому вектору
  let k = 0.18;
  if (directFood && nearestFoodDistance < 4.0) {
    k = 0.18 + (1.0 - 0.18) * (1.0 - nearestFoodDistance / 4.0);
  }

  const finalDirection = normalize({
    x: ant.heading.x * (1 - k) + finalDesired.x * k,
    y: ant.heading.y * (1 - k) + finalDesired.y * k
  });

  profiler.measure("stepAnt.surface.move", () => {
    ant.heading = finalDirection;
    ant.pos.x += finalDirection.x * speed;
    ant.pos.y += finalDirection.y * speed;
    clampToSurface(ant, world);
  });
}

function nearestVisibleFood(world: World, ant: Ant): SurfaceFoodTarget | null {
  let nearest: SurfaceFoodTarget | null = null;
  let nearestScore = Number.POSITIVE_INFINITY;
  const starving = isColonyStarving(world);
  for (const list of [world.surface.foodSources, world.surface.carrion]) {
    list.forEach((source, index) => {
      if (source.amount <= 0) {
        return;
      }
      const isSuper = source.kind === "spiderCarcass";
      const sightRadius = isSuper ? CONFIG.superFoodSightRadius : CONFIG.antFoodSightRadius;
      const sourceDistance = distance(ant.pos, source.pos);
      if (sourceDistance > sightRadius) {
        return;
      }
      const score = sourceDistance / Math.max(0.05, foodPriority(source, starving));
      if (score < nearestScore) {
        nearestScore = score;
        nearest = { source, list, index };
      }
    });
  }
  return nearest;
}

function moveScoutSearching(world: World, ant: Ant): void {
  const food = nearestVisibleFood(world, ant);
  if (food && pickupFoodIfReached(world, ant, food)) {
    ant.foundFoodTrail = [...(ant.scoutTrail ?? []), { ...food.source.pos }];
    return;
  }

  if (food) {
    ant.state = "search";
    moveSurfaceToward(world, ant, food.source.pos, !isColonyStarving(world));
    return;
  }

  const speed = surfaceMoveSpeed(world, ant);
  const jitter = randomHeading();
  const scout = scoutDirection(world, ant);
  const desired = normalize({
    x: scout.x * 1.35 + jitter.x * world.directives.forageWander,
    y: scout.y * 1.35 + jitter.y * world.directives.forageWander
  });
  const safeDesired = isColonyStarving(world)
    ? desired
    : profiler.measure("stepAnt.surface.spiderAvoid", () => applySpiderAvoidance(world, ant.pos, desired, speed));
  const finalDesired = profiler.measure("stepAnt.surface.separation", () => applySeparation(world, ant, safeDesired));
  const finalDirection = normalize({
    x: ant.heading.x * 0.82 + finalDesired.x * 0.18,
    y: ant.heading.y * 0.82 + finalDesired.y * 0.18
  });

  profiler.measure("stepAnt.surface.move", () => {
    ant.heading = finalDirection;
    ant.pos.x += finalDirection.x * speed;
    ant.pos.y += finalDirection.y * speed;
    clampToSurface(ant, world);
  });
  rememberScoutTrail(world, ant);
}

function moveAlongFoodTrail(world: World, ant: Ant, targetPos: Vec2, towardFood: boolean): void {
  const speed = surfaceMoveSpeed(world, ant);
  const trail = activeTrailForTarget(world, targetPos);
  const guide = trailGuide(ant.pos, trail, towardFood);
  const forward = guide.forward;
  const lateral = {
    x: guide.center.x - ant.pos.x,
    y: guide.center.y - ant.pos.y
  };
  const jitter = randomHeading();
  let desired = normalize({
    x: forward.x * 1.55 + lateral.x * 0.35 + jitter.x * 0.025,
    y: forward.y * 1.55 + lateral.y * 0.35 + jitter.y * 0.025
  });

  if (!isColonyStarving(world)) {
    desired = profiler.measure("stepAnt.surface.spiderAvoid", () => applySpiderAvoidance(world, ant.pos, desired, speed));
  }

  const direction = normalize({
    x: ant.heading.x * 0.55 + desired.x * 0.45,
    y: ant.heading.y * 0.55 + desired.y * 0.45
  });

  profiler.measure("stepAnt.surface.move", () => {
    ant.heading = direction;
    ant.pos.x += direction.x * speed;
    ant.pos.y += direction.y * speed;
    clampToSurface(ant, world);
  });
}

function rememberScoutTrail(world: World, ant: Ant): void {
  if (ant.forageRole !== "scout" || ant.layer !== "surface" || ant.carrying > 0) {
    return;
  }
  const trail = ant.scoutTrail ?? [{ ...world.surface.entrance }];
  const last = trail[trail.length - 1];
  if (!last || distance(last, ant.pos) >= 2.5) {
    trail.push({ ...ant.pos });
  }
  ant.scoutTrail = trail.slice(-80);
}

function activeTrailForTarget(world: World, targetPos: Vec2): Vec2[] {
  const known = world.colony.knownFood.find((food) => food.id === world.colony.activeFoodTargetId);
  const trail = known?.trail && known.trail.length >= 2
    ? known.trail
    : [world.surface.entrance, targetPos];
  return trail;
}

function trailGuide(pos: Vec2, trail: Vec2[], towardFood: boolean): { center: Vec2; forward: Vec2 } {
  if (trail.length < 2) {
    return { center: trail[0] ?? pos, forward: { x: 1, y: 0 } };
  }

  let best = {
    progress: 0,
    distanceSq: Number.POSITIVE_INFINITY,
    center: trail[0]
  };
  let walked = 0;
  const segments: Array<{ a: Vec2; b: Vec2; length: number; start: number }> = [];
  for (let i = 0; i < trail.length - 1; i += 1) {
    const a = trail[i];
    const b = trail[i + 1];
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const lenSq = Math.max(0.001, ab.x * ab.x + ab.y * ab.y);
    const length = Math.sqrt(lenSq);
    segments.push({ a, b, length, start: walked });
    const t = Math.max(0, Math.min(1, ((pos.x - a.x) * ab.x + (pos.y - a.y) * ab.y) / lenSq));
    const center = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    const dsq = (pos.x - center.x) ** 2 + (pos.y - center.y) ** 2;
    if (dsq < best.distanceSq) {
      best = { progress: walked + length * t, distanceSq: dsq, center };
    }
    walked += length;
  }

  const total = Math.max(0.001, walked);
  const lookahead = 6;
  const targetProgress = Math.max(0, Math.min(total, best.progress + (towardFood ? lookahead : -lookahead)));
  const next = pointAtTrailProgress(segments, targetProgress);
  return {
    center: best.center,
    forward: normalize({ x: next.x - pos.x, y: next.y - pos.y })
  };
}

function pointAtTrailProgress(segments: Array<{ a: Vec2; b: Vec2; length: number; start: number }>, progress: number): Vec2 {
  for (const segment of segments) {
    if (progress <= segment.start + segment.length) {
      const t = Math.max(0, Math.min(1, (progress - segment.start) / Math.max(0.001, segment.length)));
      return {
        x: segment.a.x + (segment.b.x - segment.a.x) * t,
        y: segment.a.y + (segment.b.y - segment.a.y) * t
      };
    }
  }
  const last = segments[segments.length - 1];
  return last?.b ?? { x: 0, y: 0 };
}

function moveForagerSearching(world: World, ant: Ant): void {
  const target = activeFoodTarget(world);
  if (!target) {
    moveScoutSearching(world, ant);
    return;
  }
  if (ant.knownActiveFoodTargetId !== target.source.id) {
    if (distance(ant.pos, world.surface.entrance) <= 8 || ant.state === "return") {
      ant.knownActiveFoodTargetId = target.source.id;
    } else {
      moveScoutSearching(world, ant);
      return;
    }
  }

  if (pickupFoodIfReached(world, ant, target)) {
    return;
  }

  ant.state = "search";
  world.pheromones.food.add(ant.pos.x, ant.pos.y, CONFIG.foodPheromoneDeposit * 0.75);
  moveAlongFoodTrail(world, ant, target.source.pos, true);
}

export function moveSearching(world: World, ant: Ant): void {
  ant.job = "forage";
  world.pheromones.home.add(ant.pos.x, ant.pos.y, CONFIG.homePheromoneDeposit);

  if (ant.forageRole === "scout") {
    moveScoutSearching(world, ant);
    return;
  }

  moveForagerSearching(world, ant);
}

export function moveCarrying(world: World, ant: Ant): void {
  ant.job = "forage";
  world.pheromones.food.add(ant.pos.x, ant.pos.y, CONFIG.foodPheromoneDeposit);

  const target = ant.forageRole === "forager" ? activeFoodTarget(world) : null;
  if (target) {
    moveAlongFoodTrail(world, ant, target.source.pos, false);
  } else {
    moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
  }
  tryCrossLayer(world, ant);
}

export function nearestUndergroundCarrion(world: World, ant: Ant): { index: number; pos: Vec2 } | null {
  let nearest: { index: number; pos: Vec2 } | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  world.underground.carrion.forEach((source, index) => {
    if (source.amount <= 0 || !isDugPos(world, source.pos)) {
      return;
    }
    const sourceDistance = distance(ant.pos, source.pos);
    if (sourceDistance < nearestDistance) {
      nearestDistance = sourceDistance;
      nearest = { index, pos: source.pos };
    }
  });
  return nearest;
}

export function collectUndergroundCarrion(world: World, ant: Ant): boolean {
  if (ant.state !== "idle" || ant.carrying > 0 || !hasDugRoom(world, "storage")) {
    return false;
  }

  const carrion = nearestUndergroundCarrion(world, ant);
  if (!carrion) {
    return false;
  }

  const source = world.underground.carrion[carrion.index];
  if (!source || source.amount <= 0) {
    return false;
  }

  ant.job = "forage";
  if (distance(ant.pos, source.pos) > CONFIG.foodPickupRadius) {
    ant.state = "idle";
    moveUndergroundToward(world, ant, source.pos);
    return true;
  }

  const amount = Math.min(source.amount, Math.max(0.35, ant.strength));
  source.amount = Math.max(0, source.amount - amount);
  ant.carrying = amount;
  ant.state = "deposit";
  return true;
}

export function moveCarryingDebris(world: World, ant: Ant): void {
  ant.job = "idle";
  const colony = world.colonies.find(c => c.id === ant.colonyId);
  const entrance = colony?.surfaceEntrance ?? world.surface.entrance;
  const dirtMound = colony?.underground?.dirtMound ?? 0;
  const scale = 1.0 + Math.min(1.8, dirtMound / 400);
  const minDrop = 3.0 * scale;
  const maxDrop = 7.0 * scale;

  const distToEntrance = distance(ant.pos, entrance);
  if (distToEntrance <= maxDrop) {
    const angle = Math.random() * Math.PI * 2;
    const r = minDrop + Math.random() * (maxDrop - minDrop);
    const dropPos = {
      x: entrance.x + Math.cos(angle) * r,
      y: entrance.y + Math.sin(angle) * r
    };
    dropPos.x = Math.max(1.5, Math.min(world.surface.width - 1.5, dropPos.x));
    dropPos.y = Math.max(1.5, Math.min(world.surface.height - 1.5, dropPos.y));

    const nextDebrisId = Math.random().toString(36).substr(2, 9);
    world.surface.debris.push({
      id: `debris-${nextDebrisId}`,
      type: ant.carryingDebris!,
      pos: dropPos
    });
    ant.carryingDebris = null;
    ant.state = "search";
    ant.job = "forage";
    return;
  }

  moveSurfaceToward(world, ant, entrance, !isColonyStarving(world), false);
}

export function moveSearchingDebris(world: World, ant: Ant): boolean {
  let nearestDebris: Debris | null = null;
  let minDebrisDist = Infinity;

  for (const item of world.surface.debris) {
    let canCollect = true;

    for (const colony of world.colonies) {
      const dist = distance(item.pos, colony.surfaceEntrance);
      const dirtMound = colony.underground?.dirtMound ?? 0;
      const scale = 1.0 + Math.min(1.8, dirtMound / 400);
      const minDrop = 3.0 * scale;
      const forbiddenLimit = minDrop + 12;

      // 1. Хлам внутри нового холмика (но дальше 0.7 от входа) - переносим наружу
      const isInsideMound = dist >= 0.7 && dist < minDrop;
      // 2. Хлам на кольце гнезда - не трогаем
      const isOnDome = dist >= minDrop && dist < forbiddenLimit;
      // 3. Хлам далеко на карте - собирать можно
      const isFarAway = dist >= forbiddenLimit;

      if (!isInsideMound && !isFarAway) {
        canCollect = false;
        break;
      }
    }

    if (!canCollect) {
      continue;
    }

    const distToAnt = distance(ant.pos, item.pos);
    if (distToAnt < minDebrisDist) {
      minDebrisDist = distToAnt;
      nearestDebris = item;
    }
  }

  if (!nearestDebris) {
    ant.job = "forage";
    return false;
  }

  if (minDebrisDist <= 1.2) {
    const index = world.surface.debris.findIndex((debris) => debris.id === nearestDebris!.id);
    if (index >= 0) {
      world.surface.debris.splice(index, 1);
    }
    ant.carryingDebris = nearestDebris.type;
    ant.job = "idle";
    return true;
  }

  moveSurfaceToward(world, ant, nearestDebris.pos, !isColonyStarving(world));
  return true;
}
