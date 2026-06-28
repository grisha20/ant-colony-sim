import type { Vec2 } from "../../../shared/types";
import { CONFIG } from "../config";

export type UndergroundNode = "entrance" | "junction" | "queenChamber" | "nursery" | "storage" | "barracksA" | "barracksB";

export function nodePosition(node: UndergroundNode): Vec2 {
  switch (node) {
    case "entrance":
      return CONFIG.undergroundEntrance;
    case "junction":
      return CONFIG.undergroundJunction;
    case "queenChamber":
      return CONFIG.queenPos;
    case "nursery":
      return CONFIG.nurseryPos;
    case "storage":
      return CONFIG.storagePos;
    case "barracksA":
      return CONFIG.barracksAPos;
    case "barracksB":
      return CONFIG.barracksBPos;
  }
}

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function isWithinNodeRadius(a: Vec2, b: Vec2): boolean {
  return distanceSq(a, b) <= CONFIG.undergroundNodeRadius * CONFIG.undergroundNodeRadius;
}

function isOnSegment(pos: Vec2, a: Vec2, b: Vec2): boolean {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: pos.x - a.x, y: pos.y - a.y };
  const lengthSq = ab.x * ab.x + ab.y * ab.y;
  if (lengthSq <= 0.001) {
    return isWithinNodeRadius(pos, a);
  }

  const t = (ap.x * ab.x + ap.y * ab.y) / lengthSq;
  if (t < -0.03 || t > 1.03) {
    return false;
  }

  const projection = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return isWithinNodeRadius(pos, projection);
}

export function nextWaypoint(fromPos: Vec2, destinationNode: UndergroundNode): Vec2 {
  const destination = nodePosition(destinationNode);
  const junction = nodePosition("junction");

  if (isWithinNodeRadius(fromPos, destination) || destinationNode === "junction") {
    return destination;
  }

  if (destinationNode === "entrance") {
    return isOnSegment(fromPos, nodePosition("entrance"), junction) ? destination : junction;
  }

  return isOnSegment(fromPos, junction, destination) ? destination : junction;
}
