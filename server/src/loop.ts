import { CONFIG } from "./config";
import { saveWorldSnapshot } from "./state/snapshot";
import { step } from "./sim/step";
import { toSnapshot, type World } from "./sim/world";

export function startLoop(world: World, onSnapshot: (snapshot: ReturnType<typeof toSnapshot>) => void): void {
  setInterval(() => {
    step(world);
    const includePheromones = world.tick % CONFIG.pheromoneSendEveryTicks === 0;
    const snapshot = toSnapshot(world, includePheromones);
    onSnapshot(snapshot);

    if (world.tick % CONFIG.snapshotSaveEveryTicks === 0) {
      saveWorldSnapshot(world).catch((error: unknown) => {
        console.warn(`Could not save snapshot: ${(error as Error).message}`);
      });
    }
  }, CONFIG.tickMs);
}
