import { CONFIG } from "./config";
import { saveWorldSnapshot } from "./state/snapshot";
import { step } from "./sim/step";
import { toSnapshot, type World } from "./sim/world";
import { profiler } from "./utils/profiler";

export type LoopController = {
  setSpeed(speed: number): void;
  getSpeed(): number;
};

export function startLoop(world: World, onSnapshot: (snapshot: ReturnType<typeof toSnapshot>) => void): LoopController {
  let simSpeed = 1;
  let lastPheromoneSentAt = 0;
  let lastSaveAt = Date.now();

  setInterval(() => {
    const now = Date.now();

    // Шлем феромоны по реальному времени (wall-clock) — раз в 1 секунду (1000 мс)
    let includePheromones = false;
    if (now - lastPheromoneSentAt >= 1000) {
      includePheromones = true;
      lastPheromoneSentAt = now;
    }

    // Замеряем суммарное время всех шагов симуляции за этот тик
    profiler.measure("step_total", () => {
      for (let i = 0; i < simSpeed; i += 1) {
        step(world);
      }
    });

    // Автосохранение по реальному времени — раз в 15 секунд (15000 мс)
    if (now - lastSaveAt >= 15000) {
      profiler.measureAsync("saveWorldSnapshot", () => saveWorldSnapshot(world)).catch((error: unknown) => {
        console.warn(`Could not save snapshot: ${(error as Error).message}`);
      });
      lastSaveAt = now;
    }

    // Замеряем время создания снапшота и рассылки по WebSocket
    const snapshot = profiler.measure("toSnapshot", () => toSnapshot(world, includePheromones));
    profiler.measure("broadcast", () => onSnapshot(snapshot));

    // Вывод логов профайлера в консоль раз в 10 секунд
    profiler.reportIfNeeded();
  }, CONFIG.tickMs);

  return {
    setSpeed(speed: number) {
      if (Number.isFinite(speed)) {
        simSpeed = Math.max(1, Math.floor(speed));
      }
    },
    getSpeed() {
      return simSpeed;
    }
  };
}
