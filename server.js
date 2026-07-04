import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createSign } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DEFAULT_SUPABASE_ADMIN_EMAIL = "vilarinhotechsolutionsvts@gmail.com";
const DEFAULT_SUPABASE_SYNC_TABLE = "cv_sync_snapshots";

let cachedSupabaseClient = null;
let cachedSupabaseError = null;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function loadEnvFile() {
  const envPath = path.join(rootDir, ".env");
  return readFile(envPath, "utf8")
    .then((text) => {
      text.split(/\r?\n/).forEach((line) => {
        if (!line || line.trim().startsWith("#") || !line.includes("=")) {
          return;
        }
        const idx = line.indexOf("=");
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) {
          process.env[key] = value;
        }
      });
    })
    .catch(() => undefined);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function parseEmailList(rawValue = "") {
  return String(rawValue || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseCsvList(rawValue = "") {
  return String(rawValue || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function sendPasswordResetCodeEmail(email, code) {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const secure = String(process.env.SMTP_SECURE || "false").trim() === "true";
  const from = String(process.env.SMTP_FROM || user || "").trim();

  if (!host || !port || !user || !pass || !from) {
    return {
      ok: false,
      message: "SMTP nao configurado no backend.",
    };
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    await transporter.sendMail({
      from,
      to: email,
      subject: "Codigo de redefinicao de senha - Casa Verde",
      text: `Seu codigo de redefinicao e: ${code}. Valido por 10 minutos.`,
      html: `<p>Seu codigo de redefinicao e: <strong>${code}</strong></p><p>Valido por 10 minutos.</p>`,
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Falha ao enviar e-mail: ${error.message}`
          : "Falha ao enviar e-mail.",
    };
  }
}

function getGoogleAllowedRedirectUris() {
  const fromUris = parseCsvList(process.env.GOOGLE_REDIRECT_URIS);
  const fromSingle = String(process.env.GOOGLE_REDIRECT_URI || "").trim();

  const all = [...fromUris, fromSingle].filter(Boolean);
  return [...new Set(all)];
}

function resolveGoogleRedirectUri(preferredRedirectUri) {
  const allowed = getGoogleAllowedRedirectUris();
  if (!allowed.length) {
    return "";
  }

  const preferred = String(preferredRedirectUri || "").trim();
  if (preferred && allowed.includes(preferred)) {
    return preferred;
  }

  return allowed[0];
}

function getSupabaseAllowedEmails() {
  const fromEnv = parseEmailList(process.env.SUPABASE_ALLOWED_EMAILS);
  if (fromEnv.length > 0) {
    return fromEnv;
  }

  return [DEFAULT_SUPABASE_ADMIN_EMAIL];
}

function isSupabaseAllowedEmail(email) {
  const safeEmail = String(email || "")
    .trim()
    .toLowerCase();

  if (!safeEmail) {
    return false;
  }

  return getSupabaseAllowedEmails().includes(safeEmail);
}

function getSupabaseSyncTable() {
  return String(process.env.SUPABASE_SYNC_TABLE || DEFAULT_SUPABASE_SYNC_TABLE)
    .trim()
    .toLowerCase();
}

async function getSupabaseClientState() {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  ).trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      configured: false,
      client: null,
      message:
        "Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas.",
    };
  }

  if (cachedSupabaseClient) {
    return { configured: true, client: cachedSupabaseClient, message: "OK" };
  }

  if (cachedSupabaseError) {
    return {
      configured: true,
      client: null,
      message: cachedSupabaseError,
    };
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    cachedSupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    return { configured: true, client: cachedSupabaseClient, message: "OK" };
  } catch (error) {
    cachedSupabaseError =
      error instanceof Error
        ? error.message
        : "Falha ao carregar cliente Supabase.";
    return {
      configured: true,
      client: null,
      message: cachedSupabaseError,
    };
  }
}

async function getSupabaseStatus() {
  const state = await getSupabaseClientState();
  const table = getSupabaseSyncTable();

  if (!state.configured) {
    return {
      ok: false,
      configured: false,
      connected: false,
      table,
      message: state.message,
    };
  }

  if (!state.client) {
    return {
      ok: false,
      configured: true,
      connected: false,
      table,
      message: state.message,
    };
  }

  const { error } = await state.client
    .from(table)
    .select("scope", { head: true, count: "exact" });

  if (error) {
    return {
      ok: false,
      configured: true,
      connected: false,
      table,
      message: error.message,
      code: error.code || null,
    };
  }

  return {
    ok: true,
    configured: true,
    connected: true,
    table,
    message: "Conectado ao Supabase.",
  };
}

async function syncSupabaseSnapshot({ scope, source, payload, requestedBy }) {
  const state = await getSupabaseClientState();
  const table = getSupabaseSyncTable();

  if (!state.configured) {
    return {
      ok: false,
      table,
      message: state.message,
    };
  }

  if (!state.client) {
    return {
      ok: false,
      table,
      message: state.message,
    };
  }

  const row = {
    scope,
    source,
    payload,
    updated_at: new Date().toISOString(),
    updated_by: requestedBy || null,
  };

  const { data, error } = await state.client
    .from(table)
    .upsert(row, { onConflict: "scope" })
    .select("scope,source,updated_at,updated_by")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      table,
      message: error.message,
      code: error.code || null,
    };
  }

  return {
    ok: true,
    table,
    snapshot: data,
    message: "Snapshot sincronizado no Supabase.",
  };
}

async function readSupabaseSnapshot(scope) {
  const state = await getSupabaseClientState();
  const table = getSupabaseSyncTable();

  if (!state.configured || !state.client) {
    return {
      ok: false,
      table,
      message: state.message,
      snapshot: null,
    };
  }

  const { data, error } = await state.client
    .from(table)
    .select("scope,source,payload,updated_at,updated_by")
    .eq("scope", scope)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      table,
      message: error.message,
      code: error.code || null,
      snapshot: null,
    };
  }

  return {
    ok: true,
    table,
    message: data ? "Snapshot encontrado." : "Snapshot não encontrado.",
    snapshot: data || null,
  };
}

function resolveOAuthAccess(email, context = "customer") {
  const safeContext = String(context || "customer").toLowerCase();
  if (safeContext !== "admin") {
    return {
      ok: true,
      context: safeContext,
      role: "customer",
      canAutoProvision: true,
    };
  }

  if (!isSupabaseAllowedEmail(email)) {
    return {
      ok: false,
      message: "E-mail sem permissão administrativa para OAuth.",
    };
  }

  return {
    ok: true,
    context: safeContext,
    role: "super_admin",
    canAutoProvision: true,
  };
}

function createAppleClientSecret() {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  const privateKeyBase64 = process.env.APPLE_PRIVATE_KEY_BASE64;

  if (!teamId || !keyId || !clientId || !privateKeyBase64) {
    return null;
  }

  const header = base64Url(
    JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" }),
  );
  const payload = base64Url(
    JSON.stringify({
      iss: teamId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      aud: "https://appleid.apple.com",
      sub: clientId,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const privateKey = Buffer.from(privateKeyBase64, "base64").toString("utf8");
  const signature = signer
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${payload}.${signature}`;
}

async function exchangeGoogleCode(
  code,
  context = "customer",
  redirectUriHint = "",
) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = resolveGoogleRedirectUri(redirectUriHint);

  if (!clientId || !clientSecret || !redirectUri) {
    return { ok: false, message: "Google OAuth não configurado no backend." };
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    return {
      ok: false,
      message:
        tokenData.error_description || "Falha na troca do código Google.",
    };
  }

  const userResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    },
  );
  const userData = await userResponse.json();

  if (!userResponse.ok || !userData.email) {
    return { ok: false, message: "Não foi possível obter perfil Google." };
  }

  const access = resolveOAuthAccess(userData.email, context);
  if (!access.ok) {
    return access;
  }

  return {
    ok: true,
    provider: "google",
    access,
    profile: {
      email: userData.email,
      name: userData.name || userData.given_name || "Conta Google",
    },
  };
}

async function exchangeAppleCode(code, context = "customer") {
  const clientId = process.env.APPLE_CLIENT_ID;
  const redirectUri = process.env.APPLE_REDIRECT_URI;
  const clientSecret = createAppleClientSecret();

  if (!clientId || !redirectUri || !clientSecret) {
    return { ok: false, message: "Apple OAuth não configurado no backend." };
  }

  const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.id_token) {
    return {
      ok: false,
      message: tokenData.error || "Falha na troca do código Apple.",
    };
  }

  const payload = decodeJwtPayload(tokenData.id_token);
  if (!payload?.email) {
    return { ok: false, message: "Não foi possível obter e-mail Apple." };
  }

  const access = resolveOAuthAccess(payload.email, context);
  if (!access.ok) {
    return access;
  }

  return {
    ok: true,
    provider: "apple",
    access,
    profile: {
      email: payload.email,
      name: payload.email,
    },
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/supabase/status") {
    const status = await getSupabaseStatus();
    return sendJson(res, status.ok ? 200 : 503, status);
  }

  if (req.method === "GET" && url.pathname === "/api/supabase/sync") {
    const scope = String(
      url.searchParams.get("scope") || "migration_snapshot",
    ).trim();
    const response = await readSupabaseSnapshot(scope);
    return sendJson(res, response.ok ? 200 : 503, response);
  }

  if (req.method === "POST" && url.pathname === "/api/supabase/sync") {
    const body = await readBody(req);
    const scope = String(body.scope || "migration_snapshot").trim();
    const source = String(body.source || "manual_import").trim();
    const payload = body.payload;
    const requestedBy = String(body.requestedBy || "")
      .trim()
      .toLowerCase();

    if (!scope || !payload || typeof payload !== "object") {
      return sendJson(res, 400, {
        ok: false,
        message: "scope e payload (objeto) são obrigatórios.",
      });
    }

    if (requestedBy && !isSupabaseAllowedEmail(requestedBy)) {
      return sendJson(res, 403, {
        ok: false,
        message: "Usuário sem permissão para sincronizar no Supabase.",
      });
    }

    const response = await syncSupabaseSnapshot({
      scope,
      source,
      payload,
      requestedBy,
    });

    return sendJson(res, response.ok ? 200 : 503, response);
  }

  if (req.method === "GET" && url.pathname === "/api/public-config") {
    return sendJson(res, 200, {
      oauth: {
        googleClientId:
          process.env.PUBLIC_GOOGLE_CLIENT_ID ||
          process.env.GOOGLE_CLIENT_ID ||
          "",
        appleClientId:
          process.env.PUBLIC_APPLE_CLIENT_ID ||
          process.env.APPLE_CLIENT_ID ||
          "",
      },
      reviews: {
        googleReviewUrl: process.env.PUBLIC_GOOGLE_REVIEW_URL || "",
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/google-reviews") {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const placeId = process.env.GOOGLE_PLACE_ID;

    if (!apiKey || !placeId) {
      return sendJson(res, 503, {
        ok: false,
        message: "Google Reviews API não configurada no backend.",
      });
    }

    const endpoint = new URL(
      "https://maps.googleapis.com/maps/api/place/details/json",
    );
    endpoint.searchParams.set("place_id", placeId);
    endpoint.searchParams.set(
      "fields",
      "name,rating,user_ratings_total,reviews",
    );
    endpoint.searchParams.set("reviews_sort", "newest");
    endpoint.searchParams.set("language", "pt-BR");
    endpoint.searchParams.set("key", apiKey);

    const response = await fetch(endpoint);
    const data = await response.json();

    if (!response.ok || data.status !== "OK") {
      return sendJson(res, 502, {
        ok: false,
        message:
          data.error_message || "Falha ao consultar avaliações do Google.",
      });
    }

    const result = data.result || {};
    const reviews = (result.reviews || []).map((item) => ({
      author: item.author_name,
      rating: item.rating,
      text: item.text,
      relativeTime: item.relative_time_description,
      profilePhoto: item.profile_photo_url,
    }));

    return sendJson(res, 200, {
      ok: true,
      placeName: result.name,
      rating: result.rating,
      userRatingsTotal: result.user_ratings_total,
      reviews,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/oauth/exchange") {
    const body = await readBody(req);
    const provider = String(body.provider || "").toLowerCase();
    const code = String(body.code || "").trim();
    const context = String(body.context || "customer").toLowerCase();
    const redirectUri = String(body.redirectUri || "").trim();

    if (!provider || !code) {
      return sendJson(res, 400, {
        ok: false,
        message: "Provider e code são obrigatórios.",
      });
    }

    const result =
      provider === "google"
        ? await exchangeGoogleCode(code, context, redirectUri)
        : provider === "apple"
          ? await exchangeAppleCode(code, context)
          : { ok: false, message: "Provider OAuth não suportado." };

    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/password-reset/send-code"
  ) {
    const body = await readBody(req);
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const code = String(body.code || "").trim();

    if (!email || !code) {
      return sendJson(res, 400, {
        ok: false,
        message: "email e code sao obrigatorios.",
      });
    }

    const result = await sendPasswordResetCodeEmail(email, code);
    return sendJson(res, result.ok ? 200 : 503, result);
  }

  return sendJson(res, 404, { ok: false, message: "Rota API não encontrada." });
}

async function handleStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.join(rootDir, pathname);

  if (!filePath.startsWith(rootDir)) {
    sendJson(res, 403, { ok: false, message: "Acesso negado." });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      const data = await readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { ok: false, message: "Arquivo não encontrado." });
  }
}

await loadEnvFile();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await handleStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message:
        error instanceof Error ? error.message : "Erro interno do servidor.",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Casa Verde server running at http://localhost:${PORT}`);
});
