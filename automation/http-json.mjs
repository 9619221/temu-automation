export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
};

export const CORS_JSON_HEADERS = {
  "Content-Type": "application/json",
  ...CORS_HEADERS,
};

export function parseLocalUrl(url) {
  try {
    return new URL(url, "http://127.0.0.1");
  } catch {
    return null;
  }
}

export function sendJson(res, payload, options = {}) {
  const {
    statusCode = 200,
    headers = {},
    cors = false,
  } = options;
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...(cors ? CORS_HEADERS : {}),
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

export function sendNoContent(res, options = {}) {
  const {
    statusCode = 204,
    headers = {},
    cors = false,
  } = options;
  res.writeHead(statusCode, {
    ...(cors ? CORS_HEADERS : {}),
    ...headers,
  });
  res.end();
}

export function readRequestText(req, options = {}) {
  const { onError = () => {} } = options;
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("error", (error) => {
      onError(error);
      reject(error);
    });
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

export async function readJsonBody(req, options = {}) {
  const { emptyFallback = "", onError } = options;
  const text = await readRequestText(req, { onError });
  return JSON.parse(text || emptyFallback);
}
