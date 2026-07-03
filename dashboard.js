import {
  approveAccessRequest,
  createAccessRequest,
  getSession,
  listAccessRequests,
  logout,
  rejectAccessRequest,
  ROLE,
} from "./core/auth.js";
import { navigateTo, requireAuth } from "./core/router.js";
import {
  listProducts,
  replaceImportedProducts,
  updateProductFields,
  updateProductMedia,
} from "./modules/products.js";
import { listAuditLogs } from "./modules/audit.js";
import {
  ORDER_STATUS_OPTIONS,
  listSales,
  updateOrderStatus,
} from "./modules/sales.js";
import {
  createBenefit,
  createCoupon,
  createPromotion,
  createSubscriptionPlan,
  getPixSettings,
  listBenefits,
  listCoupons,
  listPromotions,
  listSubscriptionPlans,
  removeBenefit,
  removeCoupon,
  removePromotion,
  removeSubscriptionPlan,
  savePixSettings,
  setCouponActive,
} from "./modules/commerce.js";
import { db } from "./core/db.js";

if (!requireAuth()) {
  throw new Error("Acesso negado");
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const adminSearchTargets = [
  { label: "Pedidos", type: "scroll", target: "orders-section" },
  { label: "Mídia", type: "scroll", target: "media-section" },
  { label: "Auditoria", type: "scroll", target: "audit-section" },
  { label: "Acessos", type: "scroll", target: "access-section" },
  { label: "Aprovações", type: "scroll", target: "approvals-section" },
  { label: "Migração", type: "scroll", target: "migration-section" },
  { label: "Comercial", type: "scroll", target: "commercial-section" },
  { label: "Ir para loja", type: "link", href: "index.html" },
  { label: "Abrir PDV", type: "link", href: "pdv.html" },
  { label: "Abrir ERP Completo", type: "link", href: "erp.html" },
];

const PRODUCT_OVERRIDES_KEY = "casaverde_product_overrides";
const ORDERS_KEY = "casaverde_orders";
const CUSTOMER_USERS_KEY = "casaverde_customer_users";
const ADMIN_USERS_KEY = "casaverde_users";
const IMPORTED_PRODUCTS_KEY = "casaverde_imported_products";

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function canApprove(session, role) {
  if (!session) {
    return false;
  }

  if (session.role === ROLE.SUPER_ADMIN) {
    return true;
  }

  if (session.role === ROLE.ADMIN) {
    return role === ROLE.CAIXA || role === ROLE.SUPERVISOR;
  }

  return false;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function parseCsvLine(line, delimiter) {
  const out = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (quoted && next === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  out.push(current.trim());
  return out;
}

function parseCsvText(text) {
  const rows = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length < 2) {
    return [];
  }

  const headerLine = rows[0];
  const delimiter =
    (headerLine.match(/;/g) || []).length >
    (headerLine.match(/,/g) || []).length
      ? ";"
      : ",";

  const headers = parseCsvLine(headerLine, delimiter);
  const keys = headers.map((header) => normalizeHeader(header));

  return rows.slice(1).map((line) => {
    const cols = parseCsvLine(line, delimiter);
    const item = {};
    keys.forEach((key, index) => {
      item[key] = cols[index] || "";
    });
    return item;
  });
}

function getField(item, aliases = []) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (key in item && String(item[key]).trim()) {
      return String(item[key]).trim();
    }
  }
  return "";
}

function parseNumber(value, fallback = 0) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  const normalized = raw.replace(/\s+/g, "").replace(/[^0-9,.-]/g, "");
  let candidate = normalized;

  if (normalized.includes(",") && normalized.includes(".")) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    candidate =
      lastComma > lastDot
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    candidate = normalized.replace(/\./g, "").replace(",", ".");
  }

  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRole(value) {
  const role = String(value || "")
    .toLowerCase()
    .trim();
  if (["super_admin", "superadmin"].includes(role)) {
    return ROLE.SUPER_ADMIN;
  }
  if (["admin", "administrador"].includes(role)) {
    return ROLE.ADMIN;
  }
  if (["supervisor"].includes(role)) {
    return ROLE.SUPERVISOR;
  }
  return ROLE.CAIXA;
}

function normalizeProductRows(rows) {
  return rows
    .map((row, index) => {
      const name = getField(row, ["descricao", "nome", "produto", "name"]);
      const barcode = getField(row, ["ean", "gtin", "codigo", "barcode"]);

      if (!name && !barcode) {
        return null;
      }

      const idSource = barcode || `${name}-${index + 1}`;
      const id = `imp_${idSource.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

      return {
        id,
        barcode: barcode || id,
        name: name || `Produto importado ${index + 1}`,
        unit: getField(row, ["unidade", "unit", "uom"]) || "UN",
        species:
          getField(row, ["especie", "segmento", "species"]) || "Casa e Jardim",
        category: getField(row, ["categoria", "category"]) || "Importado",
        brand: getField(row, ["marca", "brand"]) || "Importado",
        price: parseNumber(getField(row, ["preco", "valor", "price"]), 0),
        oldPrice: parseNumber(
          getField(row, ["precode", "oldprice", "precoantigo"]),
          0,
        ),
        stock: parseNumber(
          getField(row, ["estoque", "quantidade", "stock"]),
          0,
        ),
        badge: "Importado",
        rating: 4,
        deliveryHours: 24,
        icon: "📦",
        imageUrl: getField(row, ["imagem", "image", "imageurl"]),
        videoUrl: getField(row, ["video", "videourl"]),
      };
    })
    .filter(Boolean);
}

function normalizeOrderRows(rows) {
  return rows
    .map((row, index) => {
      const id =
        getField(row, ["id", "pedido", "numero", "numero_pedido"]) ||
        `imp_order_${Date.now()}_${index}`;
      const total = parseNumber(
        getField(row, ["total", "valor_total", "valor"]),
        0,
      );
      if (!id || total <= 0) {
        return null;
      }

      return {
        id: String(id)
          .toLowerCase()
          .replace(/[^a-z0-9_\-]+/g, "_"),
        createdAt:
          getField(row, ["data", "createdat", "emissao"]) ||
          new Date().toISOString(),
        status: getField(row, ["status"]) || "Recebido",
        customerId: null,
        customerName:
          getField(row, ["cliente", "cliente_nome", "customer"]) ||
          "Cliente importado",
        paymentMethod:
          getField(row, ["pagamento", "metodo_pagamento"]) || "Nao informado",
        fiscalDocumentType: "NFE",
        notes: "Importado de sistema externo",
        deliveryMode: "delivery",
        cep: getField(row, ["cep"]),
        address: getField(row, ["endereco", "address"]),
        items: [],
        totals: {
          itemsCount: 0,
          subtotal: total,
          shipping: 0,
          discount: 0,
          total,
          deliveryMode: "delivery",
        },
      };
    })
    .filter(Boolean);
}

function normalizeCustomerRows(rows) {
  return rows
    .map((row, index) => {
      const email = getField(row, ["email", "e-mail", "mail"]).toLowerCase();
      if (!email) {
        return null;
      }

      return {
        id: `cli_imp_${Date.now()}_${index}`,
        name:
          getField(row, ["nome", "cliente", "razaosocial", "name"]) ||
          "Cliente importado",
        email,
        phone: getField(row, ["telefone", "phone"]),
        role: "customer",
        createdAt: new Date().toISOString(),
        passwordSalt: "oauth",
        passwordHash: "oauth",
      };
    })
    .filter(Boolean);
}

function normalizeAdminRows(rows) {
  return rows
    .map((row, index) => {
      const email = getField(row, ["email", "e-mail", "login"]).toLowerCase();
      if (!email) {
        return null;
      }

      const name =
        getField(row, ["nome", "name", "usuario"]) || "Usuario importado";
      return {
        id: `usr_imp_${Date.now()}_${index}`,
        username: email,
        email,
        password: getField(row, ["senha", "password"]) || "",
        name,
        role: normalizeRole(getField(row, ["perfil", "role", "cargo"])),
        approved: true,
        approvedByRole: ROLE.SUPER_ADMIN,
        createdAt: new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function mergeByField(current, incoming, field) {
  const map = new Map();
  current.forEach((item) =>
    map.set(String(item[field] || "").toLowerCase(), item),
  );
  incoming.forEach((item) =>
    map.set(String(item[field] || "").toLowerCase(), item),
  );
  return [...map.values()];
}

async function readMigrationFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(new Error("Falha ao ler arquivo de migracao."));
    reader.readAsText(file);
  });
}

async function fetchSupabaseStatus() {
  try {
    const response = await fetch("/api/supabase/status", { cache: "no-store" });
    return await response.json();
  } catch {
    return {
      ok: false,
      message: "Falha ao consultar status do Supabase.",
    };
  }
}

function describeSupabaseStatus(status) {
  if (!status?.configured) {
    return "Supabase não configurado (defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).";
  }

  if (!status?.ok) {
    return `Supabase com erro: ${status?.message || "sem detalhes"}`;
  }

  return `Supabase conectado (tabela: ${status.table}).`;
}

async function syncMigrationToSupabase({ source, payload, requestedBy }) {
  try {
    const response = await fetch("/api/supabase/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "migration_snapshot",
        source,
        payload,
        requestedBy,
      }),
    });

    return await response.json();
  } catch {
    return {
      ok: false,
      message: "Falha de rede ao sincronizar com Supabase.",
    };
  }
}

function mediaPreview(product) {
  if (product.imageUrl) {
    return `<img class="admin-media-preview" src="${product.imageUrl}" alt="${product.name}" />`;
  }

  if (product.videoUrl) {
    return `<video class="admin-media-preview" src="${product.videoUrl}" controls preload="metadata"></video>`;
  }

  return '<p class="empty-state">Sem midia definida.</p>';
}

function renderMetrics() {
  const products = listProducts();
  const orders = listSales();
  const audits = listAuditLogs();
  const revenue = orders.reduce((sum, order) => sum + order.totals.total, 0);

  byId("admin-metrics").innerHTML = `
    <article class="metric-card">
      <h3>${products.length}</h3>
      <p>Produtos ativos</p>
    </article>
    <article class="metric-card">
      <h3>${orders.length}</h3>
      <p>Pedidos totais</p>
    </article>
    <article class="metric-card">
      <h3>${currency.format(revenue)}</h3>
      <p>Faturamento acumulado</p>
    </article>
    <article class="metric-card">
      <h3>${audits.length}</h3>
      <p>Eventos de auditoria</p>
    </article>
  `;
}

function renderOrders() {
  const container = byId("orders-list");
  const orders = listSales().slice(0, 8);

  if (orders.length === 0) {
    container.innerHTML =
      '<p class="empty-state">Nenhum pedido registrado.</p>';
    return;
  }

  container.innerHTML = orders
    .map(
      (order) => `
      <article class="order-card" data-order-id="${order.id}">
        <h3>${order.id.toUpperCase()}</h3>
        <p>Cliente: ${order.customerName}</p>
        <p>Pagamento: ${order.paymentMethod}</p>
        <p>Total: ${currency.format(order.totals.total)}</p>
        <label for="status-${order.id}">Status da venda</label>
        <select id="status-${order.id}" class="order-status-select" data-order-id="${order.id}">
          ${ORDER_STATUS_OPTIONS.map(
            (status) =>
              `<option value="${status}" ${order.status === status ? "selected" : ""}>${status}</option>`,
          ).join("")}
        </select>
      </article>
    `,
    )
    .join("");
}

function renderProductMediaManager() {
  const container = byId("product-media-list");
  if (!container) {
    return;
  }

  const products = listProducts();

  container.innerHTML = products
    .map(
      (product) => `
      <article class="admin-product-media" data-product-id="${product.id}">
        <h3>${product.name}</h3>
        <p class="erp-note">${product.species} | ${product.category} | ${product.brand}</p>
        <div class="admin-media-box">${mediaPreview(product)}</div>
        <div class="admin-media-form">
          <input type="text" class="product-image-url" placeholder="URL da imagem" value="${product.imageUrl || ""}" />
          <input type="text" class="product-video-url" placeholder="URL do video" value="${product.videoUrl || ""}" />
          <input type="file" class="product-image-file" accept="image/*" />
          <button class="btn secondary media-save-btn" type="button" data-product-id="${product.id}">Salvar midia</button>
        </div>
      </article>
    `,
    )
    .join("");
}

function renderAudit() {
  const container = byId("audit-list");
  const logs = listAuditLogs().slice(0, 10);

  if (logs.length === 0) {
    container.innerHTML = '<p class="empty-state">Sem logs de auditoria.</p>';
    return;
  }

  container.innerHTML = logs
    .map(
      (log) => `
      <article class="audit-row">
        <h4>${log.type}</h4>
        <p>${new Date(log.createdAt).toLocaleString("pt-BR")}</p>
      </article>
    `,
    )
    .join("");
}

function renderGovernance(session) {
  const hint = byId("access-governance-hint");
  const rows = byId("access-approvals-list");
  const requests = listAccessRequests();

  if (hint) {
    hint.textContent =
      session?.role === ROLE.SUPER_ADMIN
        ? "Perfil SUPER ADMIN: aprova acessos admin e operacionais."
        : session?.role === ROLE.ADMIN
          ? "Perfil ADMIN: aprova acessos de caixa e supervisor."
          : "Seu perfil nao possui permissao de aprovacao.";
  }

  if (!rows) {
    return;
  }

  if (!requests.length) {
    rows.innerHTML =
      '<tr><td colspan="6">Sem solicitacoes de acesso.</td></tr>';
    return;
  }

  rows.innerHTML = requests
    .map((item) => {
      const canAct =
        item.status === "pending" && canApprove(session, item.role);
      return `
      <tr data-request-id="${item.id}">
        <td>${item.name}</td>
        <td>${item.email}</td>
        <td>${item.role}</td>
        <td>${item.requiredApproverRole}</td>
        <td>${item.status}</td>
        <td>
          <div class="erp-option-actions">
            <button class="erp-mini-btn" data-request-action="approve" data-request-id="${item.id}" type="button" ${canAct ? "" : "disabled"}>Aprovar</button>
            <button class="erp-mini-btn danger" data-request-action="reject" data-request-id="${item.id}" type="button" ${canAct ? "" : "disabled"}>Rejeitar</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

function renderCouponRows() {
  const rows = byId("coupon-list");
  if (!rows) {
    return;
  }

  const coupons = listCoupons();
  if (!coupons.length) {
    rows.innerHTML = '<tr><td colspan="6">Sem cupons cadastrados.</td></tr>';
    return;
  }

  rows.innerHTML = coupons
    .map((coupon) => {
      const typeLabel = coupon.type === "fixed" ? "Fixo" : "Percentual";
      const valueLabel =
        coupon.type === "fixed"
          ? currency.format(coupon.value)
          : `${coupon.value}%`;
      const status = coupon.active && !coupon.expired ? "Ativo" : "Inativo";
      const rule = `Min ${currency.format(coupon.minSubtotal || 0)}${coupon.maxDiscount ? ` | Max desc ${currency.format(coupon.maxDiscount)}` : ""}`;

      return `
        <tr data-coupon-id="${coupon.id}">
          <td>${escapeHtml(coupon.code)}</td>
          <td>${escapeHtml(typeLabel)}</td>
          <td>${escapeHtml(valueLabel)}</td>
          <td>${escapeHtml(rule)}</td>
          <td>${escapeHtml(status)}</td>
          <td>
            <div class="erp-option-actions">
              <button class="erp-mini-btn" type="button" data-coupon-action="toggle" data-coupon-id="${coupon.id}" data-next-active="${coupon.active ? "false" : "true"}">
                ${coupon.active ? "Desativar" : "Ativar"}
              </button>
              <button class="erp-mini-btn danger" type="button" data-coupon-action="remove" data-coupon-id="${coupon.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderSimpleList(containerId, items, action) {
  const container = byId(containerId);
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">Sem itens cadastrados.</p>';
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
      <article class="admin-list-card">
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.description)}</p>
        <button class="erp-mini-btn danger" type="button" data-commercial-action="${action}" data-item-id="${item.id}">Excluir</button>
      </article>
    `,
    )
    .join("");
}

function renderCommercialSection() {
  const pix = getPixSettings();
  const pixKey = byId("pix-key");
  const pixHolder = byId("pix-holder");

  if (pixKey) {
    pixKey.value = pix.pixKey || "";
  }
  if (pixHolder) {
    pixHolder.value = pix.pixHolder || "Casa Verde Pet e Flora";
  }

  renderCouponRows();
  renderSimpleList("promotion-list", listPromotions(), "remove-promotion");
  renderSimpleList(
    "subscription-admin-list",
    listSubscriptionPlans(),
    "remove-subscription",
  );
  renderSimpleList("benefit-list", listBenefits(), "remove-benefit");
}

function setupAdminSearch() {
  const datalist = byId("admin-search-suggestions");
  const input = byId("admin-search-input");
  const form = byId("admin-search-form");

  if (!datalist || !input || !form) {
    return;
  }

  datalist.innerHTML = adminSearchTargets
    .map((item) => `<option value="${item.label}"></option>`)
    .join("");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = String(input.value || "")
      .trim()
      .toLowerCase();
    const found = adminSearchTargets.find(
      (item) => item.label.toLowerCase() === typed,
    );

    if (!found) {
      return;
    }

    if (found.type === "link") {
      navigateTo(found.href);
      return;
    }

    byId(found.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const session = getSession();
  const userLabel = byId("admin-user");
  const logoutBtn = byId("logout-btn");
  const accessForm = byId("access-request-form");
  const accessFeedback = byId("access-request-feedback");
  const migrationForm = byId("migration-form");
  const migrationFeedback = byId("migration-feedback");
  const pixSettingsForm = byId("pix-settings-form");
  const couponForm = byId("coupon-form");
  const promotionForm = byId("promotion-form");
  const subscriptionForm = byId("subscription-form");
  const benefitForm = byId("benefit-form");
  const pixSettingsFeedback = byId("pix-settings-feedback");
  const couponFeedback = byId("coupon-feedback");
  const promotionFeedback = byId("promotion-feedback");
  const subscriptionFeedback = byId("subscription-feedback");
  const benefitFeedback = byId("benefit-feedback");

  if (session && userLabel) {
    userLabel.textContent = `Logado como: ${session.name} (${session.role})`;
  }

  if (migrationFeedback) {
    migrationFeedback.textContent = "Consultando status do Supabase...";
    fetchSupabaseStatus().then((status) => {
      migrationFeedback.textContent = describeSupabaseStatus(status);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      logout();
      navigateTo("login.html");
    });
  }

  accessForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const payload = {
      name: byId("access-name")?.value,
      email: byId("access-email")?.value,
      username: byId("access-email")?.value,
      password: byId("access-password")?.value,
      role: byId("access-role")?.value,
    };

    const result = createAccessRequest(payload);

    if (!result.ok) {
      if (accessFeedback) {
        accessFeedback.textContent = result.message;
      }
      return;
    }

    if (accessFeedback) {
      accessFeedback.textContent = "Solicitacao criada com sucesso.";
    }

    accessForm.reset();
    renderGovernance(session);
  });

  migrationForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const source = byId("migration-source")?.value || "bling_csv";
    const file = byId("migration-file")?.files?.[0];

    if (!file) {
      if (migrationFeedback) {
        migrationFeedback.textContent =
          "Selecione um arquivo CSV ou JSON para migrar.";
      }
      return;
    }

    try {
      const text = await readMigrationFile(file);
      const isJson =
        source === "generic_json" || file.name.toLowerCase().endsWith(".json");
      const rows = isJson ? JSON.parse(text) : parseCsvText(text);

      const genericRows = Array.isArray(rows)
        ? rows
        : Array.isArray(rows?.items)
          ? rows.items
          : [];

      const productRows = Array.isArray(rows?.products)
        ? rows.products
        : genericRows;
      const orderRows = Array.isArray(rows?.orders) ? rows.orders : genericRows;
      const customerRows = Array.isArray(rows?.customers)
        ? rows.customers
        : genericRows;
      const adminRows = Array.isArray(rows?.users) ? rows.users : genericRows;

      if (
        !productRows.length &&
        !orderRows.length &&
        !customerRows.length &&
        !adminRows.length
      ) {
        if (migrationFeedback) {
          migrationFeedback.textContent =
            "Arquivo sem dados válidos para migração.";
        }
        return;
      }

      const importedProducts = normalizeProductRows(productRows);
      const importedOrders = normalizeOrderRows(orderRows);
      const importedCustomers = normalizeCustomerRows(customerRows);
      const importedAdmins = normalizeAdminRows(adminRows);

      const currentImportedProducts = db.read(IMPORTED_PRODUCTS_KEY, []);
      const mergedImportedProducts = mergeByField(
        currentImportedProducts,
        importedProducts,
        "id",
      );
      replaceImportedProducts(mergedImportedProducts);

      const currentOrders = db.read(ORDERS_KEY, []);
      const mergedOrders = mergeByField(currentOrders, importedOrders, "id");
      db.write(ORDERS_KEY, mergedOrders);

      const currentCustomers = db.read(CUSTOMER_USERS_KEY, []);
      const mergedCustomers = mergeByField(
        currentCustomers,
        importedCustomers,
        "email",
      );
      db.write(CUSTOMER_USERS_KEY, mergedCustomers);

      const currentAdmins = db.read(ADMIN_USERS_KEY, []);
      const mergedAdmins = mergeByField(currentAdmins, importedAdmins, "email");
      if (mergedAdmins.length) {
        db.write(ADMIN_USERS_KEY, mergedAdmins);
      }

      const supabaseSync = await syncMigrationToSupabase({
        source,
        payload: {
          products: importedProducts,
          orders: importedOrders,
          customers: importedCustomers,
          users: importedAdmins,
        },
        requestedBy: session?.email || session?.username || "",
      });

      const supabaseMessage = supabaseSync.ok
        ? `Supabase sincronizado na tabela ${supabaseSync.table}.`
        : `Supabase não sincronizado: ${supabaseSync.message || "erro desconhecido"}.`;

      if (migrationFeedback) {
        migrationFeedback.textContent = `Migração concluída: ${importedProducts.length} produtos, ${importedOrders.length} pedidos, ${importedCustomers.length} clientes e ${importedAdmins.length} usuários administrativos importados. ${supabaseMessage}`;
      }

      migrationForm.reset();
      renderMetrics();
      renderOrders();
      renderProductMediaManager();
      renderGovernance(session);
    } catch (error) {
      if (migrationFeedback) {
        migrationFeedback.textContent =
          error instanceof Error
            ? `Falha na migração: ${error.message}`
            : "Falha na migração: arquivo inválido.";
      }
    }
  });

  pixSettingsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const response = savePixSettings({
      pixKey: byId("pix-key")?.value,
      pixHolder: byId("pix-holder")?.value,
    });

    if (pixSettingsFeedback) {
      pixSettingsFeedback.textContent = response.ok
        ? "Configuração PIX salva com sucesso."
        : response.message;
    }

    renderCommercialSection();
  });

  couponForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const response = createCoupon({
      code: byId("coupon-code")?.value,
      type: byId("coupon-type")?.value,
      value: parseNumber(byId("coupon-value")?.value, 0),
      minSubtotal: parseNumber(byId("coupon-min-subtotal")?.value, 0),
      maxDiscount: parseNumber(byId("coupon-max-discount")?.value, 0),
      description: byId("coupon-description")?.value,
      expiresAt: byId("coupon-expires-at")?.value,
    });

    if (couponFeedback) {
      couponFeedback.textContent = response.ok
        ? "Cupom criado com sucesso."
        : response.message;
    }

    if (response.ok) {
      couponForm.reset();
    }

    renderCommercialSection();
  });

  promotionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const response = createPromotion({
      title: byId("promotion-title")?.value,
      description: byId("promotion-description")?.value,
    });

    if (promotionFeedback) {
      promotionFeedback.textContent = response.ok
        ? "Promoção adicionada com sucesso."
        : response.message;
    }

    if (response.ok) {
      promotionForm.reset();
    }

    renderCommercialSection();
  });

  subscriptionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const response = createSubscriptionPlan({
      title: byId("subscription-title")?.value,
      description: byId("subscription-description")?.value,
    });

    if (subscriptionFeedback) {
      subscriptionFeedback.textContent = response.ok
        ? "Plano de assinatura adicionado."
        : response.message;
    }

    if (response.ok) {
      subscriptionForm.reset();
    }

    renderCommercialSection();
  });

  benefitForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const response = createBenefit({
      title: byId("benefit-title")?.value,
      description: byId("benefit-description")?.value,
    });

    if (benefitFeedback) {
      benefitFeedback.textContent = response.ok
        ? "Benefício adicionado ao clube."
        : response.message;
    }

    if (response.ok) {
      benefitForm.reset();
    }

    renderCommercialSection();
  });

  byId("access-approvals-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-request-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.requestAction;
    const requestId = button.dataset.requestId;

    const response =
      action === "approve"
        ? approveAccessRequest(requestId, session)
        : rejectAccessRequest(requestId, session);

    if (accessFeedback) {
      accessFeedback.textContent = response.ok
        ? `Solicitacao ${action === "approve" ? "aprovada" : "rejeitada"} com sucesso.`
        : response.message;
    }

    renderGovernance(session);
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-scroll-target]");
    if (!button) {
      return;
    }

    const target = byId(button.dataset.scrollTarget);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  byId("coupon-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-coupon-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.couponAction;
    const couponId = button.dataset.couponId;
    let response = { ok: false, message: "Ação inválida." };

    if (action === "toggle") {
      response = setCouponActive(
        couponId,
        button.dataset.nextActive === "true",
      );
    }

    if (action === "remove") {
      const removed = removeCoupon(couponId);
      response = removed.ok
        ? { ok: true, message: "Cupom removido." }
        : { ok: false, message: "Cupom não encontrado." };
    }

    if (couponFeedback) {
      couponFeedback.textContent = response.message;
    }

    renderCommercialSection();
  });

  byId("commercial-section")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-commercial-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.commercialAction;
    const itemId = button.dataset.itemId;

    if (action === "remove-promotion") {
      const removed = removePromotion(itemId);
      if (promotionFeedback) {
        promotionFeedback.textContent = removed.ok
          ? "Promoção removida."
          : "Promoção não encontrada.";
      }
    }

    if (action === "remove-subscription") {
      const removed = removeSubscriptionPlan(itemId);
      if (subscriptionFeedback) {
        subscriptionFeedback.textContent = removed.ok
          ? "Plano removido."
          : "Plano não encontrado.";
      }
    }

    if (action === "remove-benefit") {
      const removed = removeBenefit(itemId);
      if (benefitFeedback) {
        benefitFeedback.textContent = removed.ok
          ? "Benefício removido."
          : "Benefício não encontrado.";
      }
    }

    renderCommercialSection();
  });

  byId("orders-list")?.addEventListener("change", (event) => {
    const select = event.target.closest(".order-status-select");
    if (!select) {
      return;
    }

    const response = updateOrderStatus(select.dataset.orderId, select.value);

    if (accessFeedback) {
      accessFeedback.textContent = response.ok
        ? `Status do pedido ${response.order.id.toUpperCase()} atualizado para ${response.order.status}.`
        : response.message;
    }

    renderOrders();
  });

  byId("product-media-list")?.addEventListener("input", async (event) => {
    const card = event.target.closest(".admin-product-media");
    if (!card) {
      return;
    }

    const productId = card.dataset.productId;
    const imageUrlInput = card.querySelector(".product-image-url");
    const videoUrlInput = card.querySelector(".product-video-url");
    const fileInput = card.querySelector(".product-image-file");

    if (event.target.classList.contains("product-image-file")) {
      const file = fileInput.files?.[0];
      if (file) {
        try {
          const dataUrl = await fileToDataUrl(file);
          imageUrlInput.value = dataUrl;
          updateProductMedia(productId, {
            imageUrl: dataUrl,
            videoUrl: videoUrlInput.value,
          });
          renderProductMediaManager();
        } catch {
          if (accessFeedback) {
            accessFeedback.textContent = "Nao foi possivel importar a imagem.";
          }
        }
      }
      return;
    }

    updateProductFields(productId, {
      imageUrl: imageUrlInput.value,
      videoUrl: videoUrlInput.value,
    });
    renderProductMediaManager();
  });

  byId("product-media-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest(".media-save-btn");
    if (!button) {
      return;
    }

    const productId = button.dataset.productId;
    const card = event.target.closest(".admin-product-media");
    const imageUrl = card.querySelector(".product-image-url").value;
    const videoUrl = card.querySelector(".product-video-url").value;
    const fileInput = card.querySelector(".product-image-file");

    let finalImage = imageUrl;

    const file = fileInput.files?.[0];
    if (file) {
      try {
        finalImage = await fileToDataUrl(file);
      } catch {
        if (accessFeedback) {
          accessFeedback.textContent = "Falha ao importar imagem do arquivo.";
        }
        return;
      }
    }

    updateProductMedia(productId, {
      imageUrl: finalImage,
      videoUrl,
    });

    if (accessFeedback) {
      accessFeedback.textContent =
        "Midia do produto atualizada e sincronizada na loja.";
    }

    renderProductMediaManager();
  });

  renderMetrics();
  renderOrders();
  renderProductMediaManager();
  renderAudit();
  renderGovernance(session);
  renderCommercialSection();
  setupAdminSearch();
});
