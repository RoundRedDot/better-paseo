/**
 * TEST ONLY: a loopback stand-in for a gateway's `/v1/responses`, and an in-process Paseo daemon
 * from a Paseo build (`BP_PASEO_SERVER_EXPORTS`) whose Keychain read is a fake. No real Keychain
 * item, gateway, model or credential is used.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const exportsPath = process.env.BP_PASEO_SERVER_EXPORTS ?? "";

export interface Recorded { path: string; authorization: string | undefined; body: unknown }
export interface Gateway { origin: string; requests: Recorded[]; answer: (request: Recorded) => { status?: number; body: unknown; delayMs?: number }; server: Server }

export async function startGateway(): Promise<Gateway> {
  const gateway = { requests: [] as Recorded[], answer: () => ({ body: {} }) } as unknown as Gateway;
  gateway.server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const recorded = { path: request.url ?? "", authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") };
      gateway.requests.push(recorded);
      const answer = gateway.answer(recorded);
      const send = () => {
        if (response.destroyed) return;
        response.writeHead(answer.status ?? 200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer.body));
      };
      if (answer.delayMs) setTimeout(send, answer.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  gateway.origin = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
  return gateway;
}

export function text(value: string) {
  return { status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: value }] }] };
}

export async function closeGateway(gateway: Gateway | undefined): Promise<void> {
  if (!gateway) return;
  gateway.server.closeAllConnections();
  await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export interface InProcessDaemon {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** A daemon in this process, from `home/config.json`, with the given fake Keychain read and extra clients. */
export async function startInProcessDaemon(home: string, options: {
  readSecret: (item: { service: string; account: string }) => Promise<string>;
  agentClients?: Record<string, unknown>;
}): Promise<InProcessDaemon> {
  const server = await import(pathToFileURL(exportsPath).href) as {
    loadConfig(home: string, options: { env: NodeJS.ProcessEnv }): Record<string, unknown>;
    createPaseoDaemon(config: unknown, logger: unknown, deps: unknown): Promise<InProcessDaemon>;
  };
  const pino = createRequire(exportsPath)("pino") as (options: { level: string }) => unknown;
  const staticDir = fs.mkdtempSync(path.join(home, "static-"));
  const config = { ...server.loadConfig(home, { env: {} }), staticDir, ...(options.agentClients ? { agentClients: options.agentClients } : {}) };
  const daemon = await server.createPaseoDaemon(config, pino({ level: "silent" }), {
    textGeneration: { platform: "darwin", readSecret: options.readSecret },
  });
  await daemon.start();
  return daemon;
}
