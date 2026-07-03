import {
  loginOrCreateAdminWithOAuthIdentity,
  loginWithOAuthIdentity,
} from "./core/auth.js";
import { clearPendingOAuth, readPendingOAuth } from "./core/oauth.js";
import { loginCustomerWithOAuth } from "./modules/users.js";

const OAUTH_FLASH_KEY = "casaverde_oauth_flash";

function byId(id) {
  return document.getElementById(id);
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

function getCallbackParams() {
  const search = new URLSearchParams(window.location.search);
  const hashText = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : "";
  const hash = new URLSearchParams(hashText);

  return {
    code: search.get("code") || hash.get("code"),
    idToken: search.get("id_token") || hash.get("id_token"),
    error: search.get("error") || hash.get("error"),
  };
}

function setFlashAndRedirect(message, context = "customer") {
  sessionStorage.setItem(
    OAUTH_FLASH_KEY,
    JSON.stringify({ message, createdAt: Date.now() }),
  );
  window.location.href =
    context === "admin" ? "admin.html" : "index.html#customer-account";
}

async function exchangeCode(provider, code, context, redirectUri) {
  const response = await fetch("/api/oauth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, code, context, redirectUri }),
  });
  return response.json();
}

document.addEventListener("DOMContentLoaded", async () => {
  const message = byId("oauth-callback-message");
  const pending = readPendingOAuth();
  const params = getCallbackParams();
  const context = pending?.context || "customer";
  const provider = pending?.provider || "oauth";

  if (params.error) {
    clearPendingOAuth();
    message.textContent = `Falha na autenticação OAuth: ${params.error}.`;
    return;
  }

  const identity = params.idToken ? decodeJwtPayload(params.idToken) : null;

  if (identity?.email) {
    const result =
      context === "admin"
        ? loginWithOAuthIdentity(identity.email, provider)
        : loginCustomerWithOAuth({
            email: identity.email,
            name: identity.name || identity.given_name || "Cliente OAuth",
            provider,
          });

    clearPendingOAuth();

    if (!result.ok) {
      message.textContent = result.message;
      return;
    }

    setFlashAndRedirect(
      `Acesso confirmado com ${provider === "google" ? "Google" : "Apple"}.`,
      context,
    );
    return;
  }

  if (params.code && provider !== "oauth") {
    const exchanged = await exchangeCode(
      provider,
      params.code,
      context,
      pending?.redirectUri,
    );
    clearPendingOAuth();

    if (!exchanged.ok || !exchanged.profile?.email) {
      message.textContent =
        exchanged.message || "Falha ao concluir a autenticação OAuth.";
      return;
    }

    const result =
      context === "admin"
        ? loginOrCreateAdminWithOAuthIdentity({
            email: exchanged.profile.email,
            name: exchanged.profile.name || "Administrador OAuth",
            provider,
            role: exchanged?.access?.role,
          })
        : loginCustomerWithOAuth({
            email: exchanged.profile.email,
            name: exchanged.profile.name || "Cliente OAuth",
            provider,
          });

    if (!result.ok) {
      message.textContent = result.message;
      return;
    }

    setFlashAndRedirect(
      `Acesso confirmado com ${provider === "google" ? "Google" : "Apple"}.`,
      context,
    );
    return;
  }

  clearPendingOAuth();
  message.textContent =
    "Nenhum retorno OAuth utilizável foi encontrado. Revise as credenciais e o redirect URI.";
});
