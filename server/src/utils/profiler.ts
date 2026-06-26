class Profiler {
  private stats: Record<string, { totalMs: number; count: number }> = {};
  private lastReportTime = Date.now();

  measure<T>(name: string, fn: () => T): T {
    const start = performance.now();
    const res = fn();
    const duration = performance.now() - start;
    if (!this.stats[name]) {
      this.stats[name] = { totalMs: 0, count: 0 };
    }
    this.stats[name].totalMs += duration;
    this.stats[name].count += 1;
    return res;
  }

  async measureAsync(name: string, fn: () => Promise<void>): Promise<void> {
    const start = performance.now();
    try {
      await fn();
    } finally {
      const duration = performance.now() - start;
      if (!this.stats[name]) {
        this.stats[name] = { totalMs: 0, count: 0 };
      }
      this.stats[name].totalMs += duration;
      this.stats[name].count += 1;
    }
  }

  reportIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastReportTime >= 10000) {
      console.log("=== PERFORMANCE REPORT ===");
      for (const [name, data] of Object.entries(this.stats)) {
        const avg = data.count > 0 ? (data.totalMs / data.count).toFixed(3) : "0.000";
        console.log(`${name.padEnd(25)}: avg ${avg.padStart(7)}ms (total ${data.totalMs.toFixed(1).padStart(7)}ms, count ${data.count})`);
      }
      console.log("==========================");
      this.stats = {};
      this.lastReportTime = now;
    }
  }
}

export const profiler = new Profiler();
