import type { Ant, Vec2 } from "../../../../shared/types";
import { CONFIG } from "../../config";
import { bumpUndergroundGridVersion, completeDigTile, findDigTarget } from "../underground";
import type { World } from "../world";
import { isWithinRadius, normalize } from "./utils";
import { moveUndergroundToNode, moveUndergroundToward } from "./movement";
import { activeDigLaborCount } from "./colony-state";

export function needsSurfaceDiggerReturn(world: World): boolean {
  const hasDigNeed = world.underground.digTasks.some((task) => task.status !== "done");
  return hasDigNeed && activeDigLaborCount(world) < world.directives.diggerTarget;
}

export function assignedDigTargets(world: World, ant: Ant): Set<string> {
  return new Set();
}

function currentUndergroundDiggers(world: World): number {
  let count = 0;
  for (const ant of world.ants) {
    if (
      ant.layer === "underground" &&
      ant.state !== "dead" &&
      (ant.state === "dig" || ant.state === "carryDirt" || ant.carryingDirt)
    ) {
      count += 1;
    }
  }
  return count;
}

export function clearDigAssignment(ant: Ant): void {
  ant.digTaskId = undefined;
  ant.digTarget = undefined;
  ant.digStandPos = undefined;
  ant.digProgress = undefined;
  ant.carryingDirt = false;
}

export function moveCarryingDirt(world: World, ant: Ant): boolean {
  ant.state = "carryDirt";
  ant.job = "carryDirt";
  ant.carryingDirt = true;
  if (isWithinRadius(ant.pos, world.underground.entrance, CONFIG.undergroundNodeRadius)) {
    clearDigAssignment(ant);
    ant.dirtLoad = 0;
    ant.state = "idle";
    ant.job = "idle";
    return true;
  }

  moveUndergroundToNode(world, ant, "entrance");
  return true;
}

export function moveDigging(world: World, ant: Ant): boolean {
  if (ant.carryingDirt || ant.state === "carryDirt") {
    return moveCarryingDirt(world, ant);
  }

  let target = ant.digTarget && ant.digStandPos && ant.digTaskId
    ? { taskId: ant.digTaskId, tile: ant.digTarget, standPos: ant.digStandPos }
    : null;

  if (!target || world.underground.grid[target.tile.y]?.[target.tile.x]?.type !== "soil") {
    const next = findDigTarget(world.underground, assignedDigTargets(world, ant));
    if (!next) {
      if ((ant.dirtLoad ?? 0) > 0) {
        ant.carryingDirt = true;
        ant.state = "carryDirt";
        ant.job = "carryDirt";
        return true;
      }
      clearDigAssignment(ant);
      return false;
    }
    target = { taskId: next.task.id, tile: next.tile, standPos: next.standPos };
    ant.digTaskId = target.taskId;
    ant.digTarget = target.tile;
    ant.digStandPos = target.standPos;
    ant.digProgress = 0;
  }

  ant.state = "dig";
  ant.job = "dig";
  if (!isWithinRadius(ant.pos, target.standPos, 0.55)) {
    moveUndergroundToward(world, ant, target.standPos);
    return true;
  }

  const current = world.underground.grid[target.tile.y]?.[target.tile.x];
  if (!current || current.type !== "soil") {
    clearDigAssignment(ant);
    return false;
  }

  ant.heading = normalize({ x: target.tile.x + 0.5 - ant.pos.x, y: target.tile.y + 0.5 - ant.pos.y });
  current.digProgress = (current.digProgress ?? 0) + CONFIG.digProgressPerTick;
  bumpUndergroundGridVersion(world.underground);
  ant.digProgress = current.digProgress;
  if (current) {
    current.digProgress = ant.digProgress;
  }

  if (current.digProgress >= CONFIG.digProgressPerTile && completeDigTile(world.underground, target.taskId, target.tile)) {
    ant.dirtLoad = (ant.dirtLoad ?? 0) + 1;
    ant.digProgress = 0;
    ant.digTaskId = undefined;
    ant.digTarget = undefined;
    ant.digStandPos = undefined;
    if (ant.dirtLoad >= CONFIG.dirtCarryBatch) {
      ant.carryingDirt = true;
      ant.state = "carryDirt";
      ant.job = "carryDirt";
    }
  }
  return true;
}

export function assignDigTask(world: World, ant: Ant): boolean {
  if (
    ant.layer !== "underground" ||
    ant.carrying > 0 ||
    ant.state !== "idle"
  ) {
    return false;
  }

  const activeDiggers = currentUndergroundDiggers(world);
  if (activeDiggers >= world.directives.diggerTarget) {
    return false;
  }

  return moveDigging(world, ant);
}
