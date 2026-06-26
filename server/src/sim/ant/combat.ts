import type { Ant, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { tickCache } from "../cache";
import type { World } from "../world";
import { distance, normalize } from "./utils";
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

export function isThreateningSpider(world: World, spiderIndex: number): boolean {
  const enemy = world.enemies[spiderIndex];
  if (!enemy || enemy.type !== "spider" || enemy.hp <= 0) {
    return false;
  }

  const attackRadius = spiderAttackRadius(enemy);
  const list = tickCache.surfaceAnts;
  const len = list.length;
  for (let i = 0; i < len; i += 1) {
    if (distance(list[i].pos, enemy.pos) <= attackRadius) {
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
  const list = tickCache.surfaceAnts;
  const len = list.length;
  const defRad = CONFIG.defenseRadius;
  for (let i = 0; i < len; i += 1) {
    const ant = list[i];
    if (ant.state === "fight" && ant.carrying <= 0 && distance(ant.pos, enemy.pos) <= defRad) {
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
  const list = tickCache.surfaceAnts;
  const len = list.length;
  const defRad = CONFIG.defenseRadius;
  for (let i = 0; i < len; i += 1) {
    const ant = list[i];
    if (ant.carrying <= 0 && distance(ant.pos, enemy.pos) <= defRad) {
      count += 1;
    }
  }
  return count;
}

export function enemyColonyAnts(world: World, ant: Ant): Ant[] {
  return (world.colonies ?? [])
    .filter((colony) => colony.id !== ant.colonyId)
    .flatMap((colony) => colony.ants)
    .filter((other) => other.layer === "surface" && other.state !== "dead");
}

export function nearestEnemyAnt(world: World, ant: Ant): { ant: Ant; distance: number } | null {
  let nearest: { ant: Ant; distance: number } | null = null;
  for (const enemy of enemyColonyAnts(world, ant)) {
    const enemyDistance = distance(ant.pos, enemy.pos);
    if (!nearest || enemyDistance < nearest.distance) {
      nearest = { ant: enemy, distance: enemyDistance };
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
    const nestDistance = distance(ant.pos, colony.surfaceEntrance);
    if (!nearest || nestDistance < nearest.distance) {
      nearest = { pos: colony.surfaceEntrance, distance: nestDistance };
    }
  }
  return nearest?.pos ?? null;
}

export function handleEnemyColonyCombat(world: World, ant: Ant): boolean {
  if (ant.carrying > 0 || ant.layer !== "surface") {
    return false;
  }

  const nearest = nearestEnemyAnt(world, ant);
  if (nearest && nearest.distance <= CONFIG.antCombatRadius) {
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

  if (!isColonyWarHungry(world)) {
    return false;
  }

  const target = nearest?.ant.pos ?? nearestEnemyNest(world, ant);
  if (!target) {
    return false;
  }

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
  const enemyDistance = distance(ant.pos, enemy.pos);
  if (enemyDistance <= CONFIG.spiderAttackRadius) {
    ant.state = "fight";
    ant.heading = normalize({ x: enemy.pos.x - ant.pos.x, y: enemy.pos.y - ant.pos.y });
    return true;
  }

  ant.state = "fight";
  moveSurfaceToward(world, ant, enemy.pos, false);
  return true;
}
