import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createSign } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const PORT = Number(process.env.PORT || 3000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
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
        if (key && !(key in process.env)) {
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

async function exchangeGoogleCode(code) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

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

  return {
    ok: true,
    provider: "google",
    profile: {
      email: userData.email,
      name: userData.name || userData.given_name || "Conta Google",
    },
  };
}

async function exchangeAppleCode(code) {
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

  return {
    ok: true,
    provider: "apple",
    profile: {
      email: payload.email,
      name: payload.email,
    },
  };
}

async function handleApi(req, res, url) {
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

    if (!provider || !code) {
      return sendJson(res, 400, {
        ok: false,
        message: "Provider e code são obrigatórios.",
      });
    }

    const result =
      provider === "google"
        ? await exchangeGoogleCode(code)
        : provider === "apple"
          ? await exchangeAppleCode(code)
          : { ok: false, message: "Provider OAuth não suportado." };

    return sendJson(res, result.ok ? 200 : 400, result);
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
