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
  updateProductFields,
  updateProductMedia,
} from "./modules/products.js";
import { listAuditLogs } from "./modules/audit.js";
import {
  ORDER_STATUS_OPTIONS,
  listSales,
  updateOrderStatus,
} from "./modules/sales.js";

if (!requireAuth()) {
  throw new Error("Acesso negado");
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function byId(id) {
  return document.getElementById(id);
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

document.addEventListener("DOMContentLoaded", () => {
  const session = getSession();
  const userLabel = byId("admin-user");
  const logoutBtn = byId("logout-btn");
  const accessForm = byId("access-request-form");
  const accessFeedback = byId("access-request-feedback");

  if (session && userLabel) {
    userLabel.textContent = `Logado como: ${session.name} (${session.role})`;
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
});
