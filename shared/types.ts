export type Layer = "surface" | "underground";
export type DetailLevel = "full" | "aggregate";
export type NetworkViewMode = "surface" | "underground";

export const CURRENT_SNAPSHOT_VERSION = 1;
export const CURRENT_PROTOCOL_VERSION = 1;

export type Vec2 = {
  x: number;
  y: number;
};

export type AntState =
  | "idle"
  | "toEntrance"
  | "search"
  | "carry"
  | "return"
  | "deposit"
  | "carryBrood"
  | "feed"
  | "dig"
  | "carryDirt"
  | "fight"
  | "dead";

export type UndergroundTileType = "soil" | "tunnel" | "chamber" | "entrance";

export type UndergroundTile = {
  type: UndergroundTileType;
  roomId?: string;
  digProgress?: number;
};

export type UndergroundRoomType = "queen" | "storage" | "egg" | "nursery" | "barracks" | "waiting";

export type UndergroundRoom = {
  id: string;
  type: UndergroundRoomType;
  x: number;
  y: number;
  width: number;
  height: number;
  capacity: number;
  used: number;
};

export type DigTaskType = "digTunnel" | "digRoom" | "expandRoom";

export type DigTask = {
  id: string;
  type: DigTaskType;
  roomType?: UndergroundRoomType;
  roomId?: string;
  roomPlan?: { x: number; y: number; width: number; height: number };
  targetTiles: Vec2[];
  completedTiles: number;
  status: "planned" | "active" | "done";
};

export type Brood = {
  id: string;
  stage: "egg" | "larva";
  location: "queen" | "egg" | "nursery";
  pos: Vec2;
  carriedBy?: string;
  progress: number;
  isPrincess: boolean;
};

export type Debris = {
  id: string;
  type: "pebble" | "leaf";
  pos: Vec2;
};

export type Ant = {
  id: string;
  colonyId: string;
  role: "worker";
  strength: number;
  job?: "forage" | "nurse" | "dig" | "carryDirt" | "idle";
  forageRole?: "scout" | "forager";
  preferredTask?: "dig";
  layer: Layer;
  state: AntState;
  pos: Vec2;
  energy: number;
  carrying: number;
  heading: Vec2;
  broodId?: string;
  carryingDirt?: boolean;
  dirtLoad?: number;
  digTaskId?: string;
  digTarget?: Vec2;
  digStandPos?: Vec2;
  digProgress?: number;
  carryingDebris?: "pebble" | "leaf" | null;
  foundFoodSourceId?: string;
  scoutTrail?: Vec2[];
  foundFoodTrail?: Vec2[];
  knownActiveFoodTargetId?: string;
  surfaceExitCooldown?: number;
  undergroundExitCooldown?: number;
};

export type Queen = {
  pos: Vec2;
  alive: boolean;
  layCooldown: number;
  starve: number;
  stress: number;
  hp: number;
  age: number;
};

export type Princess = {
  id: string;
  pos: Vec2;
};

export type Underground = {
  width: number;
  height: number;
  gridVersion: number;
  roomsVersion: number;
  digTasksVersion: number;
  grid: UndergroundTile[][];
  rooms: UndergroundRoom[];
  digTasks: DigTask[];
  dirtMound: number;
  queen: Queen;
  brood: Brood[];
  carrion: FoodSource[];
  foodStorage: number;
  entrance: Vec2;
  junction: Vec2;
  queenChamber: Vec2;
  nursery: Vec2;
  storage: Vec2;
  barracksA: Vec2;
  barracksB: Vec2;
  princesses: Princess[];
  ants: string[];
};

export type Colony = {
  id: string;
  foundedTick: number;
  knownFood: { id: string; pos: Vec2; lastSeenTick: number; trail?: Vec2[] }[];
  activeFoodTargetId?: string;
  food: number;
  population: {
    workers: number;
    scouts: number;
    nurses: number;
    eggs: number;
    larvae: number;
  };
  queenAlive: boolean;
  queenStress: number;
  queenAge: number;
  princesses: number;
  nestCapacity: number;
  detailLevel: DetailLevel;
  generation: number;
  generationsRun: number;
  bestFitness: number;
  spiderGeneration: number;
  spiderGenerationsRun: number;
};

export type FoodSource = {
  id: string;
  pos: Vec2;
  amount: number;
  kind?: "food" | "carrion" | "antCorpse" | "spiderCarcass";
  createdAt?: number;
};

export type Enemy = {
  id: string;
  type: "spider";
  pos: Vec2;
  hp: number;
  maxHp: number;
  hunger: number;
  lair: Vec2;
  carrying: number;
  hoard: number;
  sprintLeft: number;
  tiredLeft: number;
};

export type Surface = {
  width: number;
  height: number;
  entrance: Vec2;
  entrances: Vec2[];
  foodSources: FoodSource[];
  carrion: FoodSource[];
  debris: Debris[];
};

export type SparseGrid = {
  i: number[];
  v: number[];
};

export type PheromoneSnapshot = {
  width: number;
  height: number;
  food: any;
  home: any;
};

export type WorldSnapshot = {
  snapshotVersion: number;
  protocolVersion: number;
  tick: number;
  surface: Surface;
  underground: Underground;
  colony: Colony;
  colonies: Array<{
    id: string;
    color: "dark" | "red";
    underground: Underground;
    colony: Colony;
    ants: Ant[];
  }>;
  ants: Ant[];
  enemies: Enemy[];
  pheromones: PheromoneSnapshot;
};

export type DurableWorldSnapshot = WorldSnapshot;
export type NetworkViewState = {
  mode: NetworkViewMode;
  undergroundColonyIndex: number;
};

export type NetworkWorldSnapshot = WorldSnapshot & {
  networkView: NetworkViewState;
};
