import type { Brood, DigTask, Underground, UndergroundRoom, UndergroundTile, UndergroundTileType, Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";

const MAX_STORAGE_ROOMS = 15;

let nextBroodId = 1;

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

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

export function bumpUndergroundGridVersion(underground: Underground): void {
  underground.gridVersion = (underground.gridVersion ?? 1) + 1;
}

function bumpUndergroundRoomsVersion(underground: Underground): void {
  underground.roomsVersion = (underground.roomsVersion ?? 1) + 1;
}

function bumpUndergroundDigTasksVersion(underground: Underground): void {
  underground.digTasksVersion = (underground.digTasksVersion ?? 1) + 1;
}

function setTaskStatus(underground: Underground, task: DigTask, status: DigTask["status"]): void {
  if (task.status !== status) {
    task.status = status;
    bumpUndergroundDigTasksVersion(underground);
  }
}

function setTaskCompletedTiles(underground: Underground, task: DigTask, completedTiles: number): void {
  if (task.completedTiles !== completedTiles) {
    task.completedTiles = completedTiles;
    bumpUndergroundDigTasksVersion(underground);
  }
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

function roomCenterFromBounds(bounds: { x: number; y: number; width: number; height: number }): Vec2 {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
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
  const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y), 1);

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    tiles.push({
      x: Math.round(start.x + (end.x - start.x) * t),
      y: Math.round(start.y + (end.y - start.y) * t)
    });
  }

  return uniqueTiles(tiles);
}

function edgeRoughness(x: number, y: number): number {
  return (x * 17 + y * 31) % 11;
}

function organicTunnelTiles(points: Vec2[], width: number = CONFIG.tunnelWidth): Vec2[] {
  const tiles: Vec2[] = [];
  const halfWidth = Math.floor(width / 2);
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = tilePos(points[index]);
    const to = tilePos(points[index + 1]);
    const segment = lineTiles(points[index], points[index + 1]);
    for (const tile of segment) {
      for (let oy = -halfWidth; oy <= halfWidth; oy += 1) {
        for (let ox = -halfWidth; ox <= halfWidth; ox += 1) {
          if (ox * ox + oy * oy <= halfWidth * halfWidth + 0.6) {
            tiles.push({ x: tile.x + ox, y: tile.y + oy });
          }
        }
      }

      if (edgeRoughness(tile.x, tile.y) > 8) {
        tiles.push({ x: tile.x + halfWidth + 1, y: tile.y });
      } else if (edgeRoughness(tile.x, tile.y) < 2) {
        tiles.push({ x: tile.x, y: tile.y - halfWidth - 1 });
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

function createRoomFromBounds(
  id: string,
  type: UndergroundRoom["type"],
  bounds: { x: number; y: number; width: number; height: number },
  capacity: number,
  used = 0
): UndergroundRoom {
  return {
    id,
    type,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    capacity,
    used
  };
}

function createQueenRoom(center: Vec2 = CONFIG.queenPos): UndergroundRoom {
  return createRoomFromBounds(
    "room-queen",
    "queen",
    roomBounds(center, CONFIG.startingQueenRoomWidth, CONFIG.startingQueenRoomHeight),
    24,
    1
  );
}

function createStorageRoom(center: Vec2 = CONFIG.storagePos): UndergroundRoom {
  return createRoomFromBounds(
    "room-storage",
    "storage",
    roomBounds(center, CONFIG.plannedStorageRoomWidth, CONFIG.plannedStorageRoomHeight),
    CONFIG.plannedStorageCapacity
  );
}

function createStorageRoomFromBounds(id: string, bounds: { x: number; y: number; width: number; height: number }): UndergroundRoom {
  return createRoomFromBounds(id, "storage", bounds, CONFIG.plannedStorageCapacity);
}

function createNurseryRoom(id: string, bounds: { x: number; y: number; width: number; height: number }): UndergroundRoom {
  return createRoomFromBounds(id, "nursery", bounds, CONFIG.plannedNurseryCapacity);
}

function createEggRoom(bounds = roomBounds(CONFIG.eggRoomPos, CONFIG.plannedEggRoomWidth, CONFIG.plannedEggRoomHeight)): UndergroundRoom {
  return createRoomFromBounds("room-egg", "egg", bounds, CONFIG.plannedEggRoomCapacity);
}

function createEggRoomFromBounds(id: string, bounds: { x: number; y: number; width: number; height: number }): UndergroundRoom {
  return createRoomFromBounds(id, "egg", bounds, CONFIG.plannedEggRoomCapacity);
}

function createWaitingRoomFromBounds(id: string, bounds: { x: number; y: number; width: number; height: number }): UndergroundRoom {
  return createRoomFromBounds(id, "waiting", bounds, CONFIG.plannedWaitingCapacity);
}

function seededNoise(seed: number, x: number, y: number): number {
  const value = Math.sin((x + seed * 17.17) * 12.9898 + (y - seed * 9.31) * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function colonySeed(colonyId = "colony-1"): number {
  return Array.from(colonyId).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function clampRoomCenter(center: Vec2, width: number, height: number): Vec2 {
  return {
    x: Math.max(width / 2 + 3, Math.min(CONFIG.undergroundWidth - width / 2 - 3, center.x)),
    y: Math.max(height / 2 + 4, Math.min(CONFIG.undergroundHeight - height / 2 - 3, center.y))
  };
}

function createNestLayout(colonyId = "colony-1"): {
  entrance: Vec2;
  junction: Vec2;
  queen: Vec2;
  storage: Vec2;
  nursery: Vec2;
  barracksA: Vec2;
  barracksB: Vec2;
} {
  const seed = colonySeed(colonyId);
  const side = seed % 2 === 0 ? 1 : -1;
  const entrance = {
    x: Math.round(CONFIG.undergroundEntrance.x + side * (4 + (seed % 5))),
    y: 0
  };
  const queen = clampRoomCenter(
    {
      x: entrance.x + side * (18 + (seed % 7)),
      y: 58 + (seed % 10)
    },
    CONFIG.startingQueenRoomWidth,
    CONFIG.startingQueenRoomHeight
  );
  const storage = clampRoomCenter(
    {
      x: queen.x - side * (10 + (seed % 4)),
      y: queen.y - 8 - (seed % 3)
    },
    CONFIG.plannedStorageRoomWidth,
    CONFIG.plannedStorageRoomHeight
  );
  const nursery = clampRoomCenter(
    {
      x: queen.x + side * 9,
      y: queen.y + 4
    },
    CONFIG.plannedNurseryRoomWidth,
    CONFIG.plannedNurseryRoomHeight
  );
  const junction = {
    x: Math.round((entrance.x + queen.x) / 2 + side * 2),
    y: Math.round((entrance.y + queen.y) / 2)
  };

  return {
    entrance,
    junction,
    queen,
    storage,
    nursery,
    barracksA: { x: storage.x, y: storage.y - 8 },
    barracksB: { x: queen.x - side * 14, y: queen.y + 9 }
  };
}

function createDiggableLayer(
  layout = createNestLayout()
): Pick<Underground, "grid" | "rooms" | "digTasks" | "dirtMound" | "gridVersion" | "roomsVersion" | "digTasksVersion"> {
  const grid = makeSoilGrid(CONFIG.undergroundWidth, CONFIG.undergroundHeight);
  const queenRoom = createQueenRoom(layout.queen);
  const storageRoom = createStorageRoom(layout.storage);

  const startingTunnel = organicTunnelTiles([
    layout.entrance,
    { x: layout.entrance.x + Math.sign(layout.queen.x - layout.entrance.x) * 2, y: 14 },
    layout.junction,
    { x: (layout.junction.x + layout.queen.x) / 2, y: layout.queen.y - 10 },
    layout.queen
  ]);
  for (const tile of startingTunnel) {
    setTile(grid, tile.x, tile.y, "tunnel");
  }
  for (const tile of organicTunnelTiles([layout.queen, { x: (layout.queen.x + layout.storage.x) / 2, y: layout.storage.y }, layout.storage], 2)) {
    setTile(grid, tile.x, tile.y, "tunnel");
  }
  setTile(grid, Math.round(layout.entrance.x), Math.round(layout.entrance.y), "entrance");
  carveRoom(grid, queenRoom);
  carveRoom(grid, storageRoom);

  return {
    grid,
    rooms: [queenRoom, storageRoom],
    digTasks: [],
    dirtMound: 0,
    gridVersion: 1,
    roomsVersion: 1,
    digTasksVersion: 1
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
      { x: 58, y: 56 },
      { x: 58, y: 61 },
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

function roomsOfType(underground: Underground, roomType: UndergroundRoom["type"]): UndergroundRoom[] {
  return underground.rooms.filter((room) => room.type === roomType);
}

function totalRoomCapacity(underground: Underground, roomType: UndergroundRoom["type"]): number {
  const rooms = roomsOfType(underground, roomType);
  if (roomType === "storage" && rooms.length >= MAX_STORAGE_ROOMS) {
    const perRoomCapacity = Math.max(CONFIG.plannedStorageCapacity, Math.ceil(underground.foodStorage / rooms.length));
    return perRoomCapacity * rooms.length;
  }
  return rooms.reduce((total, room) => total + room.capacity, 0);
}

function nextRoomId(underground: Underground, roomType: UndergroundRoom["type"]): string {
  const prefix = `room-${roomType}`;
  const existing = underground.rooms.filter((room) => room.id === prefix || room.id.startsWith(`${prefix}-`)).length;
  const planned = underground.digTasks.filter((task) => task.roomId === prefix || task.roomId?.startsWith(`${prefix}-`)).length;
  const index = existing + planned + 1;
  return index === 1 ? prefix : `${prefix}-${index}`;
}

function boundsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, padding = 2): boolean {
  return (
    a.x - padding < b.x + b.width &&
    a.x + a.width + padding > b.x &&
    a.y - padding < b.y + b.height &&
    a.y + a.height + padding > b.y
  );
}

function roomBoundsOf(room: UndergroundRoom): { x: number; y: number; width: number; height: number } {
  return { x: room.x, y: room.y, width: room.width, height: room.height };
}

function isRoomPlanClear(underground: Underground, bounds: { x: number; y: number; width: number; height: number }): boolean {
  if (
    bounds.x < 3 ||
    bounds.y < 4 ||
    bounds.x + bounds.width >= underground.width - 3 ||
    bounds.y + bounds.height >= underground.height - 3
  ) {
    return false;
  }

  return underground.rooms.every((room) => !boundsOverlap(bounds, roomBoundsOf(room), 4));
}

function nearestDugTileTo(underground: Underground, target: Vec2): Vec2 {
  let best = tilePos(underground.queenChamber);
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < underground.grid.length; y += 1) {
    for (let x = 0; x < underground.grid[y].length; x += 1) {
      if (!isDugTile(underground, x, y)) {
        continue;
      }
      const distSq = distanceSq({ x: x + 0.5, y: y + 0.5 }, target);
      if (distSq < bestDistance) {
        best = { x, y };
        bestDistance = distSq;
      }
    }
  }
  return best;
}

function chooseRoomPlan(
  underground: Underground,
  roomType: UndergroundRoom["type"],
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const queen = underground.queenChamber;
  const seed = Math.round(queen.x * 13 + queen.y * 7 + (roomType === "nursery" ? 101 : roomType === "waiting" ? 151 : 211));
  const candidates: Array<{ bounds: { x: number; y: number; width: number; height: number }; score: number }> = [];

  for (let radius = 9; radius <= 60; radius += 2) {
    for (let angleIndex = 0; angleIndex < 18; angleIndex += 1) {
      const angle = (Math.PI * 2 * angleIndex) / 18 + seededNoise(seed, radius, angleIndex) * 0.34;
      const center = clampRoomCenter(
        {
          x: queen.x + Math.cos(angle) * radius,
          y: queen.y + Math.sin(angle) * radius * 0.55
        },
        width,
        height
      );
      const bounds = roomBounds(center, width, height);
      if (!isRoomPlanClear(underground, bounds)) {
        continue;
      }
      const centerPoint = roomCenterFromBounds(bounds);
      const nearestDug = nearestDugTileTo(underground, centerPoint);
      const distToQueen = Math.hypot(centerPoint.x - queen.x, centerPoint.y - queen.y);
      const tunnelCost = Math.hypot(centerPoint.x - nearestDug.x, centerPoint.y - nearestDug.y);
      const targetY = roomType === "nursery" ? queen.y + 2 : roomType === "waiting" ? queen.y + 10 : queen.y - 7;
      const depthPenalty = Math.abs(centerPoint.y - targetY) * (roomType === "nursery" ? 0.9 : 0.6);
      const score = tunnelCost * 1.25 + Math.abs(distToQueen - 12) * 1.6 + depthPenalty + seededNoise(seed, bounds.x, bounds.y) * 3;
      candidates.push({ bounds, score });
    }
  }

  return (candidates.sort((a, b) => a.score - b.score)[0]?.bounds) ??
    roomBounds(clampRoomCenter({ x: queen.x + 10, y: queen.y + 3 }, width, height), width, height);
}

function tunnelToRoomTiles(underground: Underground, bounds: { x: number; y: number; width: number; height: number }): Vec2[] {
  const center = roomCenterFromBounds(bounds);
  const start = nearestDugTileTo(underground, center);
  const sideX = start.x < center.x ? bounds.x - 1 : bounds.x + bounds.width;
  const doorway = { x: sideX, y: Math.round(center.y) };
  const bend = {
    x: Math.round((start.x + doorway.x) / 2),
    y: Math.round((start.y + doorway.y) / 2 + (edgeRoughness(start.x, doorway.y) - 5) * 0.35)
  };
  return organicTunnelTiles([tileCenter(start), bend, doorway], 2);
}

function makeStorageDigTask(underground: Underground): DigTask {
  const targets = storageTargetTiles().filter((tile) => inBounds(underground.grid, tile.x, tile.y));
  return {
    id: `dig-storage-${underground.digTasks.length + 1}`,
    type: "digRoom",
    roomType: "storage",
    roomId: "room-storage",
    targetTiles: targets,
    completedTiles: targets.filter((tile) => underground.grid[tile.y]?.[tile.x]?.type !== "soil").length,
    status: "planned"
  };
}

function makeOverflowRoomDigTask(underground: Underground, roomType: "storage" | "nursery" | "egg" | "waiting"): DigTask {
  const roomId = nextRoomId(underground, roomType);
  const width =
    roomType === "storage"
      ? CONFIG.plannedStorageRoomWidth
      : roomType === "egg"
        ? CONFIG.plannedEggRoomWidth
        : roomType === "waiting"
          ? CONFIG.plannedWaitingRoomWidth
        : CONFIG.plannedNurseryRoomWidth;
  const height =
    roomType === "storage"
      ? CONFIG.plannedStorageRoomHeight
      : roomType === "egg"
        ? CONFIG.plannedEggRoomHeight
        : roomType === "waiting"
          ? CONFIG.plannedWaitingRoomHeight
        : CONFIG.plannedNurseryRoomHeight;
  const roomPlan = chooseRoomPlan(underground, roomType, width, height);
  const targets = uniqueTiles([
    ...tunnelToRoomTiles(underground, roomPlan),
    ...ovalTiles(roomPlan.x, roomPlan.y, roomPlan.width, roomPlan.height)
  ]).filter((tile) => inBounds(underground.grid, tile.x, tile.y));

  return {
    id: `dig-${roomType}-${underground.digTasks.length + 1}`,
    type: "digRoom",
    roomType,
    roomId,
    roomPlan,
    targetTiles: targets,
    completedTiles: targets.filter((tile) => underground.grid[tile.y]?.[tile.x]?.type !== "soil").length,
    status: "planned"
  };
}

function makeNurseryDigTask(underground: Underground): DigTask {
  return makeOverflowRoomDigTask(underground, "nursery");
}

function makeEggRoomDigTask(underground: Underground): DigTask {
  return makeOverflowRoomDigTask(underground, "egg");
}

function makeWaitingRoomDigTask(underground: Underground): DigTask {
  return makeOverflowRoomDigTask(underground, "waiting");
}

function completeStorageRoom(underground: Underground, bounds?: { x: number; y: number; width: number; height: number }, id = "room-storage"): void {
  if (underground.rooms.some((room) => room.id === id)) {
    return;
  }

  const storageRooms = roomsOfType(underground, "storage");
  if (storageRooms.length >= MAX_STORAGE_ROOMS) {
    syncStorageCapacity(underground);
    bumpUndergroundRoomsVersion(underground);
    return;
  }

  const room = createStorageRoomFromBounds(id, bounds ?? storageRoomBounds());
  underground.rooms.push(room);
  bumpUndergroundRoomsVersion(underground);
  if (id === "room-storage") {
    underground.storage = roomCenter(room);
  }
}

function completeNurseryRoom(underground: Underground, bounds?: { x: number; y: number; width: number; height: number }, id = "room-nursery"): void {
  if (underground.rooms.some((room) => room.id === id)) {
    return;
  }

  const room = createNurseryRoom(
    id,
    bounds ??
      chooseRoomPlan(
        underground,
        "nursery",
        CONFIG.plannedNurseryRoomWidth,
        CONFIG.plannedNurseryRoomHeight
      )
  );
  underground.rooms.push(room);
  bumpUndergroundRoomsVersion(underground);
  if (id === "room-nursery" || roomsOfType(underground, "nursery").length === 1) {
    underground.nursery = roomCenter(room);
  }
}

function chamberCapacityForRoom(underground: Underground, roomId: string): number {
  return underground.grid.reduce(
    (total, row) =>
      total +
      row.filter((tile) => tile.type === "chamber" && tile.roomId === roomId).length,
    0
  );
}

function syncNurseryCapacity(underground: Underground): void {
  for (const nursery of roomsOfType(underground, "nursery")) {
    const capacity = Math.min(CONFIG.plannedNurseryCapacity, chamberCapacityForRoom(underground, nursery.id));
    if (nursery.capacity !== capacity) {
      nursery.capacity = capacity;
      bumpUndergroundRoomsVersion(underground);
    }
  }
}

function syncEggRoomCapacity(underground: Underground): void {
  for (const room of roomsOfType(underground, "egg")) {
    const capacity = Math.min(CONFIG.plannedEggRoomCapacity, chamberCapacityForRoom(underground, room.id));
    if (room.capacity !== capacity) {
      room.capacity = capacity;
      bumpUndergroundRoomsVersion(underground);
    }
  }
}

function syncStorageCapacity(underground: Underground): void {
  const rooms = roomsOfType(underground, "storage");
  if (rooms.length === 0) {
    return;
  }

  const perRoomCapacity = rooms.length >= MAX_STORAGE_ROOMS
    ? Math.max(CONFIG.plannedStorageCapacity, Math.ceil(underground.foodStorage / rooms.length))
    : CONFIG.plannedStorageCapacity;
  let changed = false;
  for (const room of rooms) {
    if (room.capacity !== perRoomCapacity) {
      room.capacity = perRoomCapacity;
      changed = true;
    }
  }
  if (changed) {
    bumpUndergroundRoomsVersion(underground);
  }
}

function completeEggRoom(underground: Underground): void {
  completeEggRoomById(underground);
}

function completeEggRoomById(underground: Underground, bounds?: { x: number; y: number; width: number; height: number }, id = "room-egg"): void {
  if (underground.rooms.some((room) => room.id === id)) {
    return;
  }

  const room = createEggRoomFromBounds(
    id,
    bounds ??
      chooseRoomPlan(
        underground,
        "egg",
        CONFIG.plannedEggRoomWidth,
        CONFIG.plannedEggRoomHeight
      )
  );
  underground.rooms.push(room);
  bumpUndergroundRoomsVersion(underground);
}

function completeWaitingRoomById(underground: Underground, bounds?: { x: number; y: number; width: number; height: number }, id = "room-waiting"): void {
  if (underground.rooms.some((room) => room.id === id)) {
    return;
  }

  const room = createWaitingRoomFromBounds(
    id,
    bounds ??
      chooseRoomPlan(
        underground,
        "waiting",
        CONFIG.plannedWaitingRoomWidth,
        CONFIG.plannedWaitingRoomHeight
      )
  );
  underground.rooms.push(room);
  bumpUndergroundRoomsVersion(underground);
}

function isStorageUsable(underground: Underground): boolean {
  const center = tilePos(CONFIG.storagePos);
  return isDugTile(underground, center.x, center.y);
}

function tileTypeForTask(task: DigTask, tile: Vec2): UndergroundTileType {
  if (task.type === "digTunnel") {
    return "tunnel";
  }

  if (task.type === "expandRoom") {
    return "chamber";
  }

  if (task.roomType === "storage") {
    const room = task.roomPlan ?? storageRoomBounds();
    const insideRoom =
      tile.x >= room.x &&
      tile.x < room.x + room.width &&
      tile.y >= room.y &&
      tile.y < room.y + room.height;
    return insideRoom ? "chamber" : "tunnel";
  }

  if (task.roomType === "nursery") {
    const room = task.roomPlan;
    if (!room) {
      return "chamber";
    }
    const insideRoom =
      tile.x >= room.x &&
      tile.x < room.x + room.width &&
      tile.y >= room.y &&
      tile.y < room.y + room.height;
    return insideRoom ? "chamber" : "tunnel";
  }

  if (task.roomType === "egg") {
    const room = task.roomPlan ?? createEggRoom();
    const insideRoom =
      tile.x >= room.x &&
      tile.x < room.x + room.width &&
      tile.y >= room.y &&
      tile.y < room.y + room.height;
    return insideRoom ? "chamber" : "tunnel";
  }

  if (task.roomType === "waiting") {
    const room = task.roomPlan ?? roomBounds(CONFIG.barracksBPos, CONFIG.plannedWaitingRoomWidth, CONFIG.plannedWaitingRoomHeight);
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
  if (task.roomId) {
    return task.roomId;
  }
  if (task.roomType === "storage") {
    return "room-storage";
  }
  if (task.roomType === "nursery") {
    return "room-nursery";
  }
  if (task.roomType === "egg") {
    return "room-egg";
  }
  if (task.roomType === "waiting") {
    return "room-waiting";
  }
  return undefined;
}

function roomCenter(room: UndergroundRoom): Vec2 {
  return { x: room.x + room.width / 2, y: room.y + room.height / 2 };
}

function roomByType(underground: Underground, roomType: UndergroundRoom["type"]): UndergroundRoom | undefined {
  return underground.rooms.find((room) => room.type === roomType);
}

function expansionTargetTiles(underground: Underground, room: UndergroundRoom): Vec2[] {
  const tiles: Vec2[] = [];
  const minX = room.x - 1;
  const maxX = room.x + room.width;
  const minY = room.y - 1;
  const maxY = room.y + room.height;

  for (let x = minX; x <= maxX; x += 1) {
    tiles.push({ x, y: minY }, { x, y: maxY });
  }
  for (let y = room.y; y < room.y + room.height; y += 1) {
    tiles.push({ x: minX, y }, { x: maxX, y });
  }

  const center = roomCenter(room);
  return uniqueTiles(tiles)
    .filter((tile) => inBounds(underground.grid, tile.x, tile.y) && underground.grid[tile.y]?.[tile.x]?.type === "soil")
    .sort((a, b) => distanceSq(a, center) - distanceSq(b, center))
    .slice(0, CONFIG.roomExpandMaxTiles);
}

function makeExpandRoomTask(underground: Underground, room: UndergroundRoom): DigTask | null {
  const targets = expansionTargetTiles(underground, room);
  if (targets.length === 0) {
    return null;
  }

  return {
    id: `expand-${room.type}-${underground.digTasks.length + 1}`,
    type: "expandRoom",
    roomType: room.type,
    targetTiles: targets,
    completedTiles: 0,
    status: "planned"
  };
}

function hasUnfinishedBaseRoomTask(underground: Underground, roomType: UndergroundRoom["type"]): boolean {
  return underground.digTasks.some(
    (task) => task.type === "digRoom" && task.roomType === roomType && task.status !== "done"
  );
}

function tileInsidePlan(tile: Vec2, plan: { x: number; y: number; width: number; height: number }): boolean {
  return tile.x >= plan.x && tile.x < plan.x + plan.width && tile.y >= plan.y && tile.y < plan.y + plan.height;
}

function hasStartedRoomChamber(underground: Underground, task: DigTask): boolean {
  return !!task.roomPlan && task.targetTiles.some(
    (tile) => tileInsidePlan(tile, task.roomPlan as { x: number; y: number; width: number; height: number }) &&
      underground.grid[tile.y]?.[tile.x]?.type === "chamber"
  );
}

function digTaskStillNeeded(underground: Underground, task: DigTask): boolean {
  if (task.status === "done") {
    return false;
  }
  if (task.type === "expandRoom") {
    return true;
  }
  if (task.type === "digRoom" && hasStartedRoomChamber(underground, task)) {
    return true;
  }
  if (task.roomType === "storage") {
    if (!isStorageRoomDug(underground)) {
      return true;
    }
    return underground.foodStorage >= totalRoomCapacity(underground, "storage");
  }
  if (task.roomType === "nursery") {
    const nurseryCapacity = totalRoomCapacity(underground, "nursery");
    const nurseryUsed = underground.brood.filter((brood) => brood.location === "nursery").length;
    const eggsWaitingForNursery = underground.brood.some((brood) => brood.stage === "egg" && brood.location === "egg");
    return nurseryCapacity === 0 ? eggsWaitingForNursery : nurseryUsed >= nurseryCapacity;
  }
  if (task.roomType === "egg") {
    const eggCapacity = totalRoomCapacity(underground, "egg");
    const eggUsed = underground.brood.filter((brood) => brood.location === "egg").length;
    const queenEggs = underground.brood.some((brood) => brood.stage === "egg" && brood.location === "queen");
    return eggCapacity === 0 ? queenEggs : eggUsed >= eggCapacity;
  }
  if (task.roomType === "waiting") {
    return true;
  }
  return true;
}

function completeRoomExpansion(underground: Underground, task: DigTask): void {
  if (!task.roomType) {
    return;
  }

  const room = roomByType(underground, task.roomType);
  if (!room) {
    return;
  }

  const chamberTiles = task.targetTiles.filter((tile) => underground.grid[tile.y]?.[tile.x]?.type === "chamber");
  if (chamberTiles.length === 0) {
    return;
  }

  const minX = Math.min(room.x, ...chamberTiles.map((tile) => tile.x));
  const minY = Math.min(room.y, ...chamberTiles.map((tile) => tile.y));
  const maxX = Math.max(room.x + room.width - 1, ...chamberTiles.map((tile) => tile.x));
  const maxY = Math.max(room.y + room.height - 1, ...chamberTiles.map((tile) => tile.y));
  room.x = minX;
  room.y = minY;
  room.width = maxX - minX + 1;
  room.height = maxY - minY + 1;
  room.capacity += CONFIG.roomExpandCapacityStep;
  bumpUndergroundRoomsVersion(underground);
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
    if (task.status === "done" || !digTaskStillNeeded(underground, task)) {
      continue;
    }
    setTaskStatus(underground, task, "active");
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
  bumpUndergroundGridVersion(underground);
  underground.dirtMound += CONFIG.dirtPerDugTile;
  if (task.roomType === "nursery") {
    if (task.roomPlan && !underground.rooms.some((room) => room.id === (task.roomId ?? "room-nursery"))) {
      completeNurseryRoom(underground, task.roomPlan, task.roomId ?? "room-nursery");
    }
    syncNurseryCapacity(underground);
  }
  if (task.roomType === "egg" && task.roomPlan && !underground.rooms.some((room) => room.id === (task.roomId ?? "room-egg"))) {
    completeEggRoomById(underground, task.roomPlan, task.roomId ?? "room-egg");
  }
  if (task.roomType === "egg") {
    syncEggRoomCapacity(underground);
  }
  if (task.roomType === "waiting" && task.roomPlan && !underground.rooms.some((room) => room.id === (task.roomId ?? "room-waiting"))) {
    completeWaitingRoomById(underground, task.roomPlan, task.roomId ?? "room-waiting");
  }
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
    dirtMound: underground.dirtMound ?? layer.dirtMound,
    gridVersion: underground.gridVersion ?? layer.gridVersion,
    roomsVersion: underground.roomsVersion ?? layer.roomsVersion,
    digTasksVersion: underground.digTasksVersion ?? layer.digTasksVersion,
    carrion: underground.carrion ?? []
  };
}

export function refreshDigTasks(underground: Underground): void {
  syncStorageCapacity(underground);
  syncNurseryCapacity(underground);
  syncEggRoomCapacity(underground);
  updateRoomUsage(underground);

  if (!isStorageRoomDug(underground) && !hasStorageTask(underground)) {
    underground.digTasks.push(makeStorageDigTask(underground));
    bumpUndergroundDigTasksVersion(underground);
  }

  if (
    isStorageRoomDug(underground) &&
    roomsOfType(underground, "storage").length < MAX_STORAGE_ROOMS &&
    underground.foodStorage >= totalRoomCapacity(underground, "storage") &&
    !hasRoomTask(underground, "storage")
  ) {
    underground.digTasks.push(makeOverflowRoomDigTask(underground, "storage"));
    bumpUndergroundDigTasksVersion(underground);
  }

  for (const room of underground.rooms) {
    if (
      room.type === "queen" ||
      room.type === "storage" ||
      room.type === "nursery" ||
      room.type === "egg" ||
      room.type === "waiting" ||
      hasRoomTask(underground, room.type) ||
      hasUnfinishedBaseRoomTask(underground, room.type) ||
      room.used < room.capacity
    ) {
      continue;
    }

    const task = makeExpandRoomTask(underground, room);
    if (task) {
      underground.digTasks.push(task);
      bumpUndergroundDigTasksVersion(underground);
    }
  }

  for (const task of underground.digTasks) {
    setTaskCompletedTiles(
      underground,
      task,
      task.targetTiles.filter((tile) => underground.grid[tile.y]?.[tile.x]?.type !== "soil").length
    );
    if (task.status === "done") {
      continue;
    }

    if (
      task.type === "digRoom" &&
      task.roomType === "nursery" &&
      task.completedTiles >= 1 &&
      !underground.rooms.some((room) => room.id === (task.roomId ?? "room-nursery"))
    ) {
      completeNurseryRoom(underground, task.roomPlan, task.roomId ?? "room-nursery");
      syncNurseryCapacity(underground);
    }

    if (task.type !== "expandRoom" && task.roomType === "storage" && !task.roomPlan && isStorageUsable(underground)) {
      setTaskStatus(underground, task, "done");
      completeStorageRoom(underground, task.roomPlan, task.roomId ?? "room-storage");
    } else if (task.completedTiles >= task.targetTiles.length) {
      setTaskStatus(underground, task, "done");
      if (task.roomType === "storage") {
        completeStorageRoom(underground, task.roomPlan, task.roomId ?? "room-storage");
      }
      if (task.roomType === "nursery") {
        completeNurseryRoom(underground, task.roomPlan, task.roomId ?? "room-nursery");
      }
      if (task.roomType === "egg") {
        completeEggRoomById(underground, task.roomPlan, task.roomId ?? "room-egg");
      }
      if (task.roomType === "waiting") {
        completeWaitingRoomById(underground, task.roomPlan, task.roomId ?? "room-waiting");
      }
      if (task.type === "expandRoom") {
        completeRoomExpansion(underground, task);
      }
    }
  }

  syncStorageCapacity(underground);
  syncNurseryCapacity(underground);
  syncEggRoomCapacity(underground);
  updateRoomUsage(underground);
}

export function planNurseryIfNeeded(underground: Underground): void {
  updateRoomUsage(underground);
  const nurseryCapacity = totalRoomCapacity(underground, "nursery");
  const nurseryUsed = underground.brood.filter((brood) => brood.location === "nursery").length;
  if (hasRoomTask(underground, "nursery") || (nurseryCapacity > 0 && nurseryUsed < nurseryCapacity)) {
    return;
  }

  underground.digTasks.push(makeNurseryDigTask(underground));
  bumpUndergroundDigTasksVersion(underground);
}

export function planEggRoomIfNeeded(underground: Underground): void {
  updateRoomUsage(underground);
  const eggCapacity = totalRoomCapacity(underground, "egg");
  const eggUsed = underground.brood.filter((brood) => brood.location === "egg").length;
  if (hasRoomTask(underground, "egg") || (eggCapacity > 0 && eggUsed < eggCapacity)) {
    return;
  }

  underground.digTasks.push(makeEggRoomDigTask(underground));
  bumpUndergroundDigTasksVersion(underground);
}

export function planWaitingRoomIfNeeded(underground: Underground, reserveNeeded: boolean): void {
  if (!reserveNeeded || underground.rooms.some((room) => room.type === "waiting") || hasRoomTask(underground, "waiting")) {
    return;
  }

  underground.digTasks.push(makeWaitingRoomDigTask(underground));
  bumpUndergroundDigTasksVersion(underground);
}

export function updateRoomUsage(underground: Underground): void {
  let storageUsed = Math.floor(underground.foodStorage);
  let nurseryUsed = underground.brood.filter((brood) => brood.location === "nursery").length;
  let eggUsed = underground.brood.filter((brood) => brood.location === "egg").length;
  const storageRooms = underground.rooms.filter((room) => room.type === "storage");

  for (const room of underground.rooms) {
    if (room.type === "storage") {
      if (storageRooms.length >= MAX_STORAGE_ROOMS) {
        const roomIndex = storageRooms.findIndex((storage) => storage.id === room.id);
        const remainingRooms = storageRooms.length - roomIndex;
        room.used = Math.min(room.capacity, Math.max(0, Math.ceil(storageUsed / Math.max(1, remainingRooms))));
        storageUsed -= room.used;
      } else {
        room.used = Math.min(room.capacity, Math.max(0, storageUsed));
        storageUsed -= room.used;
      }
    } else if (room.type === "egg") {
      room.used = Math.min(room.capacity, Math.max(0, eggUsed));
      eggUsed -= room.used;
    } else if (room.type === "nursery") {
      room.used = Math.min(room.capacity, Math.max(0, nurseryUsed));
      nurseryUsed -= room.used;
    }
  }
}

export function createUnderground(colonyId = "colony-1"): Underground {
  const layout = createNestLayout(colonyId);
  const queenChamber = layout.queen;
  const junction = layout.junction;
  const nursery = layout.nursery;
  const storage = layout.storage;
  const barracksA = layout.barracksA;
  const barracksB = layout.barracksB;
  const brood = [
    ...Array.from({ length: CONFIG.startingEggs }, () => makeBrood("egg", "queen", queenChamber)),
    ...Array.from({ length: CONFIG.startingLarvae }, () => makeBrood("larva", "nursery", nursery))
  ];

  return {
    width: CONFIG.undergroundWidth,
    height: CONFIG.undergroundHeight,
    ...createDiggableLayer(layout),
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
    carrion: [],
    foodStorage: CONFIG.startingFoodStorage,
    entrance: layout.entrance,
    junction,
    queenChamber,
    nursery,
    storage,
    barracksA,
    barracksB,
    princesses: [{ id: `${colonyId}-starting-princess`, pos: { ...queenChamber } }],
    ants: []
  };
}
