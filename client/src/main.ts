import { Application } from "pixi.js";
import type { WorldSnapshot } from "../../shared/types";
import { renderWorld, surfaceTileFromGlobal, type Camera, type ViewMode } from "./render";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app root");
}

appRoot.innerHTML = `
  <main class="app">
    <div id="canvas-host" class="canvasHost"></div>
    <section class="panel topPanel">
      <div class="brand">
        <span class="mark"></span>
        <strong>AntColonyAI</strong>
      </div>
      <div class="segmented" role="tablist" aria-label="Слой">
        <button class="active" data-view="surface" type="button">Поверхность</button>
        <button data-view="underground" type="button">Подземелье</button>
      </div>
      <div class="segmented cameraControls" aria-label="Камера">
        <button class="active" data-camera="follow" type="button">Слежение</button>
        <button data-camera="free" type="button">Свободно</button>
        <button data-camera="nest" type="button">К гнезду</button>
      </div>
    </section>
    <aside class="panel hud">
      <div><span>Тик</span><strong id="tick">0</strong></div>
      <div><span>Поколение</span><strong id="generation">1</strong></div>
      <div><span>Поколений (колония)</span><strong id="generations-run">0</strong></div>
      <div><span>Поколение паука</span><strong id="spider-generation">1</strong></div>
      <div><span>Поколений (паук)</span><strong id="spider-generations-run">0</strong></div>
      <div><span>Лучш. фитнес</span><strong id="best-fitness">0</strong></div>
      <div><span>Склад</span><strong id="storage">0</strong></div>
      <div><span>Рабочие</span><strong id="workers">0</strong></div>
      <div><span>Яйца</span><strong id="eggs">0</strong></div>
      <div><span>Личинки</span><strong id="larvae">0</strong></div>
      <div><span>Матка</span><strong id="queen">жива</strong></div>
    </aside>
    <footer class="panel status">
      <span id="status">Подключение к ws://localhost:8787</span>
      <span>Клик по карте — подкинуть еду</span>
    </footer>
  </main>
`;

const style = document.createElement("style");
style.textContent = `
  :root {
    color-scheme: light;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #182018;
    color: #f5f8ef;
  }

  * { box-sizing: border-box; }

  html, body, #app {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
  }

  button {
    font: inherit;
  }

  .app {
    position: fixed;
    inset: 0;
    background: #15100d;
  }

  .canvasHost {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .canvasHost canvas {
    width: 100%;
    height: 100%;
    display: block;
    image-rendering: pixelated;
    cursor: crosshair;
  }

  .panel {
    position: absolute;
    z-index: 2;
    border: 1px solid rgb(245 248 239 / 0.22);
    border-radius: 8px;
    background: rgb(20 27 21 / 0.78);
    color: #f5f8ef;
    backdrop-filter: blur(8px);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.22);
  }

  .topPanel {
    left: 14px;
    right: 14px;
    top: 14px;
    min-height: 52px;
    padding: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    pointer-events: auto;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 152px;
  }

  .mark {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 38%, #f0c14b 0 16%, #6b3f24 18% 42%, #17201b 44% 100%);
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.22);
  }

  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 1px solid rgb(245 248 239 / 0.24);
    border-radius: 8px;
    overflow: hidden;
    min-height: 36px;
  }

  .segmented button {
    border: 0;
    background: rgb(255 255 255 / 0.08);
    color: #dce7d2;
    padding: 0 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .segmented button.active {
    background: #dfe9c7;
    color: #1e281d;
  }

  .cameraControls {
    margin-left: auto;
  }

  .hud {
    right: 14px;
    top: 82px;
    width: min(260px, calc(100vw - 28px));
    padding: 12px;
    display: grid;
    gap: 8px;
  }

  .hud div {
    min-height: 28px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid rgb(245 248 239 / 0.12);
  }

  .hud span {
    color: #c4d0bb;
    font-size: 13px;
  }

  .hud strong {
    color: #fffbea;
    font-size: 18px;
    letter-spacing: 0;
  }

  .status {
    left: 14px;
    bottom: 14px;
    max-width: calc(100vw - 28px);
    padding: 8px 10px;
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    color: #d7e2ce;
    font-size: 13px;
  }

  @media (max-width: 760px) {
    .topPanel {
      align-items: stretch;
    }

    .brand {
      width: 100%;
    }

    .segmented,
    .cameraControls {
      width: 100%;
      margin-left: 0;
    }

    .hud {
      top: auto;
      bottom: 58px;
      max-height: 42vh;
      overflow: auto;
    }
  }
`;
document.head.appendChild(style);

const canvasHost = document.querySelector<HTMLDivElement>("#canvas-host");
const status = document.querySelector<HTMLElement>("#status");
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]"));
const cameraButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-camera]"));
const tick = document.querySelector<HTMLElement>("#tick");
const generation = document.querySelector<HTMLElement>("#generation");
const generationsRun = document.querySelector<HTMLElement>("#generations-run");
const spiderGeneration = document.querySelector<HTMLElement>("#spider-generation");
const spiderGenerationsRun = document.querySelector<HTMLElement>("#spider-generations-run");
const bestFitness = document.querySelector<HTMLElement>("#best-fitness");
const storage = document.querySelector<HTMLElement>("#storage");
const workers = document.querySelector<HTMLElement>("#workers");
const eggs = document.querySelector<HTMLElement>("#eggs");
const larvae = document.querySelector<HTMLElement>("#larvae");
const queen = document.querySelector<HTMLElement>("#queen");

if (
  !canvasHost ||
  !status ||
  !tick ||
  !generation ||
  !generationsRun ||
  !spiderGeneration ||
  !spiderGenerationsRun ||
  !bestFitness ||
  !storage ||
  !workers ||
  !eggs ||
  !larvae ||
  !queen
) {
  throw new Error("Missing UI nodes");
}

const canvasHostNode = canvasHost;
const statusNode = status;
const tickNode = tick;
const generationNode = generation;
const generationsRunNode = generationsRun;
const spiderGenerationNode = spiderGeneration;
const spiderGenerationsRunNode = spiderGenerationsRun;
const bestFitnessNode = bestFitness;
const storageNode = storage;
const workersNode = workers;
const eggsNode = eggs;
const larvaeNode = larvae;
const queenNode = queen;

const SURFACE_TILE_SIZE = 8;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.5;
const PACKET_INTERVAL = 100;

type CameraMode = "follow" | "free";
type AntInterp = {
  prevX: number;
  prevY: number;
  prevAngle: number;
  currX: number;
  currY: number;
  currAngle: number;
  layer: string;
};

let currentView: ViewMode = "surface";
let cameraMode: CameraMode = "follow";
let camera: Camera = { x: 50, y: 50, zoom: 1 };
let latestWorld: WorldSnapshot | null = null;
let lastRenderAt = 0;
let lastPacketTime = 0;
let lastPheromones: WorldSnapshot["pheromones"] | null = null;
let isDragging = false;
let pointerDown = false;
let dragDistance = 0;
let lastPointer = { x: 0, y: 0 };
const antInterp = new Map<string, AntInterp>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampCamera(world: WorldSnapshot): void {
  camera.zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);
  const marginX = pixi.screen.width / (SURFACE_TILE_SIZE * camera.zoom) / 2;
  const marginY = pixi.screen.height / (SURFACE_TILE_SIZE * camera.zoom) / 2;
  camera.x = marginX * 2 >= world.surface.width
    ? world.surface.width / 2
    : clamp(camera.x, marginX, world.surface.width - marginX);
  camera.y = marginY * 2 >= world.surface.height
    ? world.surface.height / 2
    : clamp(camera.y, marginY, world.surface.height - marginY);
}

function centerOnNest(world: WorldSnapshot): void {
  camera.x = world.surface.entrance.x;
  camera.y = world.surface.entrance.y;
  clampCamera(world);
}

function setCameraMode(mode: CameraMode): void {
  cameraMode = mode;
  for (const button of cameraButtons) {
    button.classList.toggle("active", button.dataset.camera === mode);
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

const pixi = new Application();
await pixi.init({
  background: "#15100d",
  resizeTo: window,
  antialias: false
});
canvasHost.appendChild(pixi.canvas);

function updateHud(world: WorldSnapshot): void {
  tickNode.textContent = String(world.tick);
  generationNode.textContent = String(world.colony.generation);
  generationsRunNode.textContent = String(world.colony.generationsRun);
  spiderGenerationNode.textContent = String(world.colony.spiderGeneration);
  spiderGenerationsRunNode.textContent = String(world.colony.spiderGenerationsRun);
  bestFitnessNode.textContent = String(Math.round(world.colony.bestFitness));
  storageNode.textContent = String(Math.floor(world.underground.foodStorage));
  workersNode.textContent = String(world.colony.population.workers);
  eggsNode.textContent = String(world.colony.population.eggs);
  larvaeNode.textContent = String(world.colony.population.larvae ?? 0);
  queenNode.textContent = world.colony.queenAlive ? "жива" : "погибла";
}

function draw(interpT: number): void {
  if (!latestWorld) {
    return;
  }

  if (currentView === "surface" && cameraMode === "follow") {
    centerOnNest(latestWorld);
  } else {
    clampCamera(latestWorld);
  }

  const ants = latestWorld.ants.map((ant) => {
    const ip = antInterp.get(ant.id);
    if (!ip) {
      return ant;
    }
    const x = ip.prevX + (ip.currX - ip.prevX) * interpT;
    const y = ip.prevY + (ip.currY - ip.prevY) * interpT;
    const angle = lerpAngle(ip.prevAngle, ip.currAngle, interpT);
    return { ...ant, pos: { x, y }, heading: { x: Math.cos(angle), y: Math.sin(angle) } };
  });

  renderWorld(pixi.stage, { ...latestWorld, ants }, currentView, pixi.screen.width, pixi.screen.height, camera);
  updateHud(latestWorld);
}

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    currentView = button.dataset.view as ViewMode;
    for (const item of viewButtons) {
      item.classList.toggle("active", item === button);
    }
  });
}

for (const button of cameraButtons) {
  button.addEventListener("click", () => {
    if (!latestWorld) {
      return;
    }

    if (button.dataset.camera === "nest") {
      setCameraMode("free");
      centerOnNest(latestWorld);
      return;
    }

    setCameraMode(button.dataset.camera === "free" ? "free" : "follow");
  });
}

pixi.ticker.add(() => {
  const now = performance.now();
  if (now - lastRenderAt < 1000 / 30 || !latestWorld) {
    return;
  }

  const interpT = lastPacketTime > 0 ? Math.min((now - lastPacketTime) / PACKET_INTERVAL, 1) : 1;
  draw(interpT);
  lastRenderAt = now;
});

const wsHost = window.location.hostname || "localhost";
const socket = new WebSocket(`ws://${wsHost}:8787`);

pixi.canvas.addEventListener("pointerdown", (event) => {
  pointerDown = true;
  isDragging = false;
  dragDistance = 0;
  lastPointer = { x: event.clientX, y: event.clientY };
  pixi.canvas.setPointerCapture(event.pointerId);
});

pixi.canvas.addEventListener("pointermove", (event) => {
  if (!pointerDown || currentView !== "surface" || !latestWorld) {
    return;
  }

  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  dragDistance += Math.abs(dx) + Math.abs(dy);
  lastPointer = { x: event.clientX, y: event.clientY };

  if (dragDistance <= 4) {
    return;
  }

  isDragging = true;
  setCameraMode("free");
  camera.x -= dx / (SURFACE_TILE_SIZE * camera.zoom);
  camera.y -= dy / (SURFACE_TILE_SIZE * camera.zoom);
  clampCamera(latestWorld);
});

pixi.canvas.addEventListener("pointerup", (event) => {
  pointerDown = false;
  pixi.canvas.releasePointerCapture(event.pointerId);
  if (
    isDragging ||
    currentView !== "surface" ||
    !latestWorld ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  const rect = pixi.canvas.getBoundingClientRect();
  const globalX = (event.clientX - rect.left) * (pixi.screen.width / Math.max(1, rect.width));
  const globalY = (event.clientY - rect.top) * (pixi.screen.height / Math.max(1, rect.height));
  const tile = surfaceTileFromGlobal(latestWorld, globalX, globalY);
  if (!tile) {
    return;
  }

  socket.send(JSON.stringify({ type: "dropFood", x: tile.x, y: tile.y }));
});

pixi.canvas.addEventListener("wheel", (event) => {
  if (currentView !== "surface" || !latestWorld) {
    return;
  }

  event.preventDefault();
  setCameraMode("free");
  const rect = pixi.canvas.getBoundingClientRect();
  const globalX = (event.clientX - rect.left) * (pixi.screen.width / Math.max(1, rect.width));
  const globalY = (event.clientY - rect.top) * (pixi.screen.height / Math.max(1, rect.height));
  const tile = surfaceTileFromGlobal(latestWorld, globalX, globalY);
  const nextZoom = clamp(camera.zoom * (event.deltaY < 0 ? 1.12 : 0.88), MIN_ZOOM, MAX_ZOOM);

  if (tile) {
    camera.zoom = nextZoom;
    camera.x = tile.x - (globalX - pixi.screen.width * 0.5) / (SURFACE_TILE_SIZE * camera.zoom);
    camera.y = tile.y - (globalY - pixi.screen.height * 0.5) / (SURFACE_TILE_SIZE * camera.zoom);
  } else {
    camera.zoom = nextZoom;
  }
  clampCamera(latestWorld);
}, { passive: false });

socket.addEventListener("open", () => {
  statusNode.textContent = "Подключено";
});

socket.addEventListener("close", () => {
  statusNode.textContent = "Соединение закрыто";
});

socket.addEventListener("error", () => {
  statusNode.textContent = "Ошибка WebSocket";
});

socket.addEventListener("message", (event) => {
  const snap = JSON.parse(String(event.data)) as WorldSnapshot;

  if (snap.pheromones && snap.pheromones.food.length > 0) {
    lastPheromones = snap.pheromones;
  } else if (lastPheromones) {
    snap.pheromones = lastPheromones;
  }

  const seen = new Set<string>();
  for (const ant of snap.ants) {
    seen.add(ant.id);
    const angle = Math.atan2(ant.heading.y, ant.heading.x);
    const existing = antInterp.get(ant.id);
    if (existing && existing.layer === ant.layer) {
      existing.prevX = existing.currX;
      existing.prevY = existing.currY;
      existing.prevAngle = existing.currAngle;
      existing.currX = ant.pos.x;
      existing.currY = ant.pos.y;
      existing.currAngle = angle;
    } else {
      antInterp.set(ant.id, {
        prevX: ant.pos.x,
        prevY: ant.pos.y,
        prevAngle: angle,
        currX: ant.pos.x,
        currY: ant.pos.y,
        currAngle: angle,
        layer: ant.layer
      });
    }
  }
  for (const id of antInterp.keys()) {
    if (!seen.has(id)) {
      antInterp.delete(id);
    }
  }

  latestWorld = snap;
  lastPacketTime = performance.now();
  if (camera.x === 50 && camera.y === 50) {
    centerOnNest(snap);
  }
});
