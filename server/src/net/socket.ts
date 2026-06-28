import { WebSocket, WebSocketServer } from "ws";
import type { WorldSnapshot } from "../../../shared/types";
import { CONFIG } from "../config";

export type ClientCommand =
  | {
      type: "dropFood";
      x: number;
      y: number;
    }
  | {
      type: "setSpeed";
      value: number;
    };

export type SocketHub = {
  broadcast(snapshot: WorldSnapshot): void;
  close(): void;
};

const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

function parseCommand(raw: string): ClientCommand | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") {
      return null;
    }

    const command = value as Record<string, unknown>;
    if (command.type === "setSpeed" && typeof command.value === "number" && Number.isFinite(command.value)) {
      return {
        type: "setSpeed",
        value: command.value
      };
    }

    if (command.type === "dropFood" && typeof command.x === "number" && typeof command.y === "number") {
      if (
        !Number.isFinite(command.x) ||
        !Number.isFinite(command.y) ||
        command.x < 0 ||
        command.y < 0 ||
        command.x >= CONFIG.mapWidth ||
        command.y >= CONFIG.mapHeight
      ) {
        return null;
      }

      return {
        type: "dropFood",
        x: command.x,
        y: command.y
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function createSocketHub(
  port: number,
  getInitialSnapshot: () => WorldSnapshot,
  onCommand: (command: ClientCommand) => void = () => {}
): SocketHub {
  const server = new WebSocketServer({ port });
  const clients = new Set<WebSocket>();

  server.on("connection", (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify(getInitialSnapshot()));

    socket.on("close", () => {
      clients.delete(socket);
    });

    socket.on("message", (data) => {
      const command = parseCommand(String(data));
      if (command) {
        onCommand(command);
      }
    });
  });

  console.log(`WebSocket server listening on ws://localhost:${port}`);

  return {
    broadcast(snapshot) {
      const message = JSON.stringify(snapshot);
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
            continue;
          }
          client.send(message);
        }
      }
    },
    close() {
      server.close();
    }
  };
}
