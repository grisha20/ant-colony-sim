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

  report(): void {
    console.log("=== PERFORMANCE REPORT ===");
    const stepTotal = this.stats.step_total;
    const stepTotalMs = stepTotal?.totalMs ?? 0;
    const stepAntTotalMs = this.stats.stepAnt?.totalMs ?? 0;
    const entries = Object.entries(this.stats).sort((a, b) => b[1].totalMs - a[1].totalMs);
    for (const [name, data] of entries) {
      const avg = data.count > 0 ? (data.totalMs / data.count).toFixed(3) : "0.000";
      const share = stepTotalMs > 0 ? ((data.totalMs / stepTotalMs) * 100).toFixed(1) : "0.0";
      const stepAntShare =
        name.startsWith("stepAnt.") && stepAntTotalMs > 0
          ? ` | ${((data.totalMs / stepAntTotalMs) * 100).toFixed(1).padStart(5)}% stepAnt`
          : "";
      console.log(`${name.padEnd(32)} avg ${avg.padStart(7)}ms | ${share.padStart(5)}% step_total${stepAntShare} | total ${data.totalMs.toFixed(1).padStart(7)}ms | count ${data.count}`);
    }
    console.log("==========================");
    this.stats = {};
    this.lastReportTime = Date.now();
  }

  reportIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastReportTime >= 10000) {
      this.report();
    }
  }
}

export const profiler = new Profiler();
