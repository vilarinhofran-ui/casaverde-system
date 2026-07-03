import { db } from "../core/db.js";

const PRODUCT_STOCK_DELTA_KEY = "casaverde_product_stock_delta";
const PRODUCT_OVERRIDES_KEY = "casaverde_product_overrides";
const IMPORTED_PRODUCTS_KEY = "casaverde_imported_products";

const BASE_PRODUCTS = [
  {
    id: "bird-feed-1",
    barcode: "7891000000058",
    name: "Mistura Premium para Passaros 1kg",
    unit: "KG",
    species: "Passaro",
    category: "Racao",
    brand: "Vida Aves",
    price: 29.9,
    oldPrice: 34.9,
    stock: 18,
    badge: "Nutricao",
    rating: 4.5,
    deliveryHours: 8,
    icon: "🐦",
    imageUrl: "",
    videoUrl: "",
  },
  {
    id: "fish-filter-1",
    barcode: "7891000000065",
    name: "Filtro Externo para Aquario 600L/h",
    unit: "UN",
    species: "Peixe",
    category: "Acessorio",
    brand: "AquaFlow",
    price: 159.9,
    oldPrice: 189.9,
    stock: 10,
    badge: "Tecnologia",
    rating: 4.4,
    deliveryHours: 12,
    icon: "🐠",
    imageUrl: "",
    videoUrl: "",
  },
  {
    id: "dog-toy-1",
    barcode: "7891000000072",
    name: "Brinquedo Mordedor Resistente",
    unit: "UN",
    species: "Cachorro",
    category: "Brinquedo",
    brand: "PlayPet",
    price: 49.9,
    oldPrice: 62.9,
    stock: 22,
    badge: "Duravel",
    rating: 4.3,
    deliveryHours: 5,
    icon: "🎾",
    imageUrl: "",
    videoUrl: "",
  },
  {
    id: "cat-scratcher-1",
    barcode: "7891000000089",
    name: "Arranhador Torre com Toca",
    unit: "CX",
    species: "Gato",
    category: "Brinquedo",
    brand: "Miau Design",
    price: 189.9,
    oldPrice: 229.9,
    stock: 6,
    badge: "Exclusivo",
    rating: 4.8,
    deliveryHours: 24,
    icon: "🪵",
    imageUrl: "",
    videoUrl: "",
  },
  {
    id: "farm-dog-1",
    barcode: "7891000000096",
    name: "Antipulgas Spot On 20 a 40kg",
    unit: "UN",
    species: "Cachorro",
    category: "Farmacia",
    brand: "VetCare",
    price: 79.9,
    oldPrice: 92.9,
    stock: 14,
    badge: "Cuidado",
    rating: 4.7,
    deliveryHours: 3,
    icon: "💊",
    imageUrl: "",
    videoUrl: "",
  },
  {
    id: "farm-cat-1",
    barcode: "7891000000102",
    name: "Vermifugo Gatos 4 comprimidos",
    unit: "CX",
    species: "Gato",
    category: "Farmacia",
    brand: "VetCare",
    price: 34.9,
    oldPrice: 39.9,
    stock: 20,
    badge: "Clinico",
    rating: 4.5,
    deliveryHours: 3,
    icon: "💉",
    imageUrl: "",
    videoUrl: "",
  },
  {
    id: "home-clean-1",
    barcode: "7891000000119",
    name: "Eliminador de Odores Pet 2L",
    unit: "LT",
    species: "Casa e Jardim",
    category: "Limpeza",
    brand: "GreenHome",
    price: 54.9,
    oldPrice: 69.9,
    stock: 25,
    badge: "Casa",
    rating: 4.6,
    deliveryHours: 8,
    icon: "🏠",
    imageUrl: "",
    videoUrl: "",
  },
  {
    id: "flower-1",
    barcode: "7891000000126",
    name: "Kit Jardim Pet Safe",
    unit: "M",
    species: "Casa e Jardim",
    category: "Jardim",
    brand: "Flora Viva",
    price: 99.9,
    oldPrice: 119.9,
    stock: 9,
    badge: "Novo",
    rating: 4.4,
    deliveryHours: 24,
    icon: "🌿",
    imageUrl: "",
    videoUrl: "",
  },
];

function readStockDelta() {
  return db.read(PRODUCT_STOCK_DELTA_KEY, {});
}

function readOverrides() {
  return db.read(PRODUCT_OVERRIDES_KEY, {});
}

function readImportedProducts() {
  const raw = db.read(IMPORTED_PRODUCTS_KEY, []);
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item) => item && typeof item === "object");
}

function getEffectiveStockValue(product) {
  const delta = readStockDelta();
  const deltaValue = Number(delta[product.id] || 0);
  return Math.max(0, Number(product.stock || 0) + deltaValue);
}

function withRuntimeData(product) {
  const overrides = readOverrides();
  const custom = overrides[product.id] || {};

  return {
    ...product,
    ...custom,
    stock: getEffectiveStockValue(product),
  };
}

export function listProducts() {
  return [...BASE_PRODUCTS, ...readImportedProducts()].map((product) =>
    withRuntimeData(product),
  );
}

export function getProductById(id) {
  return listProducts().find((product) => product.id === id) || null;
}

export function getProductByBarcode(barcode) {
  const normalized = String(barcode || "").trim();
  return (
    listProducts().find((product) => product.barcode === normalized) || null
  );
}

export function replaceImportedProducts(products) {
  const safeProducts = Array.isArray(products)
    ? products.filter((item) => item && typeof item === "object")
    : [];

  db.write(IMPORTED_PRODUCTS_KEY, safeProducts);
  return safeProducts;
}

export function updateProductMedia(productId, payload) {
  return db.update(PRODUCT_OVERRIDES_KEY, {}, (current) => {
    const previous = current[productId] || {};
    const next = {
      ...previous,
      imageUrl: String(payload?.imageUrl || "").trim(),
      videoUrl: String(payload?.videoUrl || "").trim(),
      updatedAt: new Date().toISOString(),
    };

    return {
      ...current,
      [productId]: next,
    };
  });
}

export function updateProductFields(productId, payload) {
  return db.update(PRODUCT_OVERRIDES_KEY, {}, (current) => {
    const previous = current[productId] || {};

    const next = {
      ...previous,
      ...payload,
      updatedAt: new Date().toISOString(),
    };

    return {
      ...current,
      [productId]: next,
    };
  });
}

export function adjustProductStock(productId, amount) {
  const safeAmount = Number(amount || 0);

  return db.update(PRODUCT_STOCK_DELTA_KEY, {}, (current) => {
    const product = BASE_PRODUCTS.find((item) => item.id === productId);
    if (!product) {
      return current;
    }

    const nextDelta = Number(current[productId] || 0) + safeAmount;
    const nextStock = Math.max(0, Number(product.stock) + nextDelta);

    return {
      ...current,
      [productId]: nextStock - Number(product.stock),
    };
  });
}

export function listSpecies() {
  return [...new Set(listProducts().map((product) => product.species))];
}

export function listCategories() {
  return [...new Set(listProducts().map((product) => product.category))];
}

function sortProducts(items, sortBy) {
  const sorted = [...items];

  if (sortBy === "price-asc") {
    sorted.sort((a, b) => a.price - b.price);
  }

  if (sortBy === "price-desc") {
    sorted.sort((a, b) => b.price - a.price);
  }

  if (sortBy === "rating") {
    sorted.sort((a, b) => b.rating - a.rating);
  }

  if (sortBy === "delivery") {
    sorted.sort((a, b) => a.deliveryHours - b.deliveryHours);
  }

  return sorted;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function filterProducts(filters = {}) {
  const {
    query = "",
    species = "",
    category = "",
    maxPrice = Number.POSITIVE_INFINITY,
    inStockOnly = false,
    sortBy = "relevance",
  } = filters;

  const normalizedQuery = normalizeSearchText(query);
  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

  const filtered = listProducts().filter((product) => {
    const searchableText = normalizeSearchText(
      [
        product.name,
        product.brand,
        product.category,
        product.species,
        product.badge,
      ].join(" "),
    );

    const matchesQuery =
      normalizedQuery === "" ||
      queryTerms.every((term) => searchableText.includes(term));
    const matchesSpecies = species === "" || product.species === species;
    const matchesCategory = category === "" || product.category === category;
    const matchesPrice = product.price <= Number(maxPrice || 0);
    const matchesStock = !inStockOnly || product.stock > 0;

    return (
      matchesQuery &&
      matchesSpecies &&
      matchesCategory &&
      matchesPrice &&
      matchesStock
    );
  });

  return sortProducts(filtered, sortBy);
}
