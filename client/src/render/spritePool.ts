import { Container, Sprite } from "pixi.js";
import type { Ant, Vec2 } from "../../../shared/types";
import type { SpriteFactory, SpritePool } from "./types";

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function pheromoneAlpha(value: number): number {
  return Math.max(0, Math.min(0.16, value / 160));
}

export function placeSprite(sprite: Sprite, x: number, y: number, rotation = 0): void {
  sprite.x = Math.round(x);
  sprite.y = Math.round(y);
  sprite.rotation = rotation;
}

export function antRotation(ant: Ant): number {
  return Math.atan2(ant.heading.y, ant.heading.x);
}

export function deterministicOffset(index: number, radius: number): Vec2 {
  const angle = index * 2.39996323;
  const distance = radius * (0.35 + ((index * 37) % 100) / 155);
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance
  };
}

export function createSpritePool(container: Container, factory: SpriteFactory): SpritePool {
  return {
    container,
    cursor: 0,
    sprites: [],
    factory
  };
}

export function beginPool(pool: SpritePool): void {
  pool.cursor = 0;
}

export function acquireSprite(pool: SpritePool): Sprite {
  let sprite = pool.sprites[pool.cursor];
  if (!sprite) {
    sprite = pool.factory();
    pool.sprites.push(sprite);
    pool.container.addChild(sprite);
  }

  pool.cursor += 1;
  sprite.visible = true;
  return sprite;
}

export function endPool(pool: SpritePool): void {
  for (let index = pool.cursor; index < pool.sprites.length; index += 1) {
    pool.sprites[index].visible = false;
  }
}

export function fitRoot(root: Container, viewportWidth: number, viewportHeight: number, designWidth: number, designHeight: number): void {
  const padding = 18;
  const scale = Math.max(0.1, Math.min((viewportWidth - padding * 2) / designWidth, (viewportHeight - padding * 2) / designHeight));
  root.scale.set(scale);
  root.x = Math.round((viewportWidth - designWidth * scale) * 0.5);
  root.y = Math.round((viewportHeight - designHeight * scale) * 0.5);
}
