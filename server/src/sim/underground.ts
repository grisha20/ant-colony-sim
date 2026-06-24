import type { Brood, Underground, Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";

let nextBroodId = 1;

function withJitter(pos: Vec2, radius = 3): Vec2 {
  return {
    x: pos.x + (Math.random() - 0.5) * radius,
    y: pos.y + (Math.random() - 0.5) * radius
  };
}

export function makeBrood(
  stage: Brood["stage"],
  location: Brood["location"],
  pos: Vec2,
  progress = 0,
  isPrincess = false
): Brood {
  const id = `brood-${nextBroodId}`;
  nextBroodId += 1;

  return {
    id,
    stage,
    location,
    pos: withJitter(pos),
    progress,
    isPrincess
  };
}

export function syncBroodIdCounter(brood: Brood[]): void {
  const maxBroodId = brood.reduce((max, item) => {
    const numeric = Number(item.id.replace("brood-", ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  nextBroodId = Math.max(nextBroodId, maxBroodId + 1);
}

export function createUnderground(): Underground {
  const queenChamber = CONFIG.queenPos;
  const junction = CONFIG.undergroundJunction;
  const nursery = CONFIG.nurseryPos;
  const storage = CONFIG.storagePos;
  const barracksA = CONFIG.barracksAPos;
  const barracksB = CONFIG.barracksBPos;
  const brood = [
    ...Array.from({ length: CONFIG.startingEggs }, () => makeBrood("egg", "queen", queenChamber)),
    ...Array.from({ length: CONFIG.startingLarvae }, () => makeBrood("larva", "nursery", nursery))
  ];

  return {
    width: CONFIG.undergroundWidth,
    height: CONFIG.undergroundHeight,
    queen: {
      pos: queenChamber,
      alive: true,
      layCooldown: CONFIG.broodLayCooldownTicks,
      starve: 0,
      stress: 0,
      hp: CONFIG.queenMaxHp,
      age: 0
    },
    brood,
    foodStorage: CONFIG.startingFoodStorage,
    entrance: CONFIG.undergroundEntrance,
    junction,
    queenChamber,
    nursery,
    storage,
    barracksA,
    barracksB,
    princesses: [],
    ants: []
  };
}
