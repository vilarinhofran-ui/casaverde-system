import { db } from "../core/db.js";
import { resolveCoupon } from "./commerce.js";

const CART_KEY = "casaverde_cart";
const ORDERS_KEY = "casaverde_orders";
const ACTIVE_COUPON_KEY = "casaverde_coupon";

export const ORDER_STATUS_OPTIONS = [
  "Recebido",
  "Em separacao",
  "Aguardando pagamento",
  "Pago",
  "Em rota",
  "Pronto para retirada",
  "Concluido",
  "Cancelado",
];

export const FISCAL_DOCUMENT_OPTIONS = ["NFE", "NFCE", "RECEIPT", "INTERNAL"];

export function getCart() {
  return db.read(CART_KEY, []);
}

export function addToCart(productId, quantity = 1) {
  const safeQuantity = Math.max(1, Number(quantity) || 1);

  return db.update(CART_KEY, [], (current) => {
    const existing = current.find((item) => item.productId === productId);

    if (existing) {
      return current.map((item) =>
        item.productId === productId
          ? { ...item, quantity: item.quantity + safeQuantity }
          : item,
      );
    }

    return [...current, { productId, quantity: safeQuantity }];
  });
}

export function updateCartItem(productId, quantity) {
  const safeQuantity = Math.max(0, Number(quantity) || 0);

  return db.update(CART_KEY, [], (current) => {
    if (safeQuantity === 0) {
      return current.filter((item) => item.productId !== productId);
    }

    return current.map((item) =>
      item.productId === productId ? { ...item, quantity: safeQuantity } : item,
    );
  });
}

export function removeFromCart(productId) {
  return db.update(CART_KEY, [], (current) =>
    current.filter((item) => item.productId !== productId),
  );
}

export function clearCart() {
  return db.write(CART_KEY, []);
}

export function applyCoupon(code) {
  const result = resolveCoupon(code);
  if (!result.ok) {
    db.write(ACTIVE_COUPON_KEY, null);
    return { ok: false, message: result.message };
  }

  const active = {
    id: result.coupon.id,
    code: result.coupon.code,
    type: result.coupon.type,
    value: result.coupon.value,
    minSubtotal: Number(result.coupon.minSubtotal || 0),
    maxDiscount: Number(result.coupon.maxDiscount || 0),
    description: result.coupon.description || "",
    expiresAt: result.coupon.expiresAt || null,
  };

  db.write(ACTIVE_COUPON_KEY, active);
  return { ok: true, message: `Cupom aplicado: ${active.code}` };
}

export function getActiveCoupon() {
  return db.read(ACTIVE_COUPON_KEY, null);
}

export function calculateShipping({ subtotal, deliveryMode, cep }) {
  if (subtotal <= 0) {
    return 0;
  }

  if (deliveryMode === "pickup") {
    return 0;
  }

  if (subtotal >= 299) {
    return 0;
  }

  const normalizedCep = String(cep || "").replace(/\D/g, "");
  if (normalizedCep.length < 8) {
    return 24.9;
  }

  const prefix = Number(normalizedCep.slice(0, 3));
  if (prefix <= 199) {
    return 14.9;
  }

  if (prefix <= 399) {
    return 19.9;
  }

  if (prefix <= 699) {
    return 27.9;
  }

  return 34.9;
}

export function calculateTotals(cartItems, productLookup, options = {}) {
  const entries = cartItems
    .map((item) => {
      const product = productLookup(item.productId);
      if (!product) {
        return null;
      }

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: product.price,
        subtotal: product.price * item.quantity,
      };
    })
    .filter(Boolean);

  const subtotal = entries.reduce((sum, item) => sum + item.subtotal, 0);
  const itemsCount = entries.reduce((sum, item) => sum + item.quantity, 0);
  const deliveryMode = options.deliveryMode || "delivery";
  const shipping = calculateShipping({
    subtotal,
    deliveryMode,
    cep: options.cep,
  });

  let discount = 0;
  const activeCoupon = getActiveCoupon();
  if (activeCoupon && subtotal >= Number(activeCoupon.minSubtotal || 0)) {
    if (activeCoupon.type === "fixed") {
      discount = Number(activeCoupon.value || 0);
    } else {
      discount = subtotal * (Number(activeCoupon.value || 0) / 100);
    }

    const maxDiscount = Number(activeCoupon.maxDiscount || 0);
    if (maxDiscount > 0) {
      discount = Math.min(discount, maxDiscount);
    }
  }

  const total = Math.max(0, subtotal + shipping - discount);

  return {
    itemsCount,
    subtotal,
    shipping,
    discount,
    total,
    deliveryMode,
  };
}

export function listSales() {
  return db.read(ORDERS_KEY, []);
}

export function listOrdersByCustomerId(customerId) {
  return listSales().filter((order) => order.customerId === customerId);
}

export function updateOrderStatus(orderId, status) {
  if (!ORDER_STATUS_OPTIONS.includes(status)) {
    return { ok: false, message: "Status de venda invalido." };
  }

  let updatedOrder = null;

  db.update(ORDERS_KEY, [], (orders) =>
    orders.map((order) => {
      if (order.id !== orderId) {
        return order;
      }

      updatedOrder = {
        ...order,
        status,
        updatedAt: new Date().toISOString(),
      };

      return updatedOrder;
    }),
  );

  if (!updatedOrder) {
    return { ok: false, message: "Pedido nao encontrado." };
  }

  return { ok: true, order: updatedOrder };
}

export function placeOrder(orderInput, productLookup) {
  const cart = getCart();
  const totals = calculateTotals(cart, productLookup, {
    deliveryMode: orderInput.deliveryMode,
    cep: orderInput.cep,
  });

  if (cart.length === 0) {
    return { ok: false, message: "Carrinho vazio." };
  }

  if (totals.deliveryMode === "delivery" && !orderInput.address) {
    return { ok: false, message: "Informe o endereco para entrega." };
  }

  const order = {
    id: db.uid("ord"),
    createdAt: new Date().toISOString(),
    status:
      totals.deliveryMode === "pickup" ? "Pronto para retirada" : "Recebido",
    customerId: orderInput.customerId || null,
    customerName: orderInput.customerName || "Cliente Casa Verde",
    paymentMethod: orderInput.paymentMethod || "Pix",
    fiscalDocumentType: orderInput.fiscalDocumentType || "NFE",
    notes: orderInput.notes || "",
    deliveryMode: totals.deliveryMode,
    cep: orderInput.cep || "",
    address: orderInput.address || "",
    items: cart,
    totals,
  };

  db.update(ORDERS_KEY, [], (current) => [order, ...current]);
  clearCart();
  db.write(ACTIVE_COUPON_KEY, null);

  return { ok: true, order };
}
