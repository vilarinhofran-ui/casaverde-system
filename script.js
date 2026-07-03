import {
  filterProducts,
  getProductById,
  listCategories,
  listProducts,
  listSpecies,
} from "./modules/products.js";
import { logEvent } from "./modules/audit.js";
import {
  getPixSettings,
  listBenefits,
  listPromotions,
  listSubscriptionPlans,
} from "./modules/commerce.js";
import {
  ORDER_STATUS_OPTIONS,
  addToCart,
  applyCoupon,
  calculateTotals,
  getActiveCoupon,
  getCart,
  listOrdersByCustomerId,
  listSales,
  placeOrder,
  removeFromCart,
  updateCartItem,
} from "./modules/sales.js";
import {
  getCustomerSession,
  getFavorites,
  isFavorite,
  loginCustomerAccount,
  logoutCustomerAccount,
  registerCustomerAccount,
  toggleFavorite,
} from "./modules/users.js";
import { getOAuthLaunchResult, loadPublicOAuthConfig } from "./core/oauth.js";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const state = {
  filters: {
    query: "",
    species: "",
    category: "",
    sortBy: "relevance",
    maxPrice: 350,
    inStockOnly: false,
    favoritesOnly: false,
  },
};

const SAFE_MEDIA_PROTOCOLS = ["http:", "https:", "data:"];
const OAUTH_FLASH_KEY = "casaverde_oauth_flash";
const REVIEWS_KEY = "casaverde_google_reviews_local";
const searchSuggestionIndex = new Map();
const GOOGLE_REVIEW_URL =
  "https://www.google.com/search?q=casa+verde+E+FLORA&sca_esv=05ee508a17931f71&sxsrf=APpeQnt5XiVImOga6rlVUvu_nGYid4Tw-g%3A1782938568935&ei=yHtFarLBOPmp1sQP_5OZmAs&biw=1280&bih=551&ved=0ahUKEwiyxbrgq7KVAxX5lJUCHf9JBrMQ4dUDCBI&uact=5&oq=casa+verde+E+FLORA&gs_lp=Egxnd3Mtd2l6LXNlcnAiEmNhc2EgdmVyZGUgRSBGTE9SQTIGEAAYFhgeMgYQABgWGB4yBhAAGBYYHjIFEAAY7wVIgBtQvQNYtxdwAngBkAEAmAG1AaABlwqqAQMwLjm4AQPIAQD4AQGYAgugAtkKwgIKEAAYRxjWBBiwA8ICDRAAGIAEGIoFGEMYsAPCAg4QABjkAhjWBBiwA9gBAcICExAuGEMYgAQYigUYyAMYsAPYAQHCAhMQLhiABBiKBRhDGMgDGLAD2AEBwgIFEAAYgATCAg4QLhivARjHARiABBiOBcICCxAuGK8BGMcBGIAEwgIKEAAYgAQYigUYQ8ICCxAuGIAEGMcBGK8BwgIKEAAYgAQYFBiHAsICCBAAGAgYHhgNmAMAiAYBkAYRugYGCAEQARgJkgcDMi45oAfjPbIHAzAuObgHyQrCBwcwLjEuOC4yyAcygAgB&sclient=gws-wiz-serp#sv=CAESzQEKuQEStgEKd0FKaVQ0dEk5MEZPU1c3OEFNUkNlRHVkVDJLbDZZY3VaOGZfcHFuYzlrRHQ4VFlvWWFDUVJPaDZVWTBVUG5tUVpNb1h5cmtrMzdxa09jME5BNzVXd3BuNTROeGVwVHdsaVFxcVNBRFJnZXE5b04xMzVCZUpvMHpREhcxSHRGYXJDWExPMzMxc1FQMDhQMWdBbxoiQURzcjlmUklxeWNaeU5pSmtIeVhpM3B2ei1jeE85c0dIdxIEODA1MRoBMyoAMAA4AUAAGAAgj7nz2AZKAhAC";

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

function isSafeMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return false;
  }

  if (raw.startsWith("data:image/")) {
    return true;
  }

  try {
    const parsed = new URL(raw, window.location.origin);
    return SAFE_MEDIA_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

function normalizeText(value, max = 160) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

function stars(rating) {
  if (rating >= 4.8) {
    return "★★★★★";
  }
  if (rating >= 4.5) {
    return "★★★★☆";
  }
  return "★★★☆☆";
}

function normalizeVideoUrl(url) {
  const value = String(url || "").trim();
  if (!value) {
    return "";
  }

  if (!isSafeMediaUrl(value)) {
    return "";
  }

  if (value.includes("youtube.com/watch?v=")) {
    return value.replace("watch?v=", "embed/");
  }

  if (value.includes("youtu.be/")) {
    const id = value.split("youtu.be/")[1];
    return `https://www.youtube.com/embed/${id}`;
  }

  return value;
}

function productMediaMarkup(product) {
  if (product.imageUrl && isSafeMediaUrl(product.imageUrl)) {
    return `<img class="product-media" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />`;
  }

  if (product.videoUrl) {
    const videoSrc = normalizeVideoUrl(product.videoUrl);
    if (!videoSrc) {
      return `<div class="product-icon">${escapeHtml(product.icon)}</div>`;
    }

    if (videoSrc.includes("youtube.com/embed")) {
      return `<iframe class="product-media" src="${escapeHtml(videoSrc)}" title="Video do produto ${escapeHtml(product.name)}" loading="lazy" allowfullscreen></iframe>`;
    }

    return `<video class="product-media" src="${escapeHtml(videoSrc)}" controls preload="metadata"></video>`;
  }

  return `<div class="product-icon">${escapeHtml(product.icon)}</div>`;
}

function toProductCard(product) {
  const favorite = isFavorite(product.id);

  return `
    <article class="product-card" data-product-id="${product.id}">
      <p class="badge">${escapeHtml(product.badge)}</p>
      ${productMediaMarkup(product)}
      <h3>${escapeHtml(product.name)}</h3>
      <p class="meta">${escapeHtml(product.species)} • ${escapeHtml(product.category)} • ${escapeHtml(product.brand)}</p>
      <p class="rating">${stars(product.rating)} ${product.rating.toFixed(1)}</p>
      <p class="old-price">de ${currency.format(product.oldPrice)}</p>
      <p class="price">${currency.format(product.price)}</p>
      <p class="delivery">Entrega em ate ${product.deliveryHours}h</p>
      <div class="card-actions">
        <div class="qty-inline">
          <label for="add-qty-${product.id}">Qtd</label>
          <input id="add-qty-${product.id}" class="add-qty" type="number" min="1" step="1" value="1" />
        </div>
        <button class="btn primary add-cart" data-product-id="${product.id}" type="button">Adicionar ao carrinho</button>
        <button class="btn secondary fav-btn" data-product-id="${product.id}" type="button">
          ${favorite ? "Favoritado" : "Favoritar"}
        </button>
      </div>
    </article>
  `;
}

function renderHighlights() {
  const list = listProducts().slice(0, 3);
  const container = el("highlights");

  container.innerHTML = list
    .map(
      (item) => `
      <article>
        <p>${escapeHtml(item.badge)}</p>
        <h3>${escapeHtml(item.icon)} ${escapeHtml(item.species)}</h3>
        <p>${escapeHtml(item.name)}</p>
      </article>
    `,
    )
    .join("");
}

function getFilteredProducts() {
  const products = filterProducts(state.filters);

  if (!state.filters.favoritesOnly) {
    return products;
  }

  const favorites = getFavorites();
  return products.filter((product) => favorites.includes(product.id));
}

function renderProducts() {
  const products = getFilteredProducts();
  const grid = el("product-grid");
  const count = el("results-count");

  if (products.length === 0) {
    grid.innerHTML = `<p class="empty-state">Nenhum produto encontrado para os filtros atuais.</p>`;
    count.textContent = "0 resultados";
    return;
  }

  grid.innerHTML = products.map(toProductCard).join("");
  count.textContent = `${products.length} resultados encontrados`;
}

function cartWithProduct() {
  return getCart()
    .map((item) => {
      const product = getProductById(item.productId);
      if (!product) {
        return null;
      }
      return { ...item, product };
    })
    .filter(Boolean);
}

function checkoutOptions() {
  return {
    deliveryMode: el("checkout-mode")?.value || "delivery",
    cep: el("checkout-cep")?.value || "",
  };
}

function updateHeaderCounters() {
  const favoritesCount = getFavorites().length;
  const cartCount = getCart().reduce((sum, item) => sum + item.quantity, 0);

  el("favorites-count").textContent = String(favoritesCount);
  el("cart-count").textContent = String(cartCount);
}

function listLocalReviews() {
  try {
    return JSON.parse(localStorage.getItem(REVIEWS_KEY) || "[]");
  } catch {
    return [];
  }
}

function buildStoreSearchSuggestions() {
  searchSuggestionIndex.clear();

  const suggestions = [];
  listProducts().forEach((product) => {
    suggestions.push({
      label: product.name,
      type: "product",
      query: product.name,
    });

    suggestions.push({
      label: `Marca: ${product.brand}`,
      type: "brand",
      query: product.brand,
    });
  });

  listCategories().forEach((category) => {
    suggestions.push({
      label: `Categoria: ${category}`,
      type: "category",
      category,
    });
  });

  listSpecies().forEach((species) => {
    suggestions.push({
      label: `Espécie: ${species}`,
      type: "species",
      species,
    });
  });

  const unique = new Map();
  suggestions.forEach((item) => {
    if (!unique.has(item.label)) {
      unique.set(item.label, item);
    }
  });

  const suggestionValues = [...unique.values()];
  suggestionValues.forEach((item) => {
    searchSuggestionIndex.set(item.label.toLowerCase(), item);
  });

  renderSearchSuggestionBoard("");
}

function renderSearchSuggestionBoard(value = "") {
  const board = el("search-suggestion-board");
  if (!board) {
    return;
  }

  const term = normalizeText(value, 80).toLowerCase();
  const allSuggestions = [...searchSuggestionIndex.values()];
  const filtered = term
    ? allSuggestions.filter((item) =>
        [item.label, item.query, item.category, item.species]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
    : allSuggestions;

  const limited = filtered.slice(0, 8);

  if (!limited.length) {
    board.innerHTML = "";
    board.classList.add("hidden");
    return;
  }

  board.classList.remove("hidden");
  board.innerHTML = limited
    .map((item) => {
      return `
        <button class="search-suggestion-chip" type="button" data-suggestion-label="${escapeHtml(item.label)}">
          ${escapeHtml(item.label)}
        </button>
      `;
    })
    .join("");
}

function applyStoreSearch(value) {
  const normalized = normalizeText(value, 80);
  const suggestion = searchSuggestionIndex.get(normalized.toLowerCase());

  state.filters.query = "";
  state.filters.category = "";
  state.filters.species = "";

  if (!suggestion) {
    state.filters.query = normalized;
  } else if (suggestion.type === "category") {
    state.filters.category = suggestion.category;
  } else if (suggestion.type === "species") {
    state.filters.species = suggestion.species;
  } else {
    state.filters.query = suggestion.query;
  }

  const searchInput = el("search-input");
  if (searchInput) {
    searchInput.value = normalized;
  }
  const speciesFilter = el("species-filter");
  const categoryFilter = el("category-filter");
  if (speciesFilter) {
    speciesFilter.value = state.filters.species;
  }
  if (categoryFilter) {
    categoryFilter.value = state.filters.category;
  }

  renderProducts();
  document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" });
}

function saveLocalReview(review) {
  const current = listLocalReviews();
  localStorage.setItem(
    REVIEWS_KEY,
    JSON.stringify([review, ...current].slice(0, 8)),
  );
}

function renderShippingFeedback() {
  const totals = calculateTotals(getCart(), getProductById, checkoutOptions());
  const feedback = el("shipping-feedback");
  const mode = checkoutOptions().deliveryMode;

  if (mode === "pickup") {
    feedback.textContent = "Retirada na loja selecionada: frete grátis.";
    return totals;
  }

  feedback.textContent = `Frete estimado: ${currency.format(totals.shipping)}`;
  return totals;
}

function renderCart() {
  const items = cartWithProduct();
  const itemsEl = el("cart-items");
  const summaryEl = el("cart-summary");
  const couponFeedback = el("coupon-feedback");
  const coupon = getActiveCoupon();

  if (coupon) {
    const couponCode = typeof coupon === "string" ? coupon : coupon.code;
    couponFeedback.textContent = `Cupom ativo: ${couponCode}`;
  } else {
    couponFeedback.textContent = "";
  }

  if (items.length === 0) {
    itemsEl.innerHTML = `<p class="empty-state">Sua sacola está vazia.</p>`;
  } else {
    itemsEl.innerHTML = items
      .map(
        (item) => `
        <article class="cart-item">
          <div class="cart-item-main">
            <div class="cart-thumb-wrap">
              ${item.product.imageUrl && isSafeMediaUrl(item.product.imageUrl) ? `<img class="cart-thumb" src="${escapeHtml(item.product.imageUrl)}" alt="${escapeHtml(item.product.name)}" />` : `<div class="cart-thumb cart-thumb-fallback">${escapeHtml(item.product.icon)}</div>`}
            </div>
            <div class="cart-item-copy">
              <h4>${item.product.name}</h4>
              <p>${currency.format(item.product.price)} cada unidade</p>
              <p class="meta">Subtotal do item: ${currency.format(item.product.price * item.quantity)}</p>
            </div>
          </div>
          <div class="qty-row">
            <div class="qty-group">
              <button class="qty-btn" data-action="decrease" data-product-id="${item.productId}" type="button">-</button>
              <input
                class="cart-qty-input"
                data-action="set-quantity"
                data-product-id="${item.productId}"
                type="number"
                min="1"
                step="1"
                value="${Math.max(1, Number(item.quantity) || 1)}"
                aria-label="Quantidade de ${escapeHtml(item.product.name)}"
              />
              <button class="qty-btn" data-action="increase" data-product-id="${item.productId}" type="button">+</button>
            </div>
            <strong class="cart-line-total">${currency.format(item.product.price * item.quantity)}</strong>
            <button class="remove-btn" data-action="remove" data-product-id="${item.productId}" type="button">Remover</button>
          </div>
        </article>
      `,
      )
      .join("");
  }

  const totals = renderShippingFeedback();
  summaryEl.innerHTML = `
    <p>Itens: <strong>${totals.itemsCount}</strong></p>
    <p>Subtotal: <strong>${currency.format(totals.subtotal)}</strong></p>
    <p>Frete: <strong>${currency.format(totals.shipping)}</strong></p>
    <p>Desconto: <strong>- ${currency.format(totals.discount)}</strong></p>
    <p class="total">Total: <strong>${currency.format(totals.total)}</strong></p>
  `;

  updateHeaderCounters();
}

function renderCommercialShowcase() {
  const promoList = el("promo-list");
  const subscriptionList = el("subscription-list");
  const benefitsList = el("benefits-list");

  if (!promoList || !subscriptionList || !benefitsList) {
    return;
  }

  function toHtml(items, emptyText) {
    if (!items.length) {
      return `<p class="empty-state">${emptyText}</p>`;
    }

    return items
      .slice(0, 4)
      .map(
        (item) => `
          <article class="dynamic-card">
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.description)}</p>
          </article>
        `,
      )
      .join("");
  }

  promoList.innerHTML = toHtml(
    listPromotions().filter((item) => item.active),
    "Sem promoções ativas no momento.",
  );
  subscriptionList.innerHTML = toHtml(
    listSubscriptionPlans().filter((item) => item.active),
    "Sem planos de assinatura disponíveis.",
  );
  benefitsList.innerHTML = toHtml(
    listBenefits().filter((item) => item.active),
    "Sem benefícios cadastrados.",
  );
}

function renderPixPaymentInfo() {
  const payment = el("checkout-payment")?.value || "";
  const pixBox = el("pix-payment-box");
  const pixKeyText = el("pix-key-text");
  const pixHolderText = el("pix-holder-text");

  if (!pixBox || !pixKeyText || !pixHolderText) {
    return;
  }

  if (payment !== "Pix") {
    pixBox.classList.add("hidden");
    return;
  }

  const pix = getPixSettings();
  pixBox.classList.remove("hidden");
  pixKeyText.textContent = pix.pixKey || "Chave PIX não cadastrada.";
  pixHolderText.textContent = pix.pixHolder
    ? `Recebedor: ${pix.pixHolder}`
    : "";
}

function populateFilterSelects() {
  const speciesSelect = el("species-filter");
  const categorySelect = el("category-filter");

  speciesSelect.innerHTML =
    `<option value="">Todas</option>` +
    listSpecies()
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");

  categorySelect.innerHTML =
    `<option value="">Todas</option>` +
    listCategories()
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");
}

function bindCatalogEvents() {
  const grid = el("product-grid");
  const searchForm = el("search-form");
  const searchInput = el("search-input");
  const speciesFilter = el("species-filter");
  const categoryFilter = el("category-filter");
  const sortFilter = el("sort-filter");
  const priceFilter = el("price-filter");
  const stockOnly = el("stock-only");
  const favoritesOnly = el("favorites-only");
  const clearFilters = el("clear-filters");

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyStoreSearch(searchInput.value);
    logEvent("search", { query: normalizeText(searchInput.value, 80) });
  });

  searchInput.addEventListener("input", () => {
    const normalized = normalizeText(searchInput.value, 80);
    renderSearchSuggestionBoard(normalized);
  });

  speciesFilter.addEventListener("change", () => {
    state.filters.species = speciesFilter.value;
    renderProducts();
  });

  categoryFilter.addEventListener("change", () => {
    state.filters.category = categoryFilter.value;
    renderProducts();
  });

  sortFilter.addEventListener("change", () => {
    state.filters.sortBy = sortFilter.value;
    renderProducts();
  });

  priceFilter.addEventListener("input", () => {
    state.filters.maxPrice = Number(priceFilter.value);
    el("price-value").textContent = currency.format(state.filters.maxPrice);
    renderProducts();
  });

  stockOnly.addEventListener("change", () => {
    state.filters.inStockOnly = stockOnly.checked;
    renderProducts();
  });

  favoritesOnly.addEventListener("change", () => {
    state.filters.favoritesOnly = favoritesOnly.checked;
    renderProducts();
  });

  clearFilters.addEventListener("click", () => {
    state.filters = {
      query: "",
      species: "",
      category: "",
      sortBy: "relevance",
      maxPrice: 350,
      inStockOnly: false,
      favoritesOnly: false,
    };

    searchInput.value = "";
    speciesFilter.value = "";
    categoryFilter.value = "";
    sortFilter.value = "relevance";
    priceFilter.value = "350";
    stockOnly.checked = false;
    favoritesOnly.checked = false;
    el("price-value").textContent = currency.format(350);
    renderSearchSuggestionBoard("");
    renderProducts();
  });

  grid.addEventListener("click", (event) => {
    const addButton = event.target.closest(".add-cart");
    const favButton = event.target.closest(".fav-btn");

    if (addButton) {
      const productId = addButton.dataset.productId;
      const card = addButton.closest(".product-card");
      const qtyInput = card?.querySelector(".add-qty");
      const quantity = Math.max(1, Number(qtyInput?.value || 1) || 1);
      addToCart(productId, quantity);
      renderCart();
      openCart();
      logEvent("add_to_cart", { productId, quantity });
      return;
    }

    if (favButton) {
      const productId = favButton.dataset.productId;
      toggleFavorite(productId);
      updateHeaderCounters();
      renderProducts();
      logEvent("toggle_favorite", { productId });
    }
  });

  el("search-suggestion-board")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-suggestion-label]");
    if (!button) {
      return;
    }

    const label = button.dataset.suggestionLabel;
    applyStoreSearch(label);
    renderSearchSuggestionBoard(label);
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.filters.species = chip.dataset.species || "";
      speciesFilter.value = state.filters.species;
      renderProducts();
      document
        .getElementById("catalogo")
        .scrollIntoView({ behavior: "smooth" });
    });
  });
}

function openCart() {
  el("cart-drawer").classList.add("open");
  el("overlay").classList.add("show");
}

function closeCart() {
  el("cart-drawer").classList.remove("open");
  el("overlay").classList.remove("show");
}

function bindCartEvents() {
  el("cart-btn").addEventListener("click", openCart);
  el("close-cart").addEventListener("click", closeCart);
  el("overlay").addEventListener("click", closeCart);

  el("cart-items").addEventListener("click", (event) => {
    const actionButton = event.target.closest("button[data-action]");

    if (!actionButton) {
      return;
    }

    const { action, productId } = actionButton.dataset;
    const currentItem = getCart().find((item) => item.productId === productId);

    if (!currentItem) {
      return;
    }

    if (action === "increase") {
      updateCartItem(productId, currentItem.quantity + 1);
    }

    if (action === "decrease") {
      updateCartItem(productId, currentItem.quantity - 1);
    }

    if (action === "remove") {
      removeFromCart(productId);
    }

    renderCart();
  });

  el("cart-items").addEventListener("change", (event) => {
    const qtyInput = event.target.closest("input[data-action='set-quantity']");
    if (!qtyInput) {
      return;
    }

    const productId = qtyInput.dataset.productId;
    const quantity = Math.max(1, Number(qtyInput.value || 1) || 1);
    updateCartItem(productId, quantity);
    renderCart();
  });

  el("cart-items").addEventListener("keydown", (event) => {
    const qtyInput = event.target.closest("input[data-action='set-quantity']");
    if (!qtyInput || event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    const productId = qtyInput.dataset.productId;
    const quantity = Math.max(1, Number(qtyInput.value || 1) || 1);
    updateCartItem(productId, quantity);
    renderCart();
  });

  el("apply-coupon").addEventListener("click", () => {
    const code = normalizeText(el("coupon-input").value, 20).toUpperCase();
    el("coupon-input").value = code;
    const response = applyCoupon(code);
    el("coupon-feedback").textContent = response.message;
    renderCart();
    logEvent("coupon", response);
  });

  ["checkout-mode", "checkout-cep", "checkout-address"].forEach((id) => {
    const input = el(id);
    input?.addEventListener("input", () => {
      const mode = el("checkout-mode").value;
      const addressInput = el("checkout-address");
      if (mode === "pickup") {
        addressInput.value = "";
      }
      renderCart();
    });

    input?.addEventListener("change", renderCart);
  });

  el("checkout-payment")?.addEventListener("change", () => {
    renderPixPaymentInfo();
    renderCart();
  });

  el("copy-pix-key")?.addEventListener("click", async () => {
    const pix = getPixSettings();
    if (!pix.pixKey) {
      el("coupon-feedback").textContent = "Chave PIX não configurada no admin.";
      return;
    }

    try {
      await navigator.clipboard.writeText(pix.pixKey);
      el("coupon-feedback").textContent =
        "Chave PIX copiada para a área de transferência.";
    } catch {
      el("coupon-feedback").textContent = `Copie manualmente: ${pix.pixKey}`;
    }
  });

  el("checkout-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const mode = el("checkout-mode").value;
    const address = normalizeText(el("checkout-address").value, 180);
    const session = getCustomerSession();
    const cep = String(el("checkout-cep").value || "")
      .replace(/\D/g, "")
      .slice(0, 8);
    const customerName = normalizeText(el("checkout-name").value, 80);

    if (!customerName) {
      el("coupon-feedback").textContent =
        "Informe um nome valido para finalizar.";
      return;
    }

    if (mode === "delivery" && cep.length < 8) {
      el("coupon-feedback").textContent = "Informe um CEP valido para entrega.";
      return;
    }

    const response = placeOrder(
      {
        customerId: session?.customerId || null,
        customerName,
        paymentMethod: el("checkout-payment").value,
        deliveryMode: mode,
        cep,
        address: mode === "pickup" ? "Retirada na loja" : address,
      },
      getProductById,
    );

    if (!response.ok) {
      el("coupon-feedback").textContent = response.message;
      return;
    }

    const orderCode = response.order.id.toUpperCase();
    el("coupon-feedback").textContent =
      `Pedido ${orderCode} confirmado com sucesso.`;
    el("checkout-form").reset();
    renderCart();
    renderCustomerSession();
    logEvent("checkout", {
      orderId: response.order.id,
      total: response.order.totals.total,
    });
  });
}

function bindEngagementForms() {
  el("newsletter-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const email = normalizeText(
      el("newsletter-email").value,
      120,
    ).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      el("newsletter-feedback").textContent = "Informe um e-mail valido.";
      return;
    }
    el("newsletter-feedback").textContent =
      `Perfeito! ${email} foi cadastrado para receber novidades.`;
    el("newsletter-form").reset();
    logEvent("newsletter", { email });
  });

  el("tracking-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const code = normalizeText(el("tracking-code").value, 64).toLowerCase();
    el("tracking-code").value = code.toUpperCase();
    const order = listSales().find((item) => item.id.toLowerCase() === code);

    if (!order) {
      el("tracking-feedback").textContent =
        "Pedido não encontrado. Confira o código e tente novamente.";
      return;
    }

    el("tracking-feedback").textContent =
      `Pedido ${order.id.toUpperCase()} | Status: ${order.status} | Total: ${currency.format(order.totals.total)}`;
  });
}

async function renderReviews() {
  const container = el("review-list");
  if (!container) {
    return;
  }

  try {
    const response = await fetch("/api/google-reviews", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (data.ok && Array.isArray(data.reviews) && data.reviews.length) {
        container.innerHTML = data.reviews
          .map(
            (review) => `
            <article class="review-card">
              <strong>${escapeHtml(review.author)}</strong>
              <p class="rating">${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}</p>
              <p>${escapeHtml(review.text || "")}</p>
              <p class="meta">${escapeHtml(review.relativeTime || "Google")}</p>
            </article>
          `,
          )
          .join("");
        return;
      }
    }
  } catch {
    // Fallback local abaixo.
  }

  const reviews = listLocalReviews();
  if (!reviews.length) {
    container.innerHTML =
      '<p class="empty-state">Ainda não há avaliações disponíveis para exibição.</p>';
    return;
  }

  container.innerHTML = reviews
    .map(
      (review) => `
      <article class="review-card">
        <strong>${escapeHtml(review.name)}</strong>
        <p class="rating">${"★".repeat(Number(review.rating))}${"☆".repeat(5 - Number(review.rating))}</p>
        <p>${escapeHtml(review.text)}</p>
      </article>
    `,
    )
    .join("");
}

function renderCustomerOrders(customerId) {
  const container = el("customer-orders");

  if (!customerId) {
    container.innerHTML =
      '<p class="empty-state">Entre na conta para ver seus pedidos.</p>';
    return;
  }

  const orders = listOrdersByCustomerId(customerId);

  if (!orders.length) {
    container.innerHTML =
      '<p class="empty-state">Nenhum pedido vinculado a esta conta.</p>';
    return;
  }

  const statusList = ORDER_STATUS_OPTIONS.join(", ");

  container.innerHTML = orders
    .slice(0, 8)
    .map(
      (order) => `
      <article class="order-card">
        <h4>${order.id.toUpperCase()}</h4>
        <p>Status: ${order.status}</p>
        <p>Entrega: ${order.deliveryMode === "pickup" ? "Retirada" : "Endereco"}</p>
        <p>Total: ${currency.format(order.totals.total)}</p>
        <p class="meta">Opcoes de status: ${statusList}</p>
      </article>
    `,
    )
    .join("");
}

function renderCustomerSession() {
  const session = getCustomerSession();
  const label = el("customer-session-label");

  updateAdminLinksVisibility(session);
  updateHeaderAccountActions(session);

  if (!session) {
    label.textContent = "Entre para acompanhar seus pedidos automaticamente.";
    el("checkout-name").value = "";
    renderCustomerOrders(null);
    return;
  }

  label.textContent = `Conta ativa: ${session.name} (${session.email}) | Perfil: ${session.role || "customer"}`;
  el("checkout-name").value = session.name;
  renderCustomerOrders(session.customerId);
}

function updateHeaderAccountActions(session) {
  const registerBtn = el("customer-register-top-btn");
  const loginBtn = el("customer-login-top-btn");
  const logoutBtn = el("customer-logout-top-btn");
  const customerAreaBtn = el("customer-area-btn");
  const quickAccountLink = el("quick-account-link");
  const isLoggedIn = Boolean(session);
  const firstName =
    String(session?.name || "")
      .trim()
      .split(" ")[0] || "Minha conta";

  registerBtn?.classList.toggle("hidden", isLoggedIn);
  loginBtn?.classList.toggle("hidden", isLoggedIn);
  logoutBtn?.classList.toggle("hidden", !isLoggedIn);
  if (customerAreaBtn) {
    customerAreaBtn.textContent = isLoggedIn
      ? `Olá, ${firstName}`
      : "Minha conta";
  }
  if (quickAccountLink) {
    quickAccountLink.textContent = isLoggedIn
      ? "Minha conta"
      : "Entrar / Criar conta";
  }
}

function updateAdminLinksVisibility(session) {
  const role = String(session?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "super_admin";
  [
    "admin-link",
    "erp-link",
    "pdv-link",
    "quick-admin-link",
    "quick-erp-link",
    "quick-pdv-link",
  ].forEach((id) => {
    const link = el(id);
    if (!link) {
      return;
    }

    link.classList.toggle("hidden", !isAdmin);
  });
}

function consumeOAuthFlash() {
  try {
    const raw = sessionStorage.getItem(OAUTH_FLASH_KEY);
    if (!raw) {
      return null;
    }

    sessionStorage.removeItem(OAUTH_FLASH_KEY);
    return JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(OAUTH_FLASH_KEY);
    return null;
  }
}

function bindCustomerAccount() {
  const registerForm = el("customer-register-form");
  const loginForm = el("customer-login-form");
  const feedback = el("customer-auth-feedback");
  const registerModeBtn = el("auth-mode-register");
  const loginModeBtn = el("auth-mode-login");

  function setAuthMode(mode) {
    const isRegister = mode === "register";
    registerForm?.classList.toggle("hidden", !isRegister);
    loginForm?.classList.toggle("hidden", isRegister);
    registerModeBtn?.classList.toggle("primary", isRegister);
    registerModeBtn?.classList.toggle("secondary", !isRegister);
    loginModeBtn?.classList.toggle("primary", !isRegister);
    loginModeBtn?.classList.toggle("secondary", isRegister);
  }

  registerModeBtn?.addEventListener("click", () => setAuthMode("register"));
  loginModeBtn?.addEventListener("click", () => setAuthMode("login"));

  registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const response = await registerCustomerAccount({
      name: normalizeText(el("register-name").value, 80),
      email: normalizeText(el("register-email").value, 120),
      phone: normalizeText(el("register-phone").value, 24),
      password: String(el("register-password").value || "").trim(),
    });

    feedback.textContent = response.ok
      ? "Conta criada com sucesso. Agora faça login para acompanhar pedidos."
      : response.message;

    if (response.ok) {
      registerForm.reset();
    }
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const response = await loginCustomerAccount({
      email: normalizeText(el("login-email").value, 120),
      password: String(el("login-password").value || "").trim(),
    });

    feedback.textContent = response.ok
      ? "Login realizado com sucesso."
      : response.message;

    if (response.ok) {
      renderCustomerSession();
      loginForm.reset();
    }
  });

  el("customer-logout")?.addEventListener("click", () => {
    logoutCustomerAccount();
    feedback.textContent = "Sessão encerrada.";
    renderCustomerSession();
  });

  el("customer-google-login")?.addEventListener("click", async () => {
    const result = await getOAuthLaunchResult("google", "customer");
    if (!result.ok) {
      feedback.textContent = result.message;
      return;
    }

    window.location.href = result.authUrl;
  });

  el("customer-apple-login")?.addEventListener("click", async () => {
    const result = await getOAuthLaunchResult("apple", "customer");
    if (!result.ok) {
      feedback.textContent = result.message;
      return;
    }

    window.location.href = result.authUrl;
  });

  el("customer-area-btn")?.addEventListener("click", () => {
    document.getElementById("customer-account").scrollIntoView({
      behavior: "smooth",
    });
  });

  el("customer-register-top-btn")?.addEventListener("click", () => {
    setAuthMode("register");
    document.getElementById("customer-account").scrollIntoView({
      behavior: "smooth",
    });
  });

  el("customer-login-top-btn")?.addEventListener("click", () => {
    setAuthMode("login");
    document.getElementById("customer-account").scrollIntoView({
      behavior: "smooth",
    });
  });

  el("customer-logout-top-btn")?.addEventListener("click", () => {
    logoutCustomerAccount();
    feedback.textContent = "Sessão encerrada.";
    setAuthMode("login");
    renderCustomerSession();
  });

  setAuthMode("login");

  const oauthFlash = consumeOAuthFlash();
  if (oauthFlash) {
    feedback.textContent = oauthFlash.message;
    renderCustomerSession();
    document.getElementById("customer-account").scrollIntoView({
      behavior: "smooth",
    });
  }
}

function bindShortcuts() {
  el("favorites-btn").addEventListener("click", () => {
    const favoritesOnly = el("favorites-only");
    favoritesOnly.checked = !favoritesOnly.checked;
    state.filters.favoritesOnly = favoritesOnly.checked;
    renderProducts();
    document.getElementById("catalogo").scrollIntoView({ behavior: "smooth" });
  });

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const target = document.querySelector(anchor.getAttribute("href"));

      if (!target) {
        return;
      }

      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
    });
  });

  const backToTop = el("back-to-top");
  if (backToTop) {
    window.addEventListener("scroll", () => {
      if (window.scrollY > 500) {
        backToTop.classList.add("show");
      } else {
        backToTop.classList.remove("show");
      }
    });

    backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  document.addEventListener("keydown", (event) => {
    const tag = String(event.target?.tagName || "").toLowerCase();
    const inTypingField = tag === "input" || tag === "textarea";

    if (event.key === "/" && !inTypingField) {
      event.preventDefault();
      el("search-input")?.focus();
      return;
    }

    if (event.altKey && event.key === "1") {
      event.preventDefault();
      openCart();
      return;
    }

    if (event.altKey && event.key === "2") {
      event.preventDefault();
      el("favorites-btn")?.click();
    }
  });
}

function start() {
  updateAdminLinksVisibility(getCustomerSession());
  loadPublicOAuthConfig();
  buildStoreSearchSuggestions();
  populateFilterSelects();
  renderHighlights();
  renderProducts();
  renderReviews();
  renderCart();
  renderCustomerSession();
  updateHeaderCounters();

  bindCatalogEvents();
  bindCartEvents();
  bindEngagementForms();
  bindCustomerAccount();
  bindShortcuts();
  renderCommercialShowcase();
  renderPixPaymentInfo();
}

document.addEventListener("DOMContentLoaded", start);
