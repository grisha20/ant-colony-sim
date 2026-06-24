import type { Ant, Enemy, FoodSource, Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";
import type { World } from "../sim/world";
import type { SpiderGenome } from "./spiderGenome";

export type SpiderMode = "ambush" | "stalk" | "chase" | "retreat" | "feed" | "store" | "wander";

const wanderTargets = new Map<string, Vec2>();
const retreatTargets = new Map<string, Vec2>();

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.y);
  if (length <= 0.001) {
    return { x: 1, y: 0 };
  }

  return { x: vec.x / length, y: vec.y / length };
}

function clampSurface(pos: Vec2): Vec2 {
  return {
    x: Math.max(1.5, Math.min(CONFIG.mapWidth - 1.5, pos.x)),
    y: Math.max(1.5, Math.min(CONFIG.mapHeight - 1.5, pos.y))
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function surfaceAnts(world: World): Ant[] {
  return world.ants.filter((ant) => ant.layer === "surface" && ant.state !== "dead");
}

function nearestFood(world: World, spider: Enemy): FoodSource | null {
  let nearest: FoodSource | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const source of world.surface.foodSources) {
    if (source.amount <= 0) {
      continue;
    }

    const sourceDistance = distance(spider.pos, source.pos);
    if (sourceDistance < nearestDistance) {
      nearest = source;
      nearestDistance = sourceDistance;
    }
  }

  return nearest;
}

function nearestCarrion(world: World, spider: Enemy): FoodSource | null {
  let nearest: FoodSource | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const source of world.surface.carrion) {
    if (source.amount <= 0) {
      continue;
    }

    const sourceDistance = distance(spider.pos, source.pos);
    if (sourceDistance < nearestDistance) {
      nearest = source;
      nearestDistance = sourceDistance;
    }
  }

  return nearest;
}

export function hasAvailableCarrion(world: World): boolean {
  return world.surface.carrion.some((source) => source.amount > 0);
}

function hasStorageWork(world: World, spider: Enemy): boolean {
  return spider.carrying > 0 || (spider.hoard < CONFIG.spiderHoardMax && hasAvailableCarrion(world));
}

function nearestAnt(world: World, spider: Enemy): { ant: Ant; distance: number } | null {
  let nearest: { ant: Ant; distance: number } | null = null;
  for (const ant of surfaceAnts(world)) {
    const antDistance = distance(spider.pos, ant.pos);
    if (!nearest || antDistance < nearest.distance) {
      nearest = { ant, distance: antDistance };
    }
  }

  return nearest;
}

function nearbyAntCount(world: World, spider: Enemy, radius: number): number {
  return surfaceAnts(world).filter((ant) => distance(ant.pos, spider.pos) <= radius).length;
}

function antCentroid(world: World, spider: Enemy): Vec2 | null {
  const ants = surfaceAnts(world);
  if (ants.length === 0) {
    return null;
  }

  const weighted = ants.reduce(
    (total, ant) => {
      const weight = 1 / Math.max(1, distance(spider.pos, ant.pos));
      return {
        x: total.x + ant.pos.x * weight,
        y: total.y + ant.pos.y * weight,
        weight: total.weight + weight
      };
    },
    { x: 0, y: 0, weight: 0 }
  );

  return { x: weighted.x / weighted.weight, y: weighted.y / weighted.weight };
}

function moveToward(spider: Enemy, target: Vec2, speed: number): void {
  const direction = normalize({ x: target.x - spider.pos.x, y: target.y - spider.pos.y });
  spider.pos = clampSurface({
    x: spider.pos.x + direction.x * speed,
    y: spider.pos.y + direction.y * speed
  });
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function activityApproachPoint(activity: Vec2, spider: Enemy, genome: SpiderGenome): Vec2 {
  const fromActivity = normalize({ x: spider.pos.x - activity.x, y: spider.pos.y - activity.y });
  const cautiousDistance = genome.genes.swarmCaution * (1 - genome.genes.aggression) * 0.9;
  const huntDistance = CONFIG.spiderAttackRadius + 1.5 + cautiousDistance;

  return clampSurface({
    x: activity.x + fromActivity.x * huntDistance,
    y: activity.y + fromActivity.y * huntDistance
  });
}

function patrolPoint(spider: Enemy): Vec2 {
  const center = { x: CONFIG.mapWidth / 2, y: CONFIG.mapHeight / 2 };
  const fromCenter = { x: spider.pos.x - center.x, y: spider.pos.y - center.y };
  const currentDistance = Math.hypot(fromCenter.x, fromCenter.y);
  const baseAngle = currentDistance > 4
    ? Math.atan2(fromCenter.y, fromCenter.x)
    : (hashString(spider.id) % 628) / 100;
  const radius = Math.min(CONFIG.mapWidth, CONFIG.mapHeight) * 0.32;
  const nextAngle = baseAngle + 1.05;

  return clampSurface({
    x: center.x + Math.cos(nextAngle) * radius,
    y: center.y + Math.sin(nextAngle) * radius
  });
}

function retreatPoint(world: World, spider: Enemy): Vec2 {
  const existing = retreatTargets.get(spider.id);
  if (existing && distance(spider.pos, existing) > 2.5) {
    return existing;
  }

  const threat = antCentroid(world, spider) ?? CONFIG.surfaceEntrance;
  const away = normalize({ x: spider.pos.x - threat.x, y: spider.pos.y - threat.y });
  const toCenter = normalize({ x: CONFIG.mapWidth / 2 - spider.pos.x, y: CONFIG.mapHeight / 2 - spider.pos.y });
  const edgeCloseness = Math.max(
    0,
    1 - Math.min(spider.pos.x, spider.pos.y, CONFIG.mapWidth - spider.pos.x, CONFIG.mapHeight - spider.pos.y) / 16
  );
  const direction = normalize({
    x: away.x * (1.15 - edgeCloseness * 0.65) + toCenter.x * (1 + edgeCloseness * 1.8),
    y: away.y * (1.15 - edgeCloseness * 0.65) + toCenter.y * (1 + edgeCloseness * 1.8)
  });
  const target = clampSurface({
    x: spider.pos.x + direction.x * 24,
    y: spider.pos.y + direction.y * 24
  });
  retreatTargets.set(spider.id, target);
  return target;
}

function wanderPoint(world: World, spider: Enemy, genome: SpiderGenome): Vec2 {
  const existing = wanderTargets.get(spider.id);
  if (existing && distance(spider.pos, existing) > 2.5) {
    return existing;
  }

  if (spider.hoard > 0) {
    wanderTargets.set(spider.id, spider.lair);
    return spider.lair;
  }

  const activity = antCentroid(world, spider);
  const target = activity ? activityApproachPoint(activity, spider, genome) : patrolPoint(spider);
  wanderTargets.set(spider.id, target);
  return target;
}

function ambushPoint(world: World, spider: Enemy, genome: SpiderGenome): Vec2 {
  const food = nearestFood(world, spider);
  if (food && genome.genes.ambushPreference >= genome.genes.entranceAffinity) {
    return food.pos;
  }

  const angle = genome.genes.entranceAffinity * Math.PI * 2 + spider.pos.x * 0.07;
  const radius = 12 + genome.genes.ambushPreference * 16;
  return clampSurface({
    x: CONFIG.surfaceEntrance.x + Math.cos(angle) * radius,
    y: CONFIG.surfaceEntrance.y + Math.sin(angle) * radius
  });
}

export function chooseMode(world: World, spider: Enemy, genome: SpiderGenome): SpiderMode {
  const hunger = clamp01(spider.hunger / CONFIG.spiderHungryThreshold);
  const hp = clamp01(spider.hp / Math.max(1, spider.maxHp));
  const crowd = nearbyAntCount(world, spider, genome.genes.swarmCaution);
  const mobbingFighters = surfaceAnts(world).filter(
    (ant) => ant.state === "fight" && distance(ant.pos, spider.pos) <= CONFIG.defenseRadius
  ).length;
  const crowdPressure = clamp01(crowd / 5);
  const caution = crowdPressure * (1 - genome.genes.aggression);
  const underThreat =
    mobbingFighters >= CONFIG.spiderMobRetreatCount || hp <= CONFIG.spiderLowHpRetreatThreshold;
  const target = nearestAnt(world, spider);
  const carrion = nearestCarrion(world, spider);
  const carrionDistance = carrion ? distance(spider.pos, carrion.pos) : Number.POSITIVE_INFINITY;
  const carrionCloseness = carrion ? clamp01(1 - carrionDistance / Math.max(1, genome.genes.chaseTriggerDist * 2)) : 0;
  const hungry = spider.hunger >= CONFIG.spiderHungryThreshold;
  const storageWork = hasStorageWork(world, spider);
  const targetCloseness = target ? clamp01(1 - target.distance / Math.max(1, genome.genes.chaseTriggerDist)) : 0;
  const antsAround = clamp01(surfaceAnts(world).length / 8);
  const entranceCloseness = clamp01(1 - distance(spider.pos, CONFIG.surfaceEntrance) / 35);

  const utilities: Record<SpiderMode, number> = {
    retreat:
      (mobbingFighters >= CONFIG.spiderMobRetreatCount ? CONFIG.spiderMobRetreatUtility : 0) +
      (hp <= CONFIG.spiderLowHpRetreatThreshold ? CONFIG.spiderLowHpRetreatUtility : 0),
    chase:
      targetCloseness * (1.2 + genome.genes.aggression) +
      hunger * (0.7 + genome.genes.hungerAggroGain) -
      caution * 0.35,
    stalk: genome.genes.aggression * 0.4 + hunger * (0.6 + antsAround * 0.5) - caution * 0.2,
    ambush:
      genome.genes.ambushPreference * (0.45 + hunger * 0.25) +
      genome.genes.entranceAffinity * entranceCloseness,
    feed: hungry && !underThreat && (spider.hoard > 0 || carrion) ? hunger * 2.4 + carrionCloseness * 0.6 : 0,
    store: !hungry && !underThreat && storageWork ? 1.35 + genome.genes.ambushPreference * 0.25 : 0,
    wander: 0.2 + (1 - hunger) * 0.15
  };

  return (Object.entries(utilities) as Array<[SpiderMode, number]>).reduce((best, current) =>
    current[1] > best[1] ? current : best
  )[0];
}

export function applyMode(world: World, spider: Enemy, mode: SpiderMode, genome: SpiderGenome): void {
  if (mode !== "retreat") {
    retreatTargets.delete(spider.id);
  }

  if (mode !== "wander") {
    wanderTargets.delete(spider.id);
  }

  if (mode === "chase") {
    const target = nearestAnt(world, spider);
    if (target) {
      moveToward(spider, target.ant.pos, CONFIG.spiderChaseSpeed);
      return;
    }
  }

  if (mode === "stalk") {
    const target = antCentroid(world, spider);
    if (target) {
      moveToward(spider, activityApproachPoint(target, spider, genome), CONFIG.spiderSpeed * 1.35);
      return;
    }
  }

  if (mode === "ambush") {
    const target = ambushPoint(world, spider, genome);
    if (distance(spider.pos, target) > 1.8) {
      moveToward(spider, target, CONFIG.spiderSpeed * 0.9);
    }
    return;
  }

  if (mode === "retreat") {
    moveToward(spider, retreatPoint(world, spider), CONFIG.spiderChaseSpeed * 0.7);
    return;
  }

  if (mode === "feed") {
    if (spider.hoard > 0) {
      if (distance(spider.pos, spider.lair) > CONFIG.foodPickupRadius) {
        moveToward(spider, spider.lair, CONFIG.spiderChaseSpeed * 0.75);
        return;
      }

      const bite = Math.min(spider.hoard, CONFIG.spiderHoardEatPerTick);
      spider.hoard -= bite;
      spider.hunger = Math.max(0, spider.hunger - bite * 14);
      return;
    }

    const carrion = nearestCarrion(world, spider);
    if (carrion) {
      if (distance(spider.pos, carrion.pos) > CONFIG.foodPickupRadius) {
        moveToward(spider, carrion.pos, CONFIG.spiderChaseSpeed * 0.8);
        return;
      }

      const bite = Math.min(carrion.amount, CONFIG.spiderCarrionEatPerTick);
      carrion.amount -= bite;
      spider.hunger = Math.max(0, spider.hunger - bite * 12);
      return;
    }
  }

  if (mode === "store") {
    if (spider.carrying > 0) {
      if (distance(spider.pos, spider.lair) > CONFIG.foodPickupRadius) {
        moveToward(spider, spider.lair, CONFIG.spiderChaseSpeed * 0.65);
        return;
      }

      const deposit = Math.min(spider.carrying, Math.max(0, CONFIG.spiderHoardMax - spider.hoard));
      spider.hoard += deposit;
      spider.carrying -= deposit;
      if (deposit <= 0) {
        spider.carrying = 0;
      }
      return;
    }

    const carrion = nearestCarrion(world, spider);
    if (carrion && spider.hoard < CONFIG.spiderHoardMax) {
      if (distance(spider.pos, carrion.pos) > CONFIG.foodPickupRadius) {
        moveToward(spider, carrion.pos, CONFIG.spiderSpeed * 1.15);
        return;
      }

      const take = Math.min(carrion.amount, CONFIG.spiderCarryAmount, Math.max(0, CONFIG.spiderHoardMax - spider.hoard));
      carrion.amount -= take;
      spider.carrying += take;
      return;
    }
  }

  moveToward(spider, wanderPoint(world, spider, genome), CONFIG.spiderSpeed);
}
