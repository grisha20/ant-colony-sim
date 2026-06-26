import type { Vec2, WorldSnapshot } from "../../../../shared/types";
import { clamp01 } from "../spritePool";
import { UNDERGROUND_WIDTH, UNDERGROUND_HEIGHT, undergroundLayout } from "../types";

export function undergroundToScreen(world: WorldSnapshot, pos: Vec2): Vec2 {
  const xRange = UNDERGROUND_WIDTH - undergroundLayout.marginX * 2;
  const yTop = undergroundLayout.surfaceY;
  const yRange = UNDERGROUND_HEIGHT - yTop - undergroundLayout.bottomPadding;

  return {
    x: undergroundLayout.marginX + clamp01(pos.x / world.underground.width) * xRange,
    y: yTop + clamp01(pos.y / world.underground.height) * yRange
  };
}

export function undergroundGridMetrics(world: WorldSnapshot): { x: number; y: number; cellWidth: number; cellHeight: number } {
  const xRange = UNDERGROUND_WIDTH - undergroundLayout.marginX * 2;
  const yTop = undergroundLayout.surfaceY;
  const yRange = UNDERGROUND_HEIGHT - yTop - undergroundLayout.bottomPadding;
  return {
    x: undergroundLayout.marginX,
    y: yTop,
    cellWidth: xRange / world.underground.width,
    cellHeight: yRange / world.underground.height
  };
}

export function undergroundTileAt(world: WorldSnapshot, pos: Vec2): string | undefined {
  const x = Math.max(0, Math.min(world.underground.width - 1, Math.floor(pos.x)));
  const y = Math.max(0, Math.min(world.underground.height - 1, Math.floor(pos.y)));
  return world.underground.grid[y]?.[x]?.type;
}

export function isDugUndergroundPos(world: WorldSnapshot, pos: Vec2): boolean {
  const type = undergroundTileAt(world, pos);
  return type === "tunnel" || type === "chamber" || type === "entrance";
}

export function hasUndergroundRoom(world: WorldSnapshot, type: string): boolean {
  return world.underground.rooms.some((room) => room.type === type);
}

export function undergroundEntranceTop(world: WorldSnapshot): Vec2 {
  const entrance = undergroundToScreen(world, world.underground.entrance);
  return {
    x: entrance.x,
    y: undergroundLayout.surfaceY
  };
}
