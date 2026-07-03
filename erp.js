import { getSession, logout } from "./core/auth.js";
import { navigateTo, requireAuth } from "./core/router.js";
import { db } from "./core/db.js";
import { listProducts } from "./modules/products.js";
import {
  listSales,
  ORDER_STATUS_OPTIONS,
  FISCAL_DOCUMENT_OPTIONS,
} from "./modules/sales.js";
import { listAuditLogs } from "./modules/audit.js";
import { listUsers } from "./modules/users.js";

if (!requireAuth()) {
  throw new Error("Acesso negado");
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

const ERP_OPTIONS_KEY = "casaverde_erp_options";
const ERP_RECORDS_KEY = "casaverde_erp_records";

const DEFAULT_ERP_OPTIONS = [
  { key: "dashboard", label: "Dashboard", category: "Gestao", locked: true },
  { key: "vendas", label: "Vendas", category: "Comercial" },
  { key: "financeiro", label: "Financeiro", category: "Financeiro" },
  { key: "estoque", label: "Estoque", category: "Operacao" },
  { key: "clientes", label: "CRM", category: "Comercial" },
  { key: "fiscal", label: "Fiscal", category: "Fiscal" },
  { key: "compras", label: "Compras", category: "Suprimentos" },
  { key: "relatorios", label: "Relatorios", category: "Gestao" },
  { key: "auditoria", label: "Auditoria", category: "Governanca" },
  { key: "config", label: "Configuracoes", category: "Sistema", locked: true },
];

const state = {
  view: "dashboard",
  periodDays: 30,
  options: [],
  records: {},
  configFeedback: "",
  moduleFeedback: {},
};

const viewMeta = {
  dashboard: {
    title: "Dashboard Executivo",
    subtitle: "Visao geral financeira, operacional e comercial.",
  },
  vendas: {
    title: "Vendas e Pedidos",
    subtitle: "Performance comercial, ticket medio e status de pedidos.",
  },
  financeiro: {
    title: "Financeiro",
    subtitle: "Fluxo de caixa, contas a pagar e contas a receber.",
  },
  estoque: {
    title: "Estoque e Catalogo",
    subtitle: "Cobertura de estoque, ruptura e giro por produto.",
  },
  clientes: {
    title: "CRM",
    subtitle: "Clientes ativos, recorrencia e oportunidades.",
  },
  fiscal: {
    title: "Fiscal",
    subtitle: "Documentos fiscais, status de emissao e conformidade.",
  },
  compras: {
    title: "Compras",
    subtitle: "Sugestoes de reposicao e ordens de compra.",
  },
  relatorios: {
    title: "Relatorios",
    subtitle: "Exportacao de dados operacionais e gerenciais.",
  },
  auditoria: {
    title: "Auditoria",
    subtitle: "Rastreabilidade de eventos do sistema.",
  },
  config: {
    title: "Configuracoes",
    subtitle: "Padroes visuais, usuarios e parametros gerais.",
  },
};

const MODULE_SCHEMAS = {
  dashboard: {
    title: "Widgets do dashboard",
    fields: [
      { key: "title", label: "Titulo", type: "text" },
      { key: "value", label: "Valor", type: "text" },
      { key: "status", label: "Status", type: "text" },
    ],
    defaults: { title: "Novo widget", value: "0", status: "Ativo" },
  },
  vendas: {
    title: "Pedidos",
    fields: [
      { key: "customerName", label: "Cliente", type: "text" },
      { key: "paymentMethod", label: "Pagamento", type: "text" },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ORDER_STATUS_OPTIONS,
      },
      { key: "total", label: "Total", type: "number" },
      { key: "createdAt", label: "Data ISO", type: "text" },
    ],
    defaults: {
      customerName: "Cliente Casa Verde",
      paymentMethod: "Pix",
      status: "Recebido",
      total: 0,
      createdAt: new Date().toISOString(),
    },
  },
  financeiro: {
    title: "Lancamentos financeiros",
    fields: [
      { key: "kind", label: "Tipo", type: "text" },
      { key: "description", label: "Descricao", type: "text" },
      { key: "value", label: "Valor", type: "number" },
      { key: "status", label: "Status", type: "text" },
    ],
    defaults: {
      kind: "Receber",
      description: "Lancamento manual",
      value: 0,
      status: "Aberto",
    },
  },
  estoque: {
    title: "Itens de estoque",
    fields: [
      { key: "name", label: "Produto", type: "text" },
      { key: "category", label: "Categoria", type: "text" },
      { key: "brand", label: "Marca", type: "text" },
      { key: "stock", label: "Estoque", type: "number" },
      { key: "price", label: "Preco", type: "number" },
    ],
    defaults: {
      name: "Novo item",
      category: "Geral",
      brand: "Casa Verde",
      stock: 0,
      price: 0,
    },
  },
  clientes: {
    title: "Cadastro de clientes",
    fields: [
      { key: "name", label: "Nome", type: "text" },
      { key: "orders", label: "Pedidos", type: "number" },
      { key: "total", label: "Faturamento", type: "number" },
      { key: "lastAt", label: "Ultima compra ISO", type: "text" },
    ],
    defaults: {
      name: "Novo cliente",
      orders: 0,
      total: 0,
      lastAt: new Date().toISOString(),
    },
  },
  fiscal: {
    title: "Documentos fiscais",
    fields: [
      {
        key: "documentType",
        label: "Tipo",
        type: "select",
        options: FISCAL_DOCUMENT_OPTIONS,
      },
      { key: "number", label: "Numero", type: "text" },
      { key: "orderRef", label: "Pedido", type: "text" },
      { key: "value", label: "Valor", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "issuedAt", label: "Emissao ISO", type: "text" },
    ],
    defaults: {
      documentType: "NFE",
      number: "NFe-Manual",
      orderRef: "-",
      value: 0,
      status: "Pendente",
      issuedAt: new Date().toISOString(),
    },
  },
  compras: {
    title: "Compras e reposicao",
    fields: [
      { key: "product", label: "Produto", type: "text" },
      { key: "currentStock", label: "Estoque atual", type: "number" },
      { key: "suggested", label: "Compra sugerida", type: "number" },
      { key: "supplier", label: "Fornecedor", type: "text" },
      { key: "status", label: "Status", type: "text" },
    ],
    defaults: {
      product: "Item manual",
      currentStock: 0,
      suggested: 0,
      supplier: "Fornecedor",
      status: "Planejado",
    },
  },
  relatorios: {
    title: "Indicadores de relatorio",
    fields: [
      { key: "indicator", label: "Indicador", type: "text" },
      { key: "value", label: "Valor", type: "text" },
      { key: "notes", label: "Observacao", type: "text" },
    ],
    defaults: { indicator: "Indicador", value: "0", notes: "-" },
  },
  auditoria: {
    title: "Eventos de auditoria",
    fields: [
      { key: "type", label: "Tipo", type: "text" },
      { key: "detail", label: "Detalhe", type: "text" },
      { key: "createdAt", label: "Data ISO", type: "text" },
    ],
    defaults: {
      type: "evento",
      detail: "detalhe",
      createdAt: new Date().toISOString(),
    },
  },
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getSchema(moduleKey) {
  if (moduleKey === "estoque") {
    const products = listProducts();
    const categories = [
      ...new Set([
        "Racao",
        "Petisco",
        "Brinquedo",
        "Farmacia",
        "Higiene",
        "Acessorio",
        "Jardinagem",
        ...products.map((item) => item.category).filter(Boolean),
      ]),
    ];
    const brands = [
      ...new Set([
        "Casa Verde",
        "Premier",
        "Golden",
        "Royal Canin",
        "Hills",
        ...products.map((item) => item.brand).filter(Boolean),
      ]),
    ];

    return {
      title: "Itens de estoque",
      fields: [
        { key: "name", label: "Produto", type: "text" },
        {
          key: "category",
          label: "Categoria",
          type: "select",
          options: categories,
        },
        {
          key: "brand",
          label: "Marca",
          type: "select",
          options: brands,
        },
        { key: "stock", label: "Estoque", type: "number" },
        { key: "price", label: "Preco", type: "number" },
      ],
      defaults: {
        name: "Novo item",
        category: categories[0] || "Geral",
        brand: brands[0] || "Casa Verde",
        stock: 0,
        price: 0,
      },
    };
  }

  if (MODULE_SCHEMAS[moduleKey]) {
    return MODULE_SCHEMAS[moduleKey];
  }

  return {
    title: "Registros customizados",
    fields: [
      { key: "name", label: "Nome", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "value", label: "Valor", type: "text" },
    ],
    defaults: { name: "Novo registro", status: "Ativo", value: "0" },
  };
}

function buildDefaultRecords() {
  const vendas = listSales().map((order) => ({
    id: order.id,
    customerName: order.customerName,
    paymentMethod: order.paymentMethod,
    status: order.status,
    fiscalDocumentType: order.fiscalDocumentType || "NFE",
    total: toNumber(order?.totals?.total),
    createdAt: order.createdAt,
    source: "manual",
  }));

  const estoque = listProducts().map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand,
    stock: toNumber(product.stock),
    price: toNumber(product.price),
    source: "manual",
  }));

  const auditoria = listAuditLogs().map((log) => ({
    id: log.id,
    type: log.type,
    detail: JSON.stringify(log.detail),
    createdAt: log.createdAt,
    source: "manual",
  }));

  const relatorios = [
    {
      id: db.uid("rep"),
      indicator: "Receita periodo",
      value: "0",
      notes: "Automatica",
      source: "manual",
    },
    {
      id: db.uid("rep"),
      indicator: "Pedidos periodo",
      value: "0",
      notes: "Automatica",
      source: "manual",
    },
  ];

  return {
    dashboard: [],
    vendas,
    financeiro: [],
    estoque,
    clientes: [],
    fiscal: [],
    compras: [],
    relatorios,
    auditoria,
  };
}

function ensureRecordBuckets(records) {
  state.options.forEach((option) => {
    if (!Array.isArray(records[option.key])) {
      records[option.key] = [];
    }
  });
}

function synchronizeRecords(records) {
  const manualFinanceiro = (records.financeiro || []).filter(
    (item) => item.source !== "sync",
  );
  const syncFinanceiro = (records.vendas || []).map((sale) => ({
    id: `sync-fin-${sale.id}`,
    kind: "Receber",
    description: `Pedido ${String(sale.id).toUpperCase()}`,
    value: toNumber(sale.total),
    status: String(sale.status || "Recebido"),
    linkedId: sale.id,
    source: "sync",
  }));
  records.financeiro = [...manualFinanceiro, ...syncFinanceiro];

  const manualFiscal = (records.fiscal || []).filter(
    (item) => item.source !== "sync",
  );
  const syncFiscal = (records.vendas || []).map((sale, idx) => {
    const docType = String(sale.fiscalDocumentType || "NFE").toUpperCase();
    const numPrefix =
      docType === "NFCE"
        ? "NFCe"
        : docType === "RECEIPT"
          ? "CF"
          : docType === "INTERNAL"
            ? "CTRL"
            : "NFe";
    const status = docType === "INTERNAL" ? "Controle interno" : "Autorizada";

    return {
      id: `sync-fis-${sale.id}`,
      documentType: docType,
      number: `${numPrefix}-${1000 + idx}`,
      orderRef: String(sale.id).toUpperCase(),
      value: toNumber(sale.total),
      status,
      issuedAt: sale.createdAt || new Date().toISOString(),
      linkedId: sale.id,
      source: "sync",
    };
  });
  records.fiscal = [...manualFiscal, ...syncFiscal];

  const manualClientes = (records.clientes || []).filter(
    (item) => item.source !== "sync",
  );
  const aggregate = new Map();
  (records.vendas || []).forEach((sale) => {
    const key = String(sale.customerName || "Cliente");
    const current = aggregate.get(key) || {
      id: `sync-cli-${normalizeKey(key)}`,
      name: key,
      orders: 0,
      total: 0,
      lastAt: sale.createdAt || new Date().toISOString(),
      source: "sync",
    };

    current.orders += 1;
    current.total += toNumber(sale.total);
    if (new Date(sale.createdAt) > new Date(current.lastAt)) {
      current.lastAt = sale.createdAt;
    }

    aggregate.set(key, current);
  });
  records.clientes = [...manualClientes, ...[...aggregate.values()]];

  const manualCompras = (records.compras || []).filter(
    (item) => item.source !== "sync",
  );
  const syncCompras = (records.estoque || [])
    .filter((item) => toNumber(item.stock) <= 10)
    .map((item) => ({
      id: `sync-com-${item.id}`,
      product: item.name,
      currentStock: toNumber(item.stock),
      suggested: Math.max(20, 30 - toNumber(item.stock)),
      supplier: item.brand || "Fornecedor",
      status: "Reposicao",
      linkedId: item.id,
      source: "sync",
    }));
  records.compras = [...manualCompras, ...syncCompras];

  const manualRelatorios = (records.relatorios || []).filter(
    (item) => item.source !== "sync",
  );
  const receitaTotal = (records.vendas || []).reduce(
    (sum, sale) => sum + toNumber(sale.total),
    0,
  );
  const baixoEstoque = (records.estoque || []).filter(
    (item) => toNumber(item.stock) <= 10,
  ).length;
  const abertoFinanceiro = (records.financeiro || []).filter(
    (item) => String(item.status || "").toLowerCase() === "aberto",
  ).length;
  const syncRelatorios = [
    {
      id: "sync-rel-receita",
      indicator: "Receita consolidada",
      value: currency.format(receitaTotal),
      notes: "Sincronizado de vendas",
      source: "sync",
    },
    {
      id: "sync-rel-estoque",
      indicator: "Itens com baixo estoque",
      value: String(baixoEstoque),
      notes: "Sincronizado de estoque",
      source: "sync",
    },
    {
      id: "sync-rel-financeiro",
      indicator: "Titulos em aberto",
      value: String(abertoFinanceiro),
      notes: "Sincronizado de financeiro",
      source: "sync",
    },
  ];
  records.relatorios = [...manualRelatorios, ...syncRelatorios];

  return records;
}

function loadRecords() {
  const defaults = buildDefaultRecords();
  const saved = db.read(ERP_RECORDS_KEY, null);

  let records = defaults;

  if (saved && typeof saved === "object") {
    records = { ...defaults, ...saved };
  }

  ensureRecordBuckets(records);
  return synchronizeRecords(records);
}

function persistRecords() {
  db.write(ERP_RECORDS_KEY, state.records);
}

function setModuleFeedback(moduleKey, message) {
  state.moduleFeedback[moduleKey] = message;
  const feedback = byId("erp-module-feedback");
  if (feedback) {
    feedback.textContent = message;
  }
}

function collectRowPayload(row, moduleKey) {
  const schema = getSchema(moduleKey);
  const payload = {};

  schema.fields.forEach((field) => {
    const input = row.querySelector(`[data-record-field="${field.key}"]`);
    if (!input) {
      return;
    }
    payload[field.key] =
      field.type === "number"
        ? toNumber(input.value)
        : String(input.value || "").trim();
  });

  return payload;
}

function addModuleRecord(moduleKey, values) {
  const schema = getSchema(moduleKey);
  const next = { id: db.uid("rec"), source: "manual" };

  schema.fields.forEach((field) => {
    const raw = values[field.key] ?? schema.defaults[field.key] ?? "";
    next[field.key] =
      field.type === "number" ? toNumber(raw) : String(raw).trim();
  });

  state.records[moduleKey] = [...(state.records[moduleKey] || []), next];
  state.records = synchronizeRecords(state.records);
  persistRecords();
  setModuleFeedback(moduleKey, "Registro adicionado com sucesso.");
  render();
}

function updateModuleRecord(moduleKey, recordId, values) {
  const list = state.records[moduleKey] || [];
  const index = list.findIndex((item) => String(item.id) === String(recordId));

  if (index < 0) {
    setModuleFeedback(moduleKey, "Registro nao encontrado para edicao.");
    return;
  }

  if (list[index].source === "sync") {
    setModuleFeedback(
      moduleKey,
      "Registro sincronizado. Edite no modulo de origem.",
    );
    return;
  }

  const schema = getSchema(moduleKey);
  const updated = { ...list[index] };

  schema.fields.forEach((field) => {
    const raw = values[field.key];
    updated[field.key] =
      field.type === "number" ? toNumber(raw) : String(raw).trim();
  });

  list[index] = updated;
  state.records[moduleKey] = list;
  state.records = synchronizeRecords(state.records);
  persistRecords();
  setModuleFeedback(moduleKey, "Registro atualizado com sucesso.");
  render();
}

function duplicateModuleRecord(moduleKey, recordId) {
  const list = state.records[moduleKey] || [];
  const source = list.find((item) => String(item.id) === String(recordId));

  if (!source) {
    setModuleFeedback(moduleKey, "Registro nao encontrado para duplicar.");
    return;
  }

  const copy = { ...source, id: db.uid("rec"), source: "manual" };
  state.records[moduleKey] = [...list, copy];
  state.records = synchronizeRecords(state.records);
  persistRecords();
  setModuleFeedback(moduleKey, "Registro duplicado com sucesso.");
  render();
}

function deleteModuleRecord(moduleKey, recordId) {
  const list = state.records[moduleKey] || [];
  const record = list.find((item) => String(item.id) === String(recordId));

  if (!record) {
    setModuleFeedback(moduleKey, "Registro nao encontrado para exclusao.");
    return;
  }

  if (record.source === "sync") {
    setModuleFeedback(
      moduleKey,
      "Registro sincronizado. Exclua no modulo de origem.",
    );
    return;
  }

  state.records[moduleKey] = list.filter(
    (item) => String(item.id) !== String(recordId),
  );
  state.records = synchronizeRecords(state.records);
  persistRecords();
  setModuleFeedback(moduleKey, "Registro excluido com sucesso.");
  render();
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function loadOptions() {
  const saved = db.read(ERP_OPTIONS_KEY, null);

  if (!Array.isArray(saved) || saved.length === 0) {
    return DEFAULT_ERP_OPTIONS.map((option) => ({ ...option }));
  }

  const normalized = saved
    .map((option) => ({
      key: normalizeKey(option.key),
      label: String(option.label || "").trim(),
      category: String(option.category || "Geral").trim(),
      locked: Boolean(option.locked),
    }))
    .filter((option) => option.key && option.label);

  const hasConfig = normalized.some((option) => option.key === "config");
  const hasDashboard = normalized.some((option) => option.key === "dashboard");

  if (!hasDashboard) {
    normalized.unshift({
      key: "dashboard",
      label: "Dashboard",
      category: "Gestao",
      locked: true,
    });
  }

  if (!hasConfig) {
    normalized.push({
      key: "config",
      label: "Configuracoes",
      category: "Sistema",
      locked: true,
    });
  }

  return normalized;
}

function persistOptions() {
  db.write(ERP_OPTIONS_KEY, state.options);
}

function renderNav() {
  const nav = byId("erp-nav");

  nav.innerHTML = state.options
    .map(
      (option) => `
      <button class="erp-nav-item ${option.key === state.view ? "active" : ""}" data-view="${option.key}" type="button">
        ${option.label}
      </button>
    `,
    )
    .join("");

  const searchList = byId("erp-module-suggestions");
  if (searchList) {
    searchList.innerHTML = state.options
      .map((option) => `<option value="${option.label}"></option>`)
      .join("");
  }
}

function getOptionByKey(key) {
  return state.options.find((option) => option.key === key) || null;
}

function setConfigFeedback(message) {
  state.configFeedback = message;
  const feedback = byId("erp-options-feedback");
  if (feedback) {
    feedback.textContent = message;
  }
}

function addOption(input) {
  const key = normalizeKey(input.key || input.label);
  const label = String(input.label || "").trim();
  const category = String(input.category || "Geral").trim();

  if (!label || !key) {
    setConfigFeedback("Informe nome e chave validos para adicionar.");
    return;
  }

  if (state.options.some((option) => option.key === key)) {
    setConfigFeedback("Ja existe uma opcao com essa chave.");
    return;
  }

  state.options.push({ key, label, category, locked: false });
  persistOptions();
  setConfigFeedback(`Opcao ${label} adicionada.`);
  render();
}

function updateOption(existingKey, input) {
  const index = state.options.findIndex((option) => option.key === existingKey);

  if (index < 0) {
    setConfigFeedback("Opcao nao encontrada para edicao.");
    return;
  }

  const option = state.options[index];
  const nextKey = normalizeKey(input.key || option.key);
  const nextLabel = String(input.label || "").trim();
  const nextCategory = String(input.category || "Geral").trim();

  if (!nextKey || !nextLabel) {
    setConfigFeedback("Nome e chave sao obrigatorios.");
    return;
  }

  if (option.locked && nextKey !== option.key) {
    setConfigFeedback("Opcoes bloqueadas nao permitem alteracao de chave.");
    return;
  }

  const keyInUse = state.options.some(
    (item, idx) => idx !== index && item.key === nextKey,
  );

  if (keyInUse) {
    setConfigFeedback("Chave ja em uso por outra opcao.");
    return;
  }

  state.options[index] = {
    ...option,
    key: nextKey,
    label: nextLabel,
    category: nextCategory,
  };

  if (state.view === existingKey) {
    state.view = nextKey;
  }

  persistOptions();
  setConfigFeedback(`Opcao ${nextLabel} atualizada.`);
  render();
}

function duplicateOption(key) {
  const source = getOptionByKey(key);

  if (!source) {
    setConfigFeedback("Opcao nao encontrada para duplicar.");
    return;
  }

  let index = 2;
  let nextKey = normalizeKey(`${source.key}-copia`);
  while (state.options.some((option) => option.key === nextKey)) {
    nextKey = normalizeKey(`${source.key}-copia-${index}`);
    index += 1;
  }

  const copy = {
    key: nextKey,
    label: `${source.label} Copia`,
    category: source.category,
    locked: false,
  };

  state.options.push(copy);
  persistOptions();
  setConfigFeedback(`Opcao ${copy.label} duplicada.`);
  render();
}

function deleteOption(key) {
  const option = getOptionByKey(key);

  if (!option) {
    setConfigFeedback("Opcao nao encontrada para exclusao.");
    return;
  }

  if (option.locked) {
    setConfigFeedback("Essa opcao e protegida e nao pode ser excluida.");
    return;
  }

  const remaining = state.options.filter((item) => item.key !== key);

  if (!remaining.length) {
    setConfigFeedback("Nao e possivel remover todas as opcoes.");
    return;
  }

  state.options = remaining;

  if (state.view === key) {
    state.view = "dashboard";
  }

  persistOptions();
  setConfigFeedback(`Opcao ${option.label} excluida.`);
  render();
}

function byId(id) {
  return document.getElementById(id);
}

function daysAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

function getDataset() {
  const orders = (state.records.vendas || []).map((sale) => ({
    id: sale.id,
    customerName: sale.customerName,
    paymentMethod: sale.paymentMethod,
    status: sale.status,
    createdAt: sale.createdAt,
    totals: {
      total: toNumber(sale.total),
      itemsCount: 1,
    },
  }));

  const products = (state.records.estoque || []).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    brand: item.brand,
    stock: toNumber(item.stock),
    price: toNumber(item.price),
  }));

  const users = listUsers();
  const audits = (state.records.auditoria || []).map((item) => ({
    id: item.id,
    type: item.type,
    createdAt: item.createdAt,
    detail: item.detail,
  }));

  const periodOrders = orders.filter(
    (order) => daysAgo(order.createdAt) <= state.periodDays,
  );

  const receita = periodOrders.reduce(
    (sum, order) => sum + order.totals.total,
    0,
  );
  const pedidos = periodOrders.length;
  const ticketMedio = pedidos > 0 ? receita / pedidos : 0;

  const totalItens = periodOrders.reduce(
    (sum, order) => sum + order.totals.itemsCount,
    0,
  );

  const estoqueTotal = products.reduce(
    (sum, product) => sum + product.stock,
    0,
  );
  const baixoEstoque = products.filter((product) => product.stock <= 10);

  const clienteMap = new Map();
  orders.forEach((order) => {
    const current = clienteMap.get(order.customerName) || {
      name: order.customerName,
      total: 0,
      orders: 0,
      lastAt: order.createdAt,
    };

    current.total += order.totals.total;
    current.orders += 1;

    if (new Date(order.createdAt) > new Date(current.lastAt)) {
      current.lastAt = order.createdAt;
    }

    clienteMap.set(order.customerName, current);
  });

  const clientes = (state.records.clientes || []).length
    ? [...(state.records.clientes || [])].sort(
        (a, b) => toNumber(b.total) - toNumber(a.total),
      )
    : [...clienteMap.values()].sort((a, b) => b.total - a.total);

  const financeiro = state.records.financeiro || [];
  const fiscal = state.records.fiscal || [];
  const compras = state.records.compras || [];
  const relatorios = state.records.relatorios || [];

  return {
    orders,
    periodOrders,
    products,
    users,
    audits,
    receita,
    pedidos,
    ticketMedio,
    totalItens,
    estoqueTotal,
    baixoEstoque,
    clientes,
    financeiro,
    fiscal,
    compras,
    relatorios,
  };
}

function metricCard(label, value, helper = "") {
  return `
    <article class="erp-kpi">
      <p>${label}</p>
      <h3>${value}</h3>
      <small>${helper}</small>
    </article>
  `;
}

function formatOrderRow(order) {
  return `
    <tr>
      <td>${order.id.toUpperCase()}</td>
      <td>${order.customerName}</td>
      <td>${order.paymentMethod}</td>
      <td>${order.status}</td>
      <td>${currency.format(order.totals.total)}</td>
      <td>${dateTime.format(new Date(order.createdAt))}</td>
    </tr>
  `;
}

function renderDashboard(data) {
  return `
    <div class="erp-grid-4">
      ${metricCard("Receita", currency.format(data.receita), "No periodo selecionado")}
      ${metricCard("Pedidos", String(data.pedidos), "Total de pedidos")}
      ${metricCard("Ticket medio", currency.format(data.ticketMedio), "Receita / pedidos")}
      ${metricCard("Itens vendidos", String(data.totalItens), "Volume comercial")}
    </div>

    <div class="erp-grid-2">
      <section class="erp-panel">
        <h2>Ultimos pedidos</h2>
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Pagamento</th>
                <th>Status</th>
                <th>Total</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              ${
                data.orders.length
                  ? data.orders.slice(0, 8).map(formatOrderRow).join("")
                  : '<tr><td colspan="6">Sem pedidos no sistema.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="erp-panel">
        <h2>Saude operacional</h2>
        <ul class="erp-list">
          <li><span>Produtos ativos</span><strong>${data.products.length}</strong></li>
          <li><span>Estoque total</span><strong>${data.estoqueTotal} un</strong></li>
          <li><span>Itens com baixo estoque</span><strong>${data.baixoEstoque.length}</strong></li>
          <li><span>Usuarios cadastrados</span><strong>${data.users.length}</strong></li>
          <li><span>Eventos auditados</span><strong>${data.audits.length}</strong></li>
        </ul>
      </section>
    </div>
  `;
}

function renderVendas(data) {
  const aprovados = data.periodOrders.filter(
    (order) => order.status === "Recebido",
  ).length;

  return `
    <div class="erp-grid-4">
      ${metricCard("Pedidos periodo", String(data.pedidos), "${state.periodDays} dias")}
      ${metricCard("Receita bruta", currency.format(data.receita), "Vendas totais")}
      ${metricCard("Aprovados", String(aprovados), "Status recebido")}
      ${metricCard("Ticket medio", currency.format(data.ticketMedio), "Performance comercial")}
    </div>

    <section class="erp-panel">
      <h2>Pipeline de pedidos</h2>
      <div class="erp-stage-row">
        <article><h3>${data.periodOrders.length}</h3><p>Recebido</p></article>
        <article><h3>${Math.max(0, data.periodOrders.length - 1)}</h3><p>Separacao</p></article>
        <article><h3>${Math.max(0, data.periodOrders.length - 2)}</h3><p>Faturado</p></article>
        <article><h3>${Math.max(0, data.periodOrders.length - 3)}</h3><p>Despachado</p></article>
      </div>
    </section>

    <section class="erp-panel">
      <h2>Pedidos detalhados</h2>
      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Pagamento</th>
              <th>Status</th>
              <th>Total</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            ${
              data.orders.length
                ? data.orders.map(formatOrderRow).join("")
                : '<tr><td colspan="6">Nenhum pedido encontrado.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>

    ${renderModuleCrud("vendas")}
  `;
}

function renderFinanceiro(data) {
  const contasReceber = data.financeiro.filter(
    (item) => String(item.kind || "").toLowerCase() === "receber",
  );
  const contasPagar = data.financeiro.filter(
    (item) => String(item.kind || "").toLowerCase() === "pagar",
  );

  const totalReceber = contasReceber.reduce(
    (sum, item) => sum + toNumber(item.value),
    0,
  );
  const totalPagar = contasPagar.reduce(
    (sum, item) => sum + toNumber(item.value),
    0,
  );

  return `
    <div class="erp-grid-3">
      ${metricCard("A receber", currency.format(totalReceber), "Pedidos gerados")}
      ${metricCard("A pagar", currency.format(totalPagar), "Compromissos proximos")}
      ${metricCard("Saldo projetado", currency.format(totalReceber - totalPagar), "Periodo atual")}
    </div>

    <div class="erp-grid-2">
      <section class="erp-panel">
        <h2>Contas a receber</h2>
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr><th>Descricao</th><th>Cliente</th><th>Valor</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${
                contasReceber.length
                  ? contasReceber
                      .map(
                        (item) => `
                    <tr>
                      <td>${item.description}</td>
                      <td>${item.linkedId || "Manual"}</td>
                      <td>${currency.format(toNumber(item.value))}</td>
                      <td>${item.status}</td>
                    </tr>
                  `,
                      )
                      .join("")
                  : '<tr><td colspan="4">Sem titulos.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="erp-panel">
        <h2>Contas a pagar</h2>
        <div class="erp-table-wrap">
          <table class="erp-table">
            <thead>
              <tr><th>Descricao</th><th>Vencimento</th><th>Valor</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${contasPagar
                .map(
                  (item) => `
                <tr>
                  <td>${item.description}</td>
                  <td>${item.linkedId || "Manual"}</td>
                  <td>${currency.format(toNumber(item.value))}</td>
                  <td>${item.status}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    ${renderModuleCrud("financeiro")}
  `;
}

function renderEstoque(data) {
  return `
    <div class="erp-grid-3">
      ${metricCard("SKU ativos", String(data.products.length), "Catalogo total")}
      ${metricCard("Estoque total", `${data.estoqueTotal} un`, "Soma de unidades")}
      ${metricCard("Baixo estoque", String(data.baixoEstoque.length), "Ponto de reposicao <= 10")}
    </div>

    <section class="erp-panel">
      <h2>Mapa de estoque</h2>
      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th>Marca</th>
              <th>Estoque</th>
              <th>Preco</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${data.products
              .map(
                (product) => `
              <tr>
                <td>${product.name}</td>
                <td>${product.category}</td>
                <td>${product.brand}</td>
                <td>${product.stock}</td>
                <td>${currency.format(product.price)}</td>
                <td>${product.stock <= 10 ? "Reposicao" : "OK"}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    ${renderModuleCrud("estoque")}
  `;
}

function renderClientes(data) {
  return `
    <div class="erp-grid-3">
      ${metricCard("Clientes ativos", String(data.clientes.length), "Com pedidos")}
      ${metricCard(
        "Recorrentes",
        String(data.clientes.filter((customer) => customer.orders > 1).length),
        "Mais de 1 compra",
      )}
      ${metricCard("Base usuarios", String(data.users.length), "Usuarios registrados")}
    </div>

    <section class="erp-panel">
      <h2>Ranking de clientes</h2>
      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Pedidos</th>
              <th>Faturamento</th>
              <th>Ultima compra</th>
            </tr>
          </thead>
          <tbody>
            ${
              data.clientes.length
                ? data.clientes
                    .map(
                      (customer) => `
                  <tr>
                    <td>${customer.name}</td>
                    <td>${toNumber(customer.orders)}</td>
                    <td>${currency.format(toNumber(customer.total))}</td>
                    <td>${dateTime.format(new Date(customer.lastAt))}</td>
                  </tr>
                `,
                    )
                    .join("")
                : '<tr><td colspan="4">Sem clientes para exibir.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>

    ${renderModuleCrud("clientes")}
  `;
}

function renderFiscal(data) {
  const docs = data.fiscal;

  return `
    <div class="erp-grid-3">
      ${metricCard(
        "NF-e autorizadas",
        String(
          docs.filter((doc) => String(doc.status) === "Autorizada").length,
        ),
        "No periodo",
      )}
      ${metricCard(
        "NF-e pendentes",
        String(docs.filter((doc) => String(doc.status) === "Pendente").length),
        "Aguardando processamento",
      )}
      ${metricCard("Base fiscal", `${docs.length} docs`, "Documentos simulados")}
    </div>

    <section class="erp-panel">
      <h2>Documentos fiscais</h2>
      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr><th>Tipo</th><th>Numero</th><th>Pedido</th><th>Valor</th><th>Status</th><th>Emissao</th></tr>
          </thead>
          <tbody>
            ${
              docs.length
                ? docs
                    .map(
                      (doc) => `
                  <tr>
                    <td>${doc.documentType || "NFE"}</td>
                    <td>${doc.number || doc.numero}</td>
                    <td>${doc.orderRef}</td>
                    <td>${currency.format(toNumber(doc.value))}</td>
                    <td>${doc.status}</td>
                    <td>${dateTime.format(new Date(doc.issuedAt))}</td>
                  </tr>
                `,
                    )
                    .join("")
                : '<tr><td colspan="6">Sem documentos fiscais.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>

    ${renderModuleCrud("fiscal")}
  `;
}

function renderCompras(data) {
  const sugestoes = data.compras;

  return `
    <div class="erp-grid-3">
      ${metricCard("Itens para reposicao", String(sugestoes.length), "Estoque baixo")}
      ${metricCard(
        "Volume sugerido",
        `${sugestoes.reduce((sum, item) => sum + toNumber(item.suggested), 0)} un`,
        "Compra recomendada",
      )}
      ${metricCard("Fornecedores", String(new Set(data.products.map((p) => p.brand)).size), "Base ativa")}
    </div>

    <section class="erp-panel">
      <h2>Sugestao de compras</h2>
      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr><th>Produto</th><th>Estoque atual</th><th>Compra sugerida</th><th>Fornecedor</th></tr>
          </thead>
          <tbody>
            ${
              sugestoes.length
                ? sugestoes
                    .map(
                      (item) => `
                  <tr>
                    <td>${item.product}</td>
                    <td>${toNumber(item.currentStock)}</td>
                    <td>${toNumber(item.suggested)}</td>
                    <td>${item.supplier}</td>
                  </tr>
                `,
                    )
                    .join("")
                : '<tr><td colspan="4">Sem necessidade de reposicao no momento.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>

    ${renderModuleCrud("compras")}
  `;
}

function renderRelatorios(data) {
  return `
    <div class="erp-grid-3">
      ${metricCard("Relatorio de vendas", "Pronto", "CSV completo")}
      ${metricCard("Relatorio de estoque", "Pronto", "Inventario atual")}
      ${metricCard("Relatorio financeiro", "Pronto", "Fluxo de caixa")}
    </div>

    <section class="erp-panel">
      <h2>Exportacoes rapidas</h2>
      <div class="erp-actions">
        <button class="btn secondary" data-export="vendas" type="button">Exportar vendas</button>
        <button class="btn secondary" data-export="estoque" type="button">Exportar estoque</button>
        <button class="btn secondary" data-export="financeiro" type="button">Exportar financeiro</button>
      </div>
      <p class="erp-note">Os arquivos sao gerados em CSV para importacao em planilhas.</p>
      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr><th>Indicador</th><th>Valor</th></tr>
          </thead>
          <tbody>
            <tr><td>Receita periodo</td><td>${currency.format(data.receita)}</td></tr>
            <tr><td>Pedidos periodo</td><td>${data.pedidos}</td></tr>
            <tr><td>Ticket medio</td><td>${currency.format(data.ticketMedio)}</td></tr>
            <tr><td>Estoque total</td><td>${data.estoqueTotal} un</td></tr>
            ${data.relatorios
              .map(
                (item) =>
                  `<tr><td>${item.indicator}</td><td>${item.value}</td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    ${renderModuleCrud("relatorios")}
  `;
}

function renderAuditoria(data) {
  return `
    <div class="erp-grid-3">
      ${metricCard("Eventos", String(data.audits.length), "Historico total")}
      ${metricCard(
        "Acoes de compra",
        String(
          data.audits.filter(
            (log) => log.type.includes("cart") || log.type.includes("checkout"),
          ).length,
        ),
        "Carrinho e checkout",
      )}
      ${metricCard("Buscas", String(data.audits.filter((log) => log.type === "search").length), "Intencao de compra")}
    </div>

    <section class="erp-panel">
      <h2>Timeline de auditoria</h2>
      <div class="erp-table-wrap">
        <table class="erp-table">
          <thead>
            <tr><th>Data</th><th>Tipo</th><th>Detalhe</th></tr>
          </thead>
          <tbody>
            ${
              data.audits.length
                ? data.audits
                    .slice(0, 60)
                    .map(
                      (log) => `
                  <tr>
                    <td>${dateTime.format(new Date(log.createdAt))}</td>
                    <td>${log.type}</td>
                    <td>${log.detail}</td>
                  </tr>
                `,
                    )
                    .join("")
                : '<tr><td colspan="3">Sem eventos de auditoria.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>

    ${renderModuleCrud("auditoria")}
  `;
}

function renderFieldInput(record, field, moduleKey) {
  const value = escapeAttr(record[field.key] ?? "");
  const isReadOnly = record.source === "sync";

  if (field.type === "select") {
    const disabled = isReadOnly ? "disabled" : "";
    const options = (field.options || [])
      .map((option) => {
        const selected =
          String(option) === String(record[field.key]) ? "selected" : "";
        const safeOption = escapeAttr(option);
        return `<option value="${safeOption}" ${selected}>${safeOption}</option>`;
      })
      .join("");
    return `<select ${disabled} data-record-field="${field.key}">${options}</select>`;
  }

  const readOnly = isReadOnly ? "readonly" : "";
  const step = field.type === "number" ? 'step="0.01"' : "";
  return `<input ${step} ${readOnly} type="${field.type === "number" ? "number" : "text"}" data-record-field="${field.key}" value="${value}" />`;
}

function renderModuleCrud(moduleKey) {
  const schema = getSchema(moduleKey);
  const records = state.records[moduleKey] || [];
  const stockTemplates =
    moduleKey === "estoque"
      ? [
          { name: "Racao Premium 15kg", category: "Racao", brand: "Premier" },
          { name: "Petisco Natural", category: "Petisco", brand: "Casa Verde" },
          {
            name: "Brinquedo Mordedor",
            category: "Brinquedo",
            brand: "Golden",
          },
          { name: "Shampoo Pet", category: "Higiene", brand: "Casa Verde" },
        ]
      : [];

  const head = schema.fields.map((field) => `<th>${field.label}</th>`).join("");

  const rows = records.length
    ? records
        .map(
          (record) => `
      <tr data-record-id="${record.id}" data-module-key="${moduleKey}">
        ${schema.fields.map((field) => `<td>${renderFieldInput(record, field, moduleKey)}</td>`).join("")}
        <td>${record.source === "sync" ? "Sincronizado" : "Manual"}</td>
        <td>
          <div class="erp-option-actions">
            <button class="erp-mini-btn" data-record-action="save" data-module-key="${moduleKey}" data-record-id="${record.id}" type="button">Salvar</button>
            <button class="erp-mini-btn" data-record-action="duplicate" data-module-key="${moduleKey}" data-record-id="${record.id}" type="button">Duplicar</button>
            <button class="erp-mini-btn danger" data-record-action="delete" data-module-key="${moduleKey}" data-record-id="${record.id}" type="button">Excluir</button>
          </div>
        </td>
      </tr>
    `,
        )
        .join("")
    : `<tr><td colspan="${schema.fields.length + 2}">Sem registros neste modulo.</td></tr>`;

  const addInputs = schema.fields
    .map((field) => {
      if (field.type === "select") {
        const options = (field.options || [])
          .map((option) => {
            const selected =
              String(option) === String(schema.defaults[field.key] ?? "")
                ? "selected"
                : "";
            const safeOption = escapeAttr(option);
            return `<option value="${safeOption}" ${selected}>${safeOption}</option>`;
          })
          .join("");
        return `<select data-add-field="${field.key}" ${field.key === schema.fields[0].key ? "required" : ""}>${options}</select>`;
      }

      const type = field.type === "number" ? "number" : "text";
      const step = field.type === "number" ? 'step="0.01"' : "";
      const defaultValue = escapeAttr(schema.defaults[field.key] ?? "");
      return `<input ${step} data-add-field="${field.key}" type="${type}" placeholder="${field.label}" value="${defaultValue}" ${field.key === schema.fields[0].key ? "required" : ""} />`;
    })
    .join("");

  return `
    <section class="erp-panel">
      <h2>Gestao de ${schema.title}</h2>
      <p class="erp-note">CRUD por modulo com sincronizacao automatica de dados relacionados.</p>

      <div class="erp-table-wrap">
        <table class="erp-options-table">
          <thead>
            <tr>
              ${head}
              <th>Origem</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>

      <form class="erp-option-form" data-module-form="${moduleKey}">
        ${
          stockTemplates.length
            ? `
        <select data-stock-template="${moduleKey}" aria-label="Modelo de item">
          <option value="">Modelo rápido (opcional)</option>
          ${stockTemplates
            .map(
              (preset) =>
                `<option value="${escapeAttr(JSON.stringify(preset))}">${escapeAttr(preset.name)}</option>`,
            )
            .join("")}
        </select>
        `
            : ""
        }
        ${addInputs}
        <button class="btn primary" type="submit">Adicionar registro</button>
      </form>

      <p id="erp-module-feedback" class="erp-feedback">${state.moduleFeedback[moduleKey] || ""}</p>
    </section>
  `;
}

function renderConfig(data) {
  const session = getSession();

  const optionsRows = state.options
    .map(
      (option) => `
      <tr data-option-key="${option.key}">
        <td><input data-field="label" type="text" value="${option.label}" /></td>
        <td><input data-field="key" type="text" value="${option.key}" ${option.locked ? "readonly" : ""} /></td>
        <td><input data-field="category" type="text" value="${option.category}" /></td>
        <td>${option.locked ? "Protegida" : "Custom"}</td>
        <td>
          <div class="erp-option-actions">
            <button class="erp-mini-btn" data-option-action="save" data-option-key="${option.key}" type="button">Salvar</button>
            <button class="erp-mini-btn" data-option-action="duplicate" data-option-key="${option.key}" type="button">Duplicar</button>
            <button class="erp-mini-btn danger" data-option-action="delete" data-option-key="${option.key}" type="button">Excluir</button>
          </div>
        </td>
      </tr>
    `,
    )
    .join("");

  return `
    <div class="erp-grid-2">
      <section class="erp-panel">
        <h2>Padroes visuais</h2>
        <ul class="erp-list">
          <li><span>Fonte principal</span><strong>Manrope</strong></li>
          <li><span>Fonte de destaque</span><strong>Manrope</strong></li>
          <li><span>Cor primaria</span><strong>#1f6b45</strong></li>
          <li><span>Cor secundaria</span><strong>#3f9b63</strong></li>
          <li><span>Cor de apoio</span><strong>#eab75c</strong></li>
        </ul>
      </section>

      <section class="erp-panel">
        <h2>Sessao e governanca</h2>
        <ul class="erp-list">
          <li><span>Usuario logado</span><strong>${session?.name || "-"}</strong></li>
          <li><span>Perfil</span><strong>${session?.role || "admin"}</strong></li>
          <li><span>Login por MFA</span><strong>${session?.mfa ? "Sim" : "Nao"}</strong></li>
          <li><span>Usuarios internos</span><strong>${data.users.length}</strong></li>
          <li><span>Integracao Instagram</span><strong>Ativa</strong></li>
        </ul>
      </section>
    </div>

    <section class="erp-panel">
      <h2>Gerenciar opcoes do ERP</h2>
      <p class="erp-note">Use esta area para adicionar, editar, duplicar ou excluir modulos do menu lateral.</p>

      <div class="erp-table-wrap">
        <table class="erp-options-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Chave</th>
              <th>Categoria</th>
              <th>Tipo</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${optionsRows}
          </tbody>
        </table>
      </div>

      <form id="erp-option-form" class="erp-option-form">
        <input id="new-option-label" type="text" placeholder="Nome da nova opcao" required />
        <input id="new-option-key" type="text" placeholder="Chave (ex: pos-venda)" />
        <select id="new-option-category">
          <option>Geral</option>
          <option>Comercial</option>
          <option>Financeiro</option>
          <option>Operacao</option>
          <option>Fiscal</option>
          <option>Sistema</option>
        </select>
        <button class="btn primary" type="submit">Adicionar opcao</button>
      </form>

      <p id="erp-options-feedback" class="erp-feedback">${state.configFeedback}</p>
    </section>

    ${renderModuleCrud("config")}
  `;
}

function renderCustomView(option) {
  const moduleKey = option.key;
  return `
    <div class="erp-grid-3">
      ${metricCard("Modulo", option.label, option.category)}
      ${metricCard("Status", "Ativo", "Opcao customizavel")}
      ${metricCard("Ultima revisao", new Date().toLocaleDateString("pt-BR"), "Edite em Configuracoes")}
    </div>
    <section class="erp-panel">
      <h2>${option.label}</h2>
      <p class="erp-note">Esta e uma opcao customizada do ERP. Voce pode editar, duplicar ou excluir em Configuracoes.</p>
    </section>

    ${renderModuleCrud(moduleKey)}
  `;
}

function getViewMarkup(data) {
  if (state.view === "dashboard") {
    return `${renderDashboard(data)}${renderModuleCrud("dashboard")}`;
  }
  if (state.view === "vendas") {
    return renderVendas(data);
  }
  if (state.view === "financeiro") {
    return renderFinanceiro(data);
  }
  if (state.view === "estoque") {
    return renderEstoque(data);
  }
  if (state.view === "clientes") {
    return renderClientes(data);
  }
  if (state.view === "fiscal") {
    return renderFiscal(data);
  }
  if (state.view === "compras") {
    return renderCompras(data);
  }
  if (state.view === "relatorios") {
    return renderRelatorios(data);
  }
  if (state.view === "auditoria") {
    return renderAuditoria(data);
  }

  if (state.view === "config") {
    return renderConfig(data);
  }

  const option = getOptionByKey(state.view);
  return renderCustomView(option || { label: "Modulo", category: "Geral" });
}

function render() {
  const data = getDataset();
  const meta = viewMeta[state.view] || {
    title: getOptionByKey(state.view)?.label || "Modulo ERP",
    subtitle: "Opcao customizada do sistema ERP.",
  };

  byId("erp-title").textContent = meta.title;
  byId("erp-subtitle").textContent = meta.subtitle;
  byId("erp-content").innerHTML = getViewMarkup(data);
  renderNav();
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  byId("erp-nav").addEventListener("click", (event) => {
    const button = event.target.closest(".erp-nav-item");

    if (!button) {
      return;
    }

    state.view = button.dataset.view;
    render();
  });

  byId("erp-period").addEventListener("change", (event) => {
    state.periodDays = Number(event.target.value);
    render();
  });

  byId("erp-refresh").addEventListener("click", () => {
    render();
  });

  byId("erp-module-search")?.addEventListener("change", (event) => {
    const typed = String(event.target.value || "")
      .trim()
      .toLowerCase();
    const option = state.options.find(
      (item) =>
        item.label.toLowerCase() === typed || item.key.toLowerCase() === typed,
    );

    if (!option) {
      return;
    }

    state.view = option.key;
    render();
  });

  byId("erp-logout").addEventListener("click", () => {
    logout();
    navigateTo("login.html");
  });

  byId("erp-content").addEventListener("click", (event) => {
    const recordActionButton = event.target.closest(
      "button[data-record-action]",
    );

    if (recordActionButton) {
      const action = recordActionButton.dataset.recordAction;
      const moduleKey = recordActionButton.dataset.moduleKey;
      const recordId = recordActionButton.dataset.recordId;

      if (action === "duplicate") {
        duplicateModuleRecord(moduleKey, recordId);
        return;
      }

      if (action === "delete") {
        deleteModuleRecord(moduleKey, recordId);
        return;
      }

      if (action === "save") {
        const row = event.target.closest("tr[data-record-id]");
        if (!row) {
          return;
        }
        const payload = collectRowPayload(row, moduleKey);
        updateModuleRecord(moduleKey, recordId, payload);
        return;
      }
    }

    const optionActionButton = event.target.closest(
      "button[data-option-action]",
    );

    if (optionActionButton) {
      const action = optionActionButton.dataset.optionAction;
      const optionKey = optionActionButton.dataset.optionKey;
      const row = event.target.closest("tr[data-option-key]");

      if (action === "duplicate") {
        duplicateOption(optionKey);
        return;
      }

      if (action === "delete") {
        deleteOption(optionKey);
        return;
      }

      if (action === "save" && row) {
        const label = row.querySelector('[data-field="label"]').value;
        const key = row.querySelector('[data-field="key"]').value;
        const category = row.querySelector('[data-field="category"]').value;
        updateOption(optionKey, { label, key, category });
        return;
      }
    }

    const exportButton = event.target.closest("button[data-export]");

    if (!exportButton) {
      return;
    }

    const data = getDataset();
    const type = exportButton.dataset.export;

    if (type === "vendas") {
      const rows = [
        ["Pedido", "Cliente", "Pagamento", "Status", "Total", "Data"],
        ...data.orders.map((order) => [
          order.id.toUpperCase(),
          order.customerName,
          order.paymentMethod,
          order.status,
          order.totals.total,
          order.createdAt,
        ]),
      ];
      downloadCsv("vendas.csv", rows);
    }

    if (type === "estoque") {
      const rows = [
        ["Produto", "Categoria", "Marca", "Estoque", "Preco"],
        ...data.products.map((product) => [
          product.name,
          product.category,
          product.brand,
          product.stock,
          product.price,
        ]),
      ];
      downloadCsv("estoque.csv", rows);
    }

    if (type === "financeiro") {
      const rows = [
        ["Indicador", "Valor"],
        ["Receita periodo", data.receita],
        ["Pedidos", data.pedidos],
        ["Ticket medio", data.ticketMedio],
      ];
      downloadCsv("financeiro.csv", rows);
    }
  });

  byId("erp-content").addEventListener("submit", (event) => {
    const moduleForm = event.target.closest("form[data-module-form]");

    if (moduleForm) {
      event.preventDefault();
      const moduleKey = moduleForm.dataset.moduleForm;
      const payload = {};

      moduleForm.querySelectorAll("[data-add-field]").forEach((input) => {
        const field = input.dataset.addField;
        payload[field] = input.value;
      });

      addModuleRecord(moduleKey, payload);
      moduleForm.reset();
      return;
    }

    const form = event.target.closest("#erp-option-form");

    if (!form) {
      return;
    }

    event.preventDefault();

    const label = byId("new-option-label")?.value;
    const key = byId("new-option-key")?.value;
    const category = byId("new-option-category")?.value;

    addOption({ label, key, category });
    form.reset();
  });

  byId("erp-content").addEventListener("change", (event) => {
    const templateSelect = event.target.closest("select[data-stock-template]");
    if (!templateSelect) {
      return;
    }

    const moduleKey = templateSelect.dataset.stockTemplate;
    const form = templateSelect.closest(
      `form[data-module-form="${moduleKey}"]`,
    );
    if (!form || !templateSelect.value) {
      return;
    }

    try {
      const preset = JSON.parse(templateSelect.value);
      Object.entries(preset).forEach(([key, value]) => {
        const input = form.querySelector(`[data-add-field="${key}"]`);
        if (input) {
          input.value = String(value);
        }
      });

      const stockInput = form.querySelector('[data-add-field="stock"]');
      const priceInput = form.querySelector('[data-add-field="price"]');
      if (stockInput) {
        stockInput.value = "1";
      }
      if (priceInput) {
        priceInput.value = "0";
      }

      const feedback = form.parentElement?.querySelector(
        "#erp-module-feedback",
      );
      if (feedback) {
        feedback.textContent =
          "Modelo aplicado. Ajuste somente estoque e preco.";
      }
    } catch {
      const feedback = form.parentElement?.querySelector(
        "#erp-module-feedback",
      );
      if (feedback) {
        feedback.textContent = "Falha ao aplicar modelo rapido.";
      }
    }
  });
}

function start() {
  state.options = loadOptions();
  state.records = loadRecords();

  state.records = synchronizeRecords(state.records);
  persistRecords();

  if (!state.options.some((option) => option.key === state.view)) {
    state.view = "dashboard";
  }

  render();
  bindEvents();
}

document.addEventListener("DOMContentLoaded", start);
