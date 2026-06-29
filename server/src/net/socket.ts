import { WebSocket, WebSocketServer } from "ws";
import type { NetworkViewState, NetworkWorldSnapshot } from "../../../shared/types";
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
    }
  | {
      type: "setView";
      mode: NetworkViewState["mode"];
      undergroundColonyIndex: number;
    };

export type SocketHub = {
  broadcast(snapshotForView: (view: NetworkViewState) => NetworkWorldSnapshot): void;
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

    if (command.type === "setView") {
      const mode = command.mode === "underground" ? "underground" : command.mode === "surface" ? "surface" : null;
      const undergroundColonyIndex = typeof command.undergroundColonyIndex === "number" && Number.isFinite(command.undergroundColonyIndex)
        ? Math.max(0, Math.min(1, Math.floor(command.undergroundColonyIndex)))
        : 0;
      if (!mode) {
        return null;
      }
      return {
        type: "setView",
        mode,
        undergroundColonyIndex
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
  getSnapshot: (view: NetworkViewState, includePheromones: boolean) => NetworkWorldSnapshot,
  onCommand: (command: ClientCommand) => void = () => {}
): SocketHub {
  const server = new WebSocketServer({ port });
  const clients = new Map<WebSocket, NetworkViewState>();

  server.on("connection", (socket) => {
    const initialView: NetworkViewState = { mode: "surface", undergroundColonyIndex: 0 };
    clients.set(socket, initialView);
    socket.send(JSON.stringify(getSnapshot(initialView, true)));

    socket.on("close", () => {
      clients.delete(socket);
    });

    socket.on("message", (data) => {
      const command = parseCommand(String(data));
      if (command) {
        if (command.type === "setView") {
          clients.set(socket, {
            mode: command.mode,
            undergroundColonyIndex: command.undergroundColonyIndex
          });
          socket.send(JSON.stringify(getSnapshot(clients.get(socket)!, false)));
          return;
        }
        onCommand(command);
      }
    });
  });

  console.log(`WebSocket server listening on ws://localhost:${port}`);

  return {
    broadcast(snapshotForView) {
      const messages = new Map<string, string>();
      for (const [client, view] of clients) {
        if (client.readyState === WebSocket.OPEN) {
          if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
            continue;
          }
          const key = `${view.mode}:${view.undergroundColonyIndex}`;
          let message = messages.get(key);
          if (!message) {
            message = JSON.stringify(snapshotForView(view));
            messages.set(key, message);
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
