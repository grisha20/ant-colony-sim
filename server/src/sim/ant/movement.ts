import type { Ant, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { profiler } from "../../utils/profiler";
import { tickCache } from "../cache";
import type { UndergroundNode } from "../nav";
import { isDugTile, tileCenter } from "../underground";
import type { World } from "../world";
import { randomHeading } from "../world";
import { distance, distanceSq, fanDirection, isWithinRadius, moveToward, normalize, posTile } from "./utils";

export type CachedPath = {
  targetTile: Vec2;
  tiles: Vec2[];
  failed?: boolean;
};

export const antPaths = new Map<string, CachedPath>();
const surfaceQueryScratch: Ant[] = [];

export function clearDeadAntPaths(activeIds: Set<string>): void {
  for (const antId of antPaths.keys()) {
    if (!activeIds.has(antId)) {
      antPaths.delete(antId);
    }
  }
}

export function surfaceMoveSpeed(world: World, ant: Ant): number {
  let nearbyWorkers = 0;
  const list = tickCache.surfaceAnts;
  const len = list.length;
  const defRad = CONFIG.defenseRadius;
  for (let i = 0; i < len; i += 1) {
    const other = list[i];
    if (other.id !== ant.id) {
      if (isWithinRadius(other.pos, ant.pos, defRad)) {
        nearbyWorkers += 1;
        if (nearbyWorkers >= CONFIG.antMobCountThreshold) {
          break;
        }
      }
    }
  }

  let speed = nearbyWorkers >= CONFIG.antMobCountThreshold
    ? CONFIG.workerSurfaceSpeed + CONFIG.antMobSpeedBonus
    : CONFIG.workerSurfaceSpeed;

  // Замедление муравьев на паутине вокруг гнезда паука
  for (const enemy of world.enemies) {
    if (enemy.type === "spider" && enemy.hp > 0) {
      if (isWithinRadius(ant.pos, enemy.lair, CONFIG.spiderLairWebRadius)) {
        speed *= CONFIG.spiderWebSpeedPenalty;
        break;
      }
    }
  }

  return speed;
}

export function moveSurfaceToward(world: World, ant: Ant, target: Vec2, avoidSpiders: boolean, allowSeparation = true): void {
  const speed = surfaceMoveSpeed(world, ant);
  let desired = normalize({ x: target.x - ant.pos.x, y: target.y - ant.pos.y });

  if (avoidSpiders) {
    desired = profiler.measure("stepAnt.surface.spiderAvoid", () => applySpiderAvoidance(world, ant.pos, desired, speed));
  }

  if (allowSeparation) {
    const dist = distance(ant.pos, target);
    const isTargetEntrance = target.x === world.surface.entrance.x && target.y === world.surface.entrance.y;
    if (!isTargetEntrance || dist > 8.0) {
      desired = profiler.measure("stepAnt.surface.separation", () => applySeparation(world, ant, desired));
    }
  }

  const dist = distance(ant.pos, target);
  // Базовая маневренность k = 0.18. Чем ближе к цели (до 4 единиц), тем точнее маневрируем (до 1.0)
  const k = dist < 4.0 ? 0.18 + (1.0 - 0.18) * (1.0 - dist / 4.0) : 0.18;

  const direction = normalize({
    x: ant.heading.x * (1 - k) + desired.x * k,
    y: ant.heading.y * (1 - k) + desired.y * k
  });

  profiler.measure("stepAnt.surface.move", () => {
    ant.heading = direction;
    ant.pos.x += direction.x * speed;
    ant.pos.y += direction.y * speed;
    clampToSurface(ant, world);
  });
}

export function clampToSurface(ant: Ant, world: World): void {
  const margin = 1.5;
  const oldX = ant.pos.x;
  const oldY = ant.pos.y;

  ant.pos.x = Math.max(margin, Math.min(world.surface.width - margin, ant.pos.x));
  ant.pos.y = Math.max(margin, Math.min(world.surface.height - margin, ant.pos.y));

  if (ant.pos.x !== oldX) {
    ant.heading.x = -ant.heading.x;
    ant.pos.x += ant.heading.x * 0.1;
  }
  if (ant.pos.y !== oldY) {
    ant.heading.y = -ant.heading.y;
    ant.pos.y += ant.heading.y * 0.1;
  }
}

export function clampToUnderground(ant: Ant, world: World): void {
  ant.pos.x = Math.max(0, Math.min(world.underground.width - 0.01, ant.pos.x));
  ant.pos.y = Math.max(0, Math.min(world.underground.height - 0.01, ant.pos.y));
}

export function isDugPos(world: World, pos: Vec2): boolean {
  const tile = posTile(pos);
  return isDugTile(world.underground, tile.x, tile.y);
}

export function findNearestDugTile(world: World, from: Vec2): Vec2 | null {
  const start = posTile(from);
  if (isDugTile(world.underground, start.x, start.y)) {
    return start;
  }

  for (let radius = 1; radius <= 8; radius += 1) {
    for (let y = start.y - radius; y <= start.y + radius; y += 1) {
      for (let x = start.x - radius; x <= start.x + radius; x += 1) {
        if (isDugTile(world.underground, x, y)) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

export function calculateDugPath(world: World, from: Vec2, to: Vec2): Vec2[] | null {
  const start = posTile(from);
  const target = posTile(to);
  if (!isDugTile(world.underground, target.x, target.y)) {
    return null;
  }
  if (!isDugTile(world.underground, start.x, start.y)) {
    const fallback = findNearestDugTile(world, from);
    if (!fallback) return null;
    return [fallback];
  }
  if (start.x === target.x && start.y === target.y) {
    return [target];
  }

  const w = world.underground.width;
  const h = world.underground.height;
  const size = w * h;
  const startIndex = start.y * w + start.x;
  const targetIndex = target.y * w + target.x;

  // Очередь индексов
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  // Храним индексы предков. Инициализируем -1
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);

  queue[tail++] = startIndex;
  cameFrom[startIndex] = -2; // Метка старта

  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ];

  let found = false;
  while (head < tail) {
    const currIndex = queue[head++];
    if (currIndex === targetIndex) {
      found = true;
      break;
    }

    const cy = Math.floor(currIndex / w);
    const cx = currIndex % w;

    for (let i = 0; i < 4; i += 1) {
      const dir = dirs[i];
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;

      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const nextIndex = ny * w + nx;
        if (cameFrom[nextIndex] === -1 && isDugTile(world.underground, nx, ny)) {
          cameFrom[nextIndex] = currIndex;
          queue[tail++] = nextIndex;
        }
      }
    }
  }

  if (!found || cameFrom[targetIndex] === -1) {
    return null;
  }

  // Восстанавливаем полный путь от конца к началу
  const path: Vec2[] = [];
  let curr = targetIndex;
  while (curr !== startIndex && curr !== -2 && curr !== -1) {
    path.push({
      x: curr % w,
      y: Math.floor(curr / w)
    });
    curr = cameFrom[curr];
  }
  path.reverse();
  return path;
}

export function moveUndergroundToward(world: World, ant: Ant, target: Vec2, speed: number = CONFIG.workerUndergroundSpeed): boolean {
  const startTile = posTile(ant.pos);
  const targetTile = posTile(target);

  // Если муравей уже находится на той же плитке, что и цель, двигаемся напрямую
  if (startTile.x === targetTile.x && startTile.y === targetTile.y) {
    antPaths.delete(ant.id);
    moveToward(ant, target, Math.min(speed, Math.max(0.15, distance(ant.pos, target))));
    clampToUnderground(ant, world);
    return isDugPos(world, ant.pos);
  }

  let cached = antPaths.get(ant.id);

  // Пересчитываем путь, если кэша нет, цель изменилась, или первая плитка пути стала недоступна.
  // Но если путь помечен как failed и цель та же, мы его НЕ пересчитываем!
  const needRecalc =
    !cached ||
    cached.targetTile.x !== targetTile.x ||
    cached.targetTile.y !== targetTile.y ||
    (!cached.failed && (cached.tiles.length === 0 || !isDugTile(world.underground, cached.tiles[0].x, cached.tiles[0].y)));

  if (needRecalc) {
    const path = calculateDugPath(world, ant.pos, target);
    if (path && path.length > 0) {
      cached = {
        targetTile,
        tiles: path
      };
      antPaths.set(ant.id, cached);
    } else {
      // Кэшируем неудачу, чтобы не вызывать BFS каждый тик к той же недостижимой цели
      cached = {
        targetTile,
        tiles: [],
        failed: true
      };
      antPaths.set(ant.id, cached);
    }
  }

  // Если путь не найден, просто стоим или делаем fallback
  if (cached && cached.failed) {
    const fallback = findNearestDugTile(world, ant.pos);
    if (fallback) {
      ant.pos = tileCenter(fallback);
      clampToUnderground(ant, world);
    }
    return false;
  }

  if (cached && cached.tiles.length > 0) {
    const nextTile = cached.tiles[0];
    const distToNext = distance(ant.pos, tileCenter(nextTile));

    // Если муравей подошел к следующей плитке достаточно близко, переходим к следующей
    if (distToNext <= 1.2) {
      cached.tiles.shift();
    }

    if (cached.tiles.length > 0) {
      const nextTarget = cached.tiles[0];
      const nextTargetPos = nextTarget.x === targetTile.x && nextTarget.y === targetTile.y ? target : tileCenter(nextTarget);
      moveToward(ant, nextTargetPos, Math.min(speed, Math.max(0.15, distance(ant.pos, nextTargetPos))));
      clampToUnderground(ant, world);
      return isDugPos(world, ant.pos);
    } else {
      // Если путь закончился, идем напрямую к цели
      moveToward(ant, target, Math.min(speed, Math.max(0.15, distance(ant.pos, target))));
      clampToUnderground(ant, world);
      return isDugPos(world, ant.pos);
    }
  }

  const fallback = findNearestDugTile(world, ant.pos);
  if (fallback) {
    ant.pos = tileCenter(fallback);
    clampToUnderground(ant, world);
  }
  return false;
}

export function moveUndergroundToNode(world: World, ant: Ant, destination: UndergroundNode): boolean {
  const target = world.underground[destination];
  return moveUndergroundToward(world, ant, target);
}

export function nearestSpider(world: World, pos: Vec2): { index: number; distance: number } {
  let index = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  world.enemies.forEach((enemy, enemyIndex) => {
    if (enemy.type !== "spider" || enemy.hp <= 0) {
      return;
    }

    const enemyDistance = distance(pos, enemy.pos);
    if (enemyDistance > CONFIG.antSpiderSightRadius) {
      return;
    }

    if (enemyDistance < nearestDistance) {
      nearestDistance = enemyDistance;
      index = enemyIndex;
    }
  });

  return { index, distance: nearestDistance };
}

export function spiderAttackRadius(enemy: { hunger: number }): number {
  return enemy.hunger >= CONFIG.spiderHungryThreshold ? CONFIG.spiderHungryAttackRadius : CONFIG.spiderAttackRadius;
}

export function applySpiderAvoidance(world: World, pos: Vec2, desired: Vec2, speed: number): Vec2 {
  const spider = nearestSpider(world, pos);
  if (spider.index < 0) {
    return desired;
  }

  const enemy = world.enemies[spider.index];
  const nextPos = {
    x: pos.x + desired.x * speed,
    y: pos.y + desired.y * speed
  };
  const nextDistance = distance(nextPos, enemy.pos);
  if (nextDistance >= world.directives.spiderAvoidRadius && spider.distance >= world.directives.spiderAvoidRadius) {
    return desired;
  }

  const away = normalize({ x: pos.x - enemy.pos.x, y: pos.y - enemy.pos.y });
  if (nextDistance < world.directives.spiderAvoidRadius) {
    return away;
  }

  const strength = Math.max(0, (world.directives.spiderAvoidRadius - spider.distance) / world.directives.spiderAvoidRadius);
  return normalize({
    x: desired.x + away.x * (1.8 + strength * 2.6),
    y: desired.y + away.y * (1.8 + strength * 2.6)
  });
}

export function applySeparation(world: World, ant: Ant, desired: Vec2): Vec2 {
  let separationX = 0;
  let separationY = 0;
  let count = 0;

  const separationRadius = 1.8;

  // tickCache.surfaceAntGrid contains the same filtered surface ants as tickCache.surfaceAnts.
  const list = tickCache.surfaceAntGrid.queryInto(ant.pos, separationRadius, surfaceQueryScratch);
  const len = list.length;
  const separationRadiusSq = separationRadius * separationRadius;
  for (let i = 0; i < len; i += 1) {
    const other = list[i];
    if (other.id === ant.id) {
      continue;
    }

    const distSq = distanceSq(ant.pos, other.pos);
    if (distSq < separationRadiusSq && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const force = (separationRadius - dist) / separationRadius;
      separationX += ((ant.pos.x - other.pos.x) / dist) * force;
      separationY += ((ant.pos.y - other.pos.y) / dist) * force;
      count += 1;
    }
  }

  if (count === 0) {
    return desired;
  }

  const separationWeight = 0.45;
  const repel = normalize({ x: separationX, y: separationY });

  return normalize({
    x: desired.x * (1 - separationWeight) + repel.x * separationWeight,
    y: desired.y * (1 - separationWeight) + repel.y * separationWeight
  });
}

export function tryCrossLayer(world: World, ant: Ant): boolean {
  const undergroundExitRadius = Math.max(CONFIG.entranceRadiusUnderground, 4.2);
  if (ant.layer === "underground" && isWithinRadius(ant.pos, world.underground.entrance, undergroundExitRadius)) {
    ant.layer = "surface";
    ant.state = "search";
    ant.pos = { ...world.surface.entrance };
    ant.heading = fanDirection(randomHeading(), ant.id);
    ant.surfaceExitCooldown = 12;
    ant.undergroundExitCooldown = 6;
    const spawnOffset = CONFIG.entranceRadiusSurface + 0.8;
    ant.pos.x += ant.heading.x * spawnOffset;
    ant.pos.y += ant.heading.y * spawnOffset;
    clampToSurface(ant, world);
    return true;
  }

  const surfaceEntryRadius =
    ant.state === "return" || ant.state === "carry" || ant.carrying > 0
      ? Math.max(CONFIG.entranceRadiusSurface + CONFIG.workerSurfaceSpeed * 3, 5.0)
      : CONFIG.entranceRadiusSurface;
  if (ant.layer === "surface" && (ant.surfaceExitCooldown ?? 0) <= 0 && isWithinRadius(ant.pos, world.surface.entrance, surfaceEntryRadius)) {
    ant.layer = "underground";
    ant.state = ant.carrying > 0 ? "deposit" : "idle";
    ant.pos = { ...world.underground.entrance };
    ant.heading = { x: -1, y: 0 };
    ant.surfaceExitCooldown = 0;
    ant.undergroundExitCooldown = ant.carrying > 0 ? 0 : 80;
    return true;
  }

  return false;
}
