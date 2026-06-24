import type { Ant, Brood, Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";
import type { UndergroundNode } from "./nav";
import {
  completeDigTile,
  findDigTarget,
  isDugTile,
  refreshDigTasks,
  tileCenter
} from "./underground";
import type { World } from "./world";
import { randomHeading } from "./world";

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.y);
  if (length <= 0.001) {
    return randomHeading();
  }

  return { x: vec.x / length, y: vec.y / length };
}

function fanDirection(base: Vec2, id: string): Vec2 {
  const numericId = Number(id.replace("ant-", ""));
  const slot = Number.isFinite(numericId) ? numericId % 7 : 0;
  const angle = (slot - 3) * 0.24;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return normalize({
    x: base.x * cos - base.y * sin,
    y: base.x * sin + base.y * cos
  });
}

function numericAntId(id: string): number {
  const numericId = Number(id.replace("ant-", ""));
  return Number.isFinite(numericId) ? numericId : 0;
}

function moveToward(ant: Ant, target: Vec2, speed: number): void {
  const direction = normalize({ x: target.x - ant.pos.x, y: target.y - ant.pos.y });
  ant.heading = direction;
  ant.pos.x += direction.x * speed;
  ant.pos.y += direction.y * speed;
}

function surfaceMoveSpeed(world: World, ant: Ant): number {
  const nearbyWorkers = world.ants.filter(
    (other) =>
      other.id !== ant.id &&
      other.layer === "surface" &&
      other.state !== "dead" &&
      distance(other.pos, ant.pos) <= CONFIG.defenseRadius
  ).length;

  return nearbyWorkers >= CONFIG.antMobCountThreshold
    ? CONFIG.workerSurfaceSpeed + CONFIG.antMobSpeedBonus
    : CONFIG.workerSurfaceSpeed;
}

function moveSurfaceToward(world: World, ant: Ant, target: Vec2, avoidSpiders: boolean): void {
  const speed = surfaceMoveSpeed(world, ant);
  let direction = normalize({ x: target.x - ant.pos.x, y: target.y - ant.pos.y });

  if (avoidSpiders) {
    direction = applySpiderAvoidance(world, ant.pos, direction, speed);
  }

  direction = applySeparation(world, ant, direction);

  ant.heading = direction;
  ant.pos.x += direction.x * speed;
  ant.pos.y += direction.y * speed;
  clampToSurface(ant, world);
}

function clampToSurface(ant: Ant, world: World): void {
  const margin = 1.5;
  const oldX = ant.pos.x;
  const oldY = ant.pos.y;

  ant.pos.x = Math.max(margin, Math.min(world.surface.width - margin, ant.pos.x));
  ant.pos.y = Math.max(margin, Math.min(world.surface.height - margin, ant.pos.y));

  if (ant.pos.x !== oldX) {
    ant.heading.x = -ant.heading.x;
  }
  if (ant.pos.y !== oldY) {
    ant.heading.y = -ant.heading.y;
  }
}

function clampToUnderground(ant: Ant, world: World): void {
  ant.pos.x = Math.max(0, Math.min(world.underground.width - 0.01, ant.pos.x));
  ant.pos.y = Math.max(0, Math.min(world.underground.height - 0.01, ant.pos.y));
}

function posTile(pos: Vec2): Vec2 {
  return {
    x: Math.max(0, Math.min(CONFIG.undergroundWidth - 1, Math.floor(pos.x))),
    y: Math.max(0, Math.min(CONFIG.undergroundHeight - 1, Math.floor(pos.y)))
  };
}

function tileKey(tile: Vec2): string {
  return `${tile.x}:${tile.y}`;
}

function isDugPos(world: World, pos: Vec2): boolean {
  const tile = posTile(pos);
  return isDugTile(world.underground, tile.x, tile.y);
}

function findNearestDugTile(world: World, from: Vec2): Vec2 | null {
  const start = posTile(from);
  if (isDugTile(world.underground, start.x, start.y)) {
    return start;
  }

  for (let radius = 1; radius <= 8; radius += 1) {
    for (let y = start.y - radius; y <= start.y + radius; y += 1) {
      for (let x = start.x - radius; x <= start.x + radius; x += 1) {
        if (isDugTile(world.underground, x, y)) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

function findDugPathNext(world: World, from: Vec2, to: Vec2): Vec2 | null {
  const start = posTile(from);
  const target = posTile(to);
  if (!isDugTile(world.underground, target.x, target.y)) {
    return null;
  }
  if (!isDugTile(world.underground, start.x, start.y)) {
    return findNearestDugTile(world, from);
  }
  if (start.x === target.x && start.y === target.y) {
    return target;
  }

  const queue: Vec2[] = [start];
  const cameFrom = new Map<string, string | null>([[tileKey(start), null]]);
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  while (queue.length > 0) {
    const current = queue.shift() as Vec2;
    if (current.x === target.x && current.y === target.y) {
      break;
    }

    for (const dir of dirs) {
      const next = { x: current.x + dir.x, y: current.y + dir.y };
      const key = tileKey(next);
      if (cameFrom.has(key) || !isDugTile(world.underground, next.x, next.y)) {
        continue;
      }
      cameFrom.set(key, tileKey(current));
      queue.push(next);
    }
  }

  const targetKey = tileKey(target);
  if (!cameFrom.has(targetKey)) {
    return null;
  }

  let cursorKey = targetKey;
  let previousKey = cameFrom.get(cursorKey);
  while (previousKey && previousKey !== tileKey(start)) {
    cursorKey = previousKey;
    previousKey = cameFrom.get(cursorKey);
  }

  const [x, y] = cursorKey.split(":").map(Number);
  return { x, y };
}

function moveUndergroundToward(world: World, ant: Ant, target: Vec2, speed: number = CONFIG.workerUndergroundSpeed): boolean {
  const nextTile = findDugPathNext(world, ant.pos, target);
  if (!nextTile) {
    const fallback = findNearestDugTile(world, ant.pos);
    if (fallback) {
      ant.pos = tileCenter(fallback);
      clampToUnderground(ant, world);
    }
    return false;
  }

  const nextTarget = nextTile.x === posTile(target).x && nextTile.y === posTile(target).y ? target : tileCenter(nextTile);
  moveToward(ant, nextTarget, Math.min(speed, Math.max(0.15, distance(ant.pos, nextTarget))));
  clampToUnderground(ant, world);
  return isDugPos(world, ant.pos);
}

function moveUndergroundToNode(world: World, ant: Ant, destination: UndergroundNode): boolean {
  const target = world.underground[destination];
  return moveUndergroundToward(world, ant, target);
}

function restNodeForAnt(ant: Ant): UndergroundNode {
  return numericAntId(ant.id) % 2 === 0 ? "barracksA" : "barracksB";
}

function restTargetForAnt(world: World, ant: Ant, node: UndergroundNode): Vec2 {
  const base = node === "barracksA" ? world.underground.barracksA : world.underground.barracksB;
  const seed = numericAntId(ant.id);
  const angle = seed * 2.399963229728653;
  const radius = 1.2 + (seed % 5) * 0.45;
  return {
    x: Math.max(0, Math.min(world.underground.width - 0.01, base.x + Math.cos(angle) * radius)),
    y: Math.max(0, Math.min(world.underground.height - 0.01, base.y + Math.sin(angle) * radius))
  };
}

function restUnderground(world: World, ant: Ant): void {
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

function queenGuardIds(world: World): Set<string> {
  if (world.underground.brood.length > 0) {
    return new Set();
  }

  return new Set(
    world.ants
      .filter((ant) => ant.layer === "underground" && ant.state === "idle" && ant.carrying <= 0)
      .sort((a, b) => numericAntId(a.id) - numericAntId(b.id))
      .slice(0, CONFIG.maxNurses)
      .map((ant) => ant.id)
  );
}

function guardQueen(world: World, ant: Ant): void {
  ant.state = "idle";
  ant.job = "idle";
  if (distance(ant.pos, world.underground.queenChamber) <= CONFIG.undergroundNodeRadius) {
    return;
  }

  moveUndergroundToNode(world, ant, "queenChamber");
}

function broodTarget(world: World, brood: Brood): Vec2 {
  return brood.location === "queen" ? world.underground.queenChamber : world.underground.nursery;
}

function hasDugRoom(world: World, type: "storage" | "nursery" | "queen" | "egg" | "barracks"): boolean {
  return world.underground.rooms.some((room) => room.type === type);
}

function getBrood(world: World, broodId: string | undefined): Brood | undefined {
  if (!broodId) {
    return undefined;
  }

  return world.underground.brood.find((brood) => brood.id === broodId);
}

function assignedFeederCount(world: World, broodId: string): number {
  return world.ants.filter((ant) => ant.layer === "underground" && ant.state === "feed" && ant.broodId === broodId).length;
}

function isColonyStarving(world: World): boolean {
  const surfaceFood = world.surface.foodSources.reduce((total, source) => total + Math.max(0, source.amount), 0);
  return surfaceFood <= CONFIG.starveFoodThreshold && world.underground.foodStorage <= world.directives.spiderAttackStorage;
}

function isColonyWarHungry(world: World): boolean {
  const surfaceFood = world.surface.foodSources.reduce((total, source) => total + Math.max(0, source.amount), 0);
  return surfaceFood <= CONFIG.starveFoodThreshold && world.underground.foodStorage <= CONFIG.warHungerThreshold;
}

function hasAvailableSurfaceFood(world: World): boolean {
  return world.surface.foodSources.some((source) => source.amount > 0);
}

function canUseStorageMeal(world: World, ignoreSurfaceFood = false): boolean {
  return (ignoreSurfaceFood || !hasAvailableSurfaceFood(world)) && world.underground.foodStorage >= CONFIG.workerMealCost;
}

function maybeFeedUndergroundAnt(world: World, ant: Ant, ignoreSurfaceFood = false): boolean {
  if (ant.energy >= world.directives.refuelThreshold || !canUseStorageMeal(world, ignoreSurfaceFood)) {
    return false;
  }

  world.underground.foodStorage -= CONFIG.workerMealCost;
  ant.energy = CONFIG.maxEnergy;
  return true;
}

function nearestSpider(world: World, pos: Vec2): { index: number; distance: number } {
  let index = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  world.enemies.forEach((enemy, enemyIndex) => {
    if (enemy.type !== "spider" || enemy.hp <= 0) {
      return;
    }

    const enemyDistance = distance(pos, enemy.pos);
    if (enemyDistance > CONFIG.antSpiderSightRadius) {
      return;
    }

    if (enemyDistance < nearestDistance) {
      nearestDistance = enemyDistance;
      index = enemyIndex;
    }
  });

  return { index, distance: nearestDistance };
}

function spiderAttackRadius(enemy: { hunger: number }): number {
  return enemy.hunger >= CONFIG.spiderHungryThreshold ? CONFIG.spiderHungryAttackRadius : CONFIG.spiderAttackRadius;
}

function isThreateningSpider(world: World, spiderIndex: number): boolean {
  const enemy = world.enemies[spiderIndex];
  if (!enemy || enemy.type !== "spider" || enemy.hp <= 0) {
    return false;
  }

  const attackRadius = spiderAttackRadius(enemy);
  return world.ants.some(
    (ant) => ant.layer === "surface" && ant.state !== "dead" && distance(ant.pos, enemy.pos) <= attackRadius
  );
}

function defenderCountForSpider(world: World, spiderIndex: number): number {
  const enemy = world.enemies[spiderIndex];
  if (!enemy) {
    return 0;
  }

  return world.ants.filter(
    (ant) =>
      ant.layer === "surface" &&
      ant.state === "fight" &&
      ant.carrying <= 0 &&
      distance(ant.pos, enemy.pos) <= CONFIG.defenseRadius
  ).length;
}

function freeWorkerCountNearSpider(world: World, spiderIndex: number): number {
  const enemy = world.enemies[spiderIndex];
  if (!enemy) {
    return 0;
  }

  return world.ants.filter(
    (ant) =>
      ant.layer === "surface" &&
      ant.state !== "dead" &&
      ant.carrying <= 0 &&
      distance(ant.pos, enemy.pos) <= CONFIG.defenseRadius
  ).length;
}

function activeSurfaceForagers(world: World): number {
  return world.ants.filter(
    (ant) => ant.layer === "surface" && ant.state !== "dead" && ant.carrying <= 0 && ant.state !== "fight"
  ).length;
}

function enemyColonyAnts(world: World, ant: Ant): Ant[] {
  return (world.colonies ?? [])
    .filter((colony) => colony.id !== ant.colonyId)
    .flatMap((colony) => colony.ants)
    .filter((other) => other.layer === "surface" && other.state !== "dead");
}

function nearestEnemyAnt(world: World, ant: Ant): { ant: Ant; distance: number } | null {
  let nearest: { ant: Ant; distance: number } | null = null;
  for (const enemy of enemyColonyAnts(world, ant)) {
    const enemyDistance = distance(ant.pos, enemy.pos);
    if (!nearest || enemyDistance < nearest.distance) {
      nearest = { ant: enemy, distance: enemyDistance };
    }
  }
  return nearest;
}

function nearestEnemyNest(world: World, ant: Ant): Vec2 | null {
  let nearest: { pos: Vec2; distance: number } | null = null;
  for (const colony of world.colonies ?? []) {
    if (colony.id === ant.colonyId) {
      continue;
    }
    const nestDistance = distance(ant.pos, colony.surfaceEntrance);
    if (!nearest || nestDistance < nearest.distance) {
      nearest = { pos: colony.surfaceEntrance, distance: nestDistance };
    }
  }
  return nearest?.pos ?? null;
}

function handleEnemyColonyCombat(world: World, ant: Ant): boolean {
  if (ant.carrying > 0 || ant.layer !== "surface") {
    return false;
  }

  const nearest = nearestEnemyAnt(world, ant);
  if (nearest && nearest.distance <= CONFIG.antCombatRadius) {
    ant.state = "fight";
    ant.heading = normalize({ x: nearest.ant.pos.x - ant.pos.x, y: nearest.ant.pos.y - ant.pos.y });
    nearest.ant.energy -= CONFIG.antVsAntDamage;
    ant.energy -= CONFIG.antVsAntDamage * 0.55;
    if (nearest.ant.energy <= 0) {
      nearest.ant.state = "dead";
    }
    if (ant.energy <= 0) {
      ant.state = "dead";
    }
    return true;
  }

  if (!isColonyWarHungry(world)) {
    return false;
  }

  const target = nearest?.ant.pos ?? nearestEnemyNest(world, ant);
  if (!target) {
    return false;
  }

  ant.state = "fight";
  moveSurfaceToward(world, ant, target, false);
  return true;
}

function shouldReturnFromSurface(world: World, ant: Ant): boolean {
  return ant.state !== "return" && ant.carrying <= 0 && activeSurfaceForagers(world) > world.directives.activeTarget;
}

function retreatFromSpiderToEntrance(world: World, ant: Ant, spiderPos: Vec2): void {
  const speed = surfaceMoveSpeed(world, ant);
  const away = normalize({ x: ant.pos.x - spiderPos.x, y: ant.pos.y - spiderPos.y });
  const home = normalize({ x: world.surface.entrance.x - ant.pos.x, y: world.surface.entrance.y - ant.pos.y });
  let direction = normalize({ x: away.x * 1.4 + home.x, y: away.y * 1.4 + home.y });

  direction = applySeparation(world, ant, direction);

  ant.state = "search";
  ant.heading = direction;
  ant.pos.x += direction.x * speed;
  ant.pos.y += direction.y * speed;
  clampToSurface(ant, world);
  tryCrossLayer(world, ant);
}

function applySpiderAvoidance(world: World, pos: Vec2, desired: Vec2, speed: number): Vec2 {
  const spider = nearestSpider(world, pos);
  if (spider.index < 0) {
    return desired;
  }

  const enemy = world.enemies[spider.index];
  const nextPos = {
    x: pos.x + desired.x * speed,
    y: pos.y + desired.y * speed
  };
  const nextDistance = distance(nextPos, enemy.pos);
  if (nextDistance >= world.directives.spiderAvoidRadius && spider.distance >= world.directives.spiderAvoidRadius) {
    return desired;
  }

  const away = normalize({ x: pos.x - enemy.pos.x, y: pos.y - enemy.pos.y });
  if (nextDistance < world.directives.spiderAvoidRadius) {
    return away;
  }

  const strength = Math.max(0, (world.directives.spiderAvoidRadius - spider.distance) / world.directives.spiderAvoidRadius);
  return normalize({
    x: desired.x + away.x * (1.8 + strength * 2.6),
    y: desired.y + away.y * (1.8 + strength * 2.6)
  });
}

function applySeparation(world: World, ant: Ant, desired: Vec2): Vec2 {
  let separationX = 0;
  let separationY = 0;
  let count = 0;

  const separationRadius = 1.8;

  for (const other of world.ants) {
    if (other.id === ant.id || other.layer !== "surface" || other.state === "dead") {
      continue;
    }

    const dist = distance(ant.pos, other.pos);
    if (dist < separationRadius && dist > 0.01) {
      const force = (separationRadius - dist) / separationRadius;
      separationX += ((ant.pos.x - other.pos.x) / dist) * force;
      separationY += ((ant.pos.y - other.pos.y) / dist) * force;
      count += 1;
    }
  }

  if (count === 0) {
    return desired;
  }

  const separationWeight = 0.45;
  const repel = normalize({ x: separationX, y: separationY });

  return normalize({
    x: desired.x * (1 - separationWeight) + repel.x * separationWeight,
    y: desired.y * (1 - separationWeight) + repel.y * separationWeight
  });
}

function busyNurseCount(world: World): number {
  return world.ants.filter((ant) => ant.layer === "underground" && (ant.state === "carryBrood" || ant.state === "feed")).length;
}

function needsBroodTransport(brood: Brood): boolean {
  return brood.stage === "egg" && brood.location === "queen";
}

function pendingBroodTransportCount(world: World): number {
  return world.underground.brood.filter((brood) => needsBroodTransport(brood) && !brood.carriedBy && !hasAssignedCarrier(world, brood.id)).length;
}

function activeNurseLaborCount(world: World): number {
  return world.ants.filter(
    (ant) =>
      (ant.layer === "underground" && (ant.state === "carryBrood" || ant.state === "feed")) ||
      (ant.layer === "surface" && ant.job === "nurse" && ant.state === "return")
  ).length;
}

function needsSurfaceNurseReturn(world: World): boolean {
  if (!hasDugRoom(world, "nursery") || pendingBroodTransportCount(world) <= 0) {
    return false;
  }

  const targetNurses = Math.max(1, Math.min(CONFIG.maxNurses, world.directives.nurseTarget));
  return activeNurseLaborCount(world) < targetNurses;
}

function hasAssignedCarrier(world: World, broodId: string): boolean {
  return world.ants.some((ant) => ant.layer === "underground" && ant.state === "carryBrood" && ant.broodId === broodId);
}

function moveCarryingBrood(world: World, ant: Ant): void {
  ant.job = "nurse";
  const brood = getBrood(world, ant.broodId);
  if (!brood) {
    ant.broodId = undefined;
    ant.state = "idle";
    ant.job = "idle";
    return;
  }

  if (!brood.carriedBy) {
    if (brood.location === "nursery" && !hasDugRoom(world, "nursery")) {
      ant.broodId = undefined;
      ant.state = "idle";
      return;
    }
    const pickupNode: UndergroundNode = brood.location === "queen" ? "queenChamber" : "nursery";
    const target = broodTarget(world, brood);
    if (distance(ant.pos, target) <= CONFIG.undergroundNodeRadius) {
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

  if (distance(ant.pos, world.underground.nursery) <= CONFIG.undergroundNodeRadius) {
    brood.location = "nursery";
    brood.pos = { ...world.underground.nursery };
      brood.carriedBy = undefined;
      ant.broodId = undefined;
      ant.state = "idle";
      ant.job = "idle";
      return;
  }

  moveUndergroundToNode(world, ant, "nursery");
  brood.pos = { ...ant.pos };
}

function moveFeedingBrood(world: World, ant: Ant): void {
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
    ant.job = "idle";
    return;
  }

  if (distance(ant.pos, world.underground.nursery) > CONFIG.undergroundNodeRadius) {
    moveUndergroundToNode(world, ant, "nursery");
  } else if (distance(ant.pos, brood.pos) > 2) {
    moveToward(ant, brood.pos, CONFIG.workerUndergroundSpeed);
    clampToUnderground(ant, world);
  } else {
    ant.heading = normalize({ x: brood.pos.x - ant.pos.x, y: brood.pos.y - ant.pos.y });
  }
}

function assignNurseTask(world: World, ant: Ant): boolean {
  const nurseryReady = hasDugRoom(world, "nursery");
  const broodToMove = nurseryReady
    ? world.underground.brood.find((brood) => needsBroodTransport(brood) && !brood.carriedBy && !hasAssignedCarrier(world, brood.id))
    : undefined;
  const nurseDemand = broodToMove ? Math.max(1, world.directives.nurseTarget) : world.directives.nurseTarget;

  if (
    ant.state !== "idle" ||
    ant.carrying > 0 ||
    ant.energy < world.directives.refuelThreshold ||
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

function assignedDigTargets(world: World, ant: Ant): Set<string> {
  return new Set();
}

function clearDigAssignment(ant: Ant): void {
  ant.digTaskId = undefined;
  ant.digTarget = undefined;
  ant.digStandPos = undefined;
  ant.digProgress = undefined;
  ant.carryingDirt = false;
}

function moveCarryingDirt(world: World, ant: Ant): boolean {
  ant.state = "carryDirt";
  ant.job = "carryDirt";
  ant.carryingDirt = true;
  if (distance(ant.pos, world.underground.entrance) <= CONFIG.undergroundNodeRadius) {
    world.underground.dirtMound += CONFIG.dirtPerDugTile;
    clearDigAssignment(ant);
    ant.state = "idle";
    ant.job = "idle";
    return true;
  }

  moveUndergroundToNode(world, ant, "entrance");
  return true;
}

function moveDigging(world: World, ant: Ant): boolean {
  refreshDigTasks(world.underground);

  if (ant.carryingDirt || ant.state === "carryDirt") {
    return moveCarryingDirt(world, ant);
  }

  let target = ant.digTarget && ant.digStandPos && ant.digTaskId
    ? { taskId: ant.digTaskId, tile: ant.digTarget, standPos: ant.digStandPos }
    : null;

  if (!target || world.underground.grid[target.tile.y]?.[target.tile.x]?.type !== "soil") {
    const next = findDigTarget(world.underground, assignedDigTargets(world, ant));
    if (!next) {
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
  if (distance(ant.pos, target.standPos) > 0.55) {
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
  ant.digProgress = current.digProgress;
  if (current) {
    current.digProgress = ant.digProgress;
  }

  if (current.digProgress >= CONFIG.digProgressPerTile && completeDigTile(world.underground, target.taskId, target.tile)) {
    ant.carryingDirt = true;
    ant.state = "carryDirt";
    ant.job = "carryDirt";
    ant.digProgress = 0;
  }
  return true;
}

function assignDigTask(world: World, ant: Ant): boolean {
  if (
    ant.layer !== "underground" ||
    ant.carrying > 0 ||
    ant.state !== "idle"
  ) {
    return false;
  }

  const activeDiggers = world.ants.filter(
    (other) => other.layer === "underground" && (other.state === "dig" || other.state === "carryDirt")
  ).length;
  if (activeDiggers >= CONFIG.maxDiggers) {
    return false;
  }

  return moveDigging(world, ant);
}

function nearestAvailableFood(world: World, ant: Ant): number {
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  world.surface.foodSources.forEach((source, index) => {
    if (source.amount <= 0) {
      return;
    }

    const sourceDistance = distance(ant.pos, source.pos);
    if (sourceDistance < nearestDistance) {
      nearestDistance = sourceDistance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function pickupFoodIfReached(world: World, ant: Ant, foodIndex: number): boolean {
  const source = world.surface.foodSources[foodIndex];
  if (!source || source.amount <= 0 || distance(ant.pos, source.pos) > CONFIG.foodPickupRadius) {
    return false;
  }

  source.amount = Math.max(0, source.amount - 1);
  ant.energy = CONFIG.maxEnergy;
  ant.carrying = 1;
  ant.state = "carry";
  return true;
}

function moveHungryToFood(world: World, ant: Ant): boolean {
  const foodIndex = nearestAvailableFood(world, ant);
  if (foodIndex < 0) {
    return false;
  }

  if (pickupFoodIfReached(world, ant, foodIndex)) {
    return true;
  }

  ant.state = "search";
  ant.job = "forage";
  moveSurfaceToward(world, ant, world.surface.foodSources[foodIndex].pos, !isColonyStarving(world));
  return true;
}

function moveHungryHome(world: World, ant: Ant): void {
  ant.state = "return";
  ant.job = "forage";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world));
  tryCrossLayer(world, ant);
}

function moveNurseHome(world: World, ant: Ant): void {
  ant.state = "return";
  ant.job = "nurse";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world));
  tryCrossLayer(world, ant);
}
function moveSearching(world: World, ant: Ant): void {
  ant.job = "forage";
  const speed = surfaceMoveSpeed(world, ant);
  const foodIndex = nearestAvailableFood(world, ant);
  if (foodIndex >= 0 && pickupFoodIfReached(world, ant, foodIndex)) {
    return;
  }

  if (foodIndex >= 0 && distance(ant.pos, world.surface.foodSources[foodIndex].pos) <= CONFIG.foodDirectApproachRange) {
    ant.state = "search";
    moveSurfaceToward(world, ant, world.surface.foodSources[foodIndex].pos, false);
    return;
  }

  world.pheromones.home.add(ant.pos.x, ant.pos.y, CONFIG.homePheromoneDeposit);

  // Проверяем, есть ли вообще еда на карте
  const foodAvailable = world.surface.foodSources.some((source) => source.amount > 0);

  // Если еды нет, градиент феромонов еды не учитываем (чистая разведка)
  const gradient = foodAvailable
    ? world.pheromones.food.sampleGradient(ant.pos.x, ant.pos.y)
    : { x: 0, y: 0, strength: 0 };

  const density = foodAvailable
    ? world.pheromones.food.getInterpolated(ant.pos.x, ant.pos.y)
    : 0;

  const jitter = randomHeading();
  const gradientPower = Math.min(2.5, gradient.strength) * CONFIG.pheromoneGradientWeight;
  const nearestFood = foodIndex >= 0 ? world.surface.foodSources[foodIndex] : null;
  const nearestFoodDistance = nearestFood ? distance(ant.pos, nearestFood.pos) : Number.POSITIVE_INFINITY;
  const directFood =
    nearestFood && nearestFoodDistance <= CONFIG.antFoodSightRadius
      ? normalize({ x: nearestFood.pos.x - ant.pos.x, y: nearestFood.pos.y - ant.pos.y })
      : null;

  // Если не видим еду напрямую, но стоим на сильном феромоне — увеличиваем блуждание (локальный поиск)
  const wanderWeight = directFood
    ? world.directives.forageWander * 0.35
    : world.directives.forageWander * (1.0 + Math.min(3.0, density / 4.0));

  const direction = normalize({
    x: ant.heading.x * 0.35 + gradient.x * gradientPower + (directFood?.x ?? 0) * 1.4 + jitter.x * wanderWeight,
    y: ant.heading.y * 0.35 + gradient.y * gradientPower + (directFood?.y ?? 0) * 1.4 + jitter.y * wanderWeight
  });
  const safeDirection = isColonyStarving(world) ? direction : applySpiderAvoidance(world, ant.pos, direction, speed);

  const finalDirection = applySeparation(world, ant, safeDirection);
  ant.heading = finalDirection;
  ant.pos.x += finalDirection.x * speed;
  ant.pos.y += finalDirection.y * speed;
  clampToSurface(ant, world);
}

function moveCarrying(world: World, ant: Ant): void {
  ant.job = "forage";
  world.pheromones.food.add(ant.pos.x, ant.pos.y, CONFIG.foodPheromoneDeposit);

  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world));
  tryCrossLayer(world, ant);
}

function moveFighting(world: World, ant: Ant): boolean {
  const starving = isColonyStarving(world);
  const nearest = nearestSpider(world, ant.pos);
  if (nearest.index < 0) {
    if (ant.state === "fight") {
      ant.state = "search";
    }
    return false;
  }

  const defensiveThreat =
    ant.carrying <= 0 &&
    isThreateningSpider(world, nearest.index) &&
    nearest.distance <= CONFIG.defenseRadius &&
    (ant.state === "fight" || defenderCountForSpider(world, nearest.index) < CONFIG.defenseMaxHelpers);
  const alertNearSpider = ant.carrying <= 0 && nearest.distance <= CONFIG.antAlertRange;
  const enoughMob = alertNearSpider && freeWorkerCountNearSpider(world, nearest.index) >= CONFIG.antMobCount;
  const mobThreat =
    enoughMob && (ant.state === "fight" || defenderCountForSpider(world, nearest.index) < CONFIG.defenseMaxHelpers);

  if (!starving && !defensiveThreat && !mobThreat) {
    if (alertNearSpider) {
      retreatFromSpiderToEntrance(world, ant, world.enemies[nearest.index].pos);
      return true;
    }

    if (ant.state === "fight") {
      ant.state = "search";
    }
    return false;
  }

  const enemy = world.enemies[nearest.index];
  const enemyDistance = distance(ant.pos, enemy.pos);
  if (enemyDistance <= CONFIG.spiderAttackRadius) {
    ant.state = "fight";
    ant.heading = normalize({ x: enemy.pos.x - ant.pos.x, y: enemy.pos.y - ant.pos.y });
    return true;
  }

  ant.state = "fight";
  moveSurfaceToward(world, ant, enemy.pos, false);
  return true;
}

function stepUnderground(world: World, ant: Ant): void {
  maybeFeedUndergroundAnt(world, ant);

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

  if (assignNurseTask(world, ant)) {
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

  if (activeSurfaceForagers(world) >= world.directives.activeTarget) {
    restUnderground(world, ant);
    return;
  }

  ant.state = "toEntrance";
  moveUndergroundToNode(world, ant, "entrance");
  tryCrossLayer(world, ant);
}

function stepSurface(world: World, ant: Ant): void {
  if (handleEnemyColonyCombat(world, ant)) {
    return;
  }

  if (ant.state === "carry") {
    moveCarrying(world, ant);
    return;
  }

  if (moveFighting(world, ant)) {
    return;
  }

  if (ant.state === "return" && ant.job === "nurse" && pendingBroodTransportCount(world) > 0) {
    moveNurseHome(world, ant);
    return;
  }

  if (ant.carrying <= 0 && needsSurfaceNurseReturn(world)) {
    moveNurseHome(world, ant);
    return;
  }

  if (ant.state === "return" || shouldReturnFromSurface(world, ant)) {
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
    } else if (canUseStorageMeal(world)) {
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

export function tryCrossLayer(world: World, ant: Ant): boolean {
  if (ant.layer === "underground" && distance(ant.pos, world.underground.entrance) <= CONFIG.entranceRadiusUnderground) {
    ant.layer = "surface";
    ant.state = "search";
    ant.pos = { ...world.surface.entrance };
    ant.heading = fanDirection(randomHeading(), ant.id);
    ant.pos.x += ant.heading.x * CONFIG.workerSurfaceSpeed;
    ant.pos.y += ant.heading.y * CONFIG.workerSurfaceSpeed;
    clampToSurface(ant, world);
    return true;
  }

  if (ant.layer === "surface" && distance(ant.pos, world.surface.entrance) <= CONFIG.entranceRadiusSurface) {
    ant.layer = "underground";
    ant.state = ant.carrying > 0 ? "deposit" : "idle";
    ant.pos = { ...world.underground.entrance };
    ant.heading = { x: -1, y: 0 };
    return true;
  }

  return false;
}
