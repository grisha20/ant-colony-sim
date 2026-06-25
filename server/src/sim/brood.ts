import { CONFIG } from "../config";
import { makeBrood } from "./underground";
import { createWorkerAnt, type World } from "./world";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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

function logQueenDeath(world: World, reason: "age" | "stress" | "starve"): void {
  const { underground } = world;
  console.log(
    `[queen-death] colony=${world.colony.id} reason=${reason} tick=${world.tick} stress=${underground.queen.stress} hp=${underground.queen.hp} food=${underground.foodStorage}`
  );
}

function nurseryChamberCapacity(world: World): number {
  return world.underground.grid.reduce(
    (total, row) =>
      total +
      row.filter((tile) => tile.type === "chamber" && tile.roomId === "room-nursery").length,
    0
  );
}

export function updateBrood(world: World): void {
  const matureBroodIds = new Set<string>();

  for (const brood of world.underground.brood) {
    if (brood.carriedBy) {
      continue;
    }

    if (brood.stage === "egg" && brood.location === "queen") {
      if (world.underground.queen.stress >= world.directives.queenRearThreshold) {
        brood.progress += 1;
        if (brood.progress >= CONFIG.queenRearTicks && brood.isPrincess) {
          if (world.underground.princesses.length < CONFIG.maxPrincesses) {
            world.underground.princesses.push({
              id: `${brood.id}-princess`,
              pos: { ...world.underground.queenChamber }
            });
          }
          matureBroodIds.add(brood.id);
        } else if (brood.progress >= CONFIG.queenRearTicks && world.ants.length < world.colony.nestCapacity) {
          const worker = createWorkerAnt(world.underground.queenChamber, "underground", world.colony.id, CONFIG.queenRearStrength);
          worker.energy = CONFIG.maxEnergy;
          world.ants.push(worker);
          matureBroodIds.add(brood.id);
        }
      }
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

      const growthNeeded = CONFIG.larvaGrowthNeeded * (brood.isPrincess ? CONFIG.princessGrowthMult : 1);
      if (brood.progress >= growthNeeded && brood.isPrincess) {
        if (world.underground.princesses.length < CONFIG.maxPrincesses) {
          world.underground.princesses.push({
            id: `${brood.id}-princess`,
            pos: { ...world.underground.nursery }
          });
        }
        matureBroodIds.add(brood.id);
      } else if (brood.progress >= growthNeeded && world.ants.length < world.colony.nestCapacity) {
        const worker = createWorkerAnt(world.underground.nursery, "underground", world.colony.id, 1);
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

  underground.queen.age += 1;
  if (underground.queen.age >= CONFIG.queenMaxAge) {
    logQueenDeath(world, "age");
    underground.queen.alive = false;
    return;
  }

  const eggsNearQueen = underground.brood.filter(
    (brood) =>
      brood.stage === "egg" &&
      brood.location === "queen" &&
      !brood.isPrincess &&
      Math.hypot(brood.pos.x - underground.queenChamber.x, brood.pos.y - underground.queenChamber.y) <= CONFIG.undergroundNodeRadius * 2
  );
  const nurseryHasAnyChamber = nurseryChamberCapacity(world) > 0;
  const crowdedEggs = nurseryHasAnyChamber ? Math.max(0, eggsNearQueen.length - CONFIG.queenEggComfortLimit) : 0;
  underground.queen.stress = clamp(
    underground.queen.stress + (crowdedEggs > 0 ? CONFIG.queenStressPerTick * crowdedEggs : -CONFIG.queenStressReliefPerTick),
    0,
    100
  );

  if (underground.queen.stress > 70) {
    underground.queen.hp -= CONFIG.queenStressDamage;
    if (underground.queen.hp <= 0) {
      logQueenDeath(world, "stress");
      underground.queen.alive = false;
      return;
    }
  }

  if (underground.queen.stress > 90 && Math.random() < CONFIG.queenHighStressDeathChance) {
    logQueenDeath(world, "stress");
    underground.queen.alive = false;
    return;
  }

  if (world.tick % CONFIG.queenEatEveryTicks === 0) {
    if (underground.foodStorage >= CONFIG.queenFoodPerMeal) {
      underground.foodStorage -= CONFIG.queenFoodPerMeal;
      underground.queen.starve = 0;
    } else {
      underground.queen.starve += 1;
      if (underground.queen.starve >= CONFIG.queenStarveBuffer) {
        logQueenDeath(world, "starve");
        underground.queen.alive = false;
        return;
      }
    }
  }

  underground.queen.layCooldown -= 1;
  const totalPopulation = world.ants.length + underground.brood.length;
  const queenHasEggSpace =
    eggsNearQueen.length < CONFIG.queenEggComfortLimit || underground.rooms.some((room) => room.type === "nursery");
  if (
    underground.queen.layCooldown <= 0 &&
    queenHasEggSpace &&
    underground.queen.stress < world.directives.queenRearThreshold &&
    underground.foodStorage >= world.directives.layReserve + CONFIG.eggCost &&
    totalPopulation < colony.nestCapacity
  ) {
    underground.foodStorage -= CONFIG.eggCost;
    const layIndex = Math.floor(underground.queen.age / CONFIG.broodLayCooldownTicks);
    const isPrincess = (layIndex > 0 && layIndex % 15 === 0) || Math.random() < CONFIG.princessChance;
    underground.brood.push(makeBrood("egg", "queen", underground.queenChamber, 0, isPrincess));
    underground.queen.layCooldown = CONFIG.broodLayCooldownTicks;
  }
}
