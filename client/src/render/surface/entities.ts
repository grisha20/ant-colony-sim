import { Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { acquireSprite, antRotation, beginPool, deterministicOffset, endPool, placeSprite } from "../spritePool";
import type { SpritePool, ViewBounds } from "../types";
import { isInBounds } from "./scene";
import {
  getAntTexture
} from "../../sprites";
import { drawPebble, drawLeaf } from "./ground";

export function updateSurfaceFood(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const source of world.surface.foodSources) {
    if (!isInBounds(source.pos, bounds, 5)) {
      continue;
    }

    const chunks = Math.max(1, Math.min(18, Math.ceil(source.amount / 6)));
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      const offset = deterministicOffset(index + source.id.length, 18);
      sprite.scale.set(2.2);
      placeSprite(sprite, source.pos.x * cell + offset.x, source.pos.y * cell + offset.y, (index % 4) * 0.2);
    }
  }

  endPool(pool);
}

export function updateSurfaceCarrion(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const source of world.surface.carrion) {
    if (source.amount <= 0 || !isInBounds(source.pos, bounds, 4)) {
      continue;
    }

    const chunks = Math.max(1, Math.min(10, Math.ceil(source.amount / 10)));
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      const offset = deterministicOffset(index + source.id.length * 3, 11);
      sprite.scale.set(2.6);
      placeSprite(sprite, source.pos.x * cell + offset.x, source.pos.y * cell + offset.y, (index % 5) * 0.27);
    }
  }

  endPool(pool);
}

export function updateSurfaceLairs(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider" || !isInBounds(enemy.lair, bounds, 4)) {
      continue;
    }

    const sprite = acquireSprite(pool);
    sprite.scale.set(3.4 + Math.min(1.2, enemy.hoard / 120));
    sprite.alpha = 0.74 + Math.min(0.2, enemy.hoard / Math.max(1, 900));
    placeSprite(sprite, enemy.lair.x * cell, enemy.lair.y * cell, 0);
  }

  endPool(pool);
}

export function updateSurfaceWebs(graphics: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  graphics.clear();

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider" || !enemy.lair || enemy.hp <= 0) {
      continue;
    }

    const lairX = enemy.lair.x * cell;
    const lairY = enemy.lair.y * cell;
    const webRadius = 14 * cell;

    if (!isInBounds(enemy.lair, bounds, 16)) {
      continue;
    }

    // 1. Радиальные лучи
    const rayCount = 16;
    for (let i = 0; i < rayCount; i += 1) {
      const angle = (Math.PI * 2 * i) / rayCount;
      graphics.moveTo(lairX, lairY);
      graphics.lineTo(lairX + Math.cos(angle) * webRadius, lairY + Math.sin(angle) * webRadius);
    }

    // 2. Спиральная паутина
    const spiralTurns = 5;
    const steps = 120;
    graphics.moveTo(lairX, lairY);
    for (let i = 0; i <= steps; i += 1) {
      const angle = (Math.PI * 2 * spiralTurns * i) / steps;
      const currentRadius = (webRadius * i) / steps;
      graphics.lineTo(lairX + Math.cos(angle) * currentRadius, lairY + Math.sin(angle) * currentRadius);
    }

    // В PixiJS v8 нужно явно вызвать stroke, чтобы нарисовать все накопленные линии
    graphics.stroke({ width: 1.6, color: 0xffffff, alpha: 0.42 });
  }
}

export function updateSurfaceEnemies(
  pool: SpritePool,
  carriedCarrionPool: SpritePool,
  world: WorldSnapshot,
  cell: number,
  bounds: ViewBounds
): void {
  beginPool(pool);
  beginPool(carriedCarrionPool);

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider") {
      continue;
    }
    if (!isInBounds(enemy.pos, bounds, 4)) {
      continue;
    }

    const sprite = acquireSprite(pool);
    const hpRatio = enemy.maxHp > 0 ? Math.max(0.2, Math.min(1, enemy.hp / enemy.maxHp)) : 1;
    sprite.scale.set(4.2);
    sprite.alpha = 0.45 + hpRatio * 0.55;
    placeSprite(sprite, enemy.pos.x * cell, enemy.pos.y * cell, 0);

    if (enemy.carrying > 0) {
      const cargo = acquireSprite(carriedCarrionPool);
      cargo.scale.set(1.9);
      placeSprite(cargo, enemy.pos.x * cell + 11, enemy.pos.y * cell - 11, 0.25);
    }
  }

  for (let index = 0; index < pool.cursor; index += 1) {
    pool.sprites[index].alpha = pool.sprites[index].visible ? pool.sprites[index].alpha : 1;
  }
  endPool(pool);
  endPool(carriedCarrionPool);
}

export function updateSurfaceAnts(
  pool: SpritePool,
  debrisGraphics: Graphics,
  world: WorldSnapshot,
  cell: number,
  bounds: ViewBounds
): void {
  beginPool(pool);

  for (const ant of world.ants) {
    if (ant.layer !== "surface") {
      continue;
    }
    if (!isInBounds(ant.pos, bounds, 2)) {
      continue;
    }

    const carrying = ant.state === "carry" || ant.carrying > 0 || !!ant.carryingDebris;
    const color = ant.colonyId === "colony-2" ? "red" : "dark";
    const sprite = acquireSprite(pool);
    sprite.texture = getAntTexture(carrying, color);
    sprite.scale.set(ant.state === "carry" ? 2.8 : 2.45);
    sprite.tint = 0xffffff;
    const rot = antRotation(ant);
    placeSprite(sprite, ant.pos.x * cell, ant.pos.y * cell, rot);

    if (ant.carryingDebris) {
      const hX = Math.cos(rot);
      const hY = Math.sin(rot);
      const offsetDist = cell * 0.7;
      const debrisX = ant.pos.x * cell + hX * offsetDist;
      const debrisY = ant.pos.y * cell + hY * offsetDist;

      if (ant.carryingDebris === "pebble") {
        drawPebble(debrisGraphics, debrisX, debrisY, cell * 0.45, 0xb4b0a6);
      } else {
        drawLeaf(debrisGraphics, debrisX, debrisY, cell * 0.22, rot + Math.PI / 2);
      }
    }
  }

  endPool(pool);
}

export function updateSurfaceDebris(graphics: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  graphics.clear();

  if (!world.surface.debris) {
    return;
  }

  for (const item of world.surface.debris) {
    if (!isInBounds(item.pos, bounds, 3)) {
      continue;
    }

    const x = item.pos.x * cell;
    const y = item.pos.y * cell;

    if (item.type === "pebble") {
      const sizeSeed = Math.sin(item.pos.x * 12.9898 + item.pos.y * 78.233) * 43758.5453;
      const sizeRoll = sizeSeed - Math.floor(sizeSeed);
      const size = cell * (0.6 + sizeRoll * 0.5);
      const shade = sizeRoll > 0.45 ? 0x9c9a91 : 0xb8b5aa;
      drawPebble(graphics, x, y, size, shade);
    } else {
      const rotSeed = Math.sin(item.pos.x * 31.7 + item.pos.y * 127.1) * 43758.5453;
      const rotRoll = rotSeed - Math.floor(rotSeed);
      const rotation = rotRoll * Math.PI * 2;
      const scale = cell * (0.3 + rotRoll * 0.2);
      drawLeaf(graphics, x, y, scale, rotation);
    }
  }
}
