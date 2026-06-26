import type { Sprite } from "pixi.js";
import type { Ant, Brood, Vec2, WorldSnapshot } from "../../../../shared/types";
import { acquireSprite, antRotation, beginPool, deterministicOffset, endPool, placeSprite } from "../spritePool";
import type { SpritePool } from "../types";
import { isDugUndergroundPos, undergroundToScreen } from "./utils";
import {
  getAntTexture,
  getEggTexture,
  getLarvaTexture,
  getQueenTexture
} from "../../sprites";

export function updateUndergroundQueen(queen: Sprite, world: WorldSnapshot): void {
  queen.visible = isDugUndergroundPos(world, world.underground.queenChamber);
  if (!queen.visible) {
    return;
  }
  const pos = undergroundToScreen(world, world.underground.queenChamber);
  const color = world.colony?.id === "colony-2" ? "red" : "dark";
  queen.texture = getQueenTexture(color);
  placeSprite(queen, pos.x - 18, pos.y + 6, 0);
  queen.alpha = world.underground.queen.alive ? 1 : 0.45;
}

function undergroundAntPosition(ant: Ant, world: WorldSnapshot): Vec2 {
  return undergroundToScreen(world, ant.pos);
}

function broodPosition(brood: Brood, world: WorldSnapshot, index: number): Vec2 {
  const carrier = brood.carriedBy ? world.ants.find((ant) => ant.id === brood.carriedBy) : undefined;
  if (carrier) {
    const antPos = undergroundAntPosition(carrier, world);
    return {
      x: antPos.x,
      y: antPos.y - 13
    };
  }

  const clusterRadius = brood.location === "queen" ? 16 : brood.stage === "egg" ? 14 : 12;
  const offset = deterministicOffset(index + brood.id.length, clusterRadius);
  const base = undergroundToScreen(world, brood.pos);
  return {
    x: base.x + offset.x * 0.28,
    y: base.y + offset.y * 0.2
  };
}

export function updateUndergroundBrood(pool: SpritePool, world: WorldSnapshot): void {
  beginPool(pool);

  world.underground.brood.forEach((brood, index) => {
    if (!isDugUndergroundPos(world, brood.pos)) {
      return;
    }
    const sprite = acquireSprite(pool);
    const pos = broodPosition(brood, world, index);
    sprite.texture = brood.stage === "egg" ? getEggTexture() : getLarvaTexture();
    sprite.scale.set(brood.carriedBy ? 2.2 : brood.stage === "egg" ? 3 : 3.2);
    sprite.tint = brood.isPrincess ? 0xf0c14b : 0xffffff;
    placeSprite(sprite, pos.x, pos.y, brood.stage === "larva" ? 0.08 : 0);
  });

  world.underground.princesses.forEach((princess, index) => {
    if (!isDugUndergroundPos(world, princess.pos)) {
      return;
    }
    const sprite = acquireSprite(pool);
    const pos = undergroundToScreen(world, princess.pos);
    const offset = deterministicOffset(index + princess.id.length, 28);
    sprite.texture = getLarvaTexture();
    sprite.scale.set(3.5);
    sprite.tint = 0xf0c14b;
    placeSprite(sprite, pos.x + offset.x * 0.35, pos.y + offset.y * 0.22, 0.08);
  });

  endPool(pool);
}

export function updateUndergroundStorage(pool: SpritePool, world: WorldSnapshot): void {
  beginPool(pool);

  const storageRooms = world.underground.rooms.filter((room) => room.type === "storage" && room.used > 0);
  if (storageRooms.length === 0) {
    endPool(pool);
    return;
  }

  for (const room of storageRooms) {
    const center = undergroundToScreen(world, {
      x: room.x + room.width / 2,
      y: room.y + room.height / 2
    });
    const count = Math.max(3, Math.min(18, Math.ceil(room.used / 7)));
    for (let index = 0; index < count; index += 1) {
      const sprite = acquireSprite(pool);
      const angle = index * 2.399963229728653;
      const ring = Math.floor(index / 5);
      const radiusX = 3 + ring * 7 + (index % 3) * 1.5;
      const radiusY = 2 + ring * 4;
      sprite.scale.set(2.9 + (index % 4) * 0.16);
      placeSprite(
        sprite,
        center.x + Math.cos(angle) * radiusX,
        center.y + 14 + Math.sin(angle) * radiusY,
        (index % 5) * 0.08
      );
    }
  }

  endPool(pool);
}

export function updateUndergroundCarrion(pool: SpritePool, world: WorldSnapshot): void {
  beginPool(pool);

  for (const source of world.underground.carrion) {
    if (source.amount <= 0 || !isDugUndergroundPos(world, source.pos)) {
      continue;
    }
    const chunks = Math.max(1, Math.min(8, Math.ceil(source.amount / 4)));
    const base = undergroundToScreen(world, source.pos);
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      const offset = deterministicOffset(index + source.id.length * 5, 12);
      sprite.scale.set(2.1);
      placeSprite(sprite, base.x + offset.x * 0.38, base.y + offset.y * 0.26, (index % 4) * 0.18);
    }
  }

  endPool(pool);
}

export function updateUndergroundAnts(pool: SpritePool, world: WorldSnapshot): void {
  beginPool(pool);

  for (const ant of world.ants) {
    if (ant.layer !== "underground") {
      continue;
    }

    const pos = undergroundAntPosition(ant, world);
    if (!isDugUndergroundPos(world, ant.pos)) {
      continue;
    }
    const carrying = ant.carrying > 0 || ant.carryingDirt || ant.state === "deposit" || ant.state === "carryBrood" || ant.state === "carryDirt";
    const color = ant.colonyId === "colony-2" ? "red" : "dark";
    const sprite = acquireSprite(pool);
    sprite.texture = getAntTexture(carrying, color);
    sprite.scale.set(2.6);
    sprite.tint = 0xffffff;
    placeSprite(sprite, pos.x, pos.y, ant.state === "deposit" ? 0 : antRotation(ant));
  }

  endPool(pool);
}
