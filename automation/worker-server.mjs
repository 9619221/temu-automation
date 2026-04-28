import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";

const DEFAULT_WORKER_PORT = 19280;
const DEFAULT_SERVER_TIMEOUT_MS = 86400000;
const DEFAULT_HEADERS_TIMEOUT_MS = 86410000;

export function createWorkerAuthToken(env = process.env) {
  return env.WORKER_AUTH_TOKEN || crypto.randomBytes(32).toString("hex");
}

export function createWorkerAuthenticator(authToken) {
  return function isAuthorizedWorkerRequest(req) {
    return req.headers.authorization === `Bearer ${authToken}`;
  };
}

export function resolveWorkerPort(env = process.env) {
  return parseInt(env.WORKER_PORT || String(DEFAULT_WORKER_PORT));
}

export function configureWorkerServer(server, options = {}) {
  server.timeout = options.timeoutMs ?? DEFAULT_SERVER_TIMEOUT_MS;
  server.keepAliveTimeout = options.keepAliveTimeoutMs ?? DEFAULT_SERVER_TIMEOUT_MS;
  server.headersTimeout = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS;
  return server;
}

export function createWorkerServer(requestHandler, options = {}) {
  return configureWorkerServer(http.createServer(requestHandler), options);
}

export function writeWorkerPortFile({ runtimeDataDir, port, authToken, fileSystem = fs, pathModule = path }) {
  const portFile = pathModule.join(runtimeDataDir, "worker-port");
  fileSystem.mkdirSync(pathModule.dirname(portFile), { recursive: true });
  fileSystem.writeFileSync(portFile, JSON.stringify({ port, token: authToken }));
  return portFile;
}

export function startWorkerServer(server, options) {
  const {
    port,
    authToken,
    runtimeDataDir,
    host = "127.0.0.1",
    logger = console,
  } = options;

  server.listen(port, host, () => {
    writeWorkerPortFile({ runtimeDataDir, port, authToken });
    logger.error(`WORKER_PORT=${port}`);
    logger.log(`Worker ready on port ${port}`);
  });

  return server;
}
