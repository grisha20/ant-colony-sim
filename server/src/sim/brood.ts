import { CONFIG } from "../config";
import { makeBrood } from "./underground";
import { createWorkerAnt, type World } from "./world";

function hasNearbyFeeder(world: World, broodId: string): boolean {
  const brood = world.underground.brood.find((item) => item.id === broodId);
  if (!brood) {
    return false;
  }

  return world.ants.some(
    (ant) =>
      ant.layer === "underground" &&
      ant.state === "feed" &&
      ant.broodId === broodId &&
      Math.hypot(ant.pos.x - brood.pos.x, ant.pos.y - brood.pos.y) <= CONFIG.undergroundNodeRadius
  );
}

export function updateBrood(world: World): void {
  const matureBroodIds = new Set<string>();

  for (const brood of world.underground.brood) {
    if (brood.carriedBy) {
      continue;
    }

    if (brood.stage === "egg" && brood.location === "nursery") {
      brood.progress += 1;
      if (brood.progress >= CONFIG.eggIncubationTicks) {
        brood.stage = "larva";
        brood.location = "nursery";
        brood.pos = { ...world.underground.nursery };
        brood.progress = 0;
      }
      continue;
    }

    if (
      brood.stage === "larva" &&
      brood.location === "nursery" &&
      hasNearbyFeeder(world, brood.id) &&
      world.underground.foodStorage >= CONFIG.larvaFeedFoodCost
    ) {
      world.underground.foodStorage -= CONFIG.larvaFeedFoodCost;
      brood.progress += CONFIG.larvaFeedPerTick;

      if (brood.progress >= CONFIG.larvaGrowthNeeded && world.ants.length < world.colony.nestCapacity) {
        const worker = createWorkerAnt(world.underground.nursery, "underground");
        worker.energy = CONFIG.maxEnergy;
        world.ants.push(worker);
        matureBroodIds.add(brood.id);
      }
    }
  }

  if (matureBroodIds.size > 0) {
    world.underground.brood = world.underground.brood.filter((brood) => !matureBroodIds.has(brood.id));
    for (const ant of world.ants) {
      if (ant.broodId && matureBroodIds.has(ant.broodId)) {
        ant.broodId = undefined;
        ant.state = "idle";
      }
    }
  }
}

export function updateQueen(world: World): void {
  const { underground, colony } = world;
  if (!underground.queen.alive) {
    return;
  }

  if (world.tick % CONFIG.queenEatEveryTicks === 0) {
    if (underground.foodStorage >= CONFIG.queenFoodPerMeal) {
      underground.foodStorage -= CONFIG.queenFoodPerMeal;
      underground.queen.starve = 0;
    } else {
      underground.queen.starve += 1;
      if (underground.queen.starve >= CONFIG.queenStarveBuffer) {
        underground.queen.alive = false;
        return;
      }
    }
  }

  underground.queen.layCooldown -= 1;
  const totalPopulation = world.ants.length + underground.brood.length;
  if (
    underground.queen.layCooldown <= 0 &&
    underground.foodStorage >= world.directives.layReserve + CONFIG.eggCost &&
    totalPopulation < colony.nestCapacity
  ) {
    underground.foodStorage -= CONFIG.eggCost;
    underground.brood.push(makeBrood("egg", "queen", underground.queenChamber));
    underground.queen.layCooldown = CONFIG.broodLayCooldownTicks;
  }
}
