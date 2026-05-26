#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");
const AdmZip = require("adm-zip");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(EXT_ROOT, "dist");
const CRX_PATH = path.join(DIST_DIR, "temu-monitor.crx");
const UPDATE_XML_PATH = path.join(DIST_DIR, "update.xml");
const MANIFEST_PATH = path.join(EXT_ROOT, "manifest.json");
const EXPECTED_EXTENSION_ID = "ejheeafceahglndenffjkcmojpiomcpg";
const DEFAULT_PRIVATE_KEY_PATH = "C:\\Users\\Administrator\\.temu-ext-key\\temu-monitor-private.pem";
const UPDATE_CODEBASE = "https://erp.temu.chat/ext/temu-monitor.crx";

function fail(message) {
  console.error(`[pack-crx] ERROR: ${message}`);
  process.exit(1);
}

function encodeVarint(value) {
  let n = BigInt(value);
  const bytes = [];

  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }

  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function encodeLengthDelimited(fieldNumber, bytes) {
  const tag = BigInt(fieldNumber) * 8n + 2n;
  return Buffer.concat([encodeVarint(tag), encodeVarint(bytes.length), bytes]);
}

function encodeSignedData(crxId) {
  return encodeLengthDelimited(1, crxId);
}

function encodeAsymmetricKeyProof(publicKey, signature) {
  return Buffer.concat([
    encodeLengthDelimited(1, publicKey),
    encodeLengthDelimited(2, signature),
  ]);
}

function extensionIdFromCrxId(crxId) {
  const alphabet = "abcdefghijklmnop";
  let id = "";

  for (const byte of crxId) {
    id += alphabet[byte >> 4];
    id += alphabet[byte & 0x0f];
  }

  return id;
}

function toZipPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isExcludedRuntimeFile(relativePath) {
  const zipPath = toZipPath(relativePath);
  const segments = zipPath.split("/");
  const filename = segments[segments.length - 1];

  if (zipPath === "web/manifest.json" || zipPath === "web/rules.json") {
    return true;
  }

  if (segments.some((segment) => ["scripts", "dist", "node_modules", ".git"].includes(segment))) {
    return true;
  }

  return (
    /\.md$/i.test(filename) ||
    /\.(pem|key|p12|pfx|crt|cert)$/i.test(filename) ||
    /(?:private|secret)/i.test(filename)
  );
}

function addFileToZip(zip, relativePath) {
  if (isExcludedRuntimeFile(relativePath)) {
    return;
  }

  const absolutePath = path.join(EXT_ROOT, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    fail(`runtime file missing: ${relativePath}`);
  }

  zip.addFile(toZipPath(relativePath), fs.readFileSync(absolutePath));
}

function addDirectoryToZip(zip, relativeDir) {
  const absoluteDir = path.join(EXT_ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
    fail(`runtime directory missing: ${relativeDir}`);
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);

    if (isExcludedRuntimeFile(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      addDirectoryToZip(zip, relativePath);
    } else if (entry.isFile()) {
      addFileToZip(zip, relativePath);
    }
  }
}

function buildZipBytes() {
  const zip = new AdmZip();

  addFileToZip(zip, "manifest.json");
  addFileToZip(zip, "rules.json");
  addDirectoryToZip(zip, "web");

  return zip.toBuffer();
}

function buildCrxBytes(zipBytes, publicKey, privateKey) {
  const crxId = crypto.createHash("sha256").update(publicKey).digest().subarray(0, 16);
  const signedHeaderData = encodeSignedData(crxId);
  const signedHeaderLength = Buffer.alloc(4);
  signedHeaderLength.writeUInt32LE(signedHeaderData.length, 0);

  const payloadToSign = Buffer.concat([
    Buffer.from("CRX3 SignedData", "ascii"),
    Buffer.from([0]),
    signedHeaderLength,
    signedHeaderData,
    zipBytes,
  ]);
  const signature = crypto.sign("RSA-SHA256", payloadToSign, {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });
  const proof = encodeAsymmetricKeyProof(publicKey, signature);
  const header = Buffer.concat([
    encodeLengthDelimited(2, proof),
    encodeLengthDelimited(10000, signedHeaderData),
  ]);

  if (header.length > 0xffffffff) {
    fail("crx3 header is too large");
  }

  const version = Buffer.alloc(4);
  version.writeUInt32LE(3, 0);

  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(header.length, 0);

  return {
    crxBytes: Buffer.concat([
      Buffer.from("Cr24", "ascii"),
      version,
      headerLength,
      header,
      zipBytes,
    ]),
    extensionId: extensionIdFromCrxId(crxId),
  };
}

function makeUpdateXml(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${EXPECTED_EXTENSION_ID}">
    <updatecheck codebase="${UPDATE_CODEBASE}" version="${version}" />
  </app>
</gupdate>
`;
}

function main() {
  const privateKeyPath = process.env.TEMU_EXT_PRIVATE_KEY || DEFAULT_PRIVATE_KEY_PATH;
  if (!fs.existsSync(privateKeyPath)) {
    fail(`private key not found: ${privateKeyPath}`);
  }

  try {
    childProcess.execFileSync("node", ["extension/scripts/build-bridge.cjs"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    childProcess.execFileSync("node", ["extension/scripts/build-web-root-compat.cjs"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  } catch (error) {
    fail(`extension build failed with exit code ${error.status ?? "unknown"}`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const version = manifest.version;
  if (!version) {
    fail("manifest.json missing version");
  }

  const privatePem = fs.readFileSync(privateKeyPath, "utf8");
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const manifestKey = Buffer.from(manifest.key || "", "base64");
  if (!manifestKey.equals(publicKey)) {
    fail("manifest.json key does not match private key public key");
  }

  const zipBytes = buildZipBytes();
  const { crxBytes, extensionId } = buildCrxBytes(zipBytes, publicKey, privateKey);
  if (extensionId !== EXPECTED_EXTENSION_ID) {
    fail(`calculated extension id ${extensionId} does not match ${EXPECTED_EXTENSION_ID}`);
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(CRX_PATH, crxBytes);
  fs.writeFileSync(UPDATE_XML_PATH, makeUpdateXml(version), "utf8");

  console.log(`[pack-crx] version: ${version}`);
  console.log(`[pack-crx] zip size: ${zipBytes.length} bytes`);
  console.log(`[pack-crx] crx size: ${crxBytes.length} bytes`);
  console.log(`[pack-crx] calculated id: ${extensionId}`);
  console.log(`[pack-crx] wrote: ${path.relative(REPO_ROOT, CRX_PATH)}`);
  console.log(`[pack-crx] wrote: ${path.relative(REPO_ROOT, UPDATE_XML_PATH)}`);
}

main();
