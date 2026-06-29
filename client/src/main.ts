import { Application } from "pixi.js";
import { CURRENT_PROTOCOL_VERSION, type NetworkWorldSnapshot, type WorldSnapshot } from "../../shared/types";
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
      <div class="segmented nestControls" aria-label="Гнездо">
        <button class="active" data-nest="0" type="button">Гнездо A</button>
        <button data-nest="1" type="button">Гнездо B</button>
      </div>
      <div class="segmented speedControls" aria-label="Скорость">
        <button class="active" data-speed="1" type="button">1x</button>
        <button data-speed="5" type="button">5x</button>
        <button data-speed="20" type="button">20x</button>
        <button data-speed="50" type="button">Max</button>
      </div>
      <div class="segmented trampleControls" aria-label="Тропинки">
        <button class="active" id="btn-trample" type="button">Тропинки: Вкл</button>
      </div>
      <div class="segmented cameraControls" aria-label="Камера">
        <button class="active" data-camera="follow" type="button">Слежение</button>
        <button data-camera="free" type="button">Свободно</button>
        <button data-camera="nest" type="button">К гнезду</button>
      </div>
    </section>
    <aside class="panel hud">
      <div class="hudCommon">
        <div><span>Тик</span><strong id="tick">0</strong></div>
        <div><span>Паук</span><strong id="spider-generation">G1</strong></div>
        <div><span>Поколений паука</span><strong id="spider-generations-run">0</strong></div>
        <div><span>Лучший фитнес</span><strong id="best-fitness">0</strong></div>
      </div>
      <div class="colonyGrid">
        <section class="colonyStats colonyA">
          <h2>Колония A</h2>
          <div><span>Поколение</span><strong id="colony-a-generation">1</strong></div>
          <div><span>Поколений</span><strong id="colony-a-generations-run">0</strong></div>
          <div><span>Рабочие</span><strong id="colony-a-workers">0</strong></div>
          <div><span>Разведка</span><strong id="colony-a-scouts">0</strong></div>
          <div><span>Няньки</span><strong id="colony-a-nurses">0</strong></div>
          <div><span>Склад</span><strong id="colony-a-storage">0</strong></div>
          <div><span>Яйца</span><strong id="colony-a-eggs">0</strong></div>
          <div><span>Личинки</span><strong id="colony-a-larvae">0</strong></div>
          <div><span>Матка</span><strong id="colony-a-queen">жива</strong></div>
          <div><span>Стресс</span><strong id="colony-a-stress">0</strong></div>
          <div><span>Возраст</span><strong id="colony-a-age">0</strong></div>
          <div><span>Принцессы</span><strong id="colony-a-princesses">0</strong></div>
        </section>
        <section class="colonyStats colonyB">
          <h2>Колония B</h2>
          <div><span>Поколение</span><strong id="colony-b-generation">1</strong></div>
          <div><span>Поколений</span><strong id="colony-b-generations-run">0</strong></div>
          <div><span>Рабочие</span><strong id="colony-b-workers">0</strong></div>
          <div><span>Разведка</span><strong id="colony-b-scouts">0</strong></div>
          <div><span>Няньки</span><strong id="colony-b-nurses">0</strong></div>
          <div><span>Склад</span><strong id="colony-b-storage">0</strong></div>
          <div><span>Яйца</span><strong id="colony-b-eggs">0</strong></div>
          <div><span>Личинки</span><strong id="colony-b-larvae">0</strong></div>
          <div><span>Матка</span><strong id="colony-b-queen">жива</strong></div>
          <div><span>Стресс</span><strong id="colony-b-stress">0</strong></div>
          <div><span>Возраст</span><strong id="colony-b-age">0</strong></div>
          <div><span>Принцессы</span><strong id="colony-b-princesses">0</strong></div>
        </section>
      </div>
    </aside>
    <footer class="panel status">
      <span id="status">Подключение к ws://localhost:8787</span>
      <span>Клик по карте - подкинуть еду</span>
      <span class="perfStat">FPS <strong id="fps">0</strong></span>
      <span class="perfStat">Packet <strong id="packet-ms">0</strong> ms</span>
      <span class="perfStat">Payload <strong id="payload-kb">0</strong> KB</span>
      <span class="perfStat">Render <strong id="render-ms">0</strong> ms</span>
      <span class="perfStat">Ants <strong id="ants-count">0</strong></span>
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

  .nestControls {
    display: none;
  }

  .app.undergroundView .nestControls {
    display: grid;
  }

  .trampleControls {
    display: grid;
  }

  .app.undergroundView .trampleControls {
    display: none;
  }

  .hud {
    right: 14px;
    top: 82px;
    width: min(560px, calc(100vw - 28px));
    padding: 12px;
    display: grid;
    gap: 12px;
  }

  .hudCommon,
  .colonyGrid {
    display: grid;
    gap: 8px;
  }

  .hudCommon {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .colonyGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hudCommon div,
  .colonyStats div {
    min-height: 28px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid rgb(245 248 239 / 0.12);
  }

  .colonyStats {
    min-width: 0;
  }

  .colonyStats h2 {
    margin: 0 0 4px;
    font-size: 14px;
    line-height: 1.2;
    letter-spacing: 0;
    color: #fffbea;
  }

  .colonyB h2 {
    color: #ffb4aa;
  }

  .hud span {
    color: #c4d0bb;
    font-size: 13px;
  }

  .hud strong {
    color: #fffbea;
    font-size: 16px;
    letter-spacing: 0;
    text-align: right;
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

  .perfStat strong {
    color: #fffbea;
    font-variant-numeric: tabular-nums;
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

    .hudCommon,
    .colonyGrid {
      grid-template-columns: 1fr;
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
const appShell = document.querySelector<HTMLElement>(".app");
const status = document.querySelector<HTMLElement>("#status");
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]"));
const nestButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-nest]"));
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-speed]"));
const cameraButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-camera]"));
const btnTrample = document.querySelector<HTMLButtonElement>("#btn-trample");
const tick = document.querySelector<HTMLElement>("#tick");
const spiderGeneration = document.querySelector<HTMLElement>("#spider-generation");
const spiderGenerationsRun = document.querySelector<HTMLElement>("#spider-generations-run");
const bestFitness = document.querySelector<HTMLElement>("#best-fitness");
const fps = document.querySelector<HTMLElement>("#fps");
const packetMs = document.querySelector<HTMLElement>("#packet-ms");
const payloadKb = document.querySelector<HTMLElement>("#payload-kb");
const renderMs = document.querySelector<HTMLElement>("#render-ms");
const antsCount = document.querySelector<HTMLElement>("#ants-count");

let trampleEnabled = true;

const colonyNodes = [0, 1].map((index) => {
  const key = index === 0 ? "a" : "b";
  return {
    generation: document.querySelector<HTMLElement>(`#colony-${key}-generation`),
    generationsRun: document.querySelector<HTMLElement>(`#colony-${key}-generations-run`),
    workers: document.querySelector<HTMLElement>(`#colony-${key}-workers`),
    scouts: document.querySelector<HTMLElement>(`#colony-${key}-scouts`),
    nurses: document.querySelector<HTMLElement>(`#colony-${key}-nurses`),
    storage: document.querySelector<HTMLElement>(`#colony-${key}-storage`),
    eggs: document.querySelector<HTMLElement>(`#colony-${key}-eggs`),
    larvae: document.querySelector<HTMLElement>(`#colony-${key}-larvae`),
    queen: document.querySelector<HTMLElement>(`#colony-${key}-queen`),
    stress: document.querySelector<HTMLElement>(`#colony-${key}-stress`),
    age: document.querySelector<HTMLElement>(`#colony-${key}-age`),
    princesses: document.querySelector<HTMLElement>(`#colony-${key}-princesses`)
  };
});

if (
  !canvasHost ||
  !appShell ||
  !status ||
  !tick ||
  !spiderGeneration ||
  !spiderGenerationsRun ||
  !bestFitness ||
  !fps ||
  !packetMs ||
  !payloadKb ||
  !renderMs ||
  !antsCount ||
  !btnTrample ||
  colonyNodes.some((nodes) => Object.values(nodes).some((node) => !node))
) {
  throw new Error("Missing UI nodes");
}

const canvasHostNode = canvasHost;
const appShellNode = appShell;
const statusNode = status;
const tickNode = tick;
const spiderGenerationNode = spiderGeneration;
const spiderGenerationsRunNode = spiderGenerationsRun;
const bestFitnessNode = bestFitness;
const fpsNode = fps;
const packetMsNode = packetMs;
const payloadKbNode = payloadKb;
const renderMsNode = renderMs;
const antsCountNode = antsCount;
const colonyStatNodes = colonyNodes.map((nodes) => ({
  generation: nodes.generation as HTMLElement,
  generationsRun: nodes.generationsRun as HTMLElement,
  workers: nodes.workers as HTMLElement,
  scouts: nodes.scouts as HTMLElement,
  nurses: nodes.nurses as HTMLElement,
  storage: nodes.storage as HTMLElement,
  eggs: nodes.eggs as HTMLElement,
  larvae: nodes.larvae as HTMLElement,
  queen: nodes.queen as HTMLElement,
  stress: nodes.stress as HTMLElement,
  age: nodes.age as HTMLElement,
  princesses: nodes.princesses as HTMLElement
}));

const SURFACE_TILE_SIZE = 8;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.5;
let packetInterval = 100;

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
let currentUndergroundColony = 0;
let cameraMode: CameraMode = "follow";
let currentSpeed = 1;
let camera: Camera = { x: 50, y: 50, zoom: 1 };
let latestWorld: NetworkWorldSnapshot | null = null;
let lastRenderAt = 0;
let lastPacketTime = 0;
let lastPheromones: WorldSnapshot["pheromones"] | null = null;
let warnedProtocolVersion = false;
let isDragging = false;
let pointerDown = false;
let dragDistance = 0;
let lastPointer = { x: 0, y: 0 };
let framesSinceFpsUpdate = 0;
let lastFpsUpdateAt = performance.now();
let currentFps = 0;
let lastRenderCostMs = 0;
let lastPayloadKb = 0;
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

function setUndergroundColony(index: number): void {
  currentUndergroundColony = clamp(index, 0, 1);
  for (const button of nestButtons) {
    button.classList.toggle("active", Number(button.dataset.nest) === currentUndergroundColony);
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
  spiderGenerationNode.textContent = `G${world.colony.spiderGeneration}`;
  spiderGenerationsRunNode.textContent = String(world.colony.spiderGenerationsRun);

  const colonies = world.colonies?.length
    ? world.colonies
    : [{ colony: world.colony, underground: world.underground }];
  bestFitnessNode.textContent = String(Math.round(Math.max(...colonies.map((item) => item.colony.bestFitness))));

  colonyStatNodes.forEach((nodes, index) => {
    const item = colonies[index];
    if (!item) {
      nodes.generation.textContent = "-";
      nodes.generationsRun.textContent = "-";
      nodes.workers.textContent = "-";
      nodes.scouts.textContent = "-";
      nodes.nurses.textContent = "-";
      nodes.storage.textContent = "-";
      nodes.eggs.textContent = "-";
      nodes.larvae.textContent = "-";
      nodes.queen.textContent = "-";
      nodes.stress.textContent = "-";
      nodes.age.textContent = "-";
      nodes.princesses.textContent = "-";
      return;
    }

    nodes.generation.textContent = String(item.colony.generation);
    nodes.generationsRun.textContent = String(item.colony.generationsRun);
    nodes.workers.textContent = String(item.colony.population.workers);
    nodes.scouts.textContent = String(item.colony.population.scouts ?? 0);
    nodes.nurses.textContent = String(item.colony.population.nurses ?? 0);
    nodes.storage.textContent = String(Math.floor(item.underground.foodStorage));
    nodes.eggs.textContent = String(item.colony.population.eggs);
    nodes.larvae.textContent = String(item.colony.population.larvae ?? 0);
    nodes.queen.textContent = item.colony.queenAlive ? "жива" : "погибла";
    nodes.stress.textContent = String(Math.round(item.colony.queenStress ?? 0));
    nodes.age.textContent = String(Math.floor(item.colony.queenAge ?? 0));
    nodes.princesses.textContent = String(item.colony.princesses ?? 0);
  });
}

function updatePerfHud(world: WorldSnapshot): void {
  fpsNode.textContent = String(currentFps);
  packetMsNode.textContent = String(Math.round(packetInterval));
  payloadKbNode.textContent = String(lastPayloadKb);
  renderMsNode.textContent = lastRenderCostMs.toFixed(1);
  antsCountNode.textContent = String(world.ants.length);
}

function draw(interpT: number): void {
  if (!latestWorld) {
    return;
  }
  if (!snapshotMatchesView(latestWorld)) {
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

  const renderStart = performance.now();
  renderWorld(
    pixi.stage,
    pixi.renderer,
    { ...latestWorld, ants },
    currentView,
    pixi.screen.width,
    pixi.screen.height,
    camera,
    currentUndergroundColony,
    trampleEnabled
  );
  lastRenderCostMs = performance.now() - renderStart;
}

btnTrample.addEventListener("click", () => {
  trampleEnabled = !trampleEnabled;
  btnTrample.classList.toggle("active", trampleEnabled);
  btnTrample.textContent = `Тропинки: ${trampleEnabled ? "Вкл" : "Выкл"}`;
});

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    currentView = button.dataset.view as ViewMode;
    appShellNode.classList.toggle("undergroundView", currentView === "underground");
    for (const item of viewButtons) {
      item.classList.toggle("active", item === button);
    }
    requestNetworkView();
  });
}

for (const button of nestButtons) {
  button.addEventListener("click", () => {
    setUndergroundColony(Number(button.dataset.nest ?? 0));
    requestNetworkView();
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

  const interpT = lastPacketTime > 0 ? Math.min((now - lastPacketTime) / packetInterval, 1) : 1;
  draw(interpT);
  framesSinceFpsUpdate += 1;
  if (now - lastFpsUpdateAt >= 1000) {
    currentFps = Math.round((framesSinceFpsUpdate * 1000) / Math.max(1, now - lastFpsUpdateAt));
    framesSinceFpsUpdate = 0;
    lastFpsUpdateAt = now;
    updatePerfHud(latestWorld);
  }
  lastRenderAt = now;
});

const wsHost = window.location.hostname || "localhost";
const socket = new WebSocket(`ws://${wsHost}:8787`);

function requestNetworkView(): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    type: "setView",
    mode: currentView,
    undergroundColonyIndex: currentUndergroundColony
  }));
}

function snapshotMatchesView(world: NetworkWorldSnapshot): boolean {
  return (
    world.networkView.mode === currentView &&
    world.networkView.undergroundColonyIndex === currentUndergroundColony
  );
}

function setSpeed(speed: number): void {
  currentSpeed = speed;
  for (const button of speedButtons) {
    button.classList.toggle("active", Number(button.dataset.speed) === speed);
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "setSpeed", value: speed }));
  }
}

for (const button of speedButtons) {
  button.addEventListener("click", () => {
    setSpeed(Number(button.dataset.speed ?? 1));
  });
}

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
  setSpeed(currentSpeed);
  requestNetworkView();
});

socket.addEventListener("close", () => {
  statusNode.textContent = "Соединение закрыто";
});

socket.addEventListener("error", () => {
  statusNode.textContent = "Ошибка WebSocket";
});

function unpackSparseGrid(sparse: any, size: number): Float32Array {
  const arr = new Float32Array(size);
  if (sparse && sparse.i && sparse.v) {
    const indices = sparse.i;
    const values = sparse.v;
    const len = indices.length;
    for (let k = 0; k < len; k += 1) {
      arr[indices[k]] = values[k];
    }
  }
  return arr;
}

socket.addEventListener("message", (event) => {
  const now = performance.now();
  if (lastPacketTime > 0) {
    const diff = now - lastPacketTime;
    if (diff > 5 && diff < 300) {
      packetInterval = packetInterval * 0.8 + diff * 0.2;
    }
  }
  lastPacketTime = now;

  const rawMessage = String(event.data);
  lastPayloadKb = Math.round(new Blob([rawMessage]).size / 1024);
  const snap = JSON.parse(rawMessage) as NetworkWorldSnapshot;
  const protocolVersion = snap.protocolVersion ?? 1;
  if (!warnedProtocolVersion && protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    console.warn(`Unsupported protocolVersion ${protocolVersion}; client expects ${CURRENT_PROTOCOL_VERSION}.`);
    warnedProtocolVersion = true;
  }

  const hasNewPheromones = snap.pheromones && snap.pheromones.food && snap.pheromones.food.i && snap.pheromones.food.i.length > 0;
  if (hasNewPheromones) {
    const size = snap.pheromones.width * snap.pheromones.height;
    snap.pheromones.food = unpackSparseGrid(snap.pheromones.food, size);
    snap.pheromones.home = unpackSparseGrid(snap.pheromones.home, size);
    lastPheromones = snap.pheromones;
  } else if (lastPheromones) {
    snap.pheromones = lastPheromones;
  } else if (snap.pheromones) {
    const size = snap.pheromones.width * snap.pheromones.height;
    snap.pheromones.food = new Float32Array(size);
    snap.pheromones.home = new Float32Array(size);
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
  updateHud(snap);
  updatePerfHud(snap);
  if (camera.x === 50 && camera.y === 50) {
    centerOnNest(snap);
  }
});
