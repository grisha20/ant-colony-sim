import { Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { UNDERGROUND_WIDTH, UNDERGROUND_HEIGHT, SHOW_UNDERGROUND_DEBUG, undergroundLayout } from "../types";
import { undergroundEntranceTop, undergroundGridMetrics } from "./utils";

export function drawUndergroundEarth(earth: Graphics): void {
  earth.rect(0, 0, UNDERGROUND_WIDTH, UNDERGROUND_HEIGHT).fill(0x5a3a1a);
  earth.rect(0, 0, UNDERGROUND_WIDTH, undergroundLayout.surfaceY).fill(0x9fb86b);
  earth.rect(0, undergroundLayout.surfaceY - 16, UNDERGROUND_WIDTH, 16).fill(0x5f422b);

  for (let y = 0; y < UNDERGROUND_HEIGHT; y += 8) {
    for (let x = 0; x < UNDERGROUND_WIDTH; x += 8) {
      const noise = (x * 13 + y * 23 + ((x + y) % 17)) % 11;
      if (y < undergroundLayout.surfaceY - 16) {
        earth.rect(x, y, 8, 8).fill(noise < 4 ? 0x8faa59 : 0xa8bf75);
      } else if (noise < 2) {
        earth.rect(x, y, 8, 8).fill(0x4e3117);
      } else if (noise > 8) {
        earth.rect(x, y, 8, 8).fill(0x64411e);
      }
    }
  }
}

export function drawUndergroundGrid(grid: Graphics, world: WorldSnapshot): void {
  const entranceTop = undergroundEntranceTop(world);
  const metrics = undergroundGridMetrics(world);

  for (let y = 0; y < world.underground.grid.length; y += 1) {
    const row = world.underground.grid[y];
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x];
      const screenX = metrics.x + x * metrics.cellWidth;
      const screenY = metrics.y + y * metrics.cellHeight;
      const width = Math.ceil(metrics.cellWidth) + 1;
      const height = Math.ceil(metrics.cellHeight) + 1;
      if (tile.type === "soil") {
        grid.rect(screenX, screenY, width, height).fill({
          color: tile.digProgress ? 0x6f4a30 : 0x5a3a1a,
          alpha: tile.digProgress ? 0.62 + Math.min(0.28, (tile.digProgress ?? 0) / 24) : 0.76
        });
      } else if (tile.type === "entrance") {
        grid.rect(screenX, screenY, width, height).fill(0x1b1009);
      } else {
        const color = tile.type === "chamber" ? 0xa08030 : 0x8b6914;
        grid.rect(screenX, screenY, width, height).fill(color);
      }
    }
  }

  if (SHOW_UNDERGROUND_DEBUG) {
    for (const task of world.underground.digTasks) {
      if (task.status === "done") {
        continue;
      }

      const color = task.status === "active" ? 0xf1c56a : 0xd9a86a;
      for (const tile of task.targetTiles) {
        if (world.underground.grid[tile.y]?.[tile.x]?.type !== "soil") {
          continue;
        }

        grid.rect(
          metrics.x + tile.x * metrics.cellWidth,
          metrics.y + tile.y * metrics.cellHeight,
          Math.ceil(metrics.cellWidth),
          Math.ceil(metrics.cellHeight)
        ).fill({ color, alpha: task.status === "active" ? 0.18 : 0.08 });
      }
    }
  }

  grid.ellipse(entranceTop.x, entranceTop.y, 24, 10).fill(0x2d1b12);
  grid.ellipse(entranceTop.x, entranceTop.y + 2, 14, 7).fill(0x100a07);
}
