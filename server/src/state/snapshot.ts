import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";
import type { GenomeState } from "../ai/genome";
import type { SpiderGenomeState } from "../ai/spiderGenome";
import { toDurableSnapshot, worldFromSnapshot, type World } from "../sim/world";
import type { WorldSnapshot } from "../../../shared/types";

export async function loadWorldSnapshot(
  genomeState: GenomeState,
  spiderGenomeState: SpiderGenomeState,
  genomeStateB: GenomeState = genomeState
): Promise<World | null> {
  try {
    const raw = await readFile(CONFIG.snapshotFile, "utf8");
    const snapshot = JSON.parse(raw) as WorldSnapshot;
    return worldFromSnapshot(snapshot, genomeState, spiderGenomeState, genomeStateB);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }

    console.warn(`Could not load snapshot, starting fresh: ${(error as Error).message}`);
    return null;
  }
}

let isSaving = false;

export async function saveWorldSnapshot(world: World): Promise<void> {
  if (isSaving) {
    return;
  }
  isSaving = true;
  try {
    await mkdir(path.dirname(CONFIG.snapshotFile), { recursive: true });
    await writeFile(CONFIG.snapshotFile, JSON.stringify(toDurableSnapshot(world)), "utf8");
  } finally {
    isSaving = false;
  }
}
