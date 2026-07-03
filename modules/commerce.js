import { db } from "../core/db.js";

const PIX_SETTINGS_KEY = "casaverde_pix_settings";
const COUPONS_KEY = "casaverde_coupons";
const PROMOTIONS_KEY = "casaverde_promotions";
const SUBSCRIPTIONS_KEY = "casaverde_subscriptions";
const BENEFITS_KEY = "casaverde_benefits_club";

function nowIso() {
  return new Date().toISOString();
}

function isExpired(expiresAt) {
  if (!expiresAt) {
    return false;
  }
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date.getTime() < Date.now();
}

function sanitizeText(value, max = 160) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function readList(key) {
  const list = db.read(key, []);
  return Array.isArray(list) ? list : [];
}

function writeList(key, list) {
  db.write(key, list);
  return list;
}

export function getPixSettings() {
  const current = db.read(PIX_SETTINGS_KEY, null);
  if (!current || typeof current !== "object") {
    return {
      pixKey: "",
      pixHolder: "Casa Verde Pet e Flora",
      updatedAt: null,
    };
  }

  return {
    pixKey: sanitizeText(current.pixKey, 200),
    pixHolder: sanitizeText(current.pixHolder, 120) || "Casa Verde Pet e Flora",
    updatedAt: current.updatedAt || null,
  };
}

export function savePixSettings(input = {}) {
  const pixKey = sanitizeText(input.pixKey, 200);
  const pixHolder =
    sanitizeText(input.pixHolder, 120) || "Casa Verde Pet e Flora";

  if (!pixKey) {
    return { ok: false, message: "Informe a chave PIX." };
  }

  const payload = {
    pixKey,
    pixHolder,
    updatedAt: nowIso(),
  };

  db.write(PIX_SETTINGS_KEY, payload);
  return { ok: true, settings: payload };
}

export function listCoupons() {
  return readList(COUPONS_KEY)
    .map((coupon) => ({
      ...coupon,
      active: Boolean(coupon.active),
      expired: isExpired(coupon.expiresAt),
    }))
    .sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    );
}

export function createCoupon(input = {}) {
  const code = sanitizeText(input.code, 40).toUpperCase().replace(/\s+/g, "");
  const type = input.type === "fixed" ? "fixed" : "percent";
  const value = Number(input.value || 0);
  const minSubtotal = Math.max(0, Number(input.minSubtotal || 0));
  const maxDiscount = Math.max(0, Number(input.maxDiscount || 0));
  const description = sanitizeText(input.description, 180);
  const expiresAt = sanitizeText(input.expiresAt, 40) || null;

  if (!code) {
    return { ok: false, message: "Informe o codigo do cupom." };
  }

  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: "Valor do cupom invalido." };
  }

  if (type === "percent" && value > 100) {
    return { ok: false, message: "Cupom percentual deve ser ate 100." };
  }

  const coupons = readList(COUPONS_KEY);
  const exists = coupons.some(
    (coupon) => String(coupon.code || "").toUpperCase() === code,
  );
  if (exists) {
    return { ok: false, message: "Ja existe cupom com este codigo." };
  }

  const coupon = {
    id: db.uid("cpn"),
    code,
    type,
    value,
    minSubtotal,
    maxDiscount,
    description,
    expiresAt,
    active: true,
    createdAt: nowIso(),
  };

  writeList(COUPONS_KEY, [coupon, ...coupons]);
  return { ok: true, coupon };
}

export function setCouponActive(couponId, active) {
  let updated = null;
  writeList(
    COUPONS_KEY,
    readList(COUPONS_KEY).map((coupon) => {
      if (coupon.id !== couponId) {
        return coupon;
      }
      updated = { ...coupon, active: Boolean(active) };
      return updated;
    }),
  );

  if (!updated) {
    return { ok: false, message: "Cupom nao encontrado." };
  }

  return { ok: true, coupon: updated };
}

export function removeCoupon(couponId) {
  const before = readList(COUPONS_KEY);
  const next = before.filter((coupon) => coupon.id !== couponId);
  writeList(COUPONS_KEY, next);
  return { ok: next.length < before.length };
}

export function resolveCoupon(code) {
  const normalized = sanitizeText(code, 40).toUpperCase().replace(/\s+/g, "");
  if (!normalized) {
    return { ok: false, message: "Informe o cupom." };
  }

  const coupon = listCoupons().find((item) => item.code === normalized);
  if (!coupon) {
    return { ok: false, message: "Cupom invalido." };
  }

  if (!coupon.active || coupon.expired) {
    return { ok: false, message: "Cupom inativo ou expirado." };
  }

  return { ok: true, coupon };
}

function createCatalogItem(key, input = {}) {
  const title = sanitizeText(input.title, 80);
  const description = sanitizeText(input.description, 220);

  if (!title || !description) {
    return { ok: false, message: "Titulo e descricao sao obrigatorios." };
  }

  const item = {
    id: db.uid("mkt"),
    title,
    description,
    active: true,
    createdAt: nowIso(),
  };

  const list = readList(key);
  writeList(key, [item, ...list]);
  return { ok: true, item };
}

function listCatalogItems(key) {
  return readList(key)
    .map((item) => ({ ...item, active: Boolean(item.active) }))
    .sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    );
}

function removeCatalogItem(key, itemId) {
  const before = readList(key);
  const next = before.filter((item) => item.id !== itemId);
  writeList(key, next);
  return { ok: next.length < before.length };
}

export function createPromotion(input) {
  return createCatalogItem(PROMOTIONS_KEY, input);
}

export function listPromotions() {
  return listCatalogItems(PROMOTIONS_KEY);
}

export function removePromotion(itemId) {
  return removeCatalogItem(PROMOTIONS_KEY, itemId);
}

export function createSubscriptionPlan(input) {
  return createCatalogItem(SUBSCRIPTIONS_KEY, input);
}

export function listSubscriptionPlans() {
  return listCatalogItems(SUBSCRIPTIONS_KEY);
}

export function removeSubscriptionPlan(itemId) {
  return removeCatalogItem(SUBSCRIPTIONS_KEY, itemId);
}

export function createBenefit(input) {
  return createCatalogItem(BENEFITS_KEY, input);
}

export function listBenefits() {
  return listCatalogItems(BENEFITS_KEY);
}

export function removeBenefit(itemId) {
  return removeCatalogItem(BENEFITS_KEY, itemId);
}
