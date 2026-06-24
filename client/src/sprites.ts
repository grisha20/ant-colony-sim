import { Sprite, Texture } from "pixi.js";

type Palette = Record<string, number>;

const transparent = ".";

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

const textureCache = new Map<string, Texture>();

function makeTexture(key: string, rows: string[], palette: Palette): Texture {
  const cached = textureCache.get(key);
  if (cached) {
    return cached;
  }

  const width = Math.max(...rows.map((row) => row.length));
  const height = rows.length;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create sprite canvas");
  }

  context.imageSmoothingEnabled = false;
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x += 1) {
      const key = row[x] ?? transparent;
      if (key === transparent) {
        continue;
      }

      const color = palette[key];
      if (color === undefined) {
        continue;
      }

      context.fillStyle = colorToCss(color);
      context.fillRect(x, y, 1, 1);
    }
  }

  const texture = Texture.from({ resource: canvas, scaleMode: "nearest" });
  texture.source.scaleMode = "nearest";
  textureCache.set(key, texture);
  return texture;
}

function makePixelSprite(texture: Texture, scale: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.scale.set(scale);
  return sprite;
}

const darkAnt = 0x1b1210;
const midAnt = 0x402019;
const antHighlight = 0x6a3a27;
const foodYellow = 0xe6c45a;

const redAntDark = 0x5a1210;
const redAntMid = 0xa62b1b;
const redAntHighlight = 0xd95d4e;

const redQueenDark = 0x55120d;
const redQueenMid = 0x9e3b2b;

export const spriteMaps = {
  ant: [
    "..1..1......",
    "...1..1.1.1.",
    ".1111.11.1..",
    "1111.2222...",
    "111112222...",
    "1111.2222...",
    ".1111.11.1..",
    "...1..1.1.1.",
    "..1..1......"
  ],
  antCarry: [
    "..1..1......",
    "...1..1.1.1.",
    ".1111.11.1..",
    "1111.222233.",
    "111112222333",
    "1111.222233.",
    ".1111.11.1..",
    "...1..1.1.1.",
    "..1..1......"
  ],
  queen: [
    "....1111.......",
    "..11222211.....",
    ".1222222221....",
    "122222222221...",
    ".1222222221.11.",
    "..11222211.1221",
    "....1111...111.",
    "..1......1....."
  ],
  egg: [
    "..11..",
    ".1221.",
    ".1221.",
    "..11.."
  ],
  larva: [
    ".111..",
    "12221.",
    ".12221",
    "..111."
  ],
  spider: [
    "1..1..1..1",
    ".1.1111.1.",
    "..122221..",
    "1112222111",
    "..122221..",
    ".1.1111.1.",
    "1..1..1..1"
  ],
  spiderLair: [
    "..1.1..",
    ".1...1.",
    "1.222.1",
    "..232..",
    "1.222.1",
    ".1...1.",
    "..1.1.."
  ],
  food: [
    ".12.",
    "1221",
    ".11."
  ],
  carrion: [
    "1.2..",
    ".223.",
    "12231",
    "..21."
  ],
  grain: [
    ".12.",
    "1221",
    ".11."
  ]
} as const;

export const spritePalettes = {
  ant: {
    "1": darkAnt,
    "2": midAnt,
    "3": antHighlight
  },
  antRed: {
    "1": redAntDark,
    "2": redAntMid,
    "3": redAntHighlight
  },
  antCarry: {
    "1": darkAnt,
    "2": midAnt,
    "3": foodYellow
  },
  antCarryRed: {
    "1": redAntDark,
    "2": redAntMid,
    "3": foodYellow
  },
  queen: {
    "1": 0x26130f,
    "2": 0x5a2b22
  },
  queenRed: {
    "1": redQueenDark,
    "2": redQueenMid
  },
  egg: {
    "1": 0xf4ead4,
    "2": 0xd9c89f
  },
  larva: {
    "1": 0xf4e7c8,
    "2": 0xcfae7a
  },
  spider: {
    "1": 0x16100f,
    "2": 0x3b2420
  },
  spiderLair: {
    "1": 0xd8d2c6,
    "2": 0x2b211e,
    "3": 0x6f2a24
  },
  food: {
    "1": 0x3d8b45,
    "2": 0x7abf5a
  },
  carrion: {
    "1": 0x2a1715,
    "2": 0x6f2a24,
    "3": 0xb57a55
  },
  grain: {
    "1": 0xb27a30,
    "2": 0xe0b458
  }
} as const;

export type AntColor = "dark" | "red";

export function getAntTexture(carrying: boolean, color: AntColor = "dark"): Texture {
  const key = carrying ? `antCarry_${color}` : `ant_${color}`;
  const palette = color === "red"
    ? (carrying ? spritePalettes.antCarryRed : spritePalettes.antRed)
    : (carrying ? spritePalettes.antCarry : spritePalettes.ant);

  return makeTexture(key, carrying ? [...spriteMaps.antCarry] : [...spriteMaps.ant], palette);
}

export function getQueenTexture(color: AntColor = "dark"): Texture {
  const key = `queen_${color}`;
  const palette = color === "red" ? spritePalettes.queenRed : spritePalettes.queen;
  return makeTexture(key, [...spriteMaps.queen], palette);
}

export function getEggTexture(): Texture {
  return makeTexture("egg", [...spriteMaps.egg], spritePalettes.egg);
}

export function getLarvaTexture(): Texture {
  return makeTexture("larva", [...spriteMaps.larva], spritePalettes.larva);
}

export function getSpiderTexture(): Texture {
  return makeTexture("spider", [...spriteMaps.spider], spritePalettes.spider);
}

export function getSpiderLairTexture(): Texture {
  return makeTexture("spiderLair", [...spriteMaps.spiderLair], spritePalettes.spiderLair);
}

export function getFoodTexture(): Texture {
  return makeTexture("food", [...spriteMaps.food], spritePalettes.food);
}

export function getCarrionTexture(): Texture {
  return makeTexture("carrion", [...spriteMaps.carrion], spritePalettes.carrion);
}

export function getGrainTexture(): Texture {
  return makeTexture("grain", [...spriteMaps.grain], spritePalettes.grain);
}

export function createAntSprite(carrying: boolean, scale = 2.5): Sprite {
  return makePixelSprite(getAntTexture(carrying), scale);
}

export function createQueenSprite(scale = 3.5): Sprite {
  return makePixelSprite(getQueenTexture(), scale);
}

export function createEggSprite(scale = 3): Sprite {
  return makePixelSprite(getEggTexture(), scale);
}

export function createLarvaSprite(scale = 3): Sprite {
  return makePixelSprite(getLarvaTexture(), scale);
}

export function createSpiderSprite(scale = 4): Sprite {
  return makePixelSprite(getSpiderTexture(), scale);
}

export function createSpiderLairSprite(scale = 4): Sprite {
  return makePixelSprite(getSpiderLairTexture(), scale);
}

export function createFoodSprite(scale = 3): Sprite {
  return makePixelSprite(getFoodTexture(), scale);
}

export function createCarrionSprite(scale = 3): Sprite {
  return makePixelSprite(getCarrionTexture(), scale);
}

export function createGrainSprite(scale = 3): Sprite {
  return makePixelSprite(getGrainTexture(), scale);
}
