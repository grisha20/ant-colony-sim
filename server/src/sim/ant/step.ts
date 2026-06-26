import type { Ant, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { tileCenter } from "../underground";
import type { UndergroundNode } from "../nav";
import type { World } from "../world";
import { distance, numericAntId } from "./utils";
import {
  clampToUnderground,
  findNearestDugTile,
  isDugPos,
  moveUndergroundToNode,
  moveUndergroundToward,
  tryCrossLayer
} from "./movement";
import {
  canUseStorageMeal,
  countActiveAndTransitioningForagers,
  maybeFeedUndergroundAnt,
  queenGuardIds,
  shouldReturnFromSurface,
  isColonyStarving
} from "./colony-state";
import {
  handleEnemyColonyCombat,
  moveFighting,
  retreatFromSpiderToEntrance
} from "./combat";
import {
  assignNurseTask,
  hasDugRoom,
  moveCarryingBrood,
  moveFeedingBrood,
  needsSurfaceNurseReturn,
  pendingBroodTransportCount
} from "./brood";
import { assignDigTask, moveDigging, needsSurfaceDiggerReturn } from "./dig";
import {
  collectUndergroundCarrion,
  moveCarrying,
  moveDiggerHome,
  moveHungryHome,
  moveHungryToFood,
  moveNurseHome,
  moveSearching,
  moveCarryingDebris,
  moveSearchingDebris,
  nearestAvailableFood
} from "./forage";

export function restNodeForAnt(ant: Ant): UndergroundNode {
  return numericAntId(ant.id) % 2 === 0 ? "barracksA" : "barracksB";
}

export function restTargetForAnt(world: World, ant: Ant, node: UndergroundNode): Vec2 {
  const base = node === "barracksA" ? world.underground.barracksA : world.underground.barracksB;
  const seed = numericAntId(ant.id);
  const angle = seed * 2.399963229728653;
  const radius = 1.2 + (seed % 5) * 0.45;
  return {
    x: Math.max(0, Math.min(world.underground.width - 0.01, base.x + Math.cos(angle) * radius)),
    y: Math.max(0, Math.min(world.underground.height - 0.01, base.y + Math.sin(angle) * radius))
  };
}

export function restUnderground(world: World, ant: Ant): void {
  const node = restNodeForAnt(ant);
  const target = restTargetForAnt(world, ant, node);
  ant.state = "idle";
  ant.job = "idle";
  if (!isDugPos(world, target)) {
    guardQueen(world, ant);
    return;
  }
  if (distance(ant.pos, target) <= 0.8) {
    return;
  }

  const nodePos = node === "barracksA" ? world.underground.barracksA : world.underground.barracksB;
  if (distance(ant.pos, nodePos) <= CONFIG.undergroundNodeRadius) {
    moveUndergroundToward(world, ant, target, CONFIG.workerUndergroundSpeed * 0.35);
    clampToUnderground(ant, world);
    return;
  }

  moveUndergroundToNode(world, ant, node);
}

export function guardQueen(world: World, ant: Ant): void {
  ant.state = "idle";
  ant.job = "idle";
  if (distance(ant.pos, world.underground.queenChamber) <= CONFIG.undergroundNodeRadius) {
    return;
  }

  moveUndergroundToNode(world, ant, "queenChamber");
}

function isSurfaceExitThreatened(world: World): boolean {
  const blockRadius = Math.max(
    CONFIG.antSpiderSightRadius + CONFIG.entranceRadiusSurface + 3,
    CONFIG.spiderLairWebRadius
  );

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider" || enemy.hp <= 0) {
      continue;
    }

    if (distance(enemy.pos, world.surface.entrance) <= blockRadius) {
      return true;
    }
    if (distance(enemy.lair, world.surface.entrance) <= CONFIG.spiderLairWebRadius + 3) {
      return true;
    }
  }

  return false;
}

function shouldWaitForExitSlot(world: World, ant: Ant): boolean {
  const maxConcurrentExits = Math.max(4, Math.min(16, Math.ceil(world.directives.activeTarget / 4)));
  const exiting = world.ants
    .filter((other) => other.layer === "underground" && other.state === "toEntrance")
    .sort((a, b) => numericAntId(a.id) - numericAntId(b.id));

  if (exiting.length < maxConcurrentExits) {
    return false;
  }

  return !exiting.slice(0, maxConcurrentExits).some((other) => other.id === ant.id);
}

export function stepUnderground(world: World, ant: Ant): void {
  maybeFeedUndergroundAnt(world, ant);

  if ((ant.undergroundExitCooldown ?? 0) > 0) {
    ant.undergroundExitCooldown = Math.max(0, (ant.undergroundExitCooldown ?? 0) - 1);
  }

  if (!isDugPos(world, ant.pos)) {
    const nearest = findNearestDugTile(world, ant.pos);
    if (nearest) {
      ant.pos = tileCenter(nearest);
    }
  }

  if (ant.state === "deposit" || ant.carrying > 0) {
    if (!hasDugRoom(world, "storage") || !isDugPos(world, world.underground.storage)) {
      ant.state = "deposit";
      if (distance(ant.pos, world.underground.queenChamber) > CONFIG.undergroundNodeRadius) {
        moveUndergroundToNode(world, ant, "queenChamber");
      }
      return;
    }
    if (distance(ant.pos, world.underground.storage) <= CONFIG.undergroundNodeRadius) {
      world.underground.foodStorage += ant.carrying;
      world.fitness.totalFoodDeposited += ant.carrying;
      ant.carrying = 0;
      ant.state = "idle";
    } else {
      moveUndergroundToNode(world, ant, "storage");
    }
    return;
  }

  if (ant.state === "dig" || ant.state === "carryDirt" || ant.carryingDirt) {
    if (moveDigging(world, ant)) {
      return;
    }
  }

  if (ant.state === "carryBrood") {
    moveCarryingBrood(world, ant);
    return;
  }

  if (ant.state === "feed") {
    moveFeedingBrood(world, ant);
    if (ant.state === "feed") {
      return;
    }
  }

  if (ant.state === "toEntrance") {
    if (isSurfaceExitThreatened(world) || (ant.undergroundExitCooldown ?? 0) > 0 || shouldWaitForExitSlot(world, ant)) {
      ant.state = "idle";
      ant.job = "idle";
      restUnderground(world, ant);
      return;
    }
    moveUndergroundToNode(world, ant, "entrance");
    tryCrossLayer(world, ant);
    return;
  }

  if (assignNurseTask(world, ant)) {
    return;
  }

  if (collectUndergroundCarrion(world, ant)) {
    return;
  }

  if (assignDigTask(world, ant)) {
    return;
  }

  if (!hasDugRoom(world, "storage")) {
    guardQueen(world, ant);
    return;
  }

  if (queenGuardIds(world).has(ant.id)) {
    guardQueen(world, ant);
    return;
  }

  if (countActiveAndTransitioningForagers(world) >= world.directives.activeTarget) {
    restUnderground(world, ant);
    return;
  }

  if (isSurfaceExitThreatened(world) || (ant.undergroundExitCooldown ?? 0) > 0 || shouldWaitForExitSlot(world, ant)) {
    restUnderground(world, ant);
    return;
  }

  ant.state = "toEntrance";
  moveUndergroundToNode(world, ant, "entrance");
  tryCrossLayer(world, ant);
}

export function stepSurface(world: World, ant: Ant): void {
  if ((ant.state === "return" || ant.state === "carry" || ant.carrying > 0) && tryCrossLayer(world, ant)) {
    return;
  }

  if ((ant.surfaceExitCooldown ?? 0) > 0) {
    ant.surfaceExitCooldown = Math.max(0, (ant.surfaceExitCooldown ?? 0) - 1);
  }

  if (handleEnemyColonyCombat(world, ant)) {
    return;
  }

  if (ant.state === "carry") {
    moveCarrying(world, ant);
    return;
  }

  if (ant.carryingDebris) {
    moveCarryingDebris(world, ant);
    return;
  }

  if (moveFighting(world, ant)) {
    return;
  }

  if (ant.state === "return" && ant.job === "nurse" && pendingBroodTransportCount(world) > 0) {
    moveNurseHome(world, ant);
    return;
  }

  if (ant.state === "return" && ant.job === "dig" && needsSurfaceDiggerReturn(world)) {
    moveDiggerHome(world, ant);
    return;
  }

  if (ant.carrying <= 0 && needsSurfaceDiggerReturn(world)) {
    moveDiggerHome(world, ant);
    return;
  }

  if (ant.carrying <= 0 && needsSurfaceNurseReturn(world)) {
    moveNurseHome(world, ant);
    return;
  }

  if (ant.state === "return" || ((ant.surfaceExitCooldown ?? 0) <= 0 && shouldReturnFromSurface(world, ant))) {
    moveHungryHome(world, ant);
    return;
  }

  if (ant.energy < CONFIG.lowEnergyThreshold && canUseStorageMeal(world, true)) {
    moveHungryHome(world, ant);
    return;
  }

  if (ant.energy < world.directives.refuelThreshold && moveHungryToFood(world, ant)) {
    return;
  }

  if (ant.energy < world.directives.refuelThreshold && canUseStorageMeal(world)) {
    moveHungryHome(world, ant);
    return;
  }

  if (ant.job === "idle") {
    if (moveSearchingDebris(world, ant)) {
      return;
    }
  }

  if (ant.carrying <= 0 && !ant.carryingDebris) {
    const food = nearestAvailableFood(world, ant);
    const hasCloseFood = food && distance(ant.pos, food.source.pos) < CONFIG.antFoodSightRadius;

    const colony = world.colonies.find(c => c.id === ant.colonyId);
    const colonyAntsCount = colony ? colony.ants.length : 0;
    const foodStorage = colony ? colony.underground.foodStorage : 0;

    if (!hasCloseFood && colonyAntsCount > 10 && foodStorage > 20 && Math.random() < 0.0003) {
      ant.job = "idle";
      if (moveSearchingDebris(world, ant)) {
        return;
      }
    }
  }

  ant.state = "search";
  moveSearching(world, ant);
}

export function stepAnt(world: World, ant: Ant): void {
  if (ant.state === "dead") {
    return;
  }

  ant.energy -= CONFIG.energyDrainPerTick;

  if (ant.energy <= 0) {
    if (ant.layer === "underground") {
      if (!maybeFeedUndergroundAnt(world, ant, true)) {
        ant.state = "dead";
        return;
      }
    } else if (canUseStorageMeal(world, true)) {
      ant.energy = 1;
    } else {
      ant.state = "dead";
      return;
    }
  }

  if (ant.layer === "underground") {
    stepUnderground(world, ant);
    return;
  }

  stepSurface(world, ant);
}
