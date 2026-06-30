import type { Ant, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { profiler } from "../../utils/profiler";
import { registerScoutFoodReport } from "../foodMemory";
import { tileCenter } from "../underground";
import type { UndergroundNode } from "../nav";
import type { World } from "../world";
import { tickCache } from "../cache";
import { distance, isWithinRadius, numericAntId } from "./utils";
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

function waitingRoomCenter(world: World): Vec2 | null {
  const room = world.underground.rooms.find((item) => item.type === "waiting");
  return room ? { x: room.x + room.width / 2, y: room.y + room.height / 2 } : null;
}

export function restTargetForAnt(world: World, ant: Ant, node: UndergroundNode): Vec2 {
  const waiting = waitingRoomCenter(world);
  if (waiting && ant.job !== "nurse") {
    const seed = numericAntId(ant.id);
    const angle = seed * 2.399963229728653;
    const radius = 0.8 + (seed % 4) * 0.35;
    return {
      x: Math.max(0, Math.min(world.underground.width - 0.01, waiting.x + Math.cos(angle) * radius)),
      y: Math.max(0, Math.min(world.underground.height - 0.01, waiting.y + Math.sin(angle) * radius))
    };
  }
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
  ant.job = ant.job === "nurse" ? "nurse" : "idle";
  if (!isDugPos(world, target)) {
    guardQueen(world, ant);
    return;
  }
  if (isWithinRadius(ant.pos, target, 0.8)) {
    return;
  }

  const nodePos = node === "barracksA" ? world.underground.barracksA : world.underground.barracksB;
  const waiting = waitingRoomCenter(world);
  if (waiting) {
    moveUndergroundToward(world, ant, target, CONFIG.workerUndergroundSpeed * 0.5);
    clampToUnderground(ant, world);
    return;
  }
  if (isWithinRadius(ant.pos, nodePos, CONFIG.undergroundNodeRadius)) {
    moveUndergroundToward(world, ant, target, CONFIG.workerUndergroundSpeed * 0.35);
    clampToUnderground(ant, world);
    return;
  }

  moveUndergroundToNode(world, ant, node);
}

export function guardQueen(world: World, ant: Ant): void {
  ant.state = "idle";
  ant.job = ant.job === "nurse" ? "nurse" : "idle";
  if (isWithinRadius(ant.pos, world.underground.queenChamber, CONFIG.undergroundNodeRadius)) {
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

    if (isWithinRadius(enemy.pos, world.surface.entrance, blockRadius)) {
      return true;
    }
    if (isWithinRadius(enemy.lair, world.surface.entrance, CONFIG.spiderLairWebRadius + 3)) {
      return true;
    }
  }

  return false;
}

function shouldWaitForExitSlot(world: World, ant: Ant): boolean {
  const maxConcurrentExits = world.colony.activeFoodTargetId
    ? Math.max(3, Math.min(12, Math.ceil(world.directives.activeTarget / 2)))
    : Math.max(3, Math.min(12, Math.ceil(world.directives.activeTarget / 2)));
  const exiting = tickCache.undergroundExitingAnts;

  if (exiting.length < maxConcurrentExits) {
    return false;
  }

  for (let i = 0; i < maxConcurrentExits; i += 1) {
    if (exiting[i]?.id === ant.id) {
      return false;
    }
  }
  return true;
}

export function stepUnderground(world: World, ant: Ant): void {
  maybeFeedUndergroundAnt(world, ant);

  if ((ant.undergroundExitCooldown ?? 0) > 0) {
    ant.undergroundExitCooldown = Math.max(0, (ant.undergroundExitCooldown ?? 0) - 1);
    if ((ant.forageRole === "scout" || ant.forageRole === "forager") && ant.state === "idle") {
      return;
    }
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
      if (isWithinRadius(ant.pos, world.underground.queenChamber, CONFIG.undergroundNodeRadius)) {
        registerScoutFoodReport(world, ant);
        world.underground.foodStorage += ant.carrying;
        world.fitness.totalFoodDeposited += ant.carrying;
        ant.carrying = 0;
        ant.state = "idle";
      } else {
        moveUndergroundToNode(world, ant, "queenChamber");
      }
      return;
    }
    if (isWithinRadius(ant.pos, world.underground.storage, CONFIG.undergroundNodeRadius)) {
      registerScoutFoodReport(world, ant);
      world.underground.foodStorage += ant.carrying;
      world.fitness.totalFoodDeposited += ant.carrying;
      ant.carrying = 0;
      ant.state = "idle";
    } else {
      moveUndergroundToNode(world, ant, "storage");
    }
    return;
  }

  if (world.colony.activeFoodTargetId && ant.state === "dig" && !ant.carryingDirt) {
    ant.state = "idle";
    ant.job = ant.forageRole === "forager" || ant.forageRole === "scout" ? "forage" : "idle";
    ant.digTaskId = undefined;
    ant.digTarget = undefined;
    ant.digStandPos = undefined;
    ant.digProgress = undefined;
  }

  if (ant.state === "dig" || ant.state === "carryDirt" || ant.carryingDirt) {
    if (moveDigging(world, ant)) {
      return;
    }
  }

  const hasPendingDig = world.underground.digTasks.some((task) => task.status !== "done");
  if (
    hasPendingDig &&
    ant.preferredTask === "dig" &&
    !ant.forageRole &&
    ant.carrying <= 0 &&
    (ant.state === "toEntrance" || ant.state === "search")
  ) {
    ant.state = "idle";
    ant.job = "idle";
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
      if (ant.forageRole === "scout" || ant.forageRole === "forager") {
        ant.job = "forage";
        return;
      }
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

  if (ant.job === "nurse") {
    restUnderground(world, ant);
    return;
  }

  if (ant.forageRole === "scout") {
    if (countActiveAndTransitioningForagers(world) >= world.directives.activeTarget) {
      restUnderground(world, ant);
      return;
    }
    if ((ant.undergroundExitCooldown ?? 0) > 0) {
      return;
    }
    if (isSurfaceExitThreatened(world) || shouldWaitForExitSlot(world, ant)) {
      ant.state = "toEntrance";
      return;
    }
    ant.job = "forage";
    ant.state = "toEntrance";
    moveUndergroundToNode(world, ant, "entrance");
    tryCrossLayer(world, ant);
    return;
  }

  if (ant.forageRole === "forager") {
    if (countActiveAndTransitioningForagers(world) >= world.directives.activeTarget) {
      restUnderground(world, ant);
      return;
    }
    if ((ant.undergroundExitCooldown ?? 0) > 0) {
      return;
    }
    if (isSurfaceExitThreatened(world) || shouldWaitForExitSlot(world, ant)) {
      ant.state = "toEntrance";
      return;
    }
    ant.job = "forage";
    ant.state = "toEntrance";
    moveUndergroundToNode(world, ant, "entrance");
    tryCrossLayer(world, ant);
    return;
  }

  if (collectUndergroundCarrion(world, ant)) {
    return;
  }

  if (assignDigTask(world, ant)) {
    return;
  }

  if (hasPendingDig && ant.preferredTask === "dig" && ant.carrying <= 0) {
    if ((ant.dirtLoad ?? 0) > 0) {
      ant.carryingDirt = true;
      ant.state = "carryDirt";
      ant.job = "carryDirt";
      moveDigging(world, ant);
      return;
    }
    restUnderground(world, ant);
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
  if (
    (ant.forageRole === "scout" || (ant.forageRole === "forager" && !!world.colony.activeFoodTargetId)) &&
    ant.state === "return" &&
    ant.carrying <= 0 &&
    ant.energy >= CONFIG.lowEnergyThreshold
  ) {
    ant.state = "search";
  }

  if ((ant.state === "return" || ant.state === "carry" || ant.carrying > 0) && tryCrossLayer(world, ant)) {
    return;
  }

  if ((ant.surfaceExitCooldown ?? 0) > 0) {
    ant.surfaceExitCooldown = Math.max(0, (ant.surfaceExitCooldown ?? 0) - 1);
  }

  if (profiler.measure("stepAnt.surface.combat", () => handleEnemyColonyCombat(world, ant))) {
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

  if (profiler.measure("stepAnt.surface.combat", () => moveFighting(world, ant))) {
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

  if (!ant.forageRole && ant.carrying <= 0 && needsSurfaceDiggerReturn(world)) {
    moveDiggerHome(world, ant);
    return;
  }

  if (!ant.forageRole && ant.carrying <= 0 && needsSurfaceNurseReturn(world)) {
    moveNurseHome(world, ant);
    return;
  }

  if (ant.state === "return" || (ant.forageRole !== "scout" && (ant.surfaceExitCooldown ?? 0) <= 0 && shouldReturnFromSurface(world, ant))) {
    moveHungryHome(world, ant);
    return;
  }

  const refuelThreshold = ant.forageRole === "scout" ? CONFIG.lowEnergyThreshold : world.directives.refuelThreshold;

  if (ant.energy < CONFIG.lowEnergyThreshold && canUseStorageMeal(world, true)) {
    moveHungryHome(world, ant);
    return;
  }

  if (ant.energy < refuelThreshold && moveHungryToFood(world, ant)) {
    return;
  }

  if (ant.energy < refuelThreshold && canUseStorageMeal(world)) {
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
    const hasCloseFood = food && isWithinRadius(ant.pos, food.source.pos, CONFIG.antFoodSightRadius);

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
