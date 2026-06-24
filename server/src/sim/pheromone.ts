export class PheromoneGrid {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
  private readonly scratch: Float32Array;

  constructor(width: number, height: number, values?: number[]) {
    this.width = width;
    this.height = height;
    this.values = new Float32Array(width * height);
    this.scratch = new Float32Array(width * height);

    if (values) {
      this.values.set(values.slice(0, width * height));
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
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = y * this.width + x;
        const center = this.values[index] * evaporation;
        const left = x > 0 ? this.values[index - 1] : center;
        const right = x < this.width - 1 ? this.values[index + 1] : center;
        const up = y > 0 ? this.values[index - this.width] : center;
        const down = y < this.height - 1 ? this.values[index + this.width] : center;
        const neighborAverage = (left + right + up + down) * 0.25;

        this.scratch[index] = center * (1 - diffusion) + neighborAverage * diffusion;
      }
    }

    this.values.set(this.scratch);
  }

  toArray(): number[] {
    return Array.from(this.values, (value) => Math.round(value * 100) / 100);
  }
}
