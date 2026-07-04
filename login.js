import {
  clearPasswordResetChallenge,
  clearAdminChallenge,
  confirmPasswordReset,
  getPasswordResetChallenge,
  getAdminChallenge,
  isAuthenticated,
  login,
  startPasswordReset,
  startGoogleAdminLogin,
  verifyAdminCode,
} from "./core/auth.js";
import { getOAuthLaunchResult } from "./core/oauth.js";
import { navigateTo } from "./core/router.js";

function resolveNextRoute() {
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (!next.startsWith("/") || next.startsWith("//")) {
    return "admin.html";
  }

  return next.slice(1) || "admin.html";
}

function goAfterLogin() {
  navigateTo(resolveNextRoute());
}

if (isAuthenticated()) {
  goAfterLogin();
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
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const forgotPasswordBtn = document.getElementById("forgot-password-btn");
  const resetRequestForm = document.getElementById("reset-request-form");
  const resetRequestError = document.getElementById("reset-request-error");
  const resetEmailInput = document.getElementById("reset-email");
  const cancelResetRequestBtn = document.getElementById(
    "cancel-reset-request-btn",
  );
  const resetConfirmForm = document.getElementById("reset-confirm-form");
  const resetConfirmHelp = document.getElementById("reset-confirm-help");
  const resetConfirmError = document.getElementById("reset-confirm-error");
  const resetCodeInput = document.getElementById("reset-code");
  const resetNewPasswordInput = document.getElementById("reset-new-password");
  const cancelResetConfirmBtn = document.getElementById(
    "cancel-reset-confirm-btn",
  );

  async function sendResetCodeEmail(email, code) {
    try {
      const response = await fetch("/api/password-reset/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });

      if (!response.ok) {
        return { ok: false, message: "Falha ao enviar e-mail de redefinicao." };
      }

      const data = await response.json();
      return data?.ok
        ? { ok: true }
        : {
            ok: false,
            message: data?.message || "Falha ao enviar e-mail de redefinicao.",
          };
    } catch {
      return { ok: false, message: "Falha de rede ao enviar e-mail." };
    }
  }

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

  function showResetRequestStep() {
    resetRequestForm?.classList.remove("hidden");
    resetConfirmForm?.classList.add("hidden");
    if (errorEl) {
      errorEl.textContent = "";
    }
    if (resetRequestError) {
      resetRequestError.textContent = "";
    }
    resetEmailInput?.focus();
    resetRequestForm?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function showLoginStep() {
    form.classList.remove("hidden");
    resetRequestForm?.classList.remove("hidden");
    resetConfirmForm?.classList.add("hidden");
    if (resetRequestError) {
      resetRequestError.textContent = "";
    }
    if (resetConfirmError) {
      resetConfirmError.textContent = "";
    }
  }

  function showResetConfirmStep(email, helpText) {
    resetRequestForm?.classList.add("hidden");
    form.classList.add("hidden");
    resetConfirmForm?.classList.remove("hidden");
    if (resetConfirmHelp) {
      resetConfirmHelp.textContent = helpText;
    }
    if (resetConfirmError) {
      resetConfirmError.textContent = "";
    }
    if (resetEmailInput) {
      resetEmailInput.value = String(email || "");
    }
    if (resetCodeInput) {
      resetCodeInput.value = "";
    }
    if (resetNewPasswordInput) {
      resetNewPasswordInput.value = "";
    }
    resetCodeInput?.focus();
  }

  if (!form) {
    return;
  }

  const prefillCredential = new URLSearchParams(window.location.search).get(
    "credential",
  );
  const prefillResetEmail = new URLSearchParams(window.location.search).get(
    "resetEmail",
  );
  if (prefillCredential && usernameInput) {
    usernameInput.value = prefillCredential;
  }
  if (prefillResetEmail && resetEmailInput) {
    resetEmailInput.value = String(prefillResetEmail).trim().toLowerCase();
  }

  usernameInput?.focus();

  [usernameInput, passwordInput].forEach((input) => {
    input?.addEventListener("input", () => {
      if (errorEl) {
        errorEl.textContent = "";
      }
    });
  });

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

    goAfterLogin();
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

  forgotPasswordBtn?.addEventListener("click", () => {
    showResetRequestStep();
  });

  cancelResetRequestBtn?.addEventListener("click", () => {
    if (resetEmailInput) {
      resetEmailInput.value = "";
    }
    if (resetRequestError) {
      resetRequestError.textContent = "";
    }
    usernameInput?.focus();
  });

  cancelResetConfirmBtn?.addEventListener("click", () => {
    clearPasswordResetChallenge();
    showLoginStep();
  });

  resetRequestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = String(resetEmailInput?.value || "")
      .trim()
      .toLowerCase();
    const result = startPasswordReset(email);

    if (!result.ok) {
      if (resetRequestError) {
        resetRequestError.textContent = result.message;
      }
      return;
    }

    const emailResult = await sendResetCodeEmail(
      result.challenge.email,
      result.challenge.devCode,
    );

    let helpText = `Codigo enviado para ${result.challenge.email}.`;
    if (!emailResult.ok) {
      helpText = `${helpText} Modo local: use o codigo ${result.challenge.devCode}.`;
    }

    showResetConfirmStep(result.challenge.email, helpText);
  });

  resetConfirmForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const email = String(resetEmailInput?.value || "")
      .trim()
      .toLowerCase();
    const code = String(resetCodeInput?.value || "").trim();
    const newPassword = String(resetNewPasswordInput?.value || "").trim();

    if (!/^\d{6}$/.test(code)) {
      if (resetConfirmError) {
        resetConfirmError.textContent = "Digite um codigo de 6 digitos.";
      }
      return;
    }

    const result = confirmPasswordReset(email, code, newPassword);
    if (!result.ok) {
      if (resetConfirmError) {
        resetConfirmError.textContent = result.message;
      }
      return;
    }

    showLoginStep();
    if (errorEl) {
      errorEl.style.color = "#1b5e20";
      errorEl.textContent =
        "Senha redefinida com sucesso. Faca login com a nova senha.";
    }
    usernameInput?.focus();
  });

  codeForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const typedCode = String(codeInput?.value || "").trim();
    if (!/^\d{6}$/.test(typedCode)) {
      if (codeError) {
        codeError.textContent = "Digite um codigo de 6 digitos.";
      }
      return;
    }

    const result = verifyAdminCode(typedCode);

    if (!result.ok) {
      if (codeError) {
        codeError.textContent = result.message;
      }
      return;
    }

    goAfterLogin();
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

  const pendingReset = getPasswordResetChallenge();
  if (pendingReset?.email && pendingReset?.expiresAt > Date.now()) {
    showResetConfirmStep(
      pendingReset.email,
      `Redefinicao pendente para ${pendingReset.email}. Digite o codigo recebido por e-mail.`,
    );
  }
});
