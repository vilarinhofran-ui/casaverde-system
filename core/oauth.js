const OAUTH_CALLBACK_PATH = "oauth-callback.html";
const OAUTH_PENDING_KEY = "casaverde_oauth_pending";

export const OAUTH_CONFIG = {
  google: {
    clientId: "CONFIGURE_GOOGLE_CLIENT_ID",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "openid email profile",
    responseType: "id_token token",
    responseMode: "fragment",
  },
  apple: {
    clientId: "CONFIGURE_APPLE_CLIENT_ID",
    authUrl: "https://appleid.apple.com/auth/authorize",
    scope: "name email",
    responseType: "code id_token",
    responseMode: "fragment",
  },
};

function hasRealClientId(value) {
  return Boolean(value) && !String(value).startsWith("CONFIGURE_");
}

function getRedirectUri() {
  if (window.location.protocol === "file:") {
    return "https://casaverdepet.com.br/oauth-callback.html";
  }

  return new URL(OAUTH_CALLBACK_PATH, window.location.href).toString();
}

function createState(provider, context) {
  return btoa(
    JSON.stringify({
      provider,
      context,
      ts: Date.now(),
    }),
  );
}

function createNonce() {
  return Math.random().toString(36).slice(2, 14);
}

export function readPendingOAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(OAUTH_PENDING_KEY) || "null");
  } catch {
    return null;
  }
}

export function clearPendingOAuth() {
  sessionStorage.removeItem(OAUTH_PENDING_KEY);
}

export function getOAuthLaunchResult(provider, context = "customer") {
  const config = OAUTH_CONFIG[provider];

  if (!config) {
    return { ok: false, message: "Provedor OAuth nao suportado." };
  }

  if (!hasRealClientId(config.clientId)) {
    return {
      ok: false,
      message: `Configure ${provider} em core/oauth.js com clientId e redirect URI oficial.`,
    };
  }

  const redirectUri = getRedirectUri();
  const nonce = createNonce();
  const url = new URL(config.authUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", config.responseType);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", createState(provider, context));
  url.searchParams.set("nonce", nonce);

  if (provider === "google") {
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
  }

  if (config.responseMode) {
    url.searchParams.set("response_mode", config.responseMode);
  }

  sessionStorage.setItem(
    OAUTH_PENDING_KEY,
    JSON.stringify({
      provider,
      context,
      redirectUri,
      nonce,
      createdAt: Date.now(),
    }),
  );

  return {
    ok: true,
    authUrl: url.toString(),
    redirectUri,
  };
}
