const crypto = require("node:crypto");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

relaunchUnderElectronIfNeeded(__filename);

const { runMigrations } = require("../electron/db/migrate.cjs");
const { openErpDatabase } = require("../electron/db/connection.cjs");

const APP_KEY_ENV = "ERP_1688_APP_KEY";
const APP_SECRET_ENV = "ERP_1688_APP_SECRET";
const ACCESS_TOKEN_ENV = "ERP_1688_ACCESS_TOKEN";
const REDIRECT_URI_ENV = "ERP_1688_REDIRECT_URI";
const COMPANY_ID_ENV = "ERP_COMPANY_ID";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:19380/api/1688/oauth/callback";
const DEFAULT_COMPANY_ID = "company_default";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeRedirectUri(value) {
  const text = String(value || DEFAULT_REDIRECT_URI).trim();
  const parsed = new URL(text);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${REDIRECT_URI_ENV} must start with http:// or https://`);
  }
  return parsed.toString();
}

function upsert1688Config({ appKey, appSecret, redirectUri, accessToken, companyId }) {
  runMigrations({ backup: false });
  const db = openErpDatabase();
  try {
    const now = new Date().toISOString();
    const normalizedCompanyId = String(companyId || DEFAULT_COMPANY_ID).trim() || DEFAULT_COMPANY_ID;
    const settingId = normalizedCompanyId === DEFAULT_COMPANY_ID ? "default" : `company:${normalizedCompanyId}`;
    const existing = db.prepare("SELECT * FROM erp_1688_auth_settings WHERE company_id = ? ORDER BY id = 'default' DESC LIMIT 1").get(normalizedCompanyId);
    const credentialsChanged = !existing
      || existing.app_key !== appKey
      || existing.app_secret !== appSecret
      || existing.redirect_uri !== redirectUri;

    db.prepare(`
      INSERT INTO erp_1688_auth_settings (
        id, company_id, app_key, app_secret, redirect_uri, access_token, refresh_token,
        member_id, ali_id, resource_owner, token_payload_json,
        access_token_expires_at, refresh_token_expires_at, authorized_at,
        created_at, updated_at
      )
      VALUES (
        @id, @company_id, @app_key, @app_secret, @redirect_uri, @access_token, @refresh_token,
        @member_id, @ali_id, @resource_owner, @token_payload_json,
        @access_token_expires_at, @refresh_token_expires_at, @authorized_at,
        @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        company_id = excluded.company_id,
        app_key = excluded.app_key,
        app_secret = excluded.app_secret,
        redirect_uri = excluded.redirect_uri,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        member_id = excluded.member_id,
        ali_id = excluded.ali_id,
        resource_owner = excluded.resource_owner,
        token_payload_json = excluded.token_payload_json,
        access_token_expires_at = excluded.access_token_expires_at,
        refresh_token_expires_at = excluded.refresh_token_expires_at,
        authorized_at = excluded.authorized_at,
        updated_at = excluded.updated_at
    `).run({
      id: existing?.id || settingId,
      company_id: normalizedCompanyId,
      app_key: appKey,
      app_secret: appSecret,
      redirect_uri: redirectUri,
      access_token: accessToken || (credentialsChanged ? null : existing.access_token),
      refresh_token: credentialsChanged ? null : existing.refresh_token,
      member_id: credentialsChanged ? null : existing.member_id,
      ali_id: credentialsChanged ? null : existing.ali_id,
      resource_owner: credentialsChanged ? null : existing.resource_owner,
      token_payload_json: credentialsChanged ? "{}" : existing.token_payload_json,
      access_token_expires_at: credentialsChanged ? null : existing.access_token_expires_at,
      refresh_token_expires_at: credentialsChanged ? null : existing.refresh_token_expires_at,
      authorized_at: accessToken ? now : (credentialsChanged ? null : existing.authorized_at),
      created_at: existing?.created_at || now,
      updated_at: now,
    });

    db.prepare("DELETE FROM erp_1688_oauth_states WHERE expires_at <= ?").run(now);
    const state = crypto.randomBytes(18).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO erp_1688_oauth_states (state, company_id, created_by, redirect_after, expires_at, created_at)
      VALUES (@state, @company_id, @created_by, @redirect_after, @expires_at, @created_at)
    `).run({
      state,
      company_id: normalizedCompanyId,
      created_by: null,
      redirect_after: "/1688",
      expires_at: expiresAt,
      created_at: now,
    });

    const params = new URLSearchParams({
      client_id: appKey,
      site: "1688",
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    });
    return {
      configured: true,
      authorized: Boolean(accessToken || existing?.access_token),
      companyId: normalizedCompanyId,
      redirectUri,
      authUrl: `https://auth.1688.com/oauth/authorize?${params.toString()}`,
      expiresAt,
    };
  } finally {
    db.close();
  }
}

try {
  const result = upsert1688Config({
    appKey: requireEnv(APP_KEY_ENV),
    appSecret: requireEnv(APP_SECRET_ENV),
    accessToken: String(process.env[ACCESS_TOKEN_ENV] || "").trim() || null,
    redirectUri: normalizeRedirectUri(process.env[REDIRECT_URI_ENV]),
    companyId: String(process.env[COMPANY_ID_ENV] || DEFAULT_COMPANY_ID).trim() || DEFAULT_COMPANY_ID,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
