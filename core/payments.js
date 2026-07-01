import { db } from "./db.js";

const PAYMENT_WEBHOOK_EVENTS_KEY = "casaverde_payment_webhooks";

const API_CONFIG = {
  stripe: {
    provider: "stripe",
    createCheckoutUrl: "/api/payments/stripe/checkout",
    statusUrl: "/api/payments/stripe/status",
  },
  mercado_pago: {
    provider: "mercado_pago",
    createCheckoutUrl: "/api/payments/mercado-pago/checkout",
    statusUrl: "/api/payments/mercado-pago/status",
  },
};

function toSafeErrorMessage(error) {
  return error?.message || "Erro na comunicacao com provedor de pagamento.";
}

export function listWebhookEvents() {
  return db.read(PAYMENT_WEBHOOK_EVENTS_KEY, []);
}

export function registerWebhookEvent(eventPayload) {
  const event = {
    id: db.uid("whk"),
    transactionId: String(eventPayload?.transactionId || ""),
    paymentId: String(eventPayload?.paymentId || ""),
    provider: String(eventPayload?.provider || "unknown"),
    status: String(eventPayload?.status || "pending"),
    receivedAt: new Date().toISOString(),
    raw: eventPayload,
  };

  db.update(PAYMENT_WEBHOOK_EVENTS_KEY, [], (current) => [event, ...current]);
  return event;
}

export function getWebhookConfirmation(transactionId) {
  const target = String(transactionId || "");
  const event = listWebhookEvents().find(
    (item) =>
      String(item.transactionId || "") === target &&
      item.status === "confirmed",
  );
  return event || null;
}

export function inferProviderFromMethod(paymentMethod) {
  if (paymentMethod === "gateway") {
    return "stripe";
  }

  if (paymentMethod === "pix_qrcode" || paymentMethod === "link_pagamento") {
    return "mercado_pago";
  }

  return "local";
}

export async function createExternalCheckout({
  provider,
  transactionId,
  amount,
  customer,
  paymentMethod,
}) {
  const config = API_CONFIG[provider];

  if (!config) {
    return {
      ok: true,
      provider: "local",
      paymentId: `local-${transactionId}`,
      checkoutUrl: null,
      mode: "offline",
      message: "Pagamento presencial/local sem checkout externo.",
    };
  }

  try {
    const response = await fetch(config.createCheckoutUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId,
        amount,
        customer,
        paymentMethod,
      }),
    });

    if (!response.ok) {
      const errorMessage = await response.text();
      return {
        ok: false,
        provider,
        message: errorMessage || "Falha ao criar checkout externo.",
      };
    }

    const data = await response.json();

    return {
      ok: true,
      provider,
      paymentId: data.paymentId,
      checkoutUrl: data.checkoutUrl || null,
      mode: "external",
      message: data.message || "Checkout externo criado.",
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      message: toSafeErrorMessage(error),
    };
  }
}

export async function queryExternalPaymentStatus({ provider, paymentId }) {
  const config = API_CONFIG[provider];

  if (!config) {
    return { ok: true, status: "confirmed", source: "local" };
  }

  try {
    const url = `${config.statusUrl}?paymentId=${encodeURIComponent(paymentId)}`;
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      const errorMessage = await response.text();
      return {
        ok: false,
        status: "unknown",
        message: errorMessage || "Falha ao consultar status de pagamento.",
      };
    }

    const data = await response.json();
    return {
      ok: true,
      status: String(data.status || "pending"),
      source: "provider",
      provider,
      raw: data,
    };
  } catch (error) {
    return {
      ok: false,
      status: "unknown",
      message: toSafeErrorMessage(error),
    };
  }
}

export async function confirmPaymentByWebhookOrProvider({
  transactionId,
  provider,
  paymentId,
}) {
  const webhook = getWebhookConfirmation(transactionId);
  if (webhook) {
    return {
      ok: true,
      status: "confirmed",
      source: "webhook",
      provider: webhook.provider,
      paymentId: webhook.paymentId,
    };
  }

  const providerStatus = await queryExternalPaymentStatus({
    provider,
    paymentId,
  });

  if (!providerStatus.ok) {
    return providerStatus;
  }

  if (
    providerStatus.status === "confirmed" ||
    providerStatus.status === "approved"
  ) {
    return {
      ok: true,
      status: "confirmed",
      source: "provider",
      provider,
      paymentId,
    };
  }

  return {
    ok: false,
    status: providerStatus.status,
    message: "Pagamento ainda nao confirmado por webhook/provedor.",
  };
}

export function paymentProviderConfigSummary() {
  return {
    stripe: API_CONFIG.stripe,
    mercadoPago: API_CONFIG.mercado_pago,
    webhookStoreKey: PAYMENT_WEBHOOK_EVENTS_KEY,
  };
}
