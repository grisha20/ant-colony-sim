import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";

export type Gene = number;

export type GenomeGenes = {
  nurseFraction: Gene;
  digFraction: Gene;
  queenRearBias: Gene;
  forageSpread: Gene;
  spiderAttackStorage: Gene;
  layReserve: Gene;
  refuelThreshold: Gene;
  spiderAvoid: Gene;
  aggression: Gene;
};

export type Genome = {
  id: string;
  generation: number;
  genes: GenomeGenes;
};

export type GenomeArchiveEntry = {
  genome: Genome;
  fitness: number;
};

export type GenomeState = {
  current: Genome;
  best: Genome | null;
  bestFitness: number;
  archive: GenomeArchiveEntry[];
  generationsRun: number;
};

type GeneName = keyof GenomeGenes;

const geneNames: GeneName[] = [
  "nurseFraction",
  "digFraction",
  "queenRearBias",
  "forageSpread",
  "spiderAttackStorage",
  "layReserve",
  "refuelThreshold",
  "spiderAvoid",
  "aggression"
];

function newGenomeId(): string {
  return `genome-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampGene(name: GeneName, value: number): number {
  const bounds = CONFIG.genomeGeneBounds[name];
  const finiteValue = Number.isFinite(value) ? value : (bounds.min + bounds.max) / 2;
  return Math.max(bounds.min, Math.min(bounds.max, finiteValue));
}

function defaultGenes(): GenomeGenes {
  return {
    nurseFraction: clampGene("nurseFraction", CONFIG.maxConcurrentNurses / Math.max(1, CONFIG.startingWorkers + CONFIG.startingEggs)),
    digFraction: clampGene("digFraction", 0.15),
    queenRearBias: clampGene("queenRearBias", 0.6),
    forageSpread: clampGene("forageSpread", CONFIG.randomWander),
    spiderAttackStorage: clampGene("spiderAttackStorage", CONFIG.starveStorageThreshold),
    layReserve: clampGene("layReserve", CONFIG.queenMinFoodReserve),
    refuelThreshold: clampGene("refuelThreshold", CONFIG.refuelEnergyThreshold),
    spiderAvoid: clampGene("spiderAvoid", CONFIG.spiderAvoidRadius),
    aggression: clampGene("aggression", 0.3)
  };
}

function normalizeGenome(genome: Partial<Genome> | null | undefined, fallbackGeneration = 1): Genome {
  const fallback = defaultGenes();
  const genes = (genome?.genes ?? {}) as Partial<GenomeGenes>;

  return {
    id: typeof genome?.id === "string" ? genome.id : newGenomeId(),
    generation: Math.max(1, Math.floor(genome?.generation ?? fallbackGeneration)),
    genes: {
      nurseFraction: clampGene("nurseFraction", Number(genes.nurseFraction ?? fallback.nurseFraction)),
      digFraction: clampGene("digFraction", Number(genes.digFraction ?? fallback.digFraction)),
      queenRearBias: clampGene("queenRearBias", Number(genes.queenRearBias ?? fallback.queenRearBias)),
      forageSpread: clampGene("forageSpread", Number(genes.forageSpread ?? fallback.forageSpread)),
      spiderAttackStorage: clampGene(
        "spiderAttackStorage",
        Number(genes.spiderAttackStorage ?? fallback.spiderAttackStorage)
      ),
      layReserve: clampGene("layReserve", Number(genes.layReserve ?? fallback.layReserve)),
      refuelThreshold: clampGene("refuelThreshold", Number(genes.refuelThreshold ?? fallback.refuelThreshold)),
      spiderAvoid: clampGene("spiderAvoid", Number(genes.spiderAvoid ?? fallback.spiderAvoid)),
      aggression: clampGene("aggression", Number(genes.aggression ?? fallback.aggression))
    }
  };
}

function cloneGenome(genome: Genome): Genome {
  return {
    ...genome,
    genes: { ...genome.genes }
  };
}

function normalizeArchiveEntry(entry: Partial<GenomeArchiveEntry> | null | undefined): GenomeArchiveEntry | null {
  if (!entry?.genome) {
    return null;
  }

  return {
    genome: normalizeGenome(entry.genome),
    fitness: Math.max(0, Number(entry.fitness ?? 0))
  };
}

function sortAndTrimArchive(archive: GenomeArchiveEntry[]): GenomeArchiveEntry[] {
  return archive
    .filter((entry) => Number.isFinite(entry.fitness))
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, CONFIG.genomeArchiveSize)
    .map((entry) => ({
      genome: cloneGenome(entry.genome),
      fitness: entry.fitness
    }));
}

function syncBestFromArchive(state: GenomeState): void {
  const bestEntry = state.archive[0];
  state.best = bestEntry ? cloneGenome(bestEntry.genome) : null;
  state.bestFitness = bestEntry ? bestEntry.fitness : 0;
}

export function randomGenome(): Genome {
  const centered = defaultGenes();
  const genes = Object.fromEntries(
    geneNames.map((name) => {
      const bounds = CONFIG.genomeGeneBounds[name];
      const jitter = (Math.random() * 2 - 1) * (bounds.max - bounds.min) * 0.08;
      return [name, clampGene(name, centered[name] + jitter)];
    })
  ) as GenomeGenes;

  return {
    id: newGenomeId(),
    generation: 1,
    genes
  };
}

export function mutate(genome: Genome, rate = CONFIG.genomeMutationRate): Genome {
  const genes = Object.fromEntries(
    geneNames.map((name) => {
      const value = genome.genes[name];
      const bounds = CONFIG.genomeGeneBounds[name];
      const delta = (bounds.max - bounds.min) * rate * (Math.random() * 2 - 1);
      return [name, clampGene(name, value + delta)];
    })
  ) as GenomeGenes;

  return {
    id: newGenomeId(),
    generation: genome.generation + 1,
    genes
  };
}

export function selectParent(state: GenomeState): Genome {
  if (state.archive.length === 0) {
    return cloneGenome(state.best ?? state.current);
  }

  const tournamentSize = Math.max(1, CONFIG.genomeTournamentSize);
  let winner = state.archive[Math.floor(Math.random() * state.archive.length)];
  for (let index = 1; index < tournamentSize; index += 1) {
    const candidate = state.archive[Math.floor(Math.random() * state.archive.length)];
    if (candidate.fitness > winner.fitness) {
      winner = candidate;
    }
  }

  return cloneGenome(winner.genome);
}

export function recordAndEvolve(state: GenomeState, genome: Genome, fitness: number): Genome {
  state.archive = sortAndTrimArchive([
    ...state.archive,
    {
      genome: cloneGenome(genome),
      fitness: Math.max(0, fitness)
    }
  ]);
  syncBestFromArchive(state);
  state.current = mutate(selectParent(state));
  return state.current;
}

export async function loadGenome(file = CONFIG.genomeFile): Promise<GenomeState> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<GenomeState>;
    const archive = sortAndTrimArchive(
      (parsed.archive ?? [])
        .map((entry) => normalizeArchiveEntry(entry))
        .filter((entry): entry is GenomeArchiveEntry => entry !== null)
    );
    if (archive.length === 0 && parsed.best) {
      archive.push({
        genome: normalizeGenome(parsed.best),
        fitness: Math.max(0, Number(parsed.bestFitness ?? 0))
      });
    }

    const state: GenomeState = {
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
      console.warn(`Could not load genome, creating a fresh one: ${(error as Error).message}`);
    }

    const state: GenomeState = {
      current: randomGenome(),
      best: null,
      bestFitness: 0,
      archive: [],
      generationsRun: 0
    };
    await saveGenome(state, file);
    return state;
  }
}

export async function saveGenome(state: GenomeState, file = CONFIG.genomeFile): Promise<void> {
  state.archive = sortAndTrimArchive(state.archive);
  syncBestFromArchive(state);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf8");
}
