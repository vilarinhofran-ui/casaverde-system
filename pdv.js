import { db } from "./core/db.js";
import { getSession, ROLE } from "./core/auth.js";
import { requireAuth } from "./core/router.js";
import {
  confirmPaymentByWebhookOrProvider,
  createExternalCheckout,
  inferProviderFromMethod,
  paymentProviderConfigSummary,
  registerWebhookEvent,
} from "./core/payments.js";
import {
  adjustProductStock,
  getProductByBarcode,
  getProductById,
  listProducts,
} from "./modules/products.js";
import { logEvent } from "./modules/audit.js";

const ORDERS_KEY = "casaverde_orders";
const PDV_TRANSACTIONS_KEY = "casaverde_pdv_transactions";
const PDV_STOCK_HISTORY_KEY = "casaverde_pdv_stock_history";
const PDV_THEME_KEY = "casaverde_pdv_theme";
const PDV_PAYMENT_TRACKING_KEY = "casaverde_pdv_payment_tracking";

if (!requireAuth()) {
  throw new Error("Acesso negado");
}

const SALE_STATUS = {
  PENDING: "PENDENTE",
  PROCESSING: "EM PROCESSAMENTO",
  CONFIRMED: "CONFIRMADO",
  FINALIZED: "FINALIZADO",
  CANCELED: "CANCELADO",
};

const paymentLabels = {
  dinheiro: "Dinheiro",
  cartao_debito: "Cartao debito",
  cartao_credito: "Cartao credito",
  pix_presencial: "PIX presencial",
  maquineta_stone: "Stone (TEF/SmartPOS)",
  maquineta_cielo: "Cielo Lio",
  maquineta_pagseguro: "PagSeguro Moderninha",
  maquineta_sumup: "SumUp",
  pix_qrcode: "PIX QR Code",
  link_pagamento: "Link de pagamento",
  gateway: "Gateway",
};

const fiscalDocLabels = {
  NFE: "NF-e",
  NFCE: "NFC-e",
  RECEIPT: "Comprovante fiscal",
  INTERNAL: "Controle interno",
};

const ROLE_PERMISSIONS = {
  [ROLE.CAIXA]: {
    setPending: true,
    setProcessing: true,
    confirmPayment: true,
    cancelSale: false,
  },
  [ROLE.SUPERVISOR]: {
    setPending: true,
    setProcessing: true,
    confirmPayment: true,
    cancelSale: true,
  },
  [ROLE.ADMIN]: {
    setPending: true,
    setProcessing: true,
    confirmPayment: true,
    cancelSale: true,
  },
  [ROLE.SUPER_ADMIN]: {
    setPending: true,
    setProcessing: true,
    confirmPayment: true,
    cancelSale: true,
  },
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

const apiAdapters = {
  payments: {
    async requestPayment(context) {
      const provider = inferProviderFromMethod(context.paymentMethod);

      const checkout = await createExternalCheckout({
        provider,
        transactionId: context.transactionId,
        amount: context.total,
        customer: context.customerName,
        paymentMethod: context.paymentMethod,
      });

      if (!checkout.ok) {
        return checkout;
      }

      db.update(PDV_PAYMENT_TRACKING_KEY, [], (current) => [
        {
          id: db.uid("pay"),
          transactionId: context.transactionId,
          provider: checkout.provider,
          paymentId: checkout.paymentId,
          checkoutUrl: checkout.checkoutUrl,
          mode: checkout.mode,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);

      return {
        ok: true,
        provider: checkout.provider,
        paymentId: checkout.paymentId,
        checkoutUrl: checkout.checkoutUrl,
        mode: checkout.mode,
      };
    },
    async validatePayment(context) {
      const provider = inferProviderFromMethod(context.paymentMethod);

      if (provider === "local") {
        return { ok: true, providerRef: `local-${context.transactionId}` };
      }

      const result = await confirmPaymentByWebhookOrProvider({
        transactionId: context.transactionId,
        provider,
        paymentId: context.paymentId,
      });

      if (!result.ok) {
        return {
          ok: false,
          message:
            result.message ||
            "Pagamento online ainda nao confirmado por webhook/provedor.",
        };
      }

      return {
        ok: true,
        providerRef: `${provider}-${context.paymentId}`,
      };
    },
  },
  stock: {
    async syncMovement(_movement) {
      return { ok: true };
    },
  },
  customers: {
    async syncCustomer(_payload) {
      return { ok: true };
    },
  },
  whatsapp: {
    async notify(_message) {
      return { ok: true };
    },
  },
  exports: {
    async queue(_payload) {
      return { ok: true };
    },
  },
};

const state = {
  mode: "sale",
  saleStatus: SALE_STATUS.PENDING,
  paymentMethod: "dinheiro",
  fiscalDocumentType: "NFE",
  cart: [],
  customerName: "",
  currentUser: getSession(),
};

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePrintKind(kind = "nf") {
  const safeKind = String(kind || "nf")
    .trim()
    .toLowerCase();

  if (["nf", "nfe", "nf-e", "nfce", "nfc-e"].includes(safeKind)) {
    return "nf";
  }

  if (["recibo", "receipt"].includes(safeKind)) {
    return "recibo";
  }

  if (["comprovante", "voucher"].includes(safeKind)) {
    return "comprovante";
  }

  return "nf";
}

function resolvePrintLabel(kind = "nf") {
  const normalizedKind = normalizePrintKind(kind);
  return normalizedKind === "recibo"
    ? "Recibo"
    : normalizedKind === "comprovante"
      ? "Comprovante"
      : "NF";
}

function printHtmlInIframe(html) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);

  const doc = frame.contentWindow?.document;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const runPrint = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      window.setTimeout(() => frame.remove(), 1000);
    }
  };

  if (doc.readyState === "complete") {
    runPrint();
  } else {
    frame.onload = runPrint;
  }

  return true;
}

function buildPrintableDocument(title, transaction, kind = "nf") {
  const normalizedKind = normalizePrintKind(kind);
  const heading =
    normalizedKind === "recibo"
      ? "Recibo"
      : normalizedKind === "comprovante"
        ? "Comprovante"
        : "Nota fiscal";

  const rows = (transaction.items || [])
    .map((item) => {
      const product = getProductById(item.productId);
      const itemName = product?.name || item.productId;
      const unitPrice = Number(item.unitPrice || product?.price || 0);
      const quantity = Number(item.quantity || 0);
      const subtotal = unitPrice * quantity;

      return `
        <tr>
          <td>${escapeHtml(itemName)}</td>
          <td>${quantity.toFixed(3)}</td>
          <td>${currency.format(unitPrice)}</td>
          <td>${currency.format(subtotal)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Manrope, Arial, sans-serif; margin: 24px; color: #1a2722; }
          h1 { margin: 0 0 8px; color: #1f6b45; }
          h2 { margin: 0 0 16px; font-size: 1.05rem; color: #35574a; }
          .meta { margin-bottom: 14px; line-height: 1.45; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #d7e1d8; padding: 8px; text-align: left; }
          th { background: #eef8f2; }
          .total { margin-top: 14px; font-weight: 800; }
        </style>
      </head>
      <body>
        <h1>Casa Verde Pet e Flora</h1>
        <h2>${escapeHtml(heading)}</h2>
        <div class="meta">
          <div><strong>ID:</strong> ${escapeHtml(String(transaction.id || "").toUpperCase())}</div>
          <div><strong>Data:</strong> ${escapeHtml(dateTime.format(new Date(transaction.createdAt || new Date().toISOString())))}</div>
          <div><strong>Cliente:</strong> ${escapeHtml(transaction.customerName || "Cliente Casa Verde")}</div>
          <div><strong>Pagamento:</strong> ${escapeHtml(paymentLabels[transaction.paymentMethod] || transaction.paymentMethod || "-")}</div>
          <div><strong>Documento:</strong> ${escapeHtml(fiscalDocLabels[transaction.fiscalDocumentType] || transaction.fiscalDocumentType || "-")}</div>
          <div><strong>Status:</strong> ${escapeHtml(transaction.status || "-")}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qtd</th>
              <th>Unitario</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4">Sem itens</td></tr>'}
          </tbody>
        </table>

        <p class="total">Total: ${currency.format(Number(transaction.total || 0))}</p>
      </body>
    </html>
  `;
}

function printTransactionDocument(transactionId, kind = "nf") {
  const transaction = getTransactions().find((tx) => tx.id === transactionId);
  if (!transaction) {
    setFeedback("Transacao nao encontrada para impressao.");
    showToast("Nao foi possivel imprimir", "error");
    return;
  }

  const normalizedKind = normalizePrintKind(kind);
  const kindLabel = resolvePrintLabel(normalizedKind);
  const title = `${kindLabel} ${String(transaction.id).toUpperCase()}`;
  const html = buildPrintableDocument(title, transaction, normalizedKind);

  if (!printHtmlInIframe(html)) {
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) {
      setFeedback("Permita popups para imprimir documentos.");
      showToast("Bloqueio de popup detectado", "error");
      return;
    }

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.onload = () => popup.print();
  }

  setFeedback(
    `${kindLabel} pronto para impressao: ${String(transaction.id).toUpperCase()}.`,
  );
}

function showToast(message, type = "info") {
  const host = el("toast-host");
  if (!host) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  host.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("hide");
    window.setTimeout(() => toast.remove(), 180);
  }, 2200);
}

function setFeedback(message) {
  const feedback = el("pdv-feedback");
  if (feedback) {
    feedback.textContent = message;
  }
}

function normalizeQty(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Number(parsed.toFixed(3));
}

function isMaquinetaMethod(method) {
  return String(method || "").startsWith("maquineta_");
}

function getPermissionSet() {
  const role = state.currentUser?.role || ROLE.CAIXA;
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[ROLE.CAIXA];
}

function can(permissionKey) {
  return Boolean(getPermissionSet()[permissionKey]);
}

function getPermissionCatalog() {
  return [
    { key: "setPending", label: "PENDENTE" },
    { key: "setProcessing", label: "EM PROCESSAMENTO" },
    { key: "confirmPayment", label: "CONFIRMAR PAGAMENTO" },
    { key: "cancelSale", label: "CANCELAR" },
  ];
}

function renderPermissionPanel() {
  const summary = el("pdv-permission-summary");
  const chipsHost = el("pdv-permission-chips");

  if (!summary || !chipsHost) {
    return;
  }

  const role = state.currentUser?.role || ROLE.CAIXA;
  const permissionSet = getPermissionSet();
  const catalog = getPermissionCatalog();
  const allowedCount = catalog.filter(
    (entry) => permissionSet[entry.key],
  ).length;

  summary.textContent = `Perfil ${role} com ${allowedCount}/${catalog.length} permissoes ativas.`;
  chipsHost.innerHTML = catalog
    .map((entry) => {
      const active = Boolean(permissionSet[entry.key]);
      return `<span class="pdv-permission-chip ${active ? "allowed" : "blocked"}">${entry.label}: ${active ? "LIBERADO" : "BLOQUEADO"}</span>`;
    })
    .join("");
}

function ensurePermission(permissionKey, denyMessage) {
  if (can(permissionKey)) {
    return true;
  }

  setFeedback(denyMessage);
  showToast("Permissao insuficiente", "error");
  return false;
}

function getTransactions() {
  return db.read(PDV_TRANSACTIONS_KEY, []);
}

function persistTransaction(transaction) {
  db.update(PDV_TRANSACTIONS_KEY, [], (current) =>
    [transaction, ...current].slice(0, 300),
  );
}

function getStockHistory() {
  return db.read(PDV_STOCK_HISTORY_KEY, []);
}

function pushStockHistory(entry) {
  db.update(PDV_STOCK_HISTORY_KEY, [], (current) =>
    [entry, ...current].slice(0, 500),
  );
}

function updateSaleStatus(nextStatus) {
  state.saleStatus = nextStatus;
  const pill = el("sale-status-pill");
  if (pill) {
    pill.textContent = nextStatus;
  }
}

function getUnitLabel(product) {
  return product.unit || "UN";
}

function findCartItem(productId) {
  return state.cart.find((item) => item.productId === productId) || null;
}

function addItemToCart(product, quantity, source = "manual") {
  const qty = normalizeQty(quantity);

  if (state.mode === "sale" && product.stock < qty) {
    setFeedback("Estoque insuficiente para venda.");
    showToast("Sem estoque suficiente", "error");
    return;
  }

  const existing = findCartItem(product.id);
  if (existing) {
    existing.quantity = Number((existing.quantity + qty).toFixed(3));
  } else {
    state.cart.push({
      productId: product.id,
      quantity: qty,
      source,
    });
  }

  if (state.mode === "sale" && state.saleStatus === SALE_STATUS.CANCELED) {
    updateSaleStatus(SALE_STATUS.PENDING);
  }

  renderCart();
  showToast(`${product.name} adicionado`, "success");
}

function getLineData(item) {
  const product = getProductById(item.productId);
  if (!product) {
    return null;
  }

  const subtotal = Number((product.price * item.quantity).toFixed(2));
  return {
    ...item,
    product,
    subtotal,
  };
}

function getCartSummary() {
  const lines = state.cart.map(getLineData).filter(Boolean);
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);

  return {
    lines,
    subtotal,
    total: subtotal,
  };
}

function renderKpis(summary = getCartSummary()) {
  const modeEl = el("kpi-mode");
  const paymentEl = el("kpi-payment");
  const itemsEl = el("kpi-items");
  const roleEl = el("kpi-role");

  if (modeEl) {
    modeEl.textContent = state.mode === "sale" ? "Venda" : "Entrada";
  }

  if (paymentEl) {
    paymentEl.textContent =
      paymentLabels[state.paymentMethod] || state.paymentMethod;
  }

  if (itemsEl) {
    const itemCount = summary.lines.reduce(
      (sum, line) => sum + line.quantity,
      0,
    );
    itemsEl.textContent = Number(itemCount).toFixed(3);
  }

  if (roleEl) {
    roleEl.textContent = state.currentUser?.role || "nao identificado";
  }
}

function renderCart() {
  const list = el("pdv-cart-list");
  const summary = getCartSummary();

  if (!list) {
    return;
  }

  if (summary.lines.length === 0) {
    list.innerHTML =
      '<p class="empty-state">Carrinho vazio. Bipe ou adicione itens.</p>';
  } else {
    list.innerHTML = summary.lines
      .map(
        (line) => `
        <article class="pdv-cart-item" data-product-id="${line.product.id}">
          <div>
            <h3>${line.product.name}</h3>
            <p>
              Cod. barras: ${line.product.barcode || "-"} |
              Estoque atual: ${line.product.stock.toFixed(3)} ${getUnitLabel(line.product)}
            </p>
          </div>
          <div class="pdv-cart-controls">
            <button class="qty-btn" data-qty-action="decrease" data-product-id="${line.product.id}" type="button">-</button>
            <span>${line.quantity.toFixed(3)} ${getUnitLabel(line.product)}</span>
            <button class="qty-btn" data-qty-action="increase" data-product-id="${line.product.id}" type="button">+</button>
            <strong>${currency.format(line.subtotal)}</strong>
            <button class="remove-btn" data-remove-item="${line.product.id}" type="button">Remover</button>
          </div>
        </article>
      `,
      )
      .join("");
  }

  const subtotalEl = el("totals-subtotal");
  const totalEl = el("totals-total");

  if (subtotalEl) {
    subtotalEl.textContent = currency.format(summary.subtotal);
  }
  if (totalEl) {
    totalEl.textContent = currency.format(summary.total);
  }

  renderKpis(summary);
}

function clearOperation() {
  state.cart = [];
  if (state.mode === "sale") {
    updateSaleStatus(SALE_STATUS.PENDING);
  }
  renderCart();
}

function persistOrderFromSale(transaction) {
  const order = {
    id: transaction.id,
    createdAt: transaction.createdAt,
    status: "Recebido",
    customerName: transaction.customerName || "Cliente Casa Verde",
    paymentMethod:
      paymentLabels[transaction.paymentMethod] || transaction.paymentMethod,
    notes: `PDV: ${transaction.status}`,
    sourceModule: "pdv",
    fiscalDocumentType: transaction.fiscalDocumentType || "NFE",
    items: transaction.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
    totals: {
      subtotal: transaction.total,
      shipping: 0,
      discount: 0,
      total: transaction.total,
      itemsCount: transaction.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
    },
  };

  db.update(ORDERS_KEY, [], (current) => [order, ...current]);
}

function adjustSaleStock(transaction) {
  transaction.items.forEach((item) => {
    const product = getProductById(item.productId);
    if (!product) {
      return;
    }

    adjustProductStock(item.productId, -item.quantity);

    pushStockHistory({
      id: db.uid("stk"),
      createdAt: new Date().toISOString(),
      movement: "SAIDA",
      productId: item.productId,
      productName: product.name,
      quantity: item.quantity,
      unit: getUnitLabel(product),
      resultingStock: Number((product.stock - item.quantity).toFixed(3)),
      transactionId: transaction.id,
    });
  });
}

function adjustEntryStock(transaction) {
  transaction.items.forEach((item) => {
    const product = getProductById(item.productId);
    if (!product) {
      return;
    }

    adjustProductStock(item.productId, item.quantity);

    pushStockHistory({
      id: db.uid("stk"),
      createdAt: new Date().toISOString(),
      movement: "ENTRADA",
      productId: item.productId,
      productName: product.name,
      quantity: item.quantity,
      unit: getUnitLabel(product),
      resultingStock: Number((product.stock + item.quantity).toFixed(3)),
      transactionId: transaction.id,
    });
  });
}

function canFinalizeSale() {
  if (state.saleStatus !== SALE_STATUS.CONFIRMED) {
    setFeedback("Venda precisa estar CONFIRMADA para finalizar.");
    showToast("Pagamento nao confirmado", "error");
    return false;
  }
  return true;
}

async function finalizeOperation() {
  const summary = getCartSummary();

  if (summary.lines.length === 0) {
    setFeedback("Carrinho vazio.");
    showToast("Adicione itens antes de finalizar", "error");
    return;
  }

  if (state.mode === "sale" && !canFinalizeSale()) {
    return;
  }

  if (state.mode === "sale") {
    for (const line of summary.lines) {
      if (line.product.stock < line.quantity) {
        setFeedback(`Estoque insuficiente para ${line.product.name}.`);
        showToast("Saldo insuficiente", "error");
        return;
      }
    }
  }

  const transaction = {
    id: db.uid(state.mode === "sale" ? "sale" : "ent"),
    createdAt: new Date().toISOString(),
    mode: state.mode,
    status: SALE_STATUS.FINALIZED,
    paymentMethod:
      state.mode === "sale" ? state.paymentMethod : "nao_aplicavel",
    fiscalDocumentType:
      state.mode === "sale" ? state.fiscalDocumentType : "INTERNAL",
    customerName: state.customerName || "Cliente Casa Verde",
    total: summary.total,
    items: summary.lines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      unitPrice: line.product.price,
      unit: getUnitLabel(line.product),
    })),
  };

  if (state.mode === "sale") {
    const paymentRequest = await apiAdapters.payments.requestPayment({
      transactionId: transaction.id,
      paymentMethod: state.paymentMethod,
      customerName: transaction.customerName,
      total: transaction.total,
    });

    if (!paymentRequest.ok) {
      setFeedback(paymentRequest.message || "Falha ao iniciar pagamento.");
      showToast("Erro no checkout", "error");
      return;
    }

    const validation = await apiAdapters.payments.validatePayment({
      transactionId: transaction.id,
      paymentMethod: state.paymentMethod,
      paymentId: paymentRequest.paymentId,
    });

    if (!validation.ok) {
      setFeedback(validation.message);
      showToast("Pagamento online ainda nao confirmado", "error");
      return;
    }

    adjustSaleStock(transaction);
    persistOrderFromSale(transaction);
    await apiAdapters.customers.syncCustomer({
      name: transaction.customerName,
    });
  } else {
    adjustEntryStock(transaction);
    await apiAdapters.stock.syncMovement(transaction);
  }

  persistTransaction(transaction);
  await apiAdapters.exports.queue({ type: "transaction", id: transaction.id });
  await apiAdapters.whatsapp.notify(`Operacao ${transaction.id} finalizada`);

  logEvent("pdv_transaction_finalized", {
    transactionId: transaction.id,
    mode: state.mode,
    total: transaction.total,
    role: state.currentUser?.role,
  });

  setFeedback(
    `Operacao ${transaction.id.toUpperCase()} finalizada com sucesso.`,
  );
  showToast("Operacao finalizada", "success");
  clearOperation();
  renderHistories();
}

function updateStatusButtons() {
  const pending = el("status-pending");
  const processing = el("status-processing");
  const confirm = el("status-confirm");
  const cancel = el("status-cancel");

  const isSale = state.mode === "sale";
  if (!pending || !processing || !confirm || !cancel) {
    return;
  }

  pending.disabled = !isSale || !can("setPending");
  processing.disabled = !isSale || !can("setProcessing");
  confirm.disabled = !isSale || !can("confirmPayment");
  cancel.disabled = !isSale || !can("cancelSale");
  renderPermissionPanel();
}

function renderHistories() {
  const movementBody = el("movement-history");
  const stockBody = el("stock-history");

  if (!movementBody || !stockBody) {
    return;
  }

  const transactions = getTransactions();
  const stockHistory = getStockHistory();

  movementBody.innerHTML = transactions.length
    ? transactions
        .slice(0, 20)
        .map(
          (tx) => `
          <tr>
            <td>${tx.id.toUpperCase()}</td>
            <td>${tx.mode === "sale" ? "Venda" : "Entrada"}</td>
            <td>${tx.status}</td>
            <td>${paymentLabels[tx.paymentMethod] || "-"}</td>
            <td>${fiscalDocLabels[tx.fiscalDocumentType] || "-"}</td>
            <td>${currency.format(tx.total)}</td>
            <td>${dateTime.format(new Date(tx.createdAt))}</td>
            <td>
              <div class="erp-option-actions">
                <button class="erp-mini-btn" data-print-tx="${tx.id}" data-print-kind="nf" type="button">NF</button>
                <button class="erp-mini-btn" data-print-tx="${tx.id}" data-print-kind="recibo" type="button">Recibo</button>
                <button class="erp-mini-btn" data-print-tx="${tx.id}" data-print-kind="comprovante" type="button">Comprovante</button>
              </div>
            </td>
          </tr>
        `,
        )
        .join("")
    : '<tr><td colspan="8">Sem movimentacoes registradas.</td></tr>';

  stockBody.innerHTML = stockHistory.length
    ? stockHistory
        .slice(0, 20)
        .map(
          (item) => `
          <tr>
            <td>${dateTime.format(new Date(item.createdAt))}</td>
            <td>${item.productName}</td>
            <td>${item.movement}</td>
            <td>${Number(item.quantity).toFixed(3)}</td>
            <td>${item.unit}</td>
            <td>${Number(item.resultingStock).toFixed(3)}</td>
          </tr>
        `,
        )
        .join("")
    : '<tr><td colspan="6">Sem historico de estoque.</td></tr>';
}

function renderProductOptions() {
  const select = el("pdv-product");
  if (!select) {
    return;
  }

  const products = listProducts();
  select.innerHTML = products
    .map(
      (product) => `
      <option value="${product.id}">
        ${product.name} | ${currency.format(product.price)} | ${product.stock.toFixed(3)} ${getUnitLabel(product)} | CB ${product.barcode}
      </option>
    `,
    )
    .join("");
}

function setMode(nextMode) {
  state.mode = nextMode;

  if (nextMode === "entry") {
    updateSaleStatus(SALE_STATUS.FINALIZED);
    setFeedback("Modo entrada: estoque atualiza imediatamente ao finalizar.");
  } else {
    updateSaleStatus(SALE_STATUS.PENDING);
    setFeedback("Modo venda: confirme pagamento para finalizar.");
  }

  updateStatusButtons();
  renderKpis();
}

function scanBarcodeAndAdd() {
  const barcode = String(el("barcode-input")?.value || "").trim();
  const qty = normalizeQty(el("pdv-quantity")?.value);

  if (!barcode) {
    setFeedback("Informe o codigo de barras.");
    return;
  }

  const product = getProductByBarcode(barcode);
  if (!product) {
    setFeedback("Produto nao encontrado para este codigo.");
    showToast("Barcode nao cadastrado", "error");
    return;
  }

  addItemToCart(product, qty, "barcode");
  const barcodeInput = el("barcode-input");
  if (barcodeInput) {
    barcodeInput.value = "";
  }
}

function addSelectedProduct() {
  const productId = String(el("pdv-product")?.value || "");
  const qty = normalizeQty(el("pdv-quantity")?.value);
  const product = getProductById(productId);

  if (!product) {
    setFeedback("Produto invalido.");
    return;
  }

  addItemToCart(product, qty, "manual");
}

function focusBarcode() {
  const barcode = el("barcode-input");
  if (!barcode) {
    return;
  }
  barcode.focus();
  barcode.select();
}

async function confirmPaymentAction() {
  if (!getCartSummary().lines.length) {
    setFeedback("Adicione itens antes de confirmar pagamento.");
    showToast("Carrinho vazio", "error");
    return;
  }

  if (isMaquinetaMethod(state.paymentMethod)) {
    updateSaleStatus(SALE_STATUS.CONFIRMED);
    setFeedback(
      `Pagamento em ${paymentLabels[state.paymentMethod]} confirmado no terminal.`,
    );
    showToast("Pagamento da maquineta confirmado", "success");
    return;
  }

  const previewTxId = db.uid("preview");
  const checkout = await apiAdapters.payments.requestPayment({
    transactionId: previewTxId,
    paymentMethod: state.paymentMethod,
    customerName: state.customerName || "Cliente Casa Verde",
    total: getCartSummary().total,
  });

  if (!checkout.ok) {
    setFeedback(checkout.message || "Falha ao iniciar checkout.");
    showToast("Falha no checkout", "error");
    return;
  }

  if (checkout.checkoutUrl) {
    setFeedback(
      `Checkout ${checkout.provider} criado. Aguarde webhook para confirmar e finalize depois.`,
    );
    showToast("Checkout online iniciado", "info");
    return;
  }

  updateSaleStatus(SALE_STATUS.CONFIRMED);
  showToast("Pagamento confirmado", "success");
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const targetTag = String(event.target?.tagName || "").toLowerCase();
    const isTypingField =
      targetTag === "input" ||
      targetTag === "textarea" ||
      targetTag === "select";

    if (event.key === "F2") {
      event.preventDefault();
      focusBarcode();
      return;
    }

    if (event.key === "F3") {
      event.preventDefault();
      addSelectedProduct();
      return;
    }

    if (event.key === "F6") {
      event.preventDefault();
      confirmPaymentAction();
      return;
    }

    if (event.key === "F8") {
      event.preventDefault();
      el("finalize-button")?.click();
      return;
    }

    if (!isTypingField && event.ctrlKey && event.key === "Backspace") {
      event.preventDefault();
      const last = state.cart[state.cart.length - 1];
      if (last) {
        removeItem(last.productId);
        showToast("Ultimo item removido", "info");
      }
    }
  });
}

function updateItemQty(productId, action) {
  const item = findCartItem(productId);
  const product = getProductById(productId);

  if (!item || !product) {
    return;
  }

  if (action === "increase") {
    const nextQty = Number((item.quantity + 1).toFixed(3));
    if (state.mode === "sale" && nextQty > product.stock) {
      showToast("Nao pode exceder saldo de estoque", "error");
      return;
    }
    item.quantity = nextQty;
  }

  if (action === "decrease") {
    item.quantity = Number((item.quantity - 1).toFixed(3));
    if (item.quantity <= 0) {
      state.cart = state.cart.filter((line) => line.productId !== productId);
    }
  }

  renderCart();
}

function removeItem(productId) {
  state.cart = state.cart.filter((item) => item.productId !== productId);
  renderCart();
}

function applyTheme(theme) {
  document.body.classList.toggle("pdv-dark", theme === "dark");
}

function toggleTheme() {
  const current = db.read(PDV_THEME_KEY, "light");
  const next = current === "light" ? "dark" : "light";
  db.write(PDV_THEME_KEY, next);
  applyTheme(next);
  showToast(`Tema ${next === "dark" ? "escuro" : "claro"} ativado`, "info");
}

function bindEvents() {
  el("movement-mode")?.addEventListener("change", (event) => {
    setMode(event.target.value);
  });

  el("pdv-customer")?.addEventListener("input", (event) => {
    state.customerName = event.target.value;
  });

  el("pdv-payment")?.addEventListener("change", (event) => {
    state.paymentMethod = event.target.value;
    renderKpis();
  });

  el("pdv-fiscal-doc")?.addEventListener("change", (event) => {
    state.fiscalDocumentType = event.target.value;
  });

  el("scan-button")?.addEventListener("click", scanBarcodeAndAdd);

  el("barcode-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      scanBarcodeAndAdd();
    }
  });

  el("pdv-quantity")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSelectedProduct();
    }
  });

  el("pdv-product")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSelectedProduct();
    }
  });

  el("add-manual-item")?.addEventListener("click", addSelectedProduct);

  document.querySelectorAll("button[data-quick-qty]").forEach((button) => {
    button.addEventListener("click", () => {
      const qty = String(button.dataset.quickQty || "1");
      const qtyInput = el("pdv-quantity");
      if (qtyInput) {
        qtyInput.value = qty;
        qtyInput.focus();
      }
    });
  });

  el("status-pending")?.addEventListener("click", () => {
    if (
      !ensurePermission(
        "setPending",
        "Apenas supervisor/admin podem alterar para pendente.",
      )
    ) {
      return;
    }
    updateSaleStatus(SALE_STATUS.PENDING);
  });

  el("status-processing")?.addEventListener("click", () => {
    if (
      !ensurePermission(
        "setProcessing",
        "Apenas supervisor/admin podem alterar para processamento.",
      )
    ) {
      return;
    }
    updateSaleStatus(SALE_STATUS.PROCESSING);
  });

  el("status-cancel")?.addEventListener("click", () => {
    if (
      !ensurePermission(
        "cancelSale",
        "Apenas supervisor/admin podem cancelar vendas.",
      )
    ) {
      return;
    }
    updateSaleStatus(SALE_STATUS.CANCELED);
  });

  el("status-confirm")?.addEventListener("click", confirmPaymentAction);

  el("shortcut-focus-barcode")?.addEventListener("click", focusBarcode);
  el("shortcut-add-selected")?.addEventListener("click", addSelectedProduct);
  el("shortcut-confirm")?.addEventListener("click", confirmPaymentAction);
  el("shortcut-finalize")?.addEventListener("click", () => {
    el("finalize-button")?.click();
  });

  el("finalize-button")?.addEventListener("click", async () => {
    const button = el("finalize-button");
    if (!button) {
      return;
    }

    button.disabled = true;
    button.textContent = "Processando...";

    try {
      await finalizeOperation();
      renderProductOptions();
    } finally {
      button.disabled = false;
      button.textContent = "Finalizar operacao";
    }
  });

  el("pdv-cart-list")?.addEventListener("click", (event) => {
    const qtyButton = event.target.closest("button[data-qty-action]");
    if (qtyButton) {
      updateItemQty(qtyButton.dataset.productId, qtyButton.dataset.qtyAction);
      return;
    }

    const removeButton = event.target.closest("button[data-remove-item]");
    if (removeButton) {
      removeItem(removeButton.dataset.removeItem);
    }
  });

  el("movement-history")?.addEventListener("click", (event) => {
    const printButton = event.target.closest("button[data-print-tx]");
    if (!printButton) {
      return;
    }

    const txId = String(printButton.dataset.printTx || "");
    const kind = normalizePrintKind(printButton.dataset.printKind || "nf");
    if (!txId) {
      return;
    }

    printTransactionDocument(txId, kind);
  });

  el("toggle-theme")?.addEventListener("click", toggleTheme);

  // Utilitario para testes de webhook em ambiente sem backend:
  // window.__pdvWebhookConfirm({ transactionId: 'sale_x', provider: 'stripe', paymentId: 'pi_x', status: 'confirmed' })
  window.__pdvWebhookConfirm = (payload) => registerWebhookEvent(payload);
}

function init() {
  const savedTheme = db.read(PDV_THEME_KEY, "light");
  applyTheme(savedTheme);

  const operator = state.currentUser
    ? `Operador: ${state.currentUser.name} (${state.currentUser.role})`
    : "Operador nao identificado";
  setFeedback(operator);

  const providerSummary = paymentProviderConfigSummary();
  const paymentStatusEl = el("api-payment-status");
  if (paymentStatusEl) {
    paymentStatusEl.textContent = `Stripe ${providerSummary.stripe.createCheckoutUrl} | MP ${providerSummary.mercadoPago.createCheckoutUrl} | Maquinetas: Stone/Cielo/PagSeguro/SumUp em modo terminal local`;
  }

  renderProductOptions();
  renderCart();
  renderHistories();
  setMode("sale");
  renderKpis();
  bindEvents();
  bindKeyboardShortcuts();
  focusBarcode();

  logEvent("pdv_opened", {
    page: "pdv",
    mode: state.mode,
    role: state.currentUser?.role,
  });
}

document.addEventListener("DOMContentLoaded", init);
