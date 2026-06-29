import type { Vec2 } from "../../../shared/types";

export type Positioned = {
  pos: Vec2;
};

const CELL_KEY_OFFSET = 8192;
const CELL_KEY_STRIDE = 16384;
const DEV_MODE = process.env.NODE_ENV !== "production";

// Invariant: queryInto clears and fills the caller-provided result array.
// Do not call queryInto with the same scratch array while a consumer is still iterating its previous result.
export class SpatialGrid<T extends Positioned> {
  private readonly cells = new Map<number, T[]>();
  private filling = false;

  constructor(private readonly cellSize: number) {}

  rebuild(items: T[]): void {
    this.cells.clear();
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const key = this.keyFor(item.pos.x, item.pos.y);
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push(item);
    }
  }

  query(pos: Vec2, radius: number): T[] {
    const result: T[] = [];
    return this.queryInto(pos, radius, result);
  }

  queryInto(pos: Vec2, radius: number, result: T[]): T[] {
    if (DEV_MODE && this.filling) {
      throw new Error("SpatialGrid.queryInto re-entered while filling a result buffer.");
    }

    if (DEV_MODE) {
      this.filling = true;
    }

    try {
      result.length = 0;
      const minX = Math.floor((pos.x - radius) / this.cellSize);
      const maxX = Math.floor((pos.x + radius) / this.cellSize);
      const minY = Math.floor((pos.y - radius) / this.cellSize);
      const maxY = Math.floor((pos.y + radius) / this.cellSize);

      for (let cy = minY; cy <= maxY; cy += 1) {
        for (let cx = minX; cx <= maxX; cx += 1) {
          const bucket = this.cells.get(this.key(cx, cy));
          if (!bucket) {
            continue;
          }
          for (let i = 0; i < bucket.length; i += 1) {
            result.push(bucket[i]);
          }
        }
      }

      return result;
    } finally {
      if (DEV_MODE) {
        this.filling = false;
      }
    }
  }

  private keyFor(x: number, y: number): number {
    return this.key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
  }

  private key(x: number, y: number): number {
    return (x + CELL_KEY_OFFSET) * CELL_KEY_STRIDE + (y + CELL_KEY_OFFSET);
  }
}
