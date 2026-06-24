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

export const spriteMaps = {
  ant: [
    "...1......",
    "..121.....",
    ".11122....",
    "1111222...",
    ".11122....",
    "..121.....",
    "...1......",
    ".1....1..."
  ],
  antCarry: [
    "...1..3...",
    "..12133...",
    ".111223...",
    "1111222...",
    ".11122....",
    "..121.....",
    "...1......",
    ".1....1..."
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
  antCarry: {
    "1": darkAnt,
    "2": midAnt,
    "3": foodYellow
  },
  queen: {
    "1": 0x26130f,
    "2": 0x5a2b22
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

export function getAntTexture(carrying: boolean): Texture {
  return carrying
    ? makeTexture("antCarry", [...spriteMaps.antCarry], spritePalettes.antCarry)
    : makeTexture("ant", [...spriteMaps.ant], spritePalettes.ant);
}

export function getQueenTexture(): Texture {
  return makeTexture("queen", [...spriteMaps.queen], spritePalettes.queen);
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
