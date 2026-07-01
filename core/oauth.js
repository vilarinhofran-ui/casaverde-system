const OAUTH_CALLBACK_PATH = "oauth-callback.html";
const OAUTH_PENDING_KEY = "casaverde_oauth_pending";
let cachedPublicConfig = null;

const fallbackConfig = {
  google: {
    clientId: "CONFIGURE_GOOGLE_CLIENT_ID",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "openid email profile",
    responseType: "code",
    responseMode: "query",
  },
  apple: {
    clientId: "CONFIGURE_APPLE_CLIENT_ID",
    authUrl: "https://appleid.apple.com/auth/authorize",
    scope: "name email",
    responseType: "code",
    responseMode: "query",
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

export async function loadPublicOAuthConfig() {
  if (cachedPublicConfig) {
    return cachedPublicConfig;
  }

  try {
    const response = await fetch("/api/public-config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("public-config unavailable");
    }
    const data = await response.json();
    cachedPublicConfig = data;
    return data;
  } catch {
    cachedPublicConfig = null;
    return null;
  }
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

export async function getOAuthLaunchResult(provider, context = "customer") {
  const publicConfig = await loadPublicOAuthConfig();
  const merged = {
    ...fallbackConfig,
    google: {
      ...fallbackConfig.google,
      clientId:
        publicConfig?.oauth?.googleClientId || fallbackConfig.google.clientId,
    },
    apple: {
      ...fallbackConfig.apple,
      clientId:
        publicConfig?.oauth?.appleClientId || fallbackConfig.apple.clientId,
    },
  };

  const config = merged[provider];

  if (!config) {
    return { ok: false, message: "Provedor OAuth não suportado." };
  }

  if (!hasRealClientId(config.clientId)) {
    return {
      ok: false,
      message: `Configure ${provider} no backend (.env) para liberar OAuth em produção.`,
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
