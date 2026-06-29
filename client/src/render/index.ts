import { Container, Renderer } from "pixi.js";
import type { Vec2, WorldSnapshot } from "../../../shared/types";
import type { Camera, RendererState, ViewMode } from "./types";
import { SURFACE_TILE_SIZE } from "./types";
import { createSurfaceScene, renderSurface } from "./surface/scene";
import { createUndergroundScene, renderUnderground } from "./underground/scene";

export type { Camera, ViewMode } from "./types";

const rendererState: RendererState = {
  stage: null,
  surface: createSurfaceScene(),
  underground: createUndergroundScene()
};

function ensureStage(stage: Container): void {
  if (rendererState.stage === stage) {
    return;
  }

  rendererState.stage = stage;
  stage.addChild(rendererState.surface.root, rendererState.underground.root);
}

function undergroundWorld(world: WorldSnapshot, colonyIndex: number): WorldSnapshot {
  const colony = world.colonies?.[colonyIndex];
  if (!colony) {
    return world;
  }

  return {
    ...world,
    underground: colony.underground,
    colony: colony.colony,
    ants: world.ants.filter((ant) => ant.colonyId === colony.id)
  };
}

export function renderWorld(
  stage: Container,
  renderer: Renderer,
  world: WorldSnapshot,
  mode: ViewMode,
  viewportWidth = 900,
  viewportHeight = 760,
  camera: Camera = { x: world.surface.entrance.x, y: world.surface.entrance.y, zoom: 1 },
  undergroundColonyIndex = 0,
  trampleEnabled = true
): void {
  ensureStage(stage);

  rendererState.surface.root.visible = mode === "surface";
  rendererState.underground.root.visible = mode === "underground";

  if (mode === "surface") {
    renderSurface(rendererState.surface, renderer, world, viewportWidth, viewportHeight, camera, trampleEnabled);
    return;
  }

  renderUnderground(rendererState.underground, undergroundWorld(world, undergroundColonyIndex), viewportWidth, viewportHeight);
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
