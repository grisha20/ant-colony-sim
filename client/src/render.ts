import { Container, Graphics, Sprite } from "pixi.js";
import type { Ant, Brood, Vec2, WorldSnapshot } from "../../shared/types";
import {
  createAntSprite,
  createCarrionSprite,
  createEggSprite,
  createFoodSprite,
  createGrainSprite,
  createQueenSprite,
  createSpiderLairSprite,
  createSpiderSprite,
  getEggTexture,
  getLarvaTexture,
  getAntTexture
} from "./sprites";

export type ViewMode = "surface" | "underground";
export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

const SURFACE_TILE_SIZE = 8;
const UNDERGROUND_WIDTH = 780;
const UNDERGROUND_HEIGHT = 540;

const undergroundLayout = {
  surfaceY: 58,
  marginX: 38,
  bottomPadding: 34
} as const;

type SpriteFactory = () => Sprite;

type SpritePool = {
  container: Container;
  cursor: number;
  sprites: Sprite[];
  factory: SpriteFactory;
};

type SurfaceScene = {
  root: Container;
  staticLayer: Container;
  pheromones: Graphics;
  foodPool: SpritePool;
  carrionPool: SpritePool;
  lairPool: SpritePool;
  carriedCarrionPool: SpritePool;
  enemyPool: SpritePool;
  antPool: SpritePool;
  staticKey: string;
};

type UndergroundScene = {
  root: Container;
  staticLayer: Container;
  storagePool: SpritePool;
  broodPool: SpritePool;
  antPool: SpritePool;
  queen: Sprite;
  staticKey: string;
};

type RendererState = {
  stage: Container | null;
  surface: SurfaceScene;
  underground: UndergroundScene;
};

type ViewBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const rendererState: RendererState = {
  stage: null,
  surface: createSurfaceScene(),
  underground: createUndergroundScene()
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pheromoneAlpha(value: number): number {
  return Math.max(0, Math.min(0.16, value / 160));
}

function placeSprite(sprite: Sprite, x: number, y: number, rotation = 0): void {
  sprite.x = Math.round(x);
  sprite.y = Math.round(y);
  sprite.rotation = rotation;
}

function antRotation(ant: Ant): number {
  return Math.atan2(ant.heading.y, ant.heading.x);
}

function deterministicOffset(index: number, radius: number): Vec2 {
  const angle = index * 2.39996323;
  const distance = radius * (0.35 + ((index * 37) % 100) / 155);
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance
  };
}

function createSpritePool(container: Container, factory: SpriteFactory): SpritePool {
  return {
    container,
    cursor: 0,
    sprites: [],
    factory
  };
}

function beginPool(pool: SpritePool): void {
  pool.cursor = 0;
}

function acquireSprite(pool: SpritePool): Sprite {
  let sprite = pool.sprites[pool.cursor];
  if (!sprite) {
    sprite = pool.factory();
    pool.sprites.push(sprite);
    pool.container.addChild(sprite);
  }

  pool.cursor += 1;
  sprite.visible = true;
  return sprite;
}

function endPool(pool: SpritePool): void {
  for (let index = pool.cursor; index < pool.sprites.length; index += 1) {
    pool.sprites[index].visible = false;
  }
}

function fitRoot(root: Container, viewportWidth: number, viewportHeight: number, designWidth: number, designHeight: number): void {
  const padding = 18;
  const scale = Math.max(0.1, Math.min((viewportWidth - padding * 2) / designWidth, (viewportHeight - padding * 2) / designHeight));
  root.scale.set(scale);
  root.x = Math.round((viewportWidth - designWidth * scale) * 0.5);
  root.y = Math.round((viewportHeight - designHeight * scale) * 0.5);
}

function undergroundToScreen(world: WorldSnapshot, pos: Vec2): Vec2 {
  const xRange = UNDERGROUND_WIDTH - undergroundLayout.marginX * 2;
  const yTop = undergroundLayout.surfaceY + 28;
  const yRange = UNDERGROUND_HEIGHT - yTop - undergroundLayout.bottomPadding;

  return {
    x: undergroundLayout.marginX + clamp01(pos.x / world.underground.width) * xRange,
    y: yTop + clamp01(pos.y / world.underground.height) * yRange
  };
}

function undergroundEntranceTop(world: WorldSnapshot): Vec2 {
  const entrance = undergroundToScreen(world, world.underground.entrance);
  return {
    x: entrance.x,
    y: undergroundLayout.surfaceY
  };
}

function createSurfaceScene(): SurfaceScene {
  const root = new Container();
  const staticLayer = new Container();
  const pheromones = new Graphics();
  const foodContainer = new Container();
  const carrionContainer = new Container();
  const lairContainer = new Container();
  const enemyContainer = new Container();
  const carriedCarrionContainer = new Container();
  const antContainer = new Container();

  root.addChild(staticLayer, pheromones, foodContainer, carrionContainer, lairContainer, enemyContainer, carriedCarrionContainer, antContainer);

  return {
    root,
    staticLayer,
    pheromones,
    foodPool: createSpritePool(foodContainer, () => createFoodSprite(2.2)),
    carrionPool: createSpritePool(carrionContainer, () => createCarrionSprite(2.6)),
    lairPool: createSpritePool(lairContainer, () => createSpiderLairSprite(3.4)),
    carriedCarrionPool: createSpritePool(carriedCarrionContainer, () => createCarrionSprite(1.7)),
    enemyPool: createSpritePool(enemyContainer, () => createSpiderSprite(4)),
    antPool: createSpritePool(antContainer, () => createAntSprite(false, 2.45)),
    staticKey: ""
  };
}

function createUndergroundScene(): UndergroundScene {
  const root = new Container();
  const staticLayer = new Container();
  const storageContainer = new Container();
  const eggContainer = new Container();
  const antContainer = new Container();
  const queen = createQueenSprite(4);

  root.addChild(staticLayer, storageContainer, eggContainer, queen, antContainer);

  return {
    root,
    staticLayer,
    storagePool: createSpritePool(storageContainer, () => createGrainSprite(2.7)),
    broodPool: createSpritePool(eggContainer, () => createEggSprite(3)),
    antPool: createSpritePool(antContainer, () => createAntSprite(false, 2.6)),
    queen,
    staticKey: ""
  };
}

function ensureStage(stage: Container): void {
  if (rendererState.stage === stage) {
    return;
  }

  rendererState.stage = stage;
  stage.addChild(rendererState.surface.root, rendererState.underground.root);
}

export function renderWorld(
  stage: Container,
  world: WorldSnapshot,
  mode: ViewMode,
  viewportWidth = 900,
  viewportHeight = 760,
  camera: Camera = { x: world.surface.entrance.x, y: world.surface.entrance.y, zoom: 1 },
  undergroundColonyIndex = 0
): void {
  ensureStage(stage);

  rendererState.surface.root.visible = mode === "surface";
  rendererState.underground.root.visible = mode === "underground";

  if (mode === "surface") {
    renderSurface(rendererState.surface, world, viewportWidth, viewportHeight, camera);
    return;
  }

  renderUnderground(rendererState.underground, undergroundWorld(world, undergroundColonyIndex), viewportWidth, viewportHeight);
}

function undergroundWorld(world: WorldSnapshot, colonyIndex: number): WorldSnapshot {
  const colony = world.colonies?.[colonyIndex];
  if (!colony) {
    return world;
  }

  const colonyAntIds = new Set(colony.ants.map((ant) => ant.id));
  return {
    ...world,
    underground: colony.underground,
    colony: colony.colony,
    ants: world.ants.filter((ant) => colonyAntIds.has(ant.id))
  };
}

export function surfaceTileFromGlobal(world: WorldSnapshot, globalX: number, globalY: number): Vec2 | null {
  const local = rendererState.surface.root.toLocal({ x: globalX, y: globalY });
  if (
    local.x < 0 ||
    local.y < 0 ||
    local.x > world.surface.width * SURFACE_TILE_SIZE ||
    local.y > world.surface.height * SURFACE_TILE_SIZE
  ) {
    return null;
  }

  return {
    x: Math.max(0, Math.min(world.surface.width - 0.001, local.x / SURFACE_TILE_SIZE)),
    y: Math.max(0, Math.min(world.surface.height - 0.001, local.y / SURFACE_TILE_SIZE))
  };
}

function renderSurface(
  scene: SurfaceScene,
  world: WorldSnapshot,
  viewportWidth: number,
  viewportHeight: number,
  camera: Camera
): void {
  scene.root.scale.set(camera.zoom);
  scene.root.x = Math.round(viewportWidth * 0.5 - camera.x * SURFACE_TILE_SIZE * camera.zoom);
  scene.root.y = Math.round(viewportHeight * 0.5 - camera.y * SURFACE_TILE_SIZE * camera.zoom);

  const cell = SURFACE_TILE_SIZE;
  const bounds = visibleSurfaceBounds(camera, viewportWidth, viewportHeight);
  const staticKey = [
    world.surface.width,
    world.surface.height,
    ...(world.surface.entrances ?? [world.surface.entrance]).flatMap((entrance) => [entrance.x, entrance.y]),
    Math.floor(bounds.left),
    Math.ceil(bounds.right),
    Math.floor(bounds.top),
    Math.ceil(bounds.bottom)
  ].join(":");
  if (scene.staticKey !== staticKey) {
    rebuildSurfaceStatic(scene, world, cell, bounds, staticKey);
  }

  drawSurfacePheromones(scene.pheromones, world, cell, bounds);
  updateSurfaceFood(scene.foodPool, world, cell, bounds);
  updateSurfaceCarrion(scene.carrionPool, world, cell, bounds);
  updateSurfaceLairs(scene.lairPool, world, cell, bounds);
  updateSurfaceEnemies(scene.enemyPool, scene.carriedCarrionPool, world, cell, bounds);
  updateSurfaceAnts(scene.antPool, world, cell, bounds);
}

function visibleSurfaceBounds(camera: Camera, viewportWidth: number, viewportHeight: number): ViewBounds {
  const halfWidth = viewportWidth / Math.max(0.1, camera.zoom) / SURFACE_TILE_SIZE / 2;
  const halfHeight = viewportHeight / Math.max(0.1, camera.zoom) / SURFACE_TILE_SIZE / 2;
  return {
    left: camera.x - halfWidth - 2,
    right: camera.x + halfWidth + 2,
    top: camera.y - halfHeight - 2,
    bottom: camera.y + halfHeight + 2
  };
}

function isInBounds(pos: Vec2, bounds: ViewBounds, padding = 0): boolean {
  return (
    pos.x >= bounds.left - padding &&
    pos.x <= bounds.right + padding &&
    pos.y >= bounds.top - padding &&
    pos.y <= bounds.bottom + padding
  );
}

function rebuildSurfaceStatic(scene: SurfaceScene, world: WorldSnapshot, cell: number, bounds: ViewBounds, staticKey: string): void {
  scene.staticLayer.removeChildren();
  drawSurfaceGround(scene.staticLayer, world.surface.width, world.surface.height, cell, bounds);
  drawSurfaceEntrance(scene.staticLayer, world, cell);
  scene.staticKey = staticKey;
}

function drawSurfaceGround(root: Container, width: number, height: number, cell: number, bounds: ViewBounds): void {
  const bg = new Graphics();
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(width, Math.ceil(bounds.right));
  const top = Math.max(0, Math.floor(bounds.top));
  const bottom = Math.min(height, Math.ceil(bounds.bottom));
  bg.rect(left * cell, top * cell, (right - left) * cell, (bottom - top) * cell).fill(0xb9c98d);

  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const noise = (x * 17 + y * 31 + ((x * y) % 19)) % 9;
      const color = noise < 2 ? 0xaec17f : noise > 6 ? 0xc4d49a : 0xb9c98d;
      bg.rect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell * 2), Math.ceil(cell * 2)).fill(color);
    }
  }

  const grid = new Graphics();
  grid.setStrokeStyle({ width: 1, color: 0x87996f, alpha: 0.18 });
  for (let line = Math.floor(left / 10) * 10; line <= right; line += 10) {
    const p = Math.round(line * cell);
    grid.moveTo(p, top * cell);
    grid.lineTo(p, bottom * cell);
  }
  for (let line = Math.floor(top / 10) * 10; line <= bottom; line += 10) {
    const p = Math.round(line * cell);
    grid.moveTo(left * cell, p);
    grid.lineTo(right * cell, p);
  }
  grid.stroke();

  root.addChild(bg, grid);
}

function drawSurfacePheromones(pheromones: Graphics, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  pheromones.clear();

  const left = Math.max(0, Math.floor(bounds.left / 3) * 3);
  const right = Math.min(world.pheromones.width, Math.ceil(bounds.right));
  const top = Math.max(0, Math.floor(bounds.top / 3) * 3);
  const bottom = Math.min(world.pheromones.height, Math.ceil(bounds.bottom));

  for (let y = top; y < bottom; y += 3) {
    for (let x = left; x < right; x += 3) {
      const index = y * world.pheromones.width + x;
      const foodValue = world.pheromones.food[index] ?? 0;
      const homeValue = world.pheromones.home[index] ?? 0;

      if (foodValue > 1.5) {
        pheromones.rect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell * 3), Math.ceil(cell * 3)).fill({
          color: 0x4f9f65,
          alpha: pheromoneAlpha(foodValue)
        });
      }
      if (homeValue > 1.5) {
        pheromones.rect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell * 3), Math.ceil(cell * 3)).fill({
          color: 0x557c9e,
          alpha: pheromoneAlpha(homeValue) * 0.55
        });
      }
    }
  }
}

function updateSurfaceFood(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const source of world.surface.foodSources) {
    if (!isInBounds(source.pos, bounds, 5)) {
      continue;
    }

    const chunks = Math.max(1, Math.min(18, Math.ceil(source.amount / 6)));
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      const offset = deterministicOffset(index + source.id.length, 18);
      sprite.scale.set(2.2);
      placeSprite(sprite, source.pos.x * cell + offset.x, source.pos.y * cell + offset.y, (index % 4) * 0.2);
    }
  }

  endPool(pool);
}

function updateSurfaceCarrion(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const source of world.surface.carrion) {
    if (source.amount <= 0 || !isInBounds(source.pos, bounds, 4)) {
      continue;
    }

    const chunks = Math.max(1, Math.min(10, Math.ceil(source.amount / 10)));
    for (let index = 0; index < chunks; index += 1) {
      const sprite = acquireSprite(pool);
      const offset = deterministicOffset(index + source.id.length * 3, 11);
      sprite.scale.set(2.6);
      placeSprite(sprite, source.pos.x * cell + offset.x, source.pos.y * cell + offset.y, (index % 5) * 0.27);
    }
  }

  endPool(pool);
}

function updateSurfaceLairs(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider" || !isInBounds(enemy.lair, bounds, 4)) {
      continue;
    }

    const sprite = acquireSprite(pool);
    sprite.scale.set(3.4 + Math.min(1.2, enemy.hoard / 120));
    sprite.alpha = 0.74 + Math.min(0.2, enemy.hoard / Math.max(1, 900));
    placeSprite(sprite, enemy.lair.x * cell, enemy.lair.y * cell, 0);
  }

  endPool(pool);
}

function drawSurfaceEntranceAt(root: Container, pos: Vec2, cell: number, color: "dark" | "red"): void {
  const x = Math.round(pos.x * cell);
  const y = Math.round(pos.y * cell);
  const entrance = new Graphics();
  const mound = color === "red" ? 0x9a513f : 0x8d6a3e;
  const soil = color === "red" ? 0x7d3b32 : 0x73502f;

  entrance.rect(x - 25, y + 9, 50, 8).fill(mound);
  entrance.rect(x - 18, y + 1, 36, 11).fill(soil);
  entrance.rect(x - 14, y - 8, 28, 24).fill(0x2a1a12);
  entrance.rect(x - 8, y - 3, 16, 13).fill(0x0c0806);
  entrance.rect(x - 21, y - 13, 8, 8).fill(mound);
  entrance.rect(x + 13, y - 12, 9, 7).fill(mound);
  root.addChild(entrance);
}

function drawSurfaceEntrance(root: Container, world: WorldSnapshot, cell: number): void {
  const entrances = world.surface.entrances ?? [world.surface.entrance];
  entrances.forEach((entrance, index) => {
    drawSurfaceEntranceAt(root, entrance, cell, index === 1 ? "red" : "dark");
  });
}

function updateSurfaceAnts(pool: SpritePool, world: WorldSnapshot, cell: number, bounds: ViewBounds): void {
  beginPool(pool);

  for (const ant of world.ants) {
    if (ant.layer !== "surface") {
      continue;
    }
    if (!isInBounds(ant.pos, bounds, 2)) {
      continue;
    }

    const carrying = ant.state === "carry" || ant.carrying > 0;
    const sprite = acquireSprite(pool);
    sprite.texture = getAntTexture(carrying);
    sprite.scale.set(ant.state === "carry" ? 2.8 : 2.45);
    sprite.tint = ant.colonyId === "colony-2" ? 0xd94a3f : 0xffffff;
    placeSprite(sprite, ant.pos.x * cell, ant.pos.y * cell, antRotation(ant));
  }

  endPool(pool);
}

function updateSurfaceEnemies(
  pool: SpritePool,
  carriedCarrionPool: SpritePool,
  world: WorldSnapshot,
  cell: number,
  bounds: ViewBounds
): void {
  beginPool(pool);
  beginPool(carriedCarrionPool);

  for (const enemy of world.enemies) {
    if (enemy.type !== "spider") {
      continue;
    }
    if (!isInBounds(enemy.pos, bounds, 4)) {
      continue;
    }

    const sprite = acquireSprite(pool);
    const hpRatio = enemy.maxHp > 0 ? Math.max(0.2, Math.min(1, enemy.hp / enemy.maxHp)) : 1;
    sprite.scale.set(4.2);
    sprite.alpha = 0.45 + hpRatio * 0.55;
    placeSprite(sprite, enemy.pos.x * cell, enemy.pos.y * cell, 0);

    if (enemy.carrying > 0) {
      const cargo = acquireSprite(carriedCarrionPool);
      cargo.scale.set(1.9);
      placeSprite(cargo, enemy.pos.x * cell + 11, enemy.pos.y * cell - 11, 0.25);
    }
  }

  for (let index = 0; index < pool.cursor; index += 1) {
    pool.sprites[index].alpha = pool.sprites[index].visible ? pool.sprites[index].alpha : 1;
  }
  endPool(pool);
  endPool(carriedCarrionPool);
}

function renderUnderground(scene: UndergroundScene, world: WorldSnapshot, viewportWidth: number, viewportHeight: number): void {
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
    world.underground.barracksB.y
  ].join(":");
  if (scene.staticKey !== staticKey) {
    rebuildUndergroundStatic(scene, world, staticKey);
  }

  updateUndergroundStorage(scene.storagePool, world);
  updateUndergroundBrood(scene.broodPool, world);
  updateUndergroundQueen(scene.queen, world);
  updateUndergroundAnts(scene.antPool, world);
}

function rebuildUndergroundStatic(scene: UndergroundScene, world: WorldSnapshot, staticKey: string): void {
  scene.staticLayer.removeChildren();
  drawUndergroundEarth(scene.staticLayer);
  drawDecorativeTunnels(scene.staticLayer, world);
  scene.staticKey = staticKey;
}

function drawUndergroundEarth(root: Container): void {
  const earth = new Graphics();
  earth.rect(0, 0, UNDERGROUND_WIDTH, UNDERGROUND_HEIGHT).fill(0x7f5738);
  earth.rect(0, 0, UNDERGROUND_WIDTH, undergroundLayout.surfaceY).fill(0x9fb86b);
  earth.rect(0, undergroundLayout.surfaceY - 16, UNDERGROUND_WIDTH, 16).fill(0x5f422b);

  for (let y = 0; y < UNDERGROUND_HEIGHT; y += 8) {
    for (let x = 0; x < UNDERGROUND_WIDTH; x += 8) {
      const noise = (x * 13 + y * 23 + ((x + y) % 17)) % 11;
      if (y < undergroundLayout.surfaceY - 16) {
        earth.rect(x, y, 8, 8).fill(noise < 4 ? 0x8faa59 : 0xa8bf75);
      } else if (noise < 2) {
        earth.rect(x, y, 8, 8).fill(0x6f4a30);
      } else if (noise > 8) {
        earth.rect(x, y, 8, 8).fill(0x8d6441);
      }
    }
  }

  root.addChild(earth);
}

function drawDecorativeTunnels(root: Container, world: WorldSnapshot): void {
  const entranceTop = undergroundEntranceTop(world);
  const entrance = undergroundToScreen(world, world.underground.entrance);
  const junction = undergroundToScreen(world, world.underground.junction);
  const queen = undergroundToScreen(world, world.underground.queenChamber);
  const nursery = undergroundToScreen(world, world.underground.nursery);
  const storage = undergroundToScreen(world, world.underground.storage);
  const barracksA = undergroundToScreen(world, world.underground.barracksA);
  const barracksB = undergroundToScreen(world, world.underground.barracksB);
  const tunnels = new Graphics();
  tunnels.setStrokeStyle({ width: 34, color: 0xb9875c, alpha: 1 });
  tunnels.moveTo(entranceTop.x, entranceTop.y);
  tunnels.lineTo(entrance.x, entrance.y);
  tunnels.lineTo(junction.x, junction.y);
  tunnels.moveTo(junction.x, junction.y);
  tunnels.lineTo(queen.x, queen.y);
  tunnels.moveTo(junction.x, junction.y);
  tunnels.lineTo(storage.x, storage.y);
  tunnels.moveTo(junction.x, junction.y);
  tunnels.lineTo(nursery.x, nursery.y);
  tunnels.moveTo(junction.x, junction.y);
  tunnels.lineTo(barracksA.x, barracksA.y);
  tunnels.moveTo(junction.x, junction.y);
  tunnels.lineTo(barracksB.x, barracksB.y);
  tunnels.stroke();

  tunnels.ellipse(queen.x, queen.y, 112, 70).fill(0xb9875c);
  tunnels.ellipse(nursery.x, nursery.y, 95, 58).fill(0xb9875c);
  tunnels.ellipse(storage.x, storage.y, 98, 60).fill(0xb9875c);
  tunnels.ellipse(barracksA.x, barracksA.y, 78, 46).fill(0xb9875c);
  tunnels.ellipse(barracksB.x, barracksB.y, 78, 46).fill(0xb9875c);

  tunnels.setStrokeStyle({ width: 6, color: 0x6c482e, alpha: 0.55 });
  tunnels.ellipse(queen.x, queen.y, 112, 70).stroke();
  tunnels.ellipse(nursery.x, nursery.y, 95, 58).stroke();
  tunnels.ellipse(storage.x, storage.y, 98, 60).stroke();
  tunnels.ellipse(barracksA.x, barracksA.y, 78, 46).stroke();
  tunnels.ellipse(barracksB.x, barracksB.y, 78, 46).stroke();

  tunnels.rect(entranceTop.x - 24, entranceTop.y - 10, 48, 18).fill(0x2d1b12);
  tunnels.rect(entranceTop.x - 14, entranceTop.y - 5, 28, 12).fill(0x100a07);
  root.addChild(tunnels);
}

function updateUndergroundQueen(queen: Sprite, world: WorldSnapshot): void {
  const pos = undergroundToScreen(world, world.underground.queenChamber);
  placeSprite(queen, pos.x - 18, pos.y + 6, 0);
  queen.alpha = world.underground.queen.alive ? 1 : 0.45;
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

  const offset = deterministicOffset(index + brood.id.length, brood.stage === "egg" ? 34 : 24);
  const base = undergroundToScreen(world, brood.pos);
  return {
    x: base.x + offset.x * 0.45,
    y: base.y + offset.y * 0.28
  };
}

function updateUndergroundBrood(pool: SpritePool, world: WorldSnapshot): void {
  beginPool(pool);

  world.underground.brood.forEach((brood, index) => {
    const sprite = acquireSprite(pool);
    const pos = broodPosition(brood, world, index);
    sprite.texture = brood.stage === "egg" ? getEggTexture() : getLarvaTexture();
    sprite.scale.set(brood.carriedBy ? 2.2 : brood.stage === "egg" ? 3 : 3.2);
    sprite.tint = brood.isPrincess ? 0xf0c14b : 0xffffff;
    placeSprite(sprite, pos.x, pos.y, brood.stage === "larva" ? 0.08 : 0);
  });

  world.underground.princesses.forEach((princess, index) => {
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

function updateUndergroundStorage(pool: SpritePool, world: WorldSnapshot): void {
  beginPool(pool);

  const storage = undergroundToScreen(world, world.underground.storage);
  const count = Math.max(1, Math.min(28, Math.ceil(world.underground.foodStorage / 2)));
  for (let index = 0; index < count; index += 1) {
    const sprite = acquireSprite(pool);
    const column = index % 7;
    const row = Math.floor(index / 7);
    sprite.scale.set(2.7);
    placeSprite(
      sprite,
      storage.x - 42 + column * 14 + ((row % 2) * 4),
      storage.y + 22 - row * 11,
      (index % 3) * 0.12
    );
  }

  endPool(pool);
}

function undergroundAntPosition(ant: Ant, world: WorldSnapshot): Vec2 {
  return undergroundToScreen(world, ant.pos);
}

function updateUndergroundAnts(pool: SpritePool, world: WorldSnapshot): void {
  beginPool(pool);

  for (const ant of world.ants) {
    if (ant.layer !== "underground") {
      continue;
    }

    const pos = undergroundAntPosition(ant, world);
    const carrying = ant.carrying > 0 || ant.state === "deposit" || ant.state === "carryBrood";
    const sprite = acquireSprite(pool);
    sprite.texture = getAntTexture(carrying);
    sprite.scale.set(2.6);
    sprite.tint = ant.colonyId === "colony-2" ? 0xd94a3f : 0xffffff;
    placeSprite(sprite, pos.x, pos.y, ant.state === "deposit" ? 0 : antRotation(ant));
  }

  endPool(pool);
}
