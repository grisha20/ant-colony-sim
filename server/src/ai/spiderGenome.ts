import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";

export type SpiderGenomeGenes = {
  aggression: number;
  ambushPreference: number;
  chaseTriggerDist: number;
  swarmCaution: number;
  entranceAffinity: number;
  patience: number;
  hungerAggroGain: number;
};

export type SpiderGenome = {
  id: string;
  generation: number;
  genes: SpiderGenomeGenes;
};

export type SpiderGenomeArchiveEntry = {
  genome: SpiderGenome;
  fitness: number;
};

export type SpiderGenomeState = {
  current: SpiderGenome;
  best: SpiderGenome | null;
  bestFitness: number;
  archive: SpiderGenomeArchiveEntry[];
  generationsRun: number;
};

type SpiderGeneName = keyof SpiderGenomeGenes;

const geneNames: SpiderGeneName[] = [
  "aggression",
  "ambushPreference",
  "chaseTriggerDist",
  "swarmCaution",
  "entranceAffinity",
  "patience",
  "hungerAggroGain"
];

function newSpiderGenomeId(): string {
  return `spider-genome-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampGene(name: SpiderGeneName, value: number): number {
  const bounds = CONFIG.spiderGeneBounds[name];
  const finiteValue = Number.isFinite(value) ? value : (bounds.min + bounds.max) / 2;
  return Math.max(bounds.min, Math.min(bounds.max, finiteValue));
}

function defaultGenes(): SpiderGenomeGenes {
  return {
    aggression: 0.55,
    ambushPreference: 0.35,
    chaseTriggerDist: clampGene("chaseTriggerDist", CONFIG.spiderChaseRange),
    swarmCaution: 4,
    entranceAffinity: 0.2,
    patience: 140,
    hungerAggroGain: 0.45
  };
}

function cloneGenome(genome: SpiderGenome): SpiderGenome {
  return {
    ...genome,
    genes: { ...genome.genes }
  };
}

function normalizeGenome(genome: Partial<SpiderGenome> | null | undefined, fallbackGeneration = 1): SpiderGenome {
  const fallback = defaultGenes();
  const genes = (genome?.genes ?? {}) as Partial<SpiderGenomeGenes>;

  return {
    id: typeof genome?.id === "string" ? genome.id : newSpiderGenomeId(),
    generation: Math.max(1, Math.floor(genome?.generation ?? fallbackGeneration)),
    genes: {
      aggression: clampGene("aggression", Number(genes.aggression ?? fallback.aggression)),
      ambushPreference: clampGene("ambushPreference", Number(genes.ambushPreference ?? fallback.ambushPreference)),
      chaseTriggerDist: clampGene("chaseTriggerDist", Number(genes.chaseTriggerDist ?? fallback.chaseTriggerDist)),
      swarmCaution: clampGene("swarmCaution", Number(genes.swarmCaution ?? fallback.swarmCaution)),
      entranceAffinity: clampGene("entranceAffinity", Number(genes.entranceAffinity ?? fallback.entranceAffinity)),
      patience: clampGene("patience", Number(genes.patience ?? fallback.patience)),
      hungerAggroGain: clampGene("hungerAggroGain", Number(genes.hungerAggroGain ?? fallback.hungerAggroGain))
    }
  };
}

function normalizeArchiveEntry(
  entry: Partial<SpiderGenomeArchiveEntry> | null | undefined
): SpiderGenomeArchiveEntry | null {
  if (!entry?.genome) {
    return null;
  }

  return {
    genome: normalizeGenome(entry.genome),
    fitness: Math.max(0, Number(entry.fitness ?? 0))
  };
}

function sortAndTrimArchive(archive: SpiderGenomeArchiveEntry[]): SpiderGenomeArchiveEntry[] {
  return archive
    .filter((entry) => Number.isFinite(entry.fitness))
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, CONFIG.spiderArchiveSize)
    .map((entry) => ({
      genome: cloneGenome(entry.genome),
      fitness: entry.fitness
    }));
}

function syncBestFromArchive(state: SpiderGenomeState): void {
  const bestEntry = state.archive[0];
  state.best = bestEntry ? cloneGenome(bestEntry.genome) : null;
  state.bestFitness = bestEntry ? bestEntry.fitness : 0;
}

export function randomSpiderGenome(): SpiderGenome {
  const centered = defaultGenes();
  const genes = Object.fromEntries(
    geneNames.map((name) => {
      const bounds = CONFIG.spiderGeneBounds[name];
      const jitter = (Math.random() * 2 - 1) * (bounds.max - bounds.min) * 0.08;
      return [name, clampGene(name, centered[name] + jitter)];
    })
  ) as SpiderGenomeGenes;

  return {
    id: newSpiderGenomeId(),
    generation: 1,
    genes
  };
}

export function mutateSpiderGenome(genome: SpiderGenome, rate = CONFIG.spiderMutationRate): SpiderGenome {
  const genes = Object.fromEntries(
    geneNames.map((name) => {
      const bounds = CONFIG.spiderGeneBounds[name];
      const delta = (bounds.max - bounds.min) * rate * (Math.random() * 2 - 1);
      return [name, clampGene(name, genome.genes[name] + delta)];
    })
  ) as SpiderGenomeGenes;

  return {
    id: newSpiderGenomeId(),
    generation: genome.generation + 1,
    genes
  };
}

export function selectSpiderParent(state: SpiderGenomeState): SpiderGenome {
  if (state.archive.length === 0) {
    return cloneGenome(state.best ?? state.current);
  }

  const tournamentSize = Math.max(1, CONFIG.spiderTournamentSize);
  let winner = state.archive[Math.floor(Math.random() * state.archive.length)];
  for (let index = 1; index < tournamentSize; index += 1) {
    const candidate = state.archive[Math.floor(Math.random() * state.archive.length)];
    if (candidate.fitness > winner.fitness) {
      winner = candidate;
    }
  }

  return cloneGenome(winner.genome);
}

export function recordAndEvolveSpider(
  state: SpiderGenomeState,
  genome: SpiderGenome,
  fitness: number
): SpiderGenome {
  state.archive = sortAndTrimArchive([
    ...state.archive,
    {
      genome: cloneGenome(genome),
      fitness: Math.max(0, fitness)
    }
  ]);
  syncBestFromArchive(state);
  state.current = mutateSpiderGenome(selectSpiderParent(state));
  return state.current;
}

export async function loadSpiderGenome(): Promise<SpiderGenomeState> {
  try {
    const raw = await readFile(CONFIG.spiderGenomeFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<SpiderGenomeState>;
    const archive = sortAndTrimArchive(
      (parsed.archive ?? [])
        .map((entry) => normalizeArchiveEntry(entry))
        .filter((entry): entry is SpiderGenomeArchiveEntry => entry !== null)
    );
    if (archive.length === 0 && parsed.best) {
      archive.push({
        genome: normalizeGenome(parsed.best),
        fitness: Math.max(0, Number(parsed.bestFitness ?? 0))
      });
    }

    const state: SpiderGenomeState = {
      current: normalizeGenome(parsed.current),
      best: null,
      bestFitness: 0,
      archive: sortAndTrimArchive(archive),
      generationsRun: Math.max(0, Math.floor(Number(parsed.generationsRun ?? 0)))
    };
    syncBestFromArchive(state);
    return state;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Could not load spider genome, creating a fresh one: ${(error as Error).message}`);
    }

    const state: SpiderGenomeState = {
      current: randomSpiderGenome(),
      best: null,
      bestFitness: 0,
      archive: [],
      generationsRun: 0
    };
    await saveSpiderGenome(state);
    return state;
  }
}

export async function saveSpiderGenome(state: SpiderGenomeState): Promise<void> {
  state.archive = sortAndTrimArchive(state.archive);
  syncBestFromArchive(state);
  await mkdir(path.dirname(CONFIG.spiderGenomeFile), { recursive: true });
  await writeFile(CONFIG.spiderGenomeFile, JSON.stringify(state, null, 2), "utf8");
}
