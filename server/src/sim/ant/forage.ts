import type { Ant, Debris, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import type { World } from "../world";
import { randomHeading } from "../world";
import { distance, normalize, numericAntId } from "./utils";
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
  source: { pos: Vec2; amount: number; kind?: "food" | "carrion" | "antCorpse" | "spiderCarcass" };
  list: Array<{ pos: Vec2; amount: number; kind?: "food" | "carrion" | "antCorpse" | "spiderCarcass" }>;
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

export function scoutDirection(world: World, ant: Ant): Vec2 {
  const seed = numericAntId(ant.id) + (ant.colonyId === "colony-2" ? 19 : 0);
  const angle = seed * 2.399963229728653 + Math.floor(world.tick / 900) * 0.65;
  let direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const distFromEntrance = distance(ant.pos, world.surface.entrance);
  if (distFromEntrance < CONFIG.antFoodSightRadius) {
    const away = normalize({ x: ant.pos.x - world.surface.entrance.x, y: ant.pos.y - world.surface.entrance.y });
    direction = normalize({ x: direction.x + away.x * 1.2, y: direction.y + away.y * 1.2 });
  }
  return direction;
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
  if (!source || source.amount <= 0 || distance(ant.pos, source.pos) > CONFIG.foodPickupRadius) {
    return false;
  }

  const amount = Math.min(source.amount, Math.max(0, ant.strength));
  source.amount = Math.max(0, source.amount - amount);
  ant.energy = CONFIG.maxEnergy;
  ant.carrying = amount;
  ant.state = "carry";
  return true;
}

export function moveHungryToFood(world: World, ant: Ant): boolean {
  const food = nearestAvailableFood(world, ant);
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

export function moveSearching(world: World, ant: Ant): void {
  ant.job = "forage";
  const speed = surfaceMoveSpeed(world, ant);
  const food = nearestAvailableFood(world, ant);
  if (food && pickupFoodIfReached(world, ant, food)) {
    return;
  }

  const isSuper = food && food.source.kind === "spiderCarcass";
  const approachRange = isSuper ? CONFIG.superFoodDirectApproachRange : CONFIG.foodDirectApproachRange;

  if (food && distance(ant.pos, food.source.pos) <= approachRange) {
    ant.state = "search";
    moveSurfaceToward(world, ant, food.source.pos, false);
    return;
  }

  world.pheromones.home.add(ant.pos.x, ant.pos.y, CONFIG.homePheromoneDeposit);

  // Проверяем, есть ли вообще еда на карте
  const foodAvailable = hasAvailableSurfaceFood(world);

  // Если еды нет, градиент феромонов еды не учитываем (чистая разведка)
  const gradient = foodAvailable
    ? world.pheromones.food.sampleGradient(ant.pos.x, ant.pos.y)
    : { x: 0, y: 0, strength: 0 };

  const density = foodAvailable
    ? world.pheromones.food.getInterpolated(ant.pos.x, ant.pos.y)
    : 0;

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

  const safeDesired = isColonyStarving(world) ? desired : applySpiderAvoidance(world, ant.pos, desired, speed);
  const finalDesired = applySeparation(world, ant, safeDesired);

  // Плавная интерполяция к желаемому вектору
  let k = 0.18;
  if (directFood && nearestFoodDistance < 4.0) {
    k = 0.18 + (1.0 - 0.18) * (1.0 - nearestFoodDistance / 4.0);
  }

  const finalDirection = normalize({
    x: ant.heading.x * (1 - k) + finalDesired.x * k,
    y: ant.heading.y * (1 - k) + finalDesired.y * k
  });

  ant.heading = finalDirection;
  ant.pos.x += finalDirection.x * speed;
  ant.pos.y += finalDirection.y * speed;
  clampToSurface(ant, world);
}

export function moveCarrying(world: World, ant: Ant): void {
  ant.job = "forage";
  world.pheromones.food.add(ant.pos.x, ant.pos.y, CONFIG.foodPheromoneDeposit);

  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
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
