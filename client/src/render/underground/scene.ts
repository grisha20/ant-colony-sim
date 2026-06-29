import { Container, Graphics } from "pixi.js";
import type { WorldSnapshot } from "../../../../shared/types";
import { createSpritePool, fitRoot } from "../spritePool";
import type { UndergroundScene } from "../types";
import { UNDERGROUND_WIDTH, UNDERGROUND_HEIGHT } from "../types";
import {
  createAntSprite,
  createCarrionSprite,
  createEggSprite,
  createGrainSprite,
  createQueenSprite
} from "../../sprites";
import { drawUndergroundEarth, drawUndergroundGrid } from "./grid";
import { updateUndergroundStorage, updateUndergroundCarrion, updateUndergroundBrood, updateUndergroundQueen, updateUndergroundAnts } from "./entities";

export function createUndergroundScene(): UndergroundScene {
  const root = new Container();
  const staticLayer = new Container();
  const storageContainer = new Container();
  const carrionContainer = new Container();
  const eggContainer = new Container();
  const antContainer = new Container();
  const queen = createQueenSprite(4);

  const earthGraphics = new Graphics();
  const gridGraphics = new Graphics();
  staticLayer.addChild(earthGraphics, gridGraphics);

  // Отрисовываем фон земли ровно один раз при создании сцены
  drawUndergroundEarth(earthGraphics);

  root.addChild(staticLayer, storageContainer, carrionContainer, eggContainer, queen, antContainer);

  return {
    root,
    staticLayer,
    storagePool: createSpritePool(storageContainer, () => createGrainSprite(2.7)),
    carrionPool: createSpritePool(carrionContainer, () => createCarrionSprite(2.2)),
    broodPool: createSpritePool(eggContainer, () => createEggSprite(3)),
    antPool: createSpritePool(antContainer, () => createAntSprite(false, 2.6)),
    queen,
    staticKey: "",
    earthGraphics,
    gridGraphics
  };
}

function rebuildUndergroundStatic(scene: UndergroundScene, world: WorldSnapshot, staticKey: string): void {
  scene.gridGraphics.clear();
  drawUndergroundGrid(scene.gridGraphics, world);
  scene.staticKey = staticKey;
}

export function renderUnderground(scene: UndergroundScene, world: WorldSnapshot, viewportWidth: number, viewportHeight: number): void {
  fitRoot(scene.root, viewportWidth, viewportHeight, UNDERGROUND_WIDTH + 48, UNDERGROUND_HEIGHT + 52);

  const staticKey = [
    world.underground.width,
    world.underground.height,
    world.underground.entrance.x,
    world.underground.entrance.y,
    world.underground.junction.x,
    world.underground.junction.y,
    world.underground.queenChamber.x,
    world.underground.queenChamber.y,
    world.underground.nursery.x,
    world.underground.nursery.y,
    world.underground.storage.x,
    world.underground.storage.y,
    world.underground.barracksA.x,
    world.underground.barracksA.y,
    world.underground.barracksB.x,
    world.underground.barracksB.y,
    world.underground.gridVersion ?? 1,
    world.underground.roomsVersion ?? 1,
    world.underground.digTasksVersion ?? 1
  ].join(":");
  if (scene.staticKey !== staticKey) {
    rebuildUndergroundStatic(scene, world, staticKey);
  }

  updateUndergroundStorage(scene.storagePool, world);
  updateUndergroundCarrion(scene.carrionPool, world);
  updateUndergroundBrood(scene.broodPool, world);
  updateUndergroundQueen(scene.queen, world);
  updateUndergroundAnts(scene.antPool, world);
}
