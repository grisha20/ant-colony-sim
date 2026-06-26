import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import type { ViewBounds } from "../types";

export function hash2(x: number, y: number, salt = 0): number {
  const value = Math.sin((x * 127.1 + y * 311.7 + salt * 74.7) * 0.0174533) * 43758.5453123;
  return value - Math.floor(value);
}

export function drawPebble(root: Graphics, x: number, y: number, size: number, shade: number): void {
  root.ellipse(x + size * 0.18, y + size * 0.22, size * 0.62, size * 0.45).fill({ color: 0x2f2923, alpha: 0.42 });
  root.ellipse(x, y, size * 0.68, size * 0.5).fill(shade);
  root.ellipse(x - size * 0.18, y - size * 0.16, size * 0.22, size * 0.13).fill({ color: 0xe0dcd1, alpha: 0.48 });
  root.ellipse(x + size * 0.22, y + size * 0.12, size * 0.28, size * 0.16).fill({ color: 0x69655f, alpha: 0.72 });
}

function drawGrassTuft(root: Graphics, x: number, y: number, scale: number, rotation: number): void {
  const colors = [0x1f5d31, 0x2f7b3d, 0x184b27];
  root.setStrokeStyle({ width: Math.max(1, scale * 0.55), color: colors[Math.floor(hash2(x, y, 4) * colors.length)], alpha: 0.95 });
  for (let blade = -2; blade <= 2; blade += 1) {
    const angle = rotation + blade * 0.42;
    const length = scale * (4.2 + hash2(x + blade, y, 5) * 3.6);
    root.moveTo(x, y);
    root.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
  }
  root.stroke();
}

export function drawLeaf(root: Graphics, x: number, y: number, scale: number, rotation: number): void {
  const dx = Math.cos(rotation);
  const dy = Math.sin(rotation);
  const color = hash2(x, y, 7) > 0.5 ? 0x7a6b24 : 0x3f7a2d;
  root.ellipse(x, y, scale * 2.7, scale * 1.05).fill({ color, alpha: 0.9 });
  root.setStrokeStyle({ width: 1, color: 0x2f3f1c, alpha: 0.5 });
  root.moveTo(x - dx * scale * 2.2, y - dy * scale * 2.2);
  root.lineTo(x + dx * scale * 2.2, y + dy * scale * 2.2);
  root.stroke();
}

function drawCrack(root: Graphics, x: number, y: number, scale: number): void {
  root.setStrokeStyle({ width: 1, color: 0x3b2816, alpha: 0.62 });
  root.moveTo(x, y);
  let cx = x;
  let cy = y;
  for (let step = 0; step < 4; step += 1) {
    cx += (hash2(x + step, y, 8) - 0.45) * scale * 4;
    cy += scale * (1.2 + hash2(x, y + step, 9) * 2);
    root.lineTo(cx, cy);
  }
  root.moveTo(x + scale * 1.2, y + scale * 2.2);
  root.lineTo(x + scale * (3 + hash2(x, y, 10) * 3), y + scale * (1.5 + hash2(x, y, 11) * 2));
  root.stroke();
}

export function drawSurfaceGround(root: Container, width: number, height: number, cell: number, bounds: ViewBounds): void {
  const bg = new Graphics();
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(width, Math.ceil(bounds.right));
  const top = Math.max(0, Math.floor(bounds.top));
  const bottom = Math.min(height, Math.ceil(bounds.bottom));
  bg.rect(left * cell, top * cell, (right - left) * cell, (bottom - top) * cell).fill(0x8a672f);

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const noise = hash2(x, y, 1);
      const speckle = hash2(x, y, 2);
      const color = noise < 0.18 ? 0x755222 : noise > 0.82 ? 0x9b783d : speckle > 0.92 ? 0xb09358 : 0x8a672f;
      bg.rect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell), Math.ceil(cell)).fill(color);
      if (speckle > 0.965) {
        bg.rect(Math.round((x + 0.35) * cell), Math.round((y + 0.35) * cell), Math.max(1, Math.ceil(cell * 0.25)), Math.max(1, Math.ceil(cell * 0.25))).fill(0xc1b07a);
      } else if (speckle < 0.035) {
        bg.rect(Math.round((x + 0.45) * cell), Math.round((y + 0.45) * cell), Math.max(1, Math.ceil(cell * 0.2)), Math.max(1, Math.ceil(cell * 0.2))).fill(0x4f3518);
      }
    }
  }

  const decor = new Graphics();
  const chunkLeft = Math.floor(left / 8) * 8;
  const chunkRight = Math.ceil(right / 8) * 8;
  const chunkTop = Math.floor(top / 8) * 8;
  const chunkBottom = Math.ceil(bottom / 8) * 8;
  for (let gy = chunkTop; gy <= chunkBottom; gy += 8) {
    for (let gx = chunkLeft; gx <= chunkRight; gx += 8) {
      const roll = hash2(gx, gy, 20);
      const x = (gx + 1 + hash2(gx, gy, 21) * 6) * cell;
      const y = (gy + 1 + hash2(gx, gy, 22) * 6) * cell;
      if (x < left * cell - 24 || x > right * cell + 24 || y < top * cell - 24 || y > bottom * cell + 24) {
        continue;
      }
      if (roll > 0.86 && roll <= 0.93) {
        drawGrassTuft(decor, x, y, cell * (0.55 + hash2(gx, gy, 25) * 0.55), hash2(gx, gy, 26) * Math.PI * 2);
      } else if (roll < 0.035) {
        drawCrack(decor, x, y, cell * (0.45 + hash2(gx, gy, 29) * 0.55));
      }
    }
  }

  const grid = new Graphics();
  if (cell >= 7) {
    grid.setStrokeStyle({ width: 1, color: 0x5e441f, alpha: 0.08 });
    for (let line = Math.floor(left / 10) * 10; line <= right; line += 10) {
      const p = Math.round(line * cell);
      grid.moveTo(p, top * cell);
      grid.lineTo(p, bottom * cell);
    }
    for (let line = Math.floor(top / 10) * 10; line <= bottom; line += 10) {
      const p = Math.round(line * cell);
      grid.moveTo(left * cell, p);
      grid.lineTo(right * cell, p);
    }
    grid.stroke();
  }

  root.addChild(bg, decor, grid);
}
