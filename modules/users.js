import { db } from "../core/db.js";

const FAVORITES_KEY = "casaverde_favorites";
const PROFILE_KEY = "casaverde_profile";
const CUSTOMER_USERS_KEY = "casaverde_customer_users";
const CUSTOMER_SESSION_KEY = "casaverde_customer_session";

const defaultProfile = {
  name: "Tutor Casa Verde",
  email: "tutor@casaverde.com",
  city: "Curitiba",
  pets: ["Cachorro", "Gato"],
};

const defaultCustomers = [
  {
    id: "cli_super_admin_demo",
    name: "VTS Super Admin",
    email: "vilarinhotechsolutionsvts@gmail.com",
    phone: "",
    role: "super_admin",
    createdAt: new Date().toISOString(),
    seedPassword: "Admin123.",
    passwordSalt: "demo",
    passwordHash: "demo",
  },
  {
    id: "cli_admin_demo",
    name: "Admin Loja",
    email: "admin@casaverde.com",
    phone: "",
    role: "admin",
    createdAt: new Date().toISOString(),
    seedPassword: "123456",
    passwordSalt: "demo",
    passwordHash: "demo",
  },
  {
    id: "cli_demo",
    name: "Cliente Demo",
    email: "cliente@casaverde.com",
    phone: "",
    role: "customer",
    createdAt: new Date().toISOString(),
    seedPassword: "123456",
    passwordSalt: "demo",
    passwordHash: "demo",
  },
];

function normalizeCredential(value) {
  return normalizeText(value, 120).toLowerCase();
}

function synchronizeDefaultCustomers(existing = []) {
  const users = Array.isArray(existing) ? [...existing] : [];

  for (const seed of defaultCustomers) {
    const seedEmail = normalizeCredential(seed.email);
    const index = users.findIndex(
      (user) =>
        String(user?.id || "") === seed.id ||
        normalizeCredential(user?.email) === seedEmail,
    );

    if (index < 0) {
      users.push({ ...seed, createdAt: new Date().toISOString() });
      continue;
    }

    users[index] = {
      ...users[index],
      id: seed.id,
      name: seed.name,
      email: seed.email,
      role: seed.role,
      seedPassword: seed.seedPassword,
      passwordSalt: users[index].passwordSalt || seed.passwordSalt,
      passwordHash: users[index].passwordHash || seed.passwordHash,
      createdAt: users[index].createdAt || seed.createdAt,
    };
  }

  return users;
}

function ensureCustomerAccounts() {
  const existing = db.read(CUSTOMER_USERS_KEY, null);
  if (Array.isArray(existing) && existing.length) {
    const synced = synchronizeDefaultCustomers(existing);
    db.write(CUSTOMER_USERS_KEY, synced);
    return synced;
  }

  const seeded = synchronizeDefaultCustomers([]);
  db.write(CUSTOMER_USERS_KEY, seeded);
  return seeded;
}

function normalizeText(value, max = 160) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

function hasMinimumPasswordStrength(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(hash);
}

async function hashPassword(password, salt) {
  return sha256Hex(`${salt}:${password}`);
}

export function getUserProfile() {
  return db.read(PROFILE_KEY, defaultProfile);
}

export function updateUserProfile(changes) {
  return db.update(PROFILE_KEY, defaultProfile, (current) => ({
    ...current,
    ...changes,
  }));
}

export function listUsers() {
  return [
    {
      id: "usr_1",
      role: "admin",
      ...getUserProfile(),
    },
  ];
}

export function getFavorites() {
  return db.read(FAVORITES_KEY, []);
}

export function isFavorite(productId) {
  return getFavorites().includes(productId);
}

export function toggleFavorite(productId) {
  return db.update(FAVORITES_KEY, [], (current) => {
    if (current.includes(productId)) {
      return current.filter((id) => id !== productId);
    }

    return [...current, productId];
  });
}

export function listCustomerAccounts() {
  return ensureCustomerAccounts();
}

export function findCustomerAccountByEmail(email) {
  const normalized = normalizeText(email, 120).toLowerCase();
  return (
    listCustomerAccounts().find((user) => user.email === normalized) || null
  );
}

export async function registerCustomerAccount(payload) {
  const name = normalizeText(payload?.name, 80);
  const email = normalizeText(payload?.email, 120).toLowerCase();
  const password = String(payload?.password || "").trim();
  const phone = normalizeText(payload?.phone, 24);

  if (!name || !email || !password) {
    return { ok: false, message: "Preencha nome, e-mail e senha." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "Informe um e-mail valido." };
  }

  if (!hasMinimumPasswordStrength(password)) {
    return {
      ok: false,
      message:
        "Use senha forte com 8+ caracteres, letra maiuscula, minuscula e numero.",
    };
  }

  const current = listCustomerAccounts();
  if (current.some((user) => user.email === email)) {
    return { ok: false, message: "Ja existe conta com este e-mail." };
  }

  const passwordSalt = randomSalt();
  const passwordHash = await hashPassword(password, passwordSalt);

  const next = {
    id: db.uid("cli"),
    name,
    email,
    phone,
    role: "customer",
    createdAt: new Date().toISOString(),
    passwordSalt,
    passwordHash,
  };

  db.update(CUSTOMER_USERS_KEY, defaultCustomers, (users) => [next, ...users]);

  return {
    ok: true,
    account: {
      id: next.id,
      name: next.name,
      email: next.email,
      phone: next.phone,
      role: next.role,
      createdAt: next.createdAt,
    },
  };
}

export async function loginCustomerAccount(payload) {
  const email = normalizeText(payload?.email, 120).toLowerCase();
  const password = String(payload?.password || "").trim();

  const match = listCustomerAccounts().find((user) => user.email === email);

  if (!match) {
    return { ok: false, message: "Credenciais invalidas." };
  }

  if (match.passwordHash === "demo" && match.passwordSalt === "demo") {
    const seedPassword = String(match.seedPassword || "123456");
    const isSuperAdminDemo =
      normalizeCredential(match.email) ===
      "vilarinhotechsolutionsvts@gmail.com";
    const isLegacySuperAdminPassword =
      isSuperAdminDemo &&
      (password === "Admin123" || password === "Admin123.") &&
      (seedPassword === "Admin123" || seedPassword === "Admin123.");

    if (password !== seedPassword && !isLegacySuperAdminPassword) {
      return { ok: false, message: "Credenciais invalidas." };
    }
  } else {
    const candidateHash = await hashPassword(password, match.passwordSalt);
    if (candidateHash !== match.passwordHash) {
      return { ok: false, message: "Credenciais invalidas." };
    }
  }

  const session = {
    customerId: match.id,
    name: match.name,
    email: match.email,
    role: match.role || "customer",
    loggedAt: new Date().toISOString(),
  };

  db.write(CUSTOMER_SESSION_KEY, session);

  return { ok: true, session };
}

export function loginCustomerWithOAuth(payload) {
  const email = normalizeText(payload?.email, 120).toLowerCase();
  const name = normalizeText(payload?.name || "Cliente OAuth", 80);
  const provider = normalizeText(
    payload?.provider || "oauth",
    32,
  ).toLowerCase();

  if (!email) {
    return { ok: false, message: "OAuth sem e-mail confirmado." };
  }

  let account = findCustomerAccountByEmail(email);

  if (!account) {
    account = {
      id: db.uid("cli"),
      name,
      email,
      phone: "",
      role: "customer",
      authProvider: provider,
      createdAt: new Date().toISOString(),
      passwordSalt: "oauth",
      passwordHash: "oauth",
    };

    db.update(CUSTOMER_USERS_KEY, defaultCustomers, (users) => [
      account,
      ...users,
    ]);
  } else if (account.authProvider !== provider) {
    db.update(CUSTOMER_USERS_KEY, defaultCustomers, (users) =>
      users.map((user) =>
        user.email === email
          ? {
              ...user,
              authProvider: provider,
              name: user.name || name,
            }
          : user,
      ),
    );
    account = {
      ...account,
      authProvider: provider,
      name: account.name || name,
    };
  }

  const session = {
    customerId: account.id,
    name: account.name || name,
    email: account.email,
    role: account.role || "customer",
    authProvider: provider,
    loggedAt: new Date().toISOString(),
  };

  db.write(CUSTOMER_SESSION_KEY, session);

  return { ok: true, session, account };
}

export function getCustomerSession() {
  const session = db.read(CUSTOMER_SESSION_KEY, null);
  if (!session) {
    return null;
  }

  if (session.role) {
    return session;
  }

  const account = listCustomerAccounts().find(
    (user) => user.id === session.customerId || user.email === session.email,
  );

  return {
    ...session,
    role: account?.role || "customer",
  };
}

export function logoutCustomerAccount() {
  db.write(CUSTOMER_SESSION_KEY, null);
}
