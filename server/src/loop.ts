import { CONFIG } from "./config";
import { saveWorldSnapshot } from "./state/snapshot";
import { step } from "./sim/step";
import type { World } from "./sim/world";
import { profiler } from "./utils/profiler";

export type LoopController = {
  setSpeed(speed: number): void;
  getSpeed(): number;
};

export function startLoop(world: World, onSnapshot: (includePheromones: boolean) => void): LoopController {
  let simSpeed = 1;
  let lastPheromoneSentAt = 0;
  let lastSaveAt = Date.now();
  let timerId: NodeJS.Timeout | null = null;

  function runTick() {
    const now = Date.now();

    // Рассчитываем целевое время тика и количество шагов на основе текущей simSpeed
    const targetTickMs = simSpeed === 1 ? CONFIG.tickMs : Math.max(20, Math.floor(CONFIG.tickMs / simSpeed));
    const stepsPerTick = simSpeed === 1 ? 1 : Math.max(1, Math.round(simSpeed / (CONFIG.tickMs / targetTickMs)));

    // Шлем феромоны по реальному времени (wall-clock) — раз в 1 секунду (1000 мс)
    let includePheromones = false;
    if (now - lastPheromoneSentAt >= 1000) {
      includePheromones = true;
      lastPheromoneSentAt = now;
    }

    // Замеряем суммарное время всех шагов симуляции за этот тик
    profiler.measure("step_total", () => {
      for (let i = 0; i < stepsPerTick; i += 1) {
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

    // Snapshot собирается внутри hub под view state каждого клиента.
    profiler.measure("broadcast", () => onSnapshot(includePheromones));

    // Вывод логов профайлера в консоль раз в 10 секунд
    profiler.reportIfNeeded();

    // Планируем следующий тик с компенсацией времени вычислений
    const elapsed = Date.now() - now;
    const delay = Math.max(1, targetTickMs - elapsed);
    timerId = setTimeout(runTick, delay);
  }

  // Запуск первого тика
  timerId = setTimeout(runTick, CONFIG.tickMs);

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
