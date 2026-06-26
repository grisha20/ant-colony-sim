import type { SparseGrid } from "../../../shared/types";

type PheromoneValues = number[] | SparseGrid;

export class PheromoneGrid {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
  private readonly scratch: Float32Array;

  constructor(width: number, height: number, values?: PheromoneValues) {
    this.width = width;
    this.height = height;
    this.values = new Float32Array(width * height);
    this.scratch = new Float32Array(width * height);

    if (Array.isArray(values)) {
      this.values.set(values.slice(0, width * height));
    } else if (values?.i && values?.v) {
      const len = Math.min(values.i.length, values.v.length);
      for (let index = 0; index < len; index += 1) {
        const gridIndex = values.i[index];
        if (gridIndex >= 0 && gridIndex < this.values.length) {
          this.values[gridIndex] = values.v[index];
        }
      }
    }
  }

  index(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(this.height - 1, Math.floor(y)));
    return cy * this.width + cx;
  }

  get(x: number, y: number): number {
    return this.values[this.index(x, y)] ?? 0;
  }

  add(x: number, y: number, amount: number): void {
    const index = this.index(x, y);
    this.values[index] = Math.min(255, this.values[index] + amount);
  }

  getInterpolated(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);

    const cx0 = Math.max(0, Math.min(this.width - 1, x0));
    const cy0 = Math.max(0, Math.min(this.height - 1, y0));
    const cx1 = Math.max(0, Math.min(this.width - 1, x0 + 1));
    const cy1 = Math.max(0, Math.min(this.height - 1, y0 + 1));

    const tx = x - x0;
    const ty = y - y0;

    const val00 = this.values[cy0 * this.width + cx0];
    const val10 = this.values[cy0 * this.width + cx1];
    const val01 = this.values[cy1 * this.width + cx0];
    const val11 = this.values[cy1 * this.width + cx1];

    const val0 = val00 * (1 - tx) + val10 * tx;
    const val1 = val01 * (1 - tx) + val11 * tx;

    return val0 * (1 - ty) + val1 * ty;
  }

  sampleGradient(x: number, y: number): { x: number; y: number; strength: number } {
    const left = this.getInterpolated(x - 1, y);
    const right = this.getInterpolated(x + 1, y);
    const up = this.getInterpolated(x, y - 1);
    const down = this.getInterpolated(x, y + 1);
    const gx = right - left;
    const gy = down - up;
    const strength = Math.hypot(gx, gy);

    if (strength <= 0.001) {
      return { x: 0, y: 0, strength: 0 };
    }

    return { x: gx / strength, y: gy / strength, strength };
  }

  evaporateAndDiffuse(evaporation: number, diffusion: number): void {
    const w = this.width;
    const h = this.height;
    const vals = this.values;
    const scr = this.scratch;

    // 1. Быстрый проход по внутренним ячейкам (без проверок границ)
    for (let y = 1; y < h - 1; y += 1) {
      const rowOffset = y * w;
      for (let x = 1; x < w - 1; x += 1) {
        const index = rowOffset + x;
        const center = vals[index] * evaporation;
        const left = vals[index - 1];
        const right = vals[index + 1];
        const up = vals[index - w];
        const down = vals[index + w];
        const neighborAverage = (left + right + up + down) * 0.25;

        scr[index] = center * (1 - diffusion) + neighborAverage * diffusion;
      }
    }

    // 2. Обработка границ с проверками
    // Верхняя граница (y = 0)
    for (let x = 0; x < w; x += 1) {
      const index = x;
      const center = vals[index] * evaporation;
      const left = x > 0 ? vals[index - 1] : center;
      const right = x < w - 1 ? vals[index + 1] : center;
      const up = center;
      const down = h > 1 ? vals[index + w] : center;
      const neighborAverage = (left + right + up + down) * 0.25;
      scr[index] = center * (1 - diffusion) + neighborAverage * diffusion;
    }

    // Нижняя граница (y = h - 1)
    if (h > 1) {
      const rowOffset = (h - 1) * w;
      for (let x = 0; x < w; x += 1) {
        const index = rowOffset + x;
        const center = vals[index] * evaporation;
        const left = x > 0 ? vals[index - 1] : center;
        const right = x < w - 1 ? vals[index + 1] : center;
        const up = vals[index - w];
        const down = center;
        const neighborAverage = (left + right + up + down) * 0.25;
        scr[index] = center * (1 - diffusion) + neighborAverage * diffusion;
      }
    }

    // Левая граница (x = 0, y = 1..h-2)
    for (let y = 1; y < h - 1; y += 1) {
      const index = y * w;
      const center = vals[index] * evaporation;
      const left = center;
      const right = w > 1 ? vals[index + 1] : center;
      const up = vals[index - w];
      const down = vals[index + w];
      const neighborAverage = (left + right + up + down) * 0.25;
      scr[index] = center * (1 - diffusion) + neighborAverage * diffusion;
    }

    // Правая граница (x = w - 1, y = 1..h-2)
    if (w > 1) {
      for (let y = 1; y < h - 1; y += 1) {
        const index = y * w + (w - 1);
        const center = vals[index] * evaporation;
        const left = vals[index - 1];
        const right = center;
        const up = vals[index - w];
        const down = vals[index + w];
        const neighborAverage = (left + right + up + down) * 0.25;
        scr[index] = center * (1 - diffusion) + neighborAverage * diffusion;
      }
    }

    vals.set(scr);
  }

  toSparse(): SparseGrid {
    const indices: number[] = [];
    const values: number[] = [];
    const vals = this.values;
    const len = vals.length;
    for (let i = 0; i < len; i += 1) {
      const val = vals[i];
      if (val > 0.01) {
        indices.push(i);
        values.push(Math.round(val * 100) / 100);
      }
    }
    return { i: indices, v: values };
  }

  toArray(): number[] {
    return Array.from(this.values, (value) => Math.round(value * 100) / 100);
  }
}
