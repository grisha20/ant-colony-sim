import type { Ant, Debris, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { tickCache } from "../cache";
import { addFoodSource } from "../world";
import type { World } from "../world";
import { distance, isWithinRadius, normalize } from "./utils";
import {
  applySeparation,
  clampToSurface,
  moveSurfaceToward,
  nearestSpider,
  spiderAttackRadius,
  surfaceMoveSpeed,
  tryCrossLayer
} from "./movement";
import { isColonyStarving, isColonyWarHungry } from "./colony-state";

const combatQueryScratch: Ant[] = [];

function isColonyInGrace(world: World, colonyId: string): boolean {
  const colony = world.colonies.find((item) => item.id === colonyId);
  if (!colony) {
    return false;
  }
  return world.tick - (colony.colony.foundedTick ?? 0) < CONFIG.colonyGraceTicks;
}

export function isThreateningSpider(world: World, spiderIndex: number): boolean {
  const enemy = world.enemies[spiderIndex];
  if (!enemy || enemy.type !== "spider" || enemy.hp <= 0) {
    return false;
  }

  const attackRadius = spiderAttackRadius(enemy);
  const list = tickCache.surfaceAntGrid.queryInto(enemy.pos, attackRadius, combatQueryScratch);
  const len = list.length;
  for (let i = 0; i < len; i += 1) {
    if (isWithinRadius(list[i].pos, enemy.pos, attackRadius)) {
      return true;
    }
  }
  return false;
}

export function defenderCountForSpider(world: World, spiderIndex: number): number {
  const enemy = world.enemies[spiderIndex];
  if (!enemy) {
    return 0;
  }

  let count = 0;
  const defRad = CONFIG.defenseRadius;
  const list = tickCache.surfaceAntGrid.queryInto(enemy.pos, defRad, combatQueryScratch);
  const len = list.length;
  for (let i = 0; i < len; i += 1) {
    const ant = list[i];
    if (ant.state === "fight" && ant.carrying <= 0 && isWithinRadius(ant.pos, enemy.pos, defRad)) {
      count += 1;
    }
  }
  return count;
}

export function freeWorkerCountNearSpider(world: World, spiderIndex: number): number {
  const enemy = world.enemies[spiderIndex];
  if (!enemy) {
    return 0;
  }

  let count = 0;
  const defRad = CONFIG.defenseRadius;
  const list = tickCache.surfaceAntGrid.queryInto(enemy.pos, defRad, combatQueryScratch);
  const len = list.length;
  for (let i = 0; i < len; i += 1) {
    const ant = list[i];
    if (ant.carrying <= 0 && isWithinRadius(ant.pos, enemy.pos, defRad)) {
      count += 1;
    }
  }
  return count;
}

export function enemyColonyAnts(world: World, ant: Ant): Ant[] {
  const result: Ant[] = [];
  for (const colony of world.colonies ?? []) {
    if (colony.id === ant.colonyId) {
      continue;
    }
    if (isColonyInGrace(world, colony.id)) {
      continue;
    }
    for (let i = 0; i < colony.ants.length; i += 1) {
      const other = colony.ants[i];
      if (other.layer === "surface" && other.state !== "dead") {
        result.push(other);
      }
    }
  }
  return result;
}

export function nearestEnemyAnt(world: World, ant: Ant): { ant: Ant; distance: number } | null {
  let nearest: { ant: Ant; distance: number } | null = null;
  for (const colony of world.colonies ?? []) {
    if (colony.id === ant.colonyId) {
      continue;
    }
    if (isColonyInGrace(world, colony.id)) {
      continue;
    }
    for (let i = 0; i < colony.ants.length; i += 1) {
      const enemy = colony.ants[i];
      if (enemy.layer !== "surface" || enemy.state === "dead") {
        continue;
      }
      const enemyDistance = distance(ant.pos, enemy.pos);
      if (!nearest || enemyDistance < nearest.distance) {
        nearest = { ant: enemy, distance: enemyDistance };
      }
    }
  }
  return nearest;
}

export function nearestEnemyNest(world: World, ant: Ant): Vec2 | null {
  let nearest: { pos: Vec2; distance: number } | null = null;
  for (const colony of world.colonies ?? []) {
    if (colony.id === ant.colonyId) {
      continue;
    }
    if (isColonyInGrace(world, colony.id)) {
      continue;
    }
    const nestDistance = distance(ant.pos, colony.surfaceEntrance);
    if (!nearest || nestDistance < nearest.distance) {
      nearest = { pos: colony.surfaceEntrance, distance: nestDistance };
    }
  }
  return nearest?.pos ?? null;
}

export function nearestSuperFood(world: World, pos: Vec2): { pos: Vec2; amount: number } | null {
  let nearest: { pos: Vec2; amount: number } | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const source of world.surface.foodSources) {
    if (source.kind === "spiderCarcass" && source.amount > 0) {
      const dist = distance(pos, source.pos);
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearest = source;
      }
    }
  }

  return nearest;
}

export function dropCarriedFood(world: World, ant: Ant): void {
  if (ant.carrying > 0) {
    addFoodSource(world, ant.pos.x, ant.pos.y, ant.carrying);
    ant.carrying = 0;
  }
  if (ant.carryingDebris) {
    const nextDebrisId = Math.random().toString(36).substr(2, 9);
    world.surface.debris.push({
      id: `debris-${nextDebrisId}`,
      type: ant.carryingDebris,
      pos: { ...ant.pos }
    });
    ant.carryingDebris = null;
  }
}

function retreatFromEnemyAnt(world: World, ant: Ant, enemyPos: Vec2): void {
  if (ant.carrying > 0) {
    ant.state = "carry";
    moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world), false);
    return;
  }

  const speed = surfaceMoveSpeed(world, ant);
  const away = normalize({ x: ant.pos.x - enemyPos.x, y: ant.pos.y - enemyPos.y });
  const home = normalize({ x: world.surface.entrance.x - ant.pos.x, y: world.surface.entrance.y - ant.pos.y });
  const desired = applySeparation(
    world,
    ant,
    normalize({ x: away.x * 1.7 + home.x * 0.45, y: away.y * 1.7 + home.y * 0.45 })
  );

  ant.state = "search";
  ant.heading = desired;
  ant.pos.x += desired.x * speed;
  ant.pos.y += desired.y * speed;
  clampToSurface(ant, world);
}

export function handleEnemyColonyCombat(world: World, ant: Ant): boolean {
  if (ant.layer !== "surface") {
    return false;
  }

  const nearest = nearestEnemyAnt(world, ant);
  const superFood = nearestSuperFood(world, ant.pos);
  const nearSuperFood = !!superFood && isWithinRadius(ant.pos, superFood.pos, CONFIG.superFoodCombatRadius);

  if (nearest && nearest.distance <= CONFIG.antCombatRadius) {
    const wantsFight =
      isColonyWarHungry(world) ||
      world.directives.aggression >= 0.55 ||
      (nearSuperFood && world.directives.aggression >= 0.35);
    if (!wantsFight || ant.carrying > 0) {
      retreatFromEnemyAnt(world, ant, nearest.ant.pos);
      return true;
    }

    dropCarriedFood(world, ant);
    ant.state = "fight";
    ant.heading = normalize({ x: nearest.ant.pos.x - ant.pos.x, y: nearest.ant.pos.y - ant.pos.y });
    nearest.ant.energy -= CONFIG.antVsAntDamage * ant.strength;
    ant.energy -= CONFIG.antVsAntDamage * 0.55 * nearest.ant.strength;
    if (nearest.ant.energy <= 0) {
      nearest.ant.state = "dead";
    }
    if (ant.energy <= 0) {
      ant.state = "dead";
    }
    return true;
  }

  // Проверяем борьбу за супер-ресурсы в зависимости от агрессии
  if (nearSuperFood && superFood) {
    if (nearest && isWithinRadius(nearest.ant.pos, superFood.pos, CONFIG.superFoodCombatRadius)) {
      const chaseRadius = CONFIG.antCombatRadius + (CONFIG.superFoodCombatRadius - CONFIG.antCombatRadius) * world.directives.aggression;
      if (nearest.distance <= chaseRadius && ant.carrying <= 0) {
        dropCarriedFood(world, ant);
        ant.state = "fight";
        moveSurfaceToward(world, ant, nearest.ant.pos, false);
        return true;
      }
    }
  }

  if (!isColonyWarHungry(world)) {
    return false;
  }

  const target = nearest?.ant.pos ?? nearestEnemyNest(world, ant);
  if (!target) {
    return false;
  }

  dropCarriedFood(world, ant);
  ant.state = "fight";
  moveSurfaceToward(world, ant, target, false);
  return true;
}

export function retreatFromSpiderToEntrance(world: World, ant: Ant, spiderPos: Vec2): void {
  const speed = surfaceMoveSpeed(world, ant);
  const away = normalize({ x: ant.pos.x - spiderPos.x, y: ant.pos.y - spiderPos.y });
  const home = normalize({ x: world.surface.entrance.x - ant.pos.x, y: world.surface.entrance.y - ant.pos.y });
  let desired = normalize({ x: away.x * 1.4 + home.x, y: away.y * 1.4 + home.y });

  desired = applySeparation(world, ant, desired);

  const dist = distance(ant.pos, world.surface.entrance);
  // Базовая маневренность k = 0.18. Чем ближе к цели (до 4 единиц), тем точнее маневрируем (до 1.0)
  const k = dist < 4.0 ? 0.18 + (1.0 - 0.18) * (1.0 - dist / 4.0) : 0.18;

  const direction = normalize({
    x: ant.heading.x * (1 - k) + desired.x * k,
    y: ant.heading.y * (1 - k) + desired.y * k
  });

  ant.state = "search";
  ant.heading = direction;
  ant.pos.x += direction.x * speed;
  ant.pos.y += direction.y * speed;
  clampToSurface(ant, world);
  tryCrossLayer(world, ant);
}

export function moveFighting(world: World, ant: Ant): boolean {
  const starving = isColonyStarving(world);
  const nearest = nearestSpider(world, ant.pos);
  if (nearest.index < 0) {
    if (ant.state === "fight") {
      ant.state = "search";
    }
    return false;
  }

  const liveAntsCount = tickCache.liveAntsCount;
  const isStartPeriod = liveAntsCount <= 10;

  if (isStartPeriod) {
    const alertNearSpider = ant.carrying <= 0 && nearest.distance <= CONFIG.antAlertRange;
    if (alertNearSpider) {
      retreatFromSpiderToEntrance(world, ant, world.enemies[nearest.index].pos);
      return true;
    }
    if (ant.state === "fight") {
      ant.state = "search";
    }
    return false;
  }

  const defensiveThreat =
    ant.carrying <= 0 &&
    isThreateningSpider(world, nearest.index) &&
    nearest.distance <= CONFIG.defenseRadius &&
    (ant.state === "fight" || defenderCountForSpider(world, nearest.index) < CONFIG.defenseMaxHelpers);
  const alertNearSpider = ant.carrying <= 0 && nearest.distance <= CONFIG.antAlertRange;
  const enoughMob = alertNearSpider && freeWorkerCountNearSpider(world, nearest.index) >= CONFIG.antMobCount;
  const mobThreat =
    enoughMob && (ant.state === "fight" || defenderCountForSpider(world, nearest.index) < CONFIG.defenseMaxHelpers);

  if (!starving && !defensiveThreat && !mobThreat) {
    if (alertNearSpider) {
      retreatFromSpiderToEntrance(world, ant, world.enemies[nearest.index].pos);
      return true;
    }

    if (ant.state === "fight") {
      ant.state = "search";
    }
    return false;
  }

  const enemy = world.enemies[nearest.index];
  if (nearest.distance <= CONFIG.spiderAttackRadius) {
    dropCarriedFood(world, ant);
    ant.state = "fight";
    ant.heading = normalize({ x: enemy.pos.x - ant.pos.x, y: enemy.pos.y - ant.pos.y });
    return true;
  }

  dropCarriedFood(world, ant);
  ant.state = "fight";
  moveSurfaceToward(world, ant, enemy.pos, false);
  return true;
}
