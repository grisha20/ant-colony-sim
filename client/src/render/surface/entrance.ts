import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import type { Vec2, WorldSnapshot } from "../../../../shared/types";
import { hash2 } from "./ground";

export function drawSurfaceEntranceAt(root: Container, pos: Vec2, cell: number, color: "dark" | "red", dirtMound = 0): void {
  const x = Math.round(pos.x * cell);
  const y = Math.round(pos.y * cell);
  const entrance = new Graphics();
  const mound = color === "red" ? 0x936245 : 0x8f6a38;
  const moundLight = color === "red" ? 0xbc8a63 : 0xb99155;
  const soil = color === "red" ? 0x6f3a25 : 0x65411e;

  const scale = 1.0 + Math.min(1.8, dirtMound / 400);

  entrance.ellipse(x + 2, y + 13, 40 * scale, 24 * scale).fill({ color: 0x4a2f16, alpha: 0.38 });
  entrance.ellipse(x, y + 10, 32 * scale, 20 * scale).fill({ color: mound, alpha: 0.96 });
  entrance.ellipse(x - 5, y + 9, 24 * scale, 15 * scale).fill({ color: moundLight, alpha: 0.46 });
  entrance.ellipse(x + 7, y + 16, 21 * scale, 9 * scale).fill({ color: soil, alpha: 0.34 });
  entrance.ellipse(x, y + 1, 15, 12).fill(0x1e120c);
  entrance.ellipse(x, y + 3, 10, 8).fill(0x050302);

  const particleCount = Math.round(18 * scale);
  for (let index = 0; index < particleCount; index += 1) {
    const angle = index * 2.399963229728653;
    const radius = (17 + hash2(pos.x + index, pos.y, 40) * 16) * scale;
    const px = x + Math.cos(angle) * radius;
    const py = y + 10 * scale + Math.sin(angle) * radius * 0.48;
    const size = cell * (0.16 + hash2(pos.x, pos.y + index, 41) * 0.34) * (0.8 + scale * 0.2);
    entrance.ellipse(px, py, size, size * 0.62).fill({ color: moundLight, alpha: 0.42 + hash2(index, pos.x, 42) * 0.3 });
  }

  entrance.ellipse(x - 19 * scale, y - 2 * scale, 7 * scale, 4 * scale).fill({ color: mound, alpha: 0.82 });
  entrance.ellipse(x + 18 * scale, y - 1 * scale, 8 * scale, 4 * scale).fill({ color: mound, alpha: 0.74 });
  root.addChild(entrance);
}

export function drawSurfaceEntrance(root: Container, world: WorldSnapshot, cell: number): void {
  const entrances = world.surface.entrances ?? [world.surface.entrance];
  entrances.forEach((entrance, index) => {
    const colony = world.colonies?.[index];
    const dirtMound = colony?.underground?.dirtMound ?? (index === 0 ? world.underground.dirtMound : 0);
    drawSurfaceEntranceAt(root, entrance, cell, index === 1 ? "red" : "dark", dirtMound);
  });
}
