import type { Ant, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { tickCache } from "../cache";
import type { World } from "../world";

export function queenGuardIds(world: World): Set<string> {
  return tickCache.queenGuardIds;
}

function surfaceFoodValue(source: { amount: number; kind?: string }): number {
  if (source.kind === "antCorpse") {
    return source.amount * 0.15;
  }
  if (source.kind === "carrion") {
    return source.amount * 0.35;
  }
  return source.amount;
}

export function surfaceFoodTotal(world: World): number {
  return [...world.surface.foodSources, ...world.surface.carrion].reduce((total, source) => total + Math.max(0, surfaceFoodValue(source)), 0);
}

export function isColonyStarving(world: World): boolean {
  return surfaceFoodTotal(world) <= CONFIG.starveFoodThreshold && world.underground.foodStorage <= world.directives.spiderAttackStorage;
}

export function isColonyWarHungry(world: World): boolean {
  return surfaceFoodTotal(world) <= CONFIG.starveFoodThreshold && world.underground.foodStorage <= CONFIG.warHungerThreshold;
}

export function hasAvailableSurfaceFood(world: World): boolean {
  return world.surface.foodSources.some((source) => source.amount > 0) || world.surface.carrion.some((source) => source.amount > 0);
}

export function canUseStorageMeal(world: World, ignoreSurfaceFood = false): boolean {
  return (ignoreSurfaceFood || !hasAvailableSurfaceFood(world)) && world.underground.foodStorage >= CONFIG.workerMealCost;
}

export function maybeFeedUndergroundAnt(world: World, ant: Ant, ignoreSurfaceFood = false): boolean {
  if (ant.energy >= world.directives.refuelThreshold || !canUseStorageMeal(world, ignoreSurfaceFood)) {
    return false;
  }

  world.underground.foodStorage -= CONFIG.workerMealCost;
  ant.energy = CONFIG.maxEnergy;
  return true;
}

export function activeSurfaceForagers(world: World): number {
  return tickCache.activeForagers;
}

export function countActiveAndTransitioningForagers(world: World): number {
  let count = 0;
  const len = world.ants.length;
  for (let i = 0; i < len; i += 1) {
    const ant = world.ants[i];
    if (ant.state === "dead") {
      continue;
    }
    if (ant.layer === "surface") {
      if (ant.state === "search" && ant.carrying <= 0 && ant.job !== "nurse" && ant.job !== "dig") {
        count += 1;
      }
    } else {
      if (ant.state === "toEntrance") {
        count += 1;
      }
    }
  }
  return count;
}

export function countUndergroundNurses(world: World): number {
  let count = 0;
  const len = world.ants.length;
  for (let i = 0; i < len; i += 1) {
    const ant = world.ants[i];
    if (ant.state === "dead") {
      continue;
    }
    if (ant.layer === "underground" && (ant.state === "carryBrood" || ant.state === "feed")) {
      count += 1;
    }
  }
  return count;
}

export function countUndergroundDiggers(world: World): number {
  let count = 0;
  const len = world.ants.length;
  for (let i = 0; i < len; i += 1) {
    const ant = world.ants[i];
    if (ant.state === "dead") {
      continue;
    }
    if (ant.layer === "underground" && (ant.state === "dig" || ant.state === "carryDirt" || ant.carryingDirt)) {
      count += 1;
    }
  }
  return count;
}

export function shouldReturnFromSurface(world: World, ant: Ant): boolean {
  if (ant.state === "return" || ant.carrying > 0) {
    return false;
  }
  const activeForagers = activeSurfaceForagers(world);
  if (activeForagers <= world.directives.activeTarget) {
    return false;
  }
  // Stochastic check: prevents feedback loops and sudden drops.
  return Math.random() < 0.15;
}

export function activeNurseLaborCount(world: World): number {
  return tickCache.activeNurses;
}

export function activeDigLaborCount(world: World): number {
  return tickCache.activeDiggers;
}
