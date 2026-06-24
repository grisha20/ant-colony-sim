import type { Colony } from "../../../shared/types";
import { CONFIG } from "../config";

export function createColony(
  generation: number,
  generationsRun: number,
  bestFitness: number,
  spiderGeneration: number,
  spiderGenerationsRun: number
): Colony {
  return {
    id: "colony-1",
    food: CONFIG.startingFoodStorage,
    population: {
      workers: CONFIG.startingWorkers,
      eggs: CONFIG.startingEggs,
      larvae: CONFIG.startingLarvae
    },
    queenAlive: true,
    nestCapacity: CONFIG.nestCapacity,
    detailLevel: "full",
    generation,
    generationsRun,
    bestFitness,
    spiderGeneration,
    spiderGenerationsRun
  };
}

export function syncColonyStats(
  colony: Colony,
  workerCount: number,
  eggCount: number,
  larvaCount: number,
  foodStorage: number,
  queenAlive: boolean,
  bestFitness: number,
  spiderGeneration: number,
  generationsRun: number,
  spiderGenerationsRun: number
): void {
  colony.food = foodStorage;
  colony.population.workers = workerCount;
  colony.population.eggs = eggCount;
  colony.population.larvae = larvaCount;
  colony.queenAlive = queenAlive;
  colony.bestFitness = bestFitness;
  colony.spiderGeneration = spiderGeneration;
  colony.generationsRun = generationsRun;
  colony.spiderGenerationsRun = spiderGenerationsRun;
}
