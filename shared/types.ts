export type Layer = "surface" | "underground";
export type DetailLevel = "full" | "aggregate";

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
  | "fight"
  | "dead";

export type Brood = {
  id: string;
  stage: "egg" | "larva";
  location: "queen" | "nursery";
  pos: Vec2;
  carriedBy?: string;
  progress: number;
};

export type Ant = {
  id: string;
  colonyId: string;
  role: "worker";
  layer: Layer;
  state: AntState;
  pos: Vec2;
  energy: number;
  carrying: number;
  heading: Vec2;
  broodId?: string;
};

export type Queen = {
  pos: Vec2;
  alive: boolean;
  layCooldown: number;
  starve: number;
};

export type Underground = {
  width: number;
  height: number;
  queen: Queen;
  brood: Brood[];
  foodStorage: number;
  entrance: Vec2;
  junction: Vec2;
  queenChamber: Vec2;
  nursery: Vec2;
  storage: Vec2;
  barracksA: Vec2;
  barracksB: Vec2;
  ants: string[];
};

export type Colony = {
  id: string;
  food: number;
  population: {
    workers: number;
    eggs: number;
    larvae: number;
  };
  queenAlive: boolean;
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
};

export type Surface = {
  width: number;
  height: number;
  entrance: Vec2;
  foodSources: FoodSource[];
  carrion: FoodSource[];
};

export type PheromoneSnapshot = {
  width: number;
  height: number;
  food: number[];
  home: number[];
};

export type WorldSnapshot = {
  tick: number;
  surface: Surface;
  underground: Underground;
  colony: Colony;
  ants: Ant[];
  enemies: Enemy[];
  pheromones: PheromoneSnapshot;
};
