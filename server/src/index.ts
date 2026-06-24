import { CONFIG } from "./config";
import { loadGenome } from "./ai/genome";
import { loadSpiderGenome } from "./ai/spiderGenome";
import { createSocketHub } from "./net/socket";
import { loadWorldSnapshot, saveWorldSnapshot } from "./state/snapshot";
import { addFoodSource, createWorld, toSnapshot } from "./sim/world";
import { startLoop, type LoopController } from "./loop";

const genomeState = await loadGenome();
const spiderGenomeState = await loadSpiderGenome();
const loadedWorld = await loadWorldSnapshot(genomeState, spiderGenomeState);
const world = loadedWorld ?? createWorld(genomeState, spiderGenomeState);

let loop: LoopController;
const hub = createSocketHub(CONFIG.wsPort, () => toSnapshot(world), (command) => {
  if (command.type === "dropFood") {
    addFoodSource(world, command.x, command.y, CONFIG.playerFoodAmount);
  }
  if (command.type === "setSpeed") {
    loop.setSpeed(Math.max(1, Math.min(50, Math.floor(command.value))));
  }
});
loop = startLoop(world, (snapshot) => hub.broadcast(snapshot));

process.on("SIGINT", () => {
  saveWorldSnapshot(world)
    .catch((error: unknown) => {
      console.warn(`Could not save snapshot on exit: ${(error as Error).message}`);
    })
    .finally(() => {
      hub.close();
      process.exit(0);
    });
});
