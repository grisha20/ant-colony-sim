import { CONFIG } from "./config";
import { saveWorldSnapshot } from "./state/snapshot";
import { step } from "./sim/step";
import { toSnapshot, type World } from "./sim/world";

export type LoopController = {
  setSpeed(speed: number): void;
  getSpeed(): number;
};

export function startLoop(world: World, onSnapshot: (snapshot: ReturnType<typeof toSnapshot>) => void): LoopController {
  let simSpeed = 1;

  setInterval(() => {
    let includePheromones = false;

    for (let i = 0; i < simSpeed; i += 1) {
      step(world);
      includePheromones ||= world.tick % CONFIG.pheromoneSendEveryTicks === 0;

      if (world.tick % CONFIG.snapshotSaveEveryTicks === 0) {
        saveWorldSnapshot(world).catch((error: unknown) => {
          console.warn(`Could not save snapshot: ${(error as Error).message}`);
        });
      }
    }

    const snapshot = toSnapshot(world, includePheromones);
    onSnapshot(snapshot);
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
