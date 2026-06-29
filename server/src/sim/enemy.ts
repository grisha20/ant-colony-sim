import type { Ant, Enemy, Vec2 } from "../../../shared/types";
import { applyMode, chooseMode, hasAvailableCarrion, isSpiderFastMode, type SpiderMode } from "../ai/spiderBrain";
import { recordAndEvolveSpider, saveSpiderGenome } from "../ai/spiderGenome";
import { CONFIG } from "../config";
import { tickCache } from "./cache";
import { isWithinRadius } from "./ant/utils";
import { addFoodSource, type World } from "./world";

const enemyQueryScratch: Ant[] = [];

let nextEnemyId = 1;
let spiderRespawnTick: number | null = null;
const spiderHeadings = new Map<string, Vec2>();
const spiderModes = new Map<string, { mode: SpiderMode; repickAt: number }>();
const spiderStarveTicks = new Map<string, number>();

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function randomSurfacePoint(): Vec2 {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pos = {
      x: 8 + Math.random() * (CONFIG.mapWidth - 16),
      y: 8 + Math.random() * (CONFIG.mapHeight - 16)
    };

    if (!isWithinRadius(pos, CONFIG.surfaceEntrance, CONFIG.spiderAvoidRadius * 2.5)) {
      return pos;
    }
  }

  return { x: CONFIG.mapWidth - 12, y: 12 };
}

function randomLairPoint(): Vec2 {
  const margin = CONFIG.spiderLairEdgeMargin;
  const minNestDistance = Math.min(CONFIG.mapWidth, CONFIG.mapHeight) * 0.38;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const side = Math.floor(Math.random() * 4);
    const pos = clampSurface(
      side === 0
        ? { x: Math.random() * margin, y: Math.random() * CONFIG.mapHeight }
        : side === 1
          ? { x: CONFIG.mapWidth - Math.random() * margin, y: Math.random() * CONFIG.mapHeight }
          : side === 2
            ? { x: Math.random() * CONFIG.mapWidth, y: Math.random() * margin }
            : { x: Math.random() * CONFIG.mapWidth, y: CONFIG.mapHeight - Math.random() * margin }
    );

    if (!isWithinRadius(pos, CONFIG.surfaceEntrance, minNestDistance) && !isWithinRadius(pos, CONFIG.surfaceEntranceB, minNestDistance)) {
      return pos;
    }
  }

  return clampSurface({ x: CONFIG.mapWidth - margin, y: CONFIG.mapHeight - margin });
}

function randomHeading(): Vec2 {
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function normalize(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.y);
  if (length <= 0.001) {
    return randomHeading();
  }

  return { x: vec.x / length, y: vec.y / length };
}

function clampSurface(pos: Vec2): Vec2 {
  return {
    x: Math.max(1.5, Math.min(CONFIG.mapWidth - 1.5, pos.x)),
    y: Math.max(1.5, Math.min(CONFIG.mapHeight - 1.5, pos.y))
  };
}

function keepAwayFromNest(enemy: Enemy, direction: Vec2, speed: number): Vec2 {
  const next = {
    x: enemy.pos.x + direction.x * speed,
    y: enemy.pos.y + direction.y * speed
  };
  const minNestDistance = CONFIG.spiderAvoidRadius * 2.2;
  if (!isWithinRadius(next, CONFIG.surfaceEntrance, minNestDistance)) {
    return direction;
  }

  const away = normalize({ x: enemy.pos.x - CONFIG.surfaceEntrance.x, y: enemy.pos.y - CONFIG.surfaceEntrance.y });
  return normalize({ x: direction.x + away.x * 3, y: direction.y + away.y * 3 });
}

function wanderDirection(enemy: Enemy): Vec2 {
  const existing = spiderHeadings.get(enemy.id) ?? randomHeading();
  const jitter = randomHeading();
  const direction = normalize({
    x: existing.x * 0.94 + jitter.x * 0.06,
    y: existing.y * 0.94 + jitter.y * 0.06
  });
  spiderHeadings.set(enemy.id, direction);
  return direction;
}

function loneChaseTarget(world: World, enemy: Enemy): Vec2 | null {
  if (enemy.hunger < CONFIG.spiderHungryThreshold) {
    return null;
  }

  let loneAnt: Vec2 | null = null;
  let nearbyCount = 0;
  const chaseRange = CONFIG.spiderChaseRange;
  const nearby = tickCache.worldSurfaceAntGrid.queryInto(enemy.pos, chaseRange, enemyQueryScratch);
  for (const ant of nearby) {
    if (isWithinRadius(ant.pos, enemy.pos, chaseRange)) {
      nearbyCount += 1;
      if (nearbyCount > 1) {
        return null;
      }
      loneAnt = ant.pos;
    }
  }
  return nearbyCount === 1 ? loneAnt : null;
}

function moveSpider(world: World, enemy: Enemy, liveAntsCount: number): void {
  const genome = world.spiderGenomeState.current;
  const nearest = nearestSurfaceAnt(world, enemy);
  const underPressure = isSpiderUnderPressure(world, enemy);
  const hungry = enemy.hunger >= CONFIG.spiderHungryThreshold;
  const atSafeLair = isWithinRadius(enemy.pos, enemy.lair, CONFIG.spiderLairSafeRadius);
  const desperate = enemy.hunger >= CONFIG.spiderStarveThreshold * CONFIG.spiderDesperateFeedFactor;
  const canFeedUnderPressure = (atSafeLair && enemy.hoard > 0) || desperate;
  const canStoreUnderPressure = nearbyAntCount(world, enemy, CONFIG.spiderStoreSafeRadius) === 0;
  const canStore = enemy.carrying > 0 || (enemy.hoard < CONFIG.spiderHoardMax && hasAvailableCarrion(world));
  if (hungry && (enemy.hoard > 0 || hasAvailableCarrion(world)) && (!underPressure || canFeedUnderPressure)) {
    spiderModes.set(enemy.id, { mode: "feed", repickAt: world.tick + 1 });
    applySpiderMode(world, enemy, "feed", genome);
    return;
  }

  if (!hungry && canStore && (!underPressure || canStoreUnderPressure)) {
    spiderModes.set(enemy.id, { mode: "store", repickAt: world.tick + 1 });
    applySpiderMode(world, enemy, "store", genome);
    return;
  }

  if (
    hungry &&
    nearest &&
    nearest.distance <= CONFIG.spiderEngageRange &&
    enemy.hoard <= 0 &&
    !hasAvailableCarrion(world) &&
    (!underPressure || desperate) &&
    liveAntsCount > 10
  ) {
    spiderModes.set(enemy.id, { mode: "chase", repickAt: world.tick + 1 });
    applySpiderMode(world, enemy, "chase", genome);
    return;
  }

  let state = spiderModes.get(enemy.id);
  if (!state || world.tick >= state.repickAt) {
    const patience = Math.round(genome.genes.patience * (1 + CONFIG.spiderModeRepickPenalty * Math.random()));
    state = {
      mode: chooseMode(world, enemy, genome),
      repickAt: world.tick + Math.max(1, patience)
    };
    spiderModes.set(enemy.id, state);
  }

  applySpiderMode(world, enemy, state.mode, genome);
}

function liveAntCount(world: World): number {
  return tickCache.worldLiveAntsCount;
}

function updateSpiderStamina(enemy: Enemy, fastMode: boolean): void {
  if (fastMode && enemy.tiredLeft <= 0 && enemy.sprintLeft > 0) {
    enemy.sprintLeft -= 1;
    if (enemy.sprintLeft <= 0) {
      enemy.sprintLeft = 0;
      enemy.tiredLeft = CONFIG.spiderRecoveryTicks;
    }
    return;
  }

  if (enemy.tiredLeft > 0) {
    enemy.tiredLeft -= 1;
    if (enemy.tiredLeft <= 0) {
      enemy.tiredLeft = 0;
      enemy.sprintLeft = CONFIG.spiderSprintTicks;
    }
  }
}

function applySpiderMode(
  world: World,
  enemy: Enemy,
  mode: SpiderMode,
  genome: Parameters<typeof applyMode>[3]
): void {
  applyMode(world, enemy, mode, genome);
  updateSpiderStamina(enemy, isSpiderFastMode(mode));
}

function nearestSurfaceAnt(world: World, enemy: Enemy): { distance: number } | null {
  let nearestDist = Number.POSITIVE_INFINITY;
  let found = false;
  const ants = tickCache.worldSurfaceAnts;
  for (const ant of ants) {
    const antDistance = distance(ant.pos, enemy.pos);
    if (antDistance < nearestDist) {
      nearestDist = antDistance;
      found = true;
    }
  }
  return found ? { distance: nearestDist } : null;
}

function nearbyAntCount(world: World, enemy: Enemy, radius: number): number {
  let count = 0;
  const nearby = tickCache.worldSurfaceAntGrid.queryInto(enemy.pos, radius, enemyQueryScratch);
  for (const ant of nearby) {
    if (isWithinRadius(ant.pos, enemy.pos, radius)) {
      count += 1;
    }
  }
  return count;
}

export function createSpider(): Enemy {
  const id = `enemy-${nextEnemyId}`;
  nextEnemyId += 1;
  const lair = randomLairPoint();

  return {
    id,
    type: "spider",
    pos: lair,
    hp: CONFIG.spiderMaxHp,
    maxHp: CONFIG.spiderMaxHp,
    hunger: 0,
    lair,
    carrying: 0,
    hoard: 0,
    sprintLeft: CONFIG.spiderSprintTicks,
    tiredLeft: 0
  };
}

export function syncEnemyIdCounter(enemies: Enemy[], tick: number): void {
  const maxEnemyId = enemies.reduce((max, enemy) => {
    const numeric = Number(enemy.id.replace("enemy-", ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  nextEnemyId = Math.max(nextEnemyId, maxEnemyId + 1);
  spiderRespawnTick = enemies.some((enemy) => enemy.type === "spider") ? null : tick + CONFIG.spiderRespawnTicks;
  for (const enemy of enemies) {
    if (!spiderHeadings.has(enemy.id)) {
      spiderHeadings.set(enemy.id, randomHeading());
    }
    if (!spiderModes.has(enemy.id)) {
      spiderModes.set(enemy.id, { mode: "wander", repickAt: tick });
    }
    if (!spiderStarveTicks.has(enemy.id)) {
      spiderStarveTicks.set(enemy.id, 0);
    }
  }
}

function resetSpiderFitness(world: World): void {
  world.spiderFitness = {
    antsKilled: 0,
    survivalTicks: 0,
    score: 0
  };
}

function updateSpiderFitness(world: World): void {
  world.spiderFitness.survivalTicks += 1;
  world.spiderFitness.score =
    world.spiderFitness.antsKilled * CONFIG.spiderKillWeight +
    world.spiderFitness.survivalTicks * CONFIG.spiderSurviveWeight;
}

function evolveSpiderGeneration(world: World): void {
  world.spiderGenomeState.generationsRun += 1;
  recordAndEvolveSpider(world.spiderGenomeState, world.spiderGenomeState.current, world.spiderFitness.score);
  saveSpiderGenome(world.spiderGenomeState).catch((error: unknown) => {
    console.warn(`Could not save spider genome: ${(error as Error).message}`);
  });
  resetSpiderFitness(world);
  world.colony.spiderGeneration = world.spiderGenomeState.current.generation;
  world.colony.spiderGenerationsRun = world.spiderGenomeState.generationsRun;
}

function isSpiderUnderPressure(world: World, enemy: Enemy): boolean {
  let mobbingFighters = 0;
  const defRad = CONFIG.defenseRadius;
  const nearby = tickCache.worldSurfaceAntGrid.queryInto(enemy.pos, defRad, enemyQueryScratch);
  for (const ant of nearby) {
    if (
      ant.state === "fight" &&
      isWithinRadius(ant.pos, enemy.pos, defRad)
    ) {
      mobbingFighters += 1;
    }
  }
  const hpRatio = enemy.hp / Math.max(1, enemy.maxHp);
  return mobbingFighters >= CONFIG.spiderMobRetreatCount || hpRatio <= CONFIG.spiderLowHpRetreatThreshold;
}

function updateSpiderStarvation(enemy: Enemy): boolean {
  const previous = spiderStarveTicks.get(enemy.id) ?? 0;
  const next = enemy.hunger >= CONFIG.spiderStarveThreshold ? previous + 1 : 0;
  spiderStarveTicks.set(enemy.id, next);
  return next >= CONFIG.spiderStarveBuffer;
}

function creditSpiderKill(world: World, enemy: Enemy): void {
  const creditedColonies = new Set<string>();
  const defRad = CONFIG.defenseRadius;
  const nearby = tickCache.worldSurfaceAntGrid.queryInto(enemy.pos, defRad, enemyQueryScratch);
  for (const ant of nearby) {
    if (ant.state === "fight" && isWithinRadius(ant.pos, enemy.pos, defRad)) {
      creditedColonies.add(ant.colonyId);
    }
  }
  for (const colony of world.colonies ?? []) {
    if (creditedColonies.has(colony.id)) {
      colony.fitness.spidersKilled += 1;
    }
  }
  if (creditedColonies.size === 0) {
    world.fitness.spidersKilled += 1;
  }
}

export function updateEnemies(world: World): void {
  if (world.enemies.length === 0) {
    if (spiderRespawnTick === null) {
      spiderRespawnTick = world.tick + CONFIG.spiderRespawnTicks;
    }
    if (world.tick >= spiderRespawnTick) {
      world.enemies.push(createSpider());
      spiderRespawnTick = null;
    }
    return;
  }

  const deadEnemies = new Set<string>();

  for (const enemy of [...world.enemies]) {
    if (enemy.type !== "spider") {
      continue;
    }

    const liveAntsCount = liveAntCount(world);
    enemy.hunger += CONFIG.spiderHungerPerTick;
    updateSpiderFitness(world);
    if (isSpiderUnderPressure(world, enemy)) {
      spiderModes.delete(enemy.id);
    }
    moveSpider(world, enemy, liveAntsCount);
    const hungry = enemy.hunger >= CONFIG.spiderHungryThreshold;
    const attackRadius = hungry ? CONFIG.spiderHungryAttackRadius : CONFIG.spiderAttackRadius;
    const damage = hungry ? CONFIG.spiderHungryDamage : CONFIG.spiderDamagePerTick;

    const isStartPeriod = liveAntsCount <= 10;

    const attackCandidates = tickCache.worldSurfaceAntGrid.queryInto(enemy.pos, attackRadius, enemyQueryScratch);
    for (const ant of attackCandidates) {
      if (!isStartPeriod && isWithinRadius(ant.pos, enemy.pos, attackRadius)) {
        const hadEnergy = ant.energy > 0;
        ant.energy -= damage;
        if (ant.energy <= 0) {
          ant.state = "dead";
          if (hadEnergy) {
            world.spiderFitness.antsKilled += 1;
            enemy.hunger = Math.max(0, enemy.hunger - CONFIG.spiderFedOnKill);
          }
        }

        if (ant.state === "fight") {
          enemy.hp -= CONFIG.antDamagePerTick * ant.strength;
        }
      }
    }

    const starved = updateSpiderStarvation(enemy);
    if (enemy.hp <= 0) {
      deadEnemies.add(enemy.id);
      addFoodSource(world, enemy.pos.x, enemy.pos.y, CONFIG.spiderCarcassFood, "spiderCarcass");
      creditSpiderKill(world, enemy);
      evolveSpiderGeneration(world);
      spiderRespawnTick = world.tick + CONFIG.spiderRespawnTicks;
    } else if (starved) {
      deadEnemies.add(enemy.id);
      evolveSpiderGeneration(world);
      spiderRespawnTick = world.tick + CONFIG.spiderRespawnTicks;
    } else if (world.spiderFitness.survivalTicks >= CONFIG.spiderLifeMaxTicks) {
      deadEnemies.add(enemy.id);
      evolveSpiderGeneration(world);
      world.enemies.push(createSpider());
      spiderRespawnTick = null;
    }
  }

  if (deadEnemies.size > 0) {
    world.enemies = world.enemies.filter((enemy) => !deadEnemies.has(enemy.id));
    for (const id of deadEnemies) {
      spiderHeadings.delete(id);
      spiderModes.delete(id);
      spiderStarveTicks.delete(id);
    }
  }
}
