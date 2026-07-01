import {
  filterProducts,
  listCategories,
  listSpecies,
} from "./modules/products.js";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const state = {
  query: "",
  species: "",
  category: "",
  sortBy: "relevance",
};

function byId(id) {
  return document.getElementById(id);
}

function card(product) {
  return `
    <article class="product-card">
      <p class="badge">${product.badge}</p>
      <div class="product-icon">${product.icon}</div>
      <h3>${product.name}</h3>
      <p class="meta">${product.species} • ${product.category} • ${product.brand}</p>
      <p class="rating">Nota ${product.rating.toFixed(1)}</p>
      <p class="price">${currency.format(product.price)}</p>
      <a class="btn secondary" href="index.html#catalogo">Comprar na loja</a>
    </article>
  `;
}

function populateFilters() {
  const species = byId("products-species-filter");
  const category = byId("products-category-filter");

  species.innerHTML =
    '<option value="">Todas</option>' +
    listSpecies()
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");

  category.innerHTML =
    '<option value="">Todas</option>' +
    listCategories()
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");
}

function applyQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category") || "";
  const species = params.get("species") || "";

  state.category = category;
  state.species = species;

  byId("products-category-filter").value = category;
  byId("products-species-filter").value = species;
}

function renderProducts() {
  const result = filterProducts({
    query: state.query,
    species: state.species,
    category: state.category,
    sortBy: state.sortBy,
    maxPrice: Number.POSITIVE_INFINITY,
    inStockOnly: false,
  });

  byId("products-results-count").textContent = `${result.length} produtos`;
  byId("products-grid").innerHTML = result.length
    ? result.map(card).join("")
    : '<p class="empty-state">Nenhum produto encontrado.</p>';
}

function bindEvents() {
  byId("products-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.query = byId("products-search-input").value.trim();
    renderProducts();
  });

  byId("products-species-filter").addEventListener("change", (event) => {
    state.species = event.target.value;
    renderProducts();
  });

  byId("products-category-filter").addEventListener("change", (event) => {
    state.category = event.target.value;
    renderProducts();
  });

  byId("products-sort-filter").addEventListener("change", (event) => {
    state.sortBy = event.target.value;
    renderProducts();
  });

  byId("products-clear-filters").addEventListener("click", () => {
    state.query = "";
    state.species = "";
    state.category = "";
    state.sortBy = "relevance";

    byId("products-search-input").value = "";
    byId("products-species-filter").value = "";
    byId("products-category-filter").value = "";
    byId("products-sort-filter").value = "relevance";
    renderProducts();
  });
}

function init() {
  populateFilters();
  applyQueryParams();
  bindEvents();
  renderProducts();
}

document.addEventListener("DOMContentLoaded", init);
