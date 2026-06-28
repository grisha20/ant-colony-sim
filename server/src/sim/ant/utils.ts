import type { Ant, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { randomHeading } from "../world";

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function isWithinRadius(a: Vec2, b: Vec2, radius: number): boolean {
  return distanceSq(a, b) <= radius * radius;
}

export function normalize(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.y);
  if (length <= 0.001) {
    return randomHeading();
  }

  return { x: vec.x / length, y: vec.y / length };
}

export function fanDirection(base: Vec2, id: string): Vec2 {
  const numericId = Number(id.replace("ant-", ""));
  const slot = Number.isFinite(numericId) ? numericId % 7 : 0;
  const angle = (slot - 3) * 0.24;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return normalize({
    x: base.x * cos - base.y * sin,
    y: base.x * sin + base.y * cos
  });
}

export function numericAntId(id: string): number {
  const numericId = Number(id.replace("ant-", ""));
  return Number.isFinite(numericId) ? numericId : 0;
}

export function moveToward(ant: Ant, target: Vec2, speed: number): void {
  const direction = normalize({ x: target.x - ant.pos.x, y: target.y - ant.pos.y });
  ant.heading = direction;
  ant.pos.x += direction.x * speed;
  ant.pos.y += direction.y * speed;
}

export function posTile(pos: Vec2): Vec2 {
  return {
    x: Math.max(0, Math.min(CONFIG.undergroundWidth - 1, Math.floor(pos.x))),
    y: Math.max(0, Math.min(CONFIG.undergroundHeight - 1, Math.floor(pos.y)))
  };
}

export function tileKey(tile: Vec2): string {
  return `${tile.x}:${tile.y}`;
}
