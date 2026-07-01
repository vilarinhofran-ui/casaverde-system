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
    const decoded = atob(normalized);
    return JSON.parse(decoded);
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
    accessToken: search.get("access_token") || hash.get("access_token"),
    error: search.get("error") || hash.get("error"),
    state: search.get("state") || hash.get("state"),
  };
}

function setFlashAndRedirect(message, type = "info") {
  sessionStorage.setItem(
    OAUTH_FLASH_KEY,
    JSON.stringify({ message, type, createdAt: Date.now() }),
  );
  window.location.href = "index.html#customer-account";
}

document.addEventListener("DOMContentLoaded", () => {
  const message = byId("oauth-callback-message");
  const pending = readPendingOAuth();
  const params = getCallbackParams();

  if (params.error) {
    clearPendingOAuth();
    message.textContent = `Falha na autenticação OAuth: ${params.error}.`;
    return;
  }

  const identity = params.idToken ? decodeJwtPayload(params.idToken) : null;

  if (identity?.email) {
    const provider = pending?.provider || "oauth";
    const loginResult = loginCustomerWithOAuth({
      email: identity.email,
      name: identity.name || identity.given_name || "Cliente OAuth",
      provider,
    });

    clearPendingOAuth();

    if (!loginResult.ok) {
      message.textContent = loginResult.message;
      return;
    }

    setFlashAndRedirect(
      `Acesso confirmado com ${provider === "google" ? "Google" : "Apple"} para ${identity.email}.`,
      "success",
    );
    return;
  }

  if (params.code) {
    clearPendingOAuth();
    message.textContent =
      "Código OAuth recebido. Para conclusão real em produção, o backend precisa trocar o code por tokens seguros do provedor.";
    return;
  }

  clearPendingOAuth();
  message.textContent =
    "Nenhum retorno OAuth utilizável foi encontrado. Revise o clientId e o redirect URI configurados.";
});
