import { Container, Graphics, RenderTexture, Sprite, Renderer } from "pixi.js";
import type { Vec2, WorldSnapshot } from "../../../../shared/types";
import { createSpritePool } from "../spritePool";
import type { Camera, SurfaceScene, ViewBounds } from "../types";
import { SURFACE_TILE_SIZE } from "../types";
import {
  createAntSprite,
  createCarrionSprite,
  createFoodSprite,
  createSpiderLairSprite,
  createSpiderSprite
} from "../../sprites";
import { drawSurfaceGround } from "./ground";
import { drawSurfacePheromones } from "./pheromones";
import { drawSurfaceEntrance } from "./entrance";
import { updateSurfaceFood, updateSurfaceCarrion, updateSurfaceLairs, updateSurfaceEnemies, updateSurfaceAnts, updateSurfaceWebs, updateSurfaceDebris } from "./entities";

export function isInBounds(pos: Vec2, bounds: ViewBounds, padding = 0): boolean {
  return (
    pos.x >= bounds.left - padding &&
    pos.x <= bounds.right + padding &&
    pos.y >= bounds.top - padding &&
    pos.y <= bounds.bottom + padding
  );
}

export function visibleSurfaceBounds(camera: Camera, viewportWidth: number, viewportHeight: number): ViewBounds {
  const halfWidth = viewportWidth / Math.max(0.1, camera.zoom) / SURFACE_TILE_SIZE / 2;
  const halfHeight = viewportHeight / Math.max(0.1, camera.zoom) / SURFACE_TILE_SIZE / 2;
  return {
    left: camera.x - halfWidth - 2,
    right: camera.x + halfWidth + 2,
    top: camera.y - halfHeight - 2,
    bottom: camera.y + halfHeight + 2
  };
}

export function createSurfaceScene(): SurfaceScene {
  const root = new Container();
  const staticLayer = new Container();
  const entranceLayer = new Container();
  const pheromones = new Graphics();
  const webs = new Graphics();
  const debrisGraphics = new Graphics();
  const foodContainer = new Container();
  const carrionContainer = new Container();
  const lairContainer = new Container();
  const enemyContainer = new Container();
  const carriedCarrionContainer = new Container();
  const antContainer = new Container();

  root.addChild(staticLayer, entranceLayer, pheromones, webs, debrisGraphics, foodContainer, carrionContainer, lairContainer, enemyContainer, carriedCarrionContainer, antContainer);

  return {
    root,
    staticLayer,
    entranceLayer,
    pheromones,
    webs,
    debrisGraphics,
    foodPool: createSpritePool(foodContainer, () => createFoodSprite(2.2)),
    carrionPool: createSpritePool(carrionContainer, () => createCarrionSprite(2.6)),
    lairPool: createSpritePool(lairContainer, () => createSpiderLairSprite(3.4)),
    carriedCarrionPool: createSpritePool(carriedCarrionContainer, () => createCarrionSprite(1.7)),
    enemyPool: createSpritePool(enemyContainer, () => createSpiderSprite(4)),
    antPool: createSpritePool(antContainer, () => createAntSprite(false, 2.45)),
    staticKey: "",
    entranceKey: ""
  };
}

function rebuildSurfaceStatic(
  scene: SurfaceScene,
  renderer: Renderer,
  world: WorldSnapshot,
  cell: number,
  staticKey: string
): void {
  scene.staticLayer.removeChildren();
  if (scene.groundSprite) {
    scene.groundSprite.destroy({ children: true, texture: true });
    scene.groundSprite = undefined;
  }

  const tempContainer = new Container();
  const fullBounds: ViewBounds = {
    left: 0,
    right: world.surface.width,
    top: 0,
    bottom: world.surface.height
  };
  drawSurfaceGround(tempContainer, world.surface.width, world.surface.height, cell, fullBounds);

  const widthPx = world.surface.width * cell;
  const heightPx = world.surface.height * cell;
  const renderTexture = RenderTexture.create({
    width: widthPx,
    height: heightPx
  });

  renderer.render({
    container: tempContainer,
    target: renderTexture
  });

  const groundSprite = new Sprite(renderTexture);
  scene.staticLayer.addChild(groundSprite);
  scene.groundSprite = groundSprite;

  tempContainer.destroy({ children: true });
  scene.staticKey = staticKey;
}

function updateSurfaceEntrances(scene: SurfaceScene, world: WorldSnapshot, cell: number, entranceKey: string): void {
  if (scene.entranceKey === entranceKey) {
    return;
  }

  const children = scene.entranceLayer.removeChildren();
  for (const child of children) {
    child.destroy({ children: true });
  }

  drawSurfaceEntrance(scene.entranceLayer, world, cell);
  scene.entranceKey = entranceKey;
}

export function renderSurface(
  scene: SurfaceScene,
  renderer: Renderer,
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
    world.surface.height
  ].join(":");
  if (scene.staticKey !== staticKey) {
    rebuildSurfaceStatic(scene, renderer, world, cell, staticKey);
  }

  const dirtMounds = world.colonies?.map((c) => Math.floor((c.underground?.dirtMound ?? 0) / 30)) ?? [Math.floor((world.underground.dirtMound ?? 0) / 30)];
  const entranceKey = [
    ...(world.surface.entrances ?? [world.surface.entrance]).flatMap((entrance) => [entrance.x, entrance.y]),
    ...dirtMounds
  ].join(":");
  updateSurfaceEntrances(scene, world, cell, entranceKey);

  drawSurfacePheromones(scene.pheromones, world, cell, bounds);
  updateSurfaceWebs(scene.webs, world, cell, bounds);
  updateSurfaceDebris(scene.debrisGraphics, world, cell, bounds);
  updateSurfaceFood(scene.foodPool, world, cell, bounds);
  updateSurfaceCarrion(scene.carrionPool, world, cell, bounds);
  updateSurfaceLairs(scene.lairPool, world, cell, bounds);
  updateSurfaceEnemies(scene.enemyPool, scene.carriedCarrionPool, world, cell, bounds);
  updateSurfaceAnts(scene.antPool, scene.debrisGraphics, world, cell, bounds);
}
