const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function toJson(value, fallback = null) {
  if (value === undefined) return fallback;
  return JSON.stringify(value);
}

function ensurePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

module.exports = {
  nowIso,
  createId,
  toJson,
  ensurePositiveInteger,
};
