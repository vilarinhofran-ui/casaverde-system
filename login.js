import {
  clearAdminChallenge,
  getAdminChallenge,
  isAuthenticated,
  login,
  startGoogleAdminLogin,
  verifyAdminCode,
} from "./core/auth.js";
import { getOAuthLaunchResult } from "./core/oauth.js";
import { navigateTo } from "./core/router.js";

if (isAuthenticated()) {
  navigateTo("admin.html");
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const googleBtn = document.getElementById("google-admin-btn");
  const codeForm = document.getElementById("code-form");
  const codeError = document.getElementById("code-error");
  const codeHelp = document.getElementById("code-help");
  const codeInput = document.getElementById("admin-code");
  const cancelCodeBtn = document.getElementById("cancel-code-btn");

  function openCodeStep(helpText) {
    codeForm?.classList.remove("hidden");
    if (codeHelp) {
      codeHelp.textContent = helpText;
    }
    if (codeError) {
      codeError.textContent = "";
    }
    if (codeInput) {
      codeInput.value = "";
      codeInput.focus();
    }
  }

  function closeCodeStep() {
    codeForm?.classList.add("hidden");
    if (codeError) {
      codeError.textContent = "";
    }
    if (codeInput) {
      codeInput.value = "";
    }
  }

  if (!form) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const username = formData.get("username");
    const password = formData.get("password");
    const result = login(username, password);

    if (!result.ok) {
      if (errorEl) {
        errorEl.textContent = result.message;
      }
      return;
    }

    navigateTo("admin.html");
  });

  googleBtn?.addEventListener("click", async () => {
    const oauth = await getOAuthLaunchResult("google", "admin");

    if (oauth.ok) {
      window.location.href = oauth.authUrl;
      return;
    }

    const response = startGoogleAdminLogin();

    if (!response.ok) {
      if (errorEl) {
        errorEl.textContent =
          oauth.message || "Nao foi possivel iniciar login com Google.";
      }
      return;
    }

    const { email, devCode } = response.challenge;
    openCodeStep(
      `Codigo enviado para ${email}. Modo demo: use o codigo ${devCode}.`,
    );
  });

  codeForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = verifyAdminCode(codeInput?.value);

    if (!result.ok) {
      if (codeError) {
        codeError.textContent = result.message;
      }
      return;
    }

    navigateTo("admin.html");
  });

  cancelCodeBtn?.addEventListener("click", () => {
    clearAdminChallenge();
    closeCodeStep();
  });

  const pendingChallenge = getAdminChallenge();
  if (pendingChallenge) {
    openCodeStep(
      `Login Google pendente para ${pendingChallenge.email}. Digite o codigo de 6 digitos.`,
    );
  }
});
