import type { Ant, Brood, UndergroundRoom, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { tileCenter } from "../underground";
import type { UndergroundNode } from "../nav";
import type { World } from "../world";
import { distance, distanceSq, isWithinRadius, normalize, moveToward } from "./utils";
import { clampToUnderground, moveUndergroundToNode, moveUndergroundToward } from "./movement";
import { activeNurseLaborCount, countUndergroundNurses } from "./colony-state";

export function broodTarget(world: World, brood: Brood): Vec2 {
  if (brood.location === "queen") {
    return world.underground.queenChamber;
  }
  if (brood.location === "egg") {
    return eggDropPos(world) ?? world.underground.queenChamber;
  }
  return nurseryDropPos(world) ?? world.underground.nursery;
}

export function hasDugRoom(world: World, type: "storage" | "nursery" | "queen" | "egg" | "barracks" | "waiting"): boolean {
  return world.underground.rooms.some((room) => room.type === type);
}

export function nurseryHasSpace(world: World): boolean {
  const rooms = world.underground.rooms.filter((room) => room.type === "nursery");
  const capacity = rooms.reduce((total, room) => total + room.capacity, 0);
  const used = world.underground.brood.filter((brood) => brood.location === "nursery").length;
  return capacity > used;
}

export function roomCenter(room: UndergroundRoom): Vec2 {
  return { x: room.x + room.width / 2, y: room.y + room.height / 2 };
}

export function chamberDropPosInRoom(world: World, room: UndergroundRoom): Vec2 | null {
  const center = roomCenter(room);
  let best: Vec2 | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < world.underground.grid.length; y += 1) {
    const row = world.underground.grid[y];
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x];
      if (tile.type !== "chamber" || tile.roomId !== room.id) {
        continue;
      }
      const pos = tileCenter({ x, y });
      const distSq = distanceSq(pos, center);
      if (distSq < bestDistance) {
        best = pos;
        bestDistance = distSq;
      }
    }
  }
  return best;
}

export function roomDropPos(world: World, type: "egg" | "nursery"): Vec2 | null {
  const rooms = world.underground.rooms
    .filter((room) => room.type === type && room.used < room.capacity)
    .sort((a, b) => distanceSq(roomCenter(a), world.underground.queenChamber) - distanceSq(roomCenter(b), world.underground.queenChamber));

  for (const room of rooms) {
    const pos = chamberDropPosInRoom(world, room);
    if (pos) {
      return pos;
    }
  }

  return null;
}

export function nurseryDropPos(world: World): Vec2 | null {
  return roomDropPos(world, "nursery");
}

export function eggRooms(world: World) {
  return world.underground.rooms.filter((room) => room.type === "egg");
}

export function eggRoomHasSpace(world: World): boolean {
  const rooms = eggRooms(world);
  const capacity = rooms.reduce((total, room) => total + room.capacity, 0);
  const used = world.underground.brood.filter((brood) => brood.location === "egg").length;
  return capacity > used;
}

export function eggDropPos(world: World): Vec2 | null {
  return roomDropPos(world, "egg");
}

export function getBrood(world: World, broodId: string | undefined): Brood | undefined {
  if (!broodId) {
    return undefined;
  }

  return world.underground.brood.find((brood) => brood.id === broodId);
}

export function assignedFeederCount(world: World, broodId: string): number {
  let count = 0;
  for (const ant of world.ants) {
    if (ant.layer === "underground" && ant.state === "feed" && ant.broodId === broodId) {
      count += 1;
    }
  }

  return count;
}

export function busyNurseCount(world: World): number {
  return countUndergroundNurses(world);
}

export function needsBroodTransport(brood: Brood): boolean {
  return brood.stage === "egg" && brood.location === "queen";
}

export function pendingBroodTransportCount(world: World): number {
  if (!eggRoomHasSpace(world) || !eggDropPos(world)) {
    return 0;
  }

  let count = 0;
  for (const brood of world.underground.brood) {
    if (needsBroodTransport(brood) && !brood.carriedBy && !hasAssignedCarrier(world, brood.id)) {
      count += 1;
    }
  }

  return count;
}

export function needsSurfaceNurseReturn(world: World): boolean {
  if (!hasDugRoom(world, "egg") || pendingBroodTransportCount(world) <= 0) {
    return false;
  }

  const targetNurses = Math.max(1, Math.min(CONFIG.maxNurses, world.directives.nurseTarget));
  return activeNurseLaborCount(world) < targetNurses;
}

export function hasAssignedCarrier(world: World, broodId: string): boolean {
  return world.ants.some((ant) => ant.layer === "underground" && ant.state === "carryBrood" && ant.broodId === broodId);
}

export function moveCarryingBrood(world: World, ant: Ant): void {
  ant.job = "nurse";
  const brood = getBrood(world, ant.broodId);
  if (!brood) {
    ant.broodId = undefined;
    ant.state = "idle";
    ant.job = "nurse";
    return;
  }

  if (!brood.carriedBy) {
    if (brood.location === "queen" && (!eggRoomHasSpace(world) || !eggDropPos(world))) {
      ant.broodId = undefined;
      ant.state = "idle";
      ant.job = "nurse";
      return;
    }
    if (brood.location === "nursery" && !hasDugRoom(world, "nursery")) {
      ant.broodId = undefined;
      ant.state = "idle";
      return;
    }
    const pickupNode: UndergroundNode = brood.location === "queen" ? "queenChamber" : "nursery";
    const target = broodTarget(world, brood);
    if (isWithinRadius(ant.pos, target, CONFIG.undergroundNodeRadius)) {
      brood.carriedBy = ant.id;
      brood.pos = { ...ant.pos };
    } else {
      moveUndergroundToNode(world, ant, pickupNode);
    }
    return;
  }

  if (brood.carriedBy !== ant.id) {
    ant.broodId = undefined;
    ant.state = "idle";
    return;
  }

  const dropPos = nurseryDropPos(world);
  const targetLocation = brood.stage === "egg" ? "egg" : "nursery";
  const targetDropPos = targetLocation === "egg" ? eggDropPos(world) : dropPos;
  if (!targetDropPos) {
    ant.broodId = undefined;
    ant.state = "idle";
    ant.job = "nurse";
    return;
  }

  if (isWithinRadius(ant.pos, targetDropPos, CONFIG.undergroundNodeRadius)) {
    brood.location = targetLocation;
    brood.pos = { ...targetDropPos };
      brood.carriedBy = undefined;
      ant.broodId = undefined;
      ant.state = "idle";
      ant.job = "nurse";
      return;
  }

  moveUndergroundToward(world, ant, targetDropPos);
  brood.pos = { ...ant.pos };
}

export function moveFeedingBrood(world: World, ant: Ant): void {
  ant.job = "nurse";
  const brood = getBrood(world, ant.broodId);
  if (
    !brood ||
    brood.stage !== "larva" ||
    brood.location !== "nursery" ||
    !hasDugRoom(world, "nursery") ||
    world.underground.foodStorage < CONFIG.nurseMinFoodReserve ||
    ant.energy < world.directives.refuelThreshold
  ) {
    ant.broodId = undefined;
    ant.state = "idle";
    ant.job = "nurse";
    return;
  }

  if (!isWithinRadius(ant.pos, world.underground.nursery, CONFIG.undergroundNodeRadius)) {
    moveUndergroundToNode(world, ant, "nursery");
  } else if (!isWithinRadius(ant.pos, brood.pos, 2)) {
    moveToward(ant, brood.pos, CONFIG.workerUndergroundSpeed);
    clampToUnderground(ant, world);
  } else {
    ant.heading = normalize({ x: brood.pos.x - ant.pos.x, y: brood.pos.y - ant.pos.y });
  }
}

export function assignNurseTask(world: World, ant: Ant): boolean {
  const nurseryReady = hasDugRoom(world, "egg") && eggRoomHasSpace(world) && !!eggDropPos(world);
  const broodToMove = nurseryReady
    ? world.underground.brood.find((brood) => needsBroodTransport(brood) && !brood.carriedBy && !hasAssignedCarrier(world, brood.id))
    : undefined;
  const nurseDemand = broodToMove ? Math.max(1, world.directives.nurseTarget) : world.directives.nurseTarget;

  if (
    ant.state !== "idle" ||
    ant.carrying > 0 ||
    (ant.energy < world.directives.refuelThreshold && !broodToMove) ||
    busyNurseCount(world) >= nurseDemand
  ) {
    return false;
  }

  if (broodToMove) {
    ant.broodId = broodToMove.id;
    ant.state = "carryBrood";
    ant.job = "nurse";
    moveCarryingBrood(world, ant);
    return true;
  }

  if (world.underground.foodStorage < CONFIG.nurseMinFoodReserve) {
    return false;
  }

  const broodToFeed = world.underground.brood.find(
    (brood) => brood.stage === "larva" && brood.location === "nursery" && assignedFeederCount(world, brood.id) === 0
  );
  if (broodToFeed) {
    ant.broodId = broodToFeed.id;
    ant.state = "feed";
    ant.job = "nurse";
    moveFeedingBrood(world, ant);
    return true;
  }

  return false;
}
