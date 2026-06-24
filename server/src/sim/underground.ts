import type { Brood, DigTask, Underground, UndergroundRoom, UndergroundTile, UndergroundTileType, Vec2 } from "../../../shared/types";
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

function makeSoilGrid(width: number, height: number): UndergroundTile[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ type: "soil" as const })));
}

function tilePos(pos: Vec2): Vec2 {
  return {
    x: Math.round(pos.x),
    y: Math.round(pos.y)
  };
}

function inBounds(grid: UndergroundTile[][], x: number, y: number): boolean {
  return y >= 0 && y < grid.length && x >= 0 && x < (grid[y]?.length ?? 0);
}

function setTile(grid: UndergroundTile[][], x: number, y: number, type: UndergroundTileType, roomId?: string): void {
  if (!inBounds(grid, x, y)) {
    return;
  }

  grid[y][x] = roomId ? { type, roomId } : { type };
}

function roomBounds(center: Vec2, width: number, height: number): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(center.x - width / 2),
    y: Math.round(center.y - height / 2),
    width,
    height
  };
}

function rectTiles(x: number, y: number, width: number, height: number): Vec2[] {
  const tiles: Vec2[] = [];
  for (let ty = y; ty < y + height; ty += 1) {
    for (let tx = x; tx < x + width; tx += 1) {
      tiles.push({ x: tx, y: ty });
    }
  }
  return tiles;
}

function ovalTiles(x: number, y: number, width: number, height: number): Vec2[] {
  const centerX = x + (width - 1) / 2;
  const centerY = y + (height - 1) / 2;
  const rx = Math.max(1, width / 2);
  const ry = Math.max(1, height / 2);
  return rectTiles(x, y, width, height).filter((tile) => {
    const nx = (tile.x - centerX) / rx;
    const ny = (tile.y - centerY) / ry;
    const roughness = ((tile.x * 17 + tile.y * 31) % 11) / 100;
    return nx * nx + ny * ny <= 1.02 + roughness;
  });
}

function carveRoom(grid: UndergroundTile[][], room: UndergroundRoom): void {
  for (const tile of ovalTiles(room.x, room.y, room.width, room.height)) {
    setTile(grid, tile.x, tile.y, "chamber", room.id);
  }
}

function lineTiles(from: Vec2, to: Vec2): Vec2[] {
  const start = tilePos(from);
  const end = tilePos(to);
  const tiles: Vec2[] = [];
  const stepX = start.x <= end.x ? 1 : -1;
  const stepY = start.y <= end.y ? 1 : -1;

  for (let x = start.x; x !== end.x + stepX; x += stepX) {
    tiles.push({ x, y: start.y });
  }
  for (let y = start.y + stepY; y !== end.y + stepY; y += stepY) {
    tiles.push({ x: end.x, y });
  }

  return tiles;
}

function organicTunnelTiles(points: Vec2[]): Vec2[] {
  const tiles: Vec2[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const segment = lineTiles(points[index], points[index + 1]);
    for (const tile of segment) {
      tiles.push(tile);
      if ((tile.x * 7 + tile.y * 13) % 9 === 0) {
        tiles.push({ x: tile.x + 1, y: tile.y });
      }
      if ((tile.x * 11 + tile.y * 5) % 13 === 0) {
        tiles.push({ x: tile.x - 1, y: tile.y });
      }
    }
  }
  return uniqueTiles(tiles);
}

function uniqueTiles(tiles: Vec2[]): Vec2[] {
  const seen = new Set<string>();
  const result: Vec2[] = [];
  for (const tile of tiles) {
    const key = `${tile.x}:${tile.y}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(tile);
  }
  return result;
}

function createQueenRoom(): UndergroundRoom {
  const bounds = roomBounds(CONFIG.queenPos, CONFIG.startingQueenRoomWidth, CONFIG.startingQueenRoomHeight);
  return {
    id: "room-queen",
    type: "queen",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    capacity: 24,
    used: 1
  };
}

function createStorageRoom(): UndergroundRoom {
  const bounds = roomBounds(CONFIG.storagePos, CONFIG.plannedStorageRoomWidth, CONFIG.plannedStorageRoomHeight);
  return {
    id: "room-storage",
    type: "storage",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    capacity: CONFIG.plannedStorageCapacity,
    used: 0
  };
}

function createNurseryRoom(): UndergroundRoom {
  const bounds = roomBounds(CONFIG.nurseryPos, CONFIG.plannedNurseryRoomWidth, CONFIG.plannedNurseryRoomHeight);
  return {
    id: "room-nursery",
    type: "nursery",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    capacity: CONFIG.plannedNurseryCapacity,
    used: 0
  };
}

function createDiggableLayer(): Pick<Underground, "grid" | "rooms" | "digTasks" | "dirtMound"> {
  const grid = makeSoilGrid(CONFIG.undergroundWidth, CONFIG.undergroundHeight);
  const queenRoom = createQueenRoom();
  const storageRoom = createStorageRoom();

  const startingTunnel = organicTunnelTiles([
    CONFIG.undergroundEntrance,
    { x: CONFIG.undergroundEntrance.x - 1, y: 16 },
    { x: CONFIG.undergroundJunction.x + 2, y: CONFIG.undergroundJunction.y },
    { x: 38, y: 45 },
    CONFIG.queenPos
  ]);
  for (const tile of startingTunnel) {
    setTile(grid, tile.x, tile.y, "tunnel");
  }
  for (const tile of organicTunnelTiles([{ x: 38, y: 45 }, CONFIG.storagePos])) {
    setTile(grid, tile.x, tile.y, "tunnel");
  }
  setTile(grid, Math.round(CONFIG.undergroundEntrance.x), Math.round(CONFIG.undergroundEntrance.y), "entrance");
  carveRoom(grid, queenRoom);
  carveRoom(grid, storageRoom);

  return {
    grid,
    rooms: [queenRoom, storageRoom],
    digTasks: [],
    dirtMound: 0
  };
}

function storageRoomBounds(): { x: number; y: number; width: number; height: number } {
  return roomBounds(CONFIG.storagePos, CONFIG.plannedStorageRoomWidth, CONFIG.plannedStorageRoomHeight);
}

function storageTargetTiles(): Vec2[] {
  const room = storageRoomBounds();
  const tunnelEnd = { x: room.x - 2, y: Math.round(CONFIG.storagePos.y) };
  return uniqueTiles([
    ...organicTunnelTiles([
      { x: 38, y: 45 },
      { x: 40, y: 48 },
      tunnelEnd
    ]),
    ...ovalTiles(room.x, room.y, room.width, room.height)
  ]);
}

function isStorageRoomDug(underground: Underground): boolean {
  return underground.rooms.some((room) => room.type === "storage");
}

function hasStorageTask(underground: Underground): boolean {
  return underground.digTasks.some((task) => task.roomType === "storage" && task.status !== "done");
}

function hasRoomTask(underground: Underground, roomType: DigTask["roomType"]): boolean {
  return underground.digTasks.some((task) => task.roomType === roomType && task.status !== "done");
}

function makeStorageDigTask(underground: Underground): DigTask {
  const targets = storageTargetTiles().filter((tile) => inBounds(underground.grid, tile.x, tile.y));
  return {
    id: `dig-storage-${underground.digTasks.length + 1}`,
    type: "digRoom",
    roomType: "storage",
    targetTiles: targets,
    completedTiles: targets.filter((tile) => underground.grid[tile.y]?.[tile.x]?.type !== "soil").length,
    status: "planned"
  };
}

function nurseryTargetTiles(): Vec2[] {
  const room = createNurseryRoom();
  return uniqueTiles([
    ...organicTunnelTiles([
      CONFIG.storagePos,
      { x: 48, y: 49 },
      { x: 53, y: 51 },
      CONFIG.nurseryPos
    ]),
    ...ovalTiles(room.x, room.y, room.width, room.height)
  ]);
}

function makeNurseryDigTask(underground: Underground): DigTask {
  const targets = nurseryTargetTiles().filter((tile) => inBounds(underground.grid, tile.x, tile.y));
  return {
    id: `dig-nursery-${underground.digTasks.length + 1}`,
    type: "digRoom",
    roomType: "nursery",
    targetTiles: targets,
    completedTiles: targets.filter((tile) => underground.grid[tile.y]?.[tile.x]?.type !== "soil").length,
    status: "planned"
  };
}

function completeStorageRoom(underground: Underground): void {
  if (isStorageRoomDug(underground)) {
    return;
  }

  const bounds = storageRoomBounds();
  const room: UndergroundRoom = {
    id: "room-storage",
    type: "storage",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    capacity: CONFIG.plannedStorageCapacity,
    used: Math.floor(underground.foodStorage)
  };
  underground.rooms.push(room);
}

function completeNurseryRoom(underground: Underground): void {
  if (underground.rooms.some((room) => room.type === "nursery")) {
    return;
  }

  underground.rooms.push(createNurseryRoom());
}

function isStorageUsable(underground: Underground): boolean {
  const center = tilePos(CONFIG.storagePos);
  return isDugTile(underground, center.x, center.y);
}

function tileTypeForTask(task: DigTask, tile: Vec2): UndergroundTileType {
  if (task.type === "digTunnel") {
    return "tunnel";
  }

  if (task.roomType === "storage") {
    const room = storageRoomBounds();
    const insideRoom =
      tile.x >= room.x &&
      tile.x < room.x + room.width &&
      tile.y >= room.y &&
      tile.y < room.y + room.height;
    return insideRoom ? "chamber" : "tunnel";
  }

  if (task.roomType === "nursery") {
    const room = createNurseryRoom();
    const insideRoom =
      tile.x >= room.x &&
      tile.x < room.x + room.width &&
      tile.y >= room.y &&
      tile.y < room.y + room.height;
    return insideRoom ? "chamber" : "tunnel";
  }

  return task.type === "digRoom" || task.type === "expandRoom" ? "chamber" : "tunnel";
}

function roomIdForTask(task: DigTask): string | undefined {
  if (task.roomType === "storage") {
    return "room-storage";
  }
  if (task.roomType === "nursery") {
    return "room-nursery";
  }
  return undefined;
}

export function isDugTileType(type: UndergroundTileType | undefined): boolean {
  return type === "tunnel" || type === "chamber" || type === "entrance";
}

export function isDugTile(underground: Underground, x: number, y: number): boolean {
  return isDugTileType(underground.grid[y]?.[x]?.type);
}

export function tileCenter(tile: Vec2): Vec2 {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

export function nearestDugNeighbor(underground: Underground, tile: Vec2): Vec2 | null {
  const neighbors = [
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 }
  ];
  return neighbors.find((neighbor) => isDugTile(underground, neighbor.x, neighbor.y)) ?? null;
}

export function findDigTarget(underground: Underground, reserved: Set<string>): { task: DigTask; tile: Vec2; standPos: Vec2 } | null {
  refreshDigTasks(underground);
  for (const task of underground.digTasks) {
    if (task.status === "done") {
      continue;
    }
    task.status = "active";
    for (const tile of task.targetTiles) {
      const key = `${tile.x}:${tile.y}`;
      if (reserved.has(key) || underground.grid[tile.y]?.[tile.x]?.type !== "soil") {
        continue;
      }
      const neighbor = nearestDugNeighbor(underground, tile);
      if (neighbor) {
        return { task, tile, standPos: tileCenter(neighbor) };
      }
    }
  }
  return null;
}

export function completeDigTile(underground: Underground, taskId: string | undefined, tile: Vec2): boolean {
  const task = underground.digTasks.find((item) => item.id === taskId);
  const current = underground.grid[tile.y]?.[tile.x];
  if (!task || !current || current.type !== "soil" || !nearestDugNeighbor(underground, tile)) {
    return false;
  }

  setTile(underground.grid, tile.x, tile.y, tileTypeForTask(task, tile), roomIdForTask(task));
  refreshDigTasks(underground);
  return true;
}

export function ensureDiggableUnderground(underground: Underground): Underground {
  const layer = createDiggableLayer();
  return {
    ...underground,
    grid: underground.grid ?? layer.grid,
    rooms: underground.rooms ?? layer.rooms,
    digTasks: underground.digTasks ?? layer.digTasks,
    dirtMound: underground.dirtMound ?? layer.dirtMound
  };
}

export function refreshDigTasks(underground: Underground): void {
  if (!isStorageRoomDug(underground) && !hasStorageTask(underground)) {
    underground.digTasks.push(makeStorageDigTask(underground));
  }

  for (const task of underground.digTasks) {
    task.completedTiles = task.targetTiles.filter((tile) => underground.grid[tile.y]?.[tile.x]?.type !== "soil").length;
    if (task.roomType === "storage" && isStorageUsable(underground)) {
      task.status = "done";
      completeStorageRoom(underground);
    } else if (task.roomType === "nursery" && isDugTile(underground, Math.round(CONFIG.nurseryPos.x), Math.round(CONFIG.nurseryPos.y))) {
      task.status = "done";
      completeNurseryRoom(underground);
    } else if (task.completedTiles >= task.targetTiles.length) {
      task.status = "done";
      if (task.roomType === "storage") {
        completeStorageRoom(underground);
      }
      if (task.roomType === "nursery") {
        completeNurseryRoom(underground);
      }
    } else if (task.status === "done") {
      task.status = "active";
    }
  }
}

export function planNurseryIfNeeded(underground: Underground): void {
  if (underground.rooms.some((room) => room.type === "nursery") || hasRoomTask(underground, "nursery")) {
    return;
  }

  underground.digTasks.push(makeNurseryDigTask(underground));
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
    ...createDiggableLayer(),
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
