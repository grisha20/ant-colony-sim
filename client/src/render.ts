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
  getAntTexture,
  getQueenTexture
} from "./sprites";

export type ViewMode = "surface" | "underground";
export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

const SURFACE_TILE_SIZE = 8;
const UNDERGROUND_WIDTH = 1180;
const UNDERGROUND_HEIGHT = 860;
const SHOW_UNDERGROUND_DEBUG = false;

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
  carrionPool: SpritePool;
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
  const yTop = undergroundLayout.surfaceY;
  const yRange = UNDERGROUND_HEIGHT - yTop - undergroundLayout.bottomPadding;

  return {
    x: undergroundLayout.marginX + clamp01(pos.x / world.underground.width) * xRange,
    y: yTop + clamp01(pos.y / world.underground.height) * yRange
  };
}

function undergroundGridMetrics(world: WorldSnapshot): { x: number; y: number; cellWidth: number; cellHeight: number } {
  const xRange = UNDERGROUND_WIDTH - undergroundLayout.marginX * 2;
  const yTop = undergroundLayout.surfaceY;
  const yRange = UNDERGROUND_HEIGHT - yTop - undergroundLayout.bottomPadding;
  return {
    x: undergroundLayout.marginX,
    y: yTop,
    cellWidth: xRange / world.underground.width,
    cellHeight: yRange / world.underground.height
  };
}

function undergroundTileAt(world: WorldSnapshot, pos: Vec2): string | undefined {
  const x = Math.max(0, Math.min(world.underground.width - 1, Math.floor(pos.x)));
  const y = Math.max(0, Math.min(world.underground.height - 1, Math.floor(pos.y)));
  return world.underground.grid[y]?.[x]?.type;
}

function isDugUndergroundPos(world: WorldSnapshot, pos: Vec2): boolean {
  const type = undergroundTileAt(world, pos);
  return type === "tunnel" || type === "chamber" || type === "entrance";
}

function hasUndergroundRoom(world: WorldSnapshot, type: string): boolean {
  return world.underground.rooms.some((room) => room.type === type);
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
  const carrionContainer = new Container();
  const eggContainer = new Container();
  const antContainer = new Container();
  const queen = createQueenSprite(4);

  root.addChild(staticLayer, storageContainer, carrionContainer, eggContainer, queen, antContainer);

  return {
    root,
    staticLayer,
    storagePool: createSpritePool(storageContainer, () => createGrainSprite(2.7)),
    carrionPool: createSpritePool(carrionContainer, () => createCarrionSprite(2.2)),
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

function hash2(x: number, y: number, salt = 0): number {
  const value = Math.sin((x * 127.1 + y * 311.7 + salt * 74.7) * 0.0174533) * 43758.5453123;
  return value - Math.floor(value);
}

function drawPebble(root: Graphics, x: number, y: number, size: number, shade: number): void {
  root.ellipse(x + size * 0.18, y + size * 0.22, size * 0.62, size * 0.45).fill({ color: 0x2f2923, alpha: 0.42 });
  root.ellipse(x, y, size * 0.68, size * 0.5).fill(shade);
  root.ellipse(x - size * 0.18, y - size * 0.16, size * 0.22, size * 0.13).fill({ color: 0xe0dcd1, alpha: 0.48 });
  root.ellipse(x + size * 0.22, y + size * 0.12, size * 0.28, size * 0.16).fill({ color: 0x69655f, alpha: 0.72 });
}

function drawGrassTuft(root: Graphics, x: number, y: number, scale: number, rotation: number): void {
  const colors = [0x1f5d31, 0x2f7b3d, 0x184b27];
  root.setStrokeStyle({ width: Math.max(1, scale * 0.55), color: colors[Math.floor(hash2(x, y, 4) * colors.length)], alpha: 0.95 });
  for (let blade = -2; blade <= 2; blade += 1) {
    const angle = rotation + blade * 0.42;
    const length = scale * (4.2 + hash2(x + blade, y, 5) * 3.6);
    root.moveTo(x, y);
    root.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
  }
  root.stroke();
}

function drawLeaf(root: Graphics, x: number, y: number, scale: number, rotation: number): void {
  const dx = Math.cos(rotation);
  const dy = Math.sin(rotation);
  const color = hash2(x, y, 7) > 0.5 ? 0x7a6b24 : 0x3f7a2d;
  root.ellipse(x, y, scale * 2.7, scale * 1.05).fill({ color, alpha: 0.9 });
  root.setStrokeStyle({ width: 1, color: 0x2f3f1c, alpha: 0.5 });
  root.moveTo(x - dx * scale * 2.2, y - dy * scale * 2.2);
  root.lineTo(x + dx * scale * 2.2, y + dy * scale * 2.2);
  root.stroke();
}

function drawCrack(root: Graphics, x: number, y: number, scale: number): void {
  root.setStrokeStyle({ width: 1, color: 0x3b2816, alpha: 0.62 });
  root.moveTo(x, y);
  let cx = x;
  let cy = y;
  for (let step = 0; step < 4; step += 1) {
    cx += (hash2(x + step, y, 8) - 0.45) * scale * 4;
    cy += scale * (1.2 + hash2(x, y + step, 9) * 2);
    root.lineTo(cx, cy);
  }
  root.moveTo(x + scale * 1.2, y + scale * 2.2);
  root.lineTo(x + scale * (3 + hash2(x, y, 10) * 3), y + scale * (1.5 + hash2(x, y, 11) * 2));
  root.stroke();
}

function drawSurfaceGround(root: Container, width: number, height: number, cell: number, bounds: ViewBounds): void {
  const bg = new Graphics();
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(width, Math.ceil(bounds.right));
  const top = Math.max(0, Math.floor(bounds.top));
  const bottom = Math.min(height, Math.ceil(bounds.bottom));
  bg.rect(left * cell, top * cell, (right - left) * cell, (bottom - top) * cell).fill(0x8a672f);

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const noise = hash2(x, y, 1);
      const speckle = hash2(x, y, 2);
      const color = noise < 0.18 ? 0x755222 : noise > 0.82 ? 0x9b783d : speckle > 0.92 ? 0xb09358 : 0x8a672f;
      bg.rect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell), Math.ceil(cell)).fill(color);
      if (speckle > 0.965) {
        bg.rect(Math.round((x + 0.35) * cell), Math.round((y + 0.35) * cell), Math.max(1, Math.ceil(cell * 0.25)), Math.max(1, Math.ceil(cell * 0.25))).fill(0xc1b07a);
      } else if (speckle < 0.035) {
        bg.rect(Math.round((x + 0.45) * cell), Math.round((y + 0.45) * cell), Math.max(1, Math.ceil(cell * 0.2)), Math.max(1, Math.ceil(cell * 0.2))).fill(0x4f3518);
      }
    }
  }

  const decor = new Graphics();
  const chunkLeft = Math.floor(left / 8) * 8;
  const chunkRight = Math.ceil(right / 8) * 8;
  const chunkTop = Math.floor(top / 8) * 8;
  const chunkBottom = Math.ceil(bottom / 8) * 8;
  for (let gy = chunkTop; gy <= chunkBottom; gy += 8) {
    for (let gx = chunkLeft; gx <= chunkRight; gx += 8) {
      const roll = hash2(gx, gy, 20);
      const x = (gx + 1 + hash2(gx, gy, 21) * 6) * cell;
      const y = (gy + 1 + hash2(gx, gy, 22) * 6) * cell;
      if (x < left * cell - 24 || x > right * cell + 24 || y < top * cell - 24 || y > bottom * cell + 24) {
        continue;
      }
      if (roll > 0.93) {
        drawPebble(decor, x, y, cell * (1.2 + hash2(gx, gy, 23) * 2.9), hash2(gx, gy, 24) > 0.45 ? 0x9c9a91 : 0xb8b5aa);
      } else if (roll > 0.86) {
        drawGrassTuft(decor, x, y, cell * (0.55 + hash2(gx, gy, 25) * 0.55), hash2(gx, gy, 26) * Math.PI * 2);
      } else if (roll > 0.8) {
        drawLeaf(decor, x, y, cell * (0.35 + hash2(gx, gy, 27) * 0.38), hash2(gx, gy, 28) * Math.PI * 2);
      } else if (roll < 0.035) {
        drawCrack(decor, x, y, cell * (0.45 + hash2(gx, gy, 29) * 0.55));
      } else if (roll < 0.18) {
        const stones = 2 + Math.floor(hash2(gx, gy, 30) * 4);
        for (let index = 0; index < stones; index += 1) {
          const ox = (hash2(gx + index, gy, 31) - 0.5) * cell * 7;
          const oy = (hash2(gx, gy + index, 32) - 0.5) * cell * 7;
          drawPebble(decor, x + ox, y + oy, cell * (0.28 + hash2(gx + index, gy, 33) * 0.36), 0xb4b0a6);
        }
      }
    }
  }

  const grid = new Graphics();
  if (cell >= 7) {
    grid.setStrokeStyle({ width: 1, color: 0x5e441f, alpha: 0.08 });
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
  }

  root.addChild(bg, decor, grid);
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
  const mound = color === "red" ? 0x936245 : 0x8f6a38;
  const moundLight = color === "red" ? 0xbc8a63 : 0xb99155;
  const soil = color === "red" ? 0x6f3a25 : 0x65411e;

  entrance.ellipse(x + 2, y + 13, 40, 24).fill({ color: 0x4a2f16, alpha: 0.38 });
  entrance.ellipse(x, y + 10, 32, 20).fill({ color: mound, alpha: 0.96 });
  entrance.ellipse(x - 5, y + 9, 24, 15).fill({ color: moundLight, alpha: 0.46 });
  entrance.ellipse(x + 7, y + 16, 21, 9).fill({ color: soil, alpha: 0.34 });
  entrance.ellipse(x, y + 1, 15, 12).fill(0x1e120c);
  entrance.ellipse(x, y + 3, 10, 8).fill(0x050302);

  for (let index = 0; index < 18; index += 1) {
    const angle = index * 2.399963229728653;
    const radius = 17 + hash2(pos.x + index, pos.y, 40) * 16;
    const px = x + Math.cos(angle) * radius;
    const py = y + 10 + Math.sin(angle) * radius * 0.48;
    const size = cell * (0.16 + hash2(pos.x, pos.y + index, 41) * 0.34);
    entrance.ellipse(px, py, size, size * 0.62).fill({ color: moundLight, alpha: 0.42 + hash2(index, pos.x, 42) * 0.3 });
  }

  entrance.ellipse(x - 19, y - 2, 7, 4).fill({ color: mound, alpha: 0.82 });
  entrance.ellipse(x + 18, y - 1, 8, 4).fill({ color: mound, alpha: 0.74 });
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
    const color = ant.colonyId === "colony-2" ? "red" : "dark";
    const sprite = acquireSprite(pool);
    sprite.texture = getAntTexture(carrying, color);
    sprite.scale.set(ant.state === "carry" ? 2.8 : 2.45);
    sprite.tint = 0xffffff;
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
    world.underground.barracksB.y,
    world.underground.digTasks.map((task) => `${task.id}:${task.status}:${task.completedTiles}/${task.targetTiles.length}`).join(","),
    world.underground.grid.map((row) => row.map((tile) => `${tile.type[0]}${tile.digProgress ? Math.floor(tile.digProgress) : ""}`).join("")).join("")
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

function rebuildUndergroundStatic(scene: UndergroundScene, world: WorldSnapshot, staticKey: string): void {
  scene.staticLayer.removeChildren();
  drawUndergroundEarth(scene.staticLayer);
  drawUndergroundGrid(scene.staticLayer, world);
  scene.staticKey = staticKey;
}

function drawUndergroundEarth(root: Container): void {
  const earth = new Graphics();
  earth.rect(0, 0, UNDERGROUND_WIDTH, UNDERGROUND_HEIGHT).fill(0x5a3a1a);
  earth.rect(0, 0, UNDERGROUND_WIDTH, undergroundLayout.surfaceY).fill(0x9fb86b);
  earth.rect(0, undergroundLayout.surfaceY - 16, UNDERGROUND_WIDTH, 16).fill(0x5f422b);

  for (let y = 0; y < UNDERGROUND_HEIGHT; y += 8) {
    for (let x = 0; x < UNDERGROUND_WIDTH; x += 8) {
      const noise = (x * 13 + y * 23 + ((x + y) % 17)) % 11;
      if (y < undergroundLayout.surfaceY - 16) {
        earth.rect(x, y, 8, 8).fill(noise < 4 ? 0x8faa59 : 0xa8bf75);
      } else if (noise < 2) {
        earth.rect(x, y, 8, 8).fill(0x4e3117);
      } else if (noise > 8) {
        earth.rect(x, y, 8, 8).fill(0x64411e);
      }
    }
  }

  root.addChild(earth);
}

function drawUndergroundGrid(root: Container, world: WorldSnapshot): void {
  const entranceTop = undergroundEntranceTop(world);
  const metrics = undergroundGridMetrics(world);
  const grid = new Graphics();

  for (let y = 0; y < world.underground.grid.length; y += 1) {
    const row = world.underground.grid[y];
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x];
      const screenX = metrics.x + x * metrics.cellWidth;
      const screenY = metrics.y + y * metrics.cellHeight;
      const width = Math.ceil(metrics.cellWidth) + 1;
      const height = Math.ceil(metrics.cellHeight) + 1;
      if (tile.type === "soil") {
        grid.rect(screenX, screenY, width, height).fill({
          color: tile.digProgress ? 0x6f4a30 : 0x5a3a1a,
          alpha: tile.digProgress ? 0.62 + Math.min(0.28, (tile.digProgress ?? 0) / 24) : 0.76
        });
      } else if (tile.type === "entrance") {
        grid.rect(screenX, screenY, width, height).fill(0x1b1009);
      } else {
        const color = tile.type === "chamber" ? 0xa08030 : 0x8b6914;
        grid.rect(screenX, screenY, width, height).fill(color);
      }
    }
  }

  if (SHOW_UNDERGROUND_DEBUG) {
    for (const task of world.underground.digTasks) {
      if (task.status === "done") {
        continue;
      }

      const color = task.status === "active" ? 0xf1c56a : 0xd9a86a;
      for (const tile of task.targetTiles) {
        if (world.underground.grid[tile.y]?.[tile.x]?.type !== "soil") {
          continue;
        }

        grid.rect(
          metrics.x + tile.x * metrics.cellWidth,
          metrics.y + tile.y * metrics.cellHeight,
          Math.ceil(metrics.cellWidth),
          Math.ceil(metrics.cellHeight)
        ).fill({ color, alpha: task.status === "active" ? 0.18 : 0.08 });
      }
    }
  }

  grid.ellipse(entranceTop.x, entranceTop.y, 24, 10).fill(0x2d1b12);
  grid.ellipse(entranceTop.x, entranceTop.y + 2, 14, 7).fill(0x100a07);
  root.addChild(grid);
}

function updateUndergroundQueen(queen: Sprite, world: WorldSnapshot): void {
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

function updateUndergroundBrood(pool: SpritePool, world: WorldSnapshot): void {
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

function updateUndergroundStorage(pool: SpritePool, world: WorldSnapshot): void {
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

function updateUndergroundCarrion(pool: SpritePool, world: WorldSnapshot): void {
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
