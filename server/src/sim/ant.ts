import type { Ant, Brood, Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";
import { nextWaypoint, type UndergroundNode } from "./nav";
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

  ant.heading = direction;
  ant.pos.x += direction.x * speed;
  ant.pos.y += direction.y * speed;
  clampToSurface(ant, world);
}

function clampToSurface(ant: Ant, world: World): void {
  const margin = 1.5;
  ant.pos.x = Math.max(margin, Math.min(world.surface.width - margin, ant.pos.x));
  ant.pos.y = Math.max(margin, Math.min(world.surface.height - margin, ant.pos.y));
}

function clampToUnderground(ant: Ant, world: World): void {
  ant.pos.x = Math.max(0, Math.min(world.underground.width - 0.01, ant.pos.x));
  ant.pos.y = Math.max(0, Math.min(world.underground.height - 0.01, ant.pos.y));
}

function moveUndergroundToNode(world: World, ant: Ant, destination: UndergroundNode): void {
  moveToward(ant, nextWaypoint(ant.pos, destination), CONFIG.workerUndergroundSpeed);
  clampToUnderground(ant, world);
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
  if (distance(ant.pos, target) <= 0.8) {
    return;
  }

  const nodePos = node === "barracksA" ? world.underground.barracksA : world.underground.barracksB;
  if (distance(ant.pos, nodePos) <= CONFIG.undergroundNodeRadius) {
    moveToward(ant, target, CONFIG.workerUndergroundSpeed * 0.35);
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
  if (distance(ant.pos, world.underground.queenChamber) <= CONFIG.undergroundNodeRadius) {
    return;
  }

  moveUndergroundToNode(world, ant, "queenChamber");
}

function broodTarget(world: World, brood: Brood): Vec2 {
  return brood.location === "queen" ? world.underground.queenChamber : world.underground.nursery;
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
  const direction = normalize({ x: away.x * 1.4 + home.x, y: away.y * 1.4 + home.y });
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

function busyNurseCount(world: World): number {
  return world.ants.filter((ant) => ant.layer === "underground" && (ant.state === "carryBrood" || ant.state === "feed")).length;
}

function needsBroodTransport(brood: Brood): boolean {
  return brood.stage === "egg" && brood.location === "queen";
}

function hasAssignedCarrier(world: World, broodId: string): boolean {
  return world.ants.some((ant) => ant.layer === "underground" && ant.state === "carryBrood" && ant.broodId === broodId);
}

function moveCarryingBrood(world: World, ant: Ant): void {
  const brood = getBrood(world, ant.broodId);
  if (!brood) {
    ant.broodId = undefined;
    ant.state = "idle";
    return;
  }

  if (!brood.carriedBy) {
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
    return;
  }

  moveUndergroundToNode(world, ant, "nursery");
  brood.pos = { ...ant.pos };
}

function moveFeedingBrood(world: World, ant: Ant): void {
  const brood = getBrood(world, ant.broodId);
  if (
    !brood ||
    brood.stage !== "larva" ||
    brood.location !== "nursery" ||
    world.underground.foodStorage < CONFIG.nurseMinFoodReserve ||
    ant.energy < world.directives.refuelThreshold
  ) {
    ant.broodId = undefined;
    ant.state = "idle";
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
  if (
    ant.state !== "idle" ||
    ant.carrying > 0 ||
    ant.energy < world.directives.refuelThreshold ||
    world.underground.foodStorage < CONFIG.nurseMinFoodReserve ||
    busyNurseCount(world) >= world.directives.nurseTarget
  ) {
    return false;
  }

  const broodToMove = world.underground.brood.find(
    (brood) => needsBroodTransport(brood) && !brood.carriedBy && !hasAssignedCarrier(world, brood.id)
  );
  if (broodToMove) {
    ant.broodId = broodToMove.id;
    ant.state = "carryBrood";
    moveCarryingBrood(world, ant);
    return true;
  }

  const broodToFeed = world.underground.brood.find(
    (brood) => brood.stage === "larva" && brood.location === "nursery" && assignedFeederCount(world, brood.id) === 0
  );
  if (broodToFeed) {
    ant.broodId = broodToFeed.id;
    ant.state = "feed";
    moveFeedingBrood(world, ant);
    return true;
  }

  return false;
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
  moveSurfaceToward(world, ant, world.surface.foodSources[foodIndex].pos, !isColonyStarving(world));
  return true;
}

function moveHungryHome(world: World, ant: Ant): void {
  ant.state = "return";
  moveSurfaceToward(world, ant, world.surface.entrance, !isColonyStarving(world));
  tryCrossLayer(world, ant);
}

function moveSearching(world: World, ant: Ant): void {
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

  const gradient = world.pheromones.food.sampleGradient(ant.pos.x, ant.pos.y);
  const jitter = randomHeading();
  const gradientPower = Math.min(2.5, gradient.strength) * CONFIG.pheromoneGradientWeight;
  const nearestFood = foodIndex >= 0 ? world.surface.foodSources[foodIndex] : null;
  const nearestFoodDistance = nearestFood ? distance(ant.pos, nearestFood.pos) : Number.POSITIVE_INFINITY;
  const directFood =
    nearestFood && nearestFoodDistance <= CONFIG.antFoodSightRadius
      ? normalize({ x: nearestFood.pos.x - ant.pos.x, y: nearestFood.pos.y - ant.pos.y })
      : null;
  const wanderWeight = directFood ? world.directives.forageWander * 0.35 : world.directives.forageWander;
  const direction = normalize({
    x: ant.heading.x * 0.35 + gradient.x * gradientPower + (directFood?.x ?? 0) * 1.4 + jitter.x * wanderWeight,
    y: ant.heading.y * 0.35 + gradient.y * gradientPower + (directFood?.y ?? 0) * 1.4 + jitter.y * wanderWeight
  });
  const safeDirection = isColonyStarving(world) ? direction : applySpiderAvoidance(world, ant.pos, direction, speed);

  ant.heading = safeDirection;
  ant.pos.x += safeDirection.x * speed;
  ant.pos.y += safeDirection.y * speed;
  clampToSurface(ant, world);
}

function moveCarrying(world: World, ant: Ant): void {
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

  if (ant.state === "deposit") {
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
