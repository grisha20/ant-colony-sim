import { CONFIG } from "../config";
import { makeBrood } from "./underground";
import { createWorkerAnt, type World } from "./world";
import type { UndergroundRoom } from "../../../shared/types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distanceSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function isWithinRadius(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): boolean {
  return distanceSq(a, b) <= radius * radius;
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
      isWithinRadius(ant.pos, brood.pos, CONFIG.undergroundNodeRadius)
  );
}

function logQueenDeath(world: World, reason: "age" | "stress" | "starve"): void {
  const { underground } = world;
  console.log(
    `[queen-death] colony=${world.colony.id} reason=${reason} tick=${world.tick} stress=${underground.queen.stress} hp=${underground.queen.hp} food=${underground.foodStorage}`
  );
}

function chamberCapacity(world: World, prefix: string): number {
  return world.underground.grid.reduce(
    (total, row) =>
      total +
      row.filter((tile) => tile.type === "chamber" && tile.roomId?.startsWith(prefix)).length,
    0
  );
}

function nurseryHasFreeCapacity(world: World): boolean {
  const rooms = world.underground.rooms.filter((room) => room.type === "nursery");
  const capacity = rooms.reduce((total, room) => total + room.capacity, 0);
  const used = world.underground.brood.filter((brood) => brood.location === "nursery").length;
  return capacity > used;
}

function eggRoomHasFreeCapacity(world: World): boolean {
  const rooms = world.underground.rooms.filter((room) => room.type === "egg");
  const capacity = rooms.reduce((total, room) => total + room.capacity, 0);
  const used = world.underground.brood.filter((brood) => brood.location === "egg").length;
  return capacity > used;
}

function roomCenter(room: UndergroundRoom): { x: number; y: number } {
  return { x: room.x + room.width / 2, y: room.y + room.height / 2 };
}

function nearestChamberPos(world: World, room: UndergroundRoom): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const target = roomCenter(room);
  for (let y = 0; y < world.underground.grid.length; y += 1) {
    for (let x = 0; x < world.underground.grid[y].length; x += 1) {
      const tile = world.underground.grid[y][x];
      if (tile.type !== "chamber" || tile.roomId !== room.id) {
        continue;
      }
      const distSq = distanceSq({ x: x + 0.5, y: y + 0.5 }, target);
      if (distSq < bestDistance) {
        best = { x: x + 0.5, y: y + 0.5 };
        bestDistance = distSq;
      }
    }
  }
  return best;
}

function nurseryDropPos(world: World): { x: number; y: number } | null {
  const rooms = world.underground.rooms
    .filter((room) => room.type === "nursery" && room.used < room.capacity)
    .sort((a, b) => distanceSq(roomCenter(a), world.underground.queenChamber) -
      distanceSq(roomCenter(b), world.underground.queenChamber));

  for (const room of rooms) {
    const pos = nearestChamberPos(world, room);
    if (pos) {
      return pos;
    }
  }
  return null;
}

function centerSettledBrood(world: World): void {
  const centerByRoom = new Map<string, { x: number; y: number }>();
  for (const room of world.underground.rooms) {
    if (room.type !== "egg" && room.type !== "nursery") {
      continue;
    }
    const pos = nearestChamberPos(world, room);
    if (pos) {
      centerByRoom.set(room.id, pos);
    }
  }

  for (const type of ["egg", "nursery"] as const) {
    const rooms = world.underground.rooms
      .filter((room) => room.type === type && room.capacity > 0 && centerByRoom.has(room.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (rooms.length === 0) {
      continue;
    }

    let roomIndex = 0;
    let roomUsed = 0;
    const broodItems = world.underground.brood.filter((brood) => !brood.carriedBy && brood.location === type);
    for (const brood of broodItems) {
      while (roomIndex < rooms.length - 1 && roomUsed >= rooms[roomIndex].capacity) {
        roomIndex += 1;
        roomUsed = 0;
      }
      const pos = centerByRoom.get(rooms[roomIndex].id);
      if (pos) {
        brood.pos = { ...pos };
      }
      roomUsed += 1;
    }
  }
}

export function updateBrood(world: World): void {
  const matureBroodIds = new Set<string>();
  centerSettledBrood(world);

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

    if (brood.stage === "egg" && brood.location === "egg") {
      brood.progress += 1;
      const nurseryPos = nurseryDropPos(world);
      if (brood.progress >= CONFIG.eggIncubationTicks && nurseryHasFreeCapacity(world) && nurseryPos) {
        brood.stage = "larva";
        brood.location = "nursery";
        brood.pos = nurseryPos;
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
      isWithinRadius(brood.pos, underground.queenChamber, CONFIG.undergroundNodeRadius * 2)
  );
  const eggRoomHasAnyChamber = chamberCapacity(world, "room-egg") > 0;
  const nurseCareNearQueen = world.ants.filter(
    (ant) =>
      ant.layer === "underground" &&
      ant.state !== "dead" &&
      ant.job === "nurse" &&
      isWithinRadius(ant.pos, underground.queenChamber, CONFIG.undergroundNodeRadius * 2)
  ).length;
  const comfortLimit = CONFIG.queenEggComfortLimit + nurseCareNearQueen * 3;
  const crowdedEggs = eggRoomHasAnyChamber ? Math.max(0, eggsNearQueen.length - comfortLimit) : 0;
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
    eggsNearQueen.length < CONFIG.queenEggComfortLimit || eggRoomHasFreeCapacity(world);
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
