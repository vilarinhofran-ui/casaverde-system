import { listCategories, listProducts } from "./modules/products.js";

function byId(id) {
  return document.getElementById(id);
}

function countByCategory() {
  const products = listProducts();
  const counters = new Map();

  products.forEach((product) => {
    const current = counters.get(product.category) || {
      category: product.category,
      count: 0,
      species: new Set(),
    };

    current.count += 1;
    current.species.add(product.species);
    counters.set(product.category, current);
  });

  return [...counters.values()];
}

function renderCategories() {
  const categories = listCategories();
  const summary = countByCategory();

  byId("category-grid").innerHTML = categories
    .map((name) => {
      const item = summary.find((entry) => entry.category === name);
      const species = item ? [...item.species].join(", ") : "";
      const count = item ? item.count : 0;

      return `
      <article class="category-card">
        <h3>${name}</h3>
        <p>${count} produto(s)</p>
        <p class="meta">Especies: ${species}</p>
        <div class="card-actions">
          <a class="btn primary" href="produtos.html?category=${encodeURIComponent(name)}">Ver produtos</a>
          <a class="btn secondary" href="index.html#catalogo">Ir para loja</a>
        </div>
      </article>
    `;
    })
    .join("");
}

document.addEventListener("DOMContentLoaded", renderCategories);
