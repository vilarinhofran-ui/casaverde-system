import { db } from "./db.js";

const SESSION_KEY = "casaverde_session";
const ADMIN_CHALLENGE_KEY = "casaverde_admin_challenge";
const USERS_KEY = "casaverde_users";
const ACCESS_REQUESTS_KEY = "casaverde_access_requests";

const ROLE = {
  CAIXA: "caixa",
  SUPERVISOR: "supervisor",
  ADMIN: "admin",
  SUPER_ADMIN: "super_admin",
};

const SEED_USERS = [
  {
    id: "usr_super_admin_vts",
    username: "vilarinhotechsolutionsvts@gmail.com",
    email: "vilarinhotechsolutionsvts@gmail.com",
    password: "Admin123",
    name: "VTS Super Admin",
    role: ROLE.SUPER_ADMIN,
    approved: true,
    approvedByRole: ROLE.SUPER_ADMIN,
    createdAt: new Date().toISOString(),
  },
  {
    id: "usr_admin_legacy",
    username: "admin",
    email: "admin@casaverde.com",
    password: "123456",
    name: "Administrador",
    role: ROLE.ADMIN,
    approved: true,
    approvedByRole: ROLE.SUPER_ADMIN,
    createdAt: new Date().toISOString(),
  },
  {
    id: "usr_supervisor_demo",
    username: "supervisor",
    email: "supervisor@casaverde.com",
    password: "123456",
    name: "Supervisor",
    role: ROLE.SUPERVISOR,
    approved: true,
    approvedByRole: ROLE.ADMIN,
    createdAt: new Date().toISOString(),
  },
  {
    id: "usr_caixa_demo",
    username: "caixa",
    email: "caixa@casaverde.com",
    password: "123456",
    name: "Operador Caixa",
    role: ROLE.CAIXA,
    approved: true,
    approvedByRole: ROLE.ADMIN,
    createdAt: new Date().toISOString(),
  },
];

function normalizeCredential(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function synchronizeSeedUsers(existing = []) {
  const users = Array.isArray(existing) ? [...existing] : [];

  for (const seed of SEED_USERS) {
    const seedUsername = normalizeCredential(seed.username);
    const seedEmail = normalizeCredential(seed.email);

    const index = users.findIndex((user) => {
      return (
        String(user?.id || "") === seed.id ||
        normalizeCredential(user?.username) === seedUsername ||
        normalizeCredential(user?.email) === seedEmail
      );
    });

    if (index < 0) {
      users.push({
        ...seed,
        createdAt: new Date().toISOString(),
      });
      continue;
    }

    users[index] = {
      ...users[index],
      id: seed.id,
      username: seed.username,
      email: seed.email,
      password: seed.password,
      name: seed.name,
      role: seed.role,
      approved: true,
      approvedByRole: seed.approvedByRole,
      createdAt: users[index].createdAt || seed.createdAt,
    };
  }

  return users;
}

function ensureUsers() {
  const existing = db.read(USERS_KEY, null);
  if (Array.isArray(existing) && existing.length > 0) {
    const synced = synchronizeSeedUsers(existing);
    db.write(USERS_KEY, synced);
    return synced;
  }

  const seeded = synchronizeSeedUsers([]);
  db.write(USERS_KEY, seeded);
  return seeded;
}

function saveUsers(users) {
  db.write(USERS_KEY, users);
  return users;
}

function requiredApproverRole(requestedRole) {
  if (requestedRole === ROLE.ADMIN || requestedRole === ROLE.SUPER_ADMIN) {
    return ROLE.SUPER_ADMIN;
  }
  return ROLE.ADMIN;
}

function canApproveRole(approverRole, requestedRole) {
  if (approverRole === ROLE.SUPER_ADMIN) {
    return true;
  }

  if (approverRole === ROLE.ADMIN) {
    return requestedRole === ROLE.CAIXA || requestedRole === ROLE.SUPERVISOR;
  }

  return false;
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    approved: Boolean(user.approved),
    approvedByRole: user.approvedByRole || null,
    createdAt: user.createdAt,
  };
}

function findUserByCredential(credential) {
  const safeCredential = normalizeCredential(credential);
  const users = ensureUsers();

  return (
    users.find((user) => {
      const username = String(user.username || "").toLowerCase();
      const email = String(user.email || "").toLowerCase();
      return username === safeCredential || email === safeCredential;
    }) || null
  );
}

function isSuperAdminCredential(credential) {
  const safeCredential = normalizeCredential(credential);
  return safeCredential === "vilarinhotechsolutionsvts@gmail.com";
}

function isPasswordValid(user, safePassword, credential) {
  const userPassword = String(user?.password || "").trim();
  if (userPassword === safePassword) {
    return true;
  }

  if (!isSuperAdminCredential(credential)) {
    return false;
  }

  return (
    (safePassword === "Admin123" || safePassword === "Admin123.") &&
    (userPassword === "Admin123" || userPassword === "Admin123.")
  );
}

function setSessionFromUser(user, extras = {}) {
  const session = {
    userId: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    loggedAt: new Date().toISOString(),
    ...extras,
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function listUsers() {
  return ensureUsers().map(publicUser);
}

export function listAccessRequests() {
  return db.read(ACCESS_REQUESTS_KEY, []);
}

export function createAccessRequest(input) {
  const name = String(input?.name || "").trim();
  const email = String(input?.email || "")
    .trim()
    .toLowerCase();
  const username = String(input?.username || email)
    .trim()
    .toLowerCase();
  const password = String(input?.password || "").trim();
  const role = String(input?.role || ROLE.CAIXA).trim();

  if (!name || !email || !password) {
    return { ok: false, message: "Nome, email e senha sao obrigatorios." };
  }

  const validRoles = Object.values(ROLE);
  if (!validRoles.includes(role)) {
    return { ok: false, message: "Perfil de acesso invalido." };
  }

  const users = ensureUsers();
  const existsUser = users.some(
    (user) =>
      String(user.email || "").toLowerCase() === email ||
      String(user.username || "").toLowerCase() === username,
  );

  if (existsUser) {
    return { ok: false, message: "Ja existe usuario com este email/login." };
  }

  const requests = listAccessRequests();
  const hasPending = requests.some(
    (item) =>
      item.status === "pending" &&
      (String(item.email || "").toLowerCase() === email ||
        String(item.username || "").toLowerCase() === username),
  );

  if (hasPending) {
    return {
      ok: false,
      message: "Ja existe solicitacao pendente para este usuario.",
    };
  }

  const request = {
    id: db.uid("acc"),
    name,
    email,
    username,
    password,
    role,
    requiredApproverRole: requiredApproverRole(role),
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  db.update(ACCESS_REQUESTS_KEY, [], (current) => [request, ...current]);
  return { ok: true, request };
}

export function approveAccessRequest(requestId, approverSession) {
  if (!approverSession) {
    return { ok: false, message: "Sessao invalida para aprovacao." };
  }

  const approverRole = approverSession.role;
  const requests = listAccessRequests();
  const requestIndex = requests.findIndex((item) => item.id === requestId);

  if (requestIndex < 0) {
    return { ok: false, message: "Solicitacao nao encontrada." };
  }

  const request = requests[requestIndex];

  if (request.status !== "pending") {
    return { ok: false, message: "Solicitacao ja processada." };
  }

  if (!canApproveRole(approverRole, request.role)) {
    return {
      ok: false,
      message: "Seu perfil nao pode aprovar este tipo de acesso.",
    };
  }

  const users = ensureUsers();
  const exists = users.some(
    (user) =>
      String(user.email || "").toLowerCase() ===
        String(request.email).toLowerCase() ||
      String(user.username || "").toLowerCase() ===
        String(request.username).toLowerCase(),
  );

  if (exists) {
    return {
      ok: false,
      message: "Usuario ja existente para esta solicitacao.",
    };
  }

  users.push({
    id: db.uid("usr"),
    username: request.username,
    email: request.email,
    password: request.password,
    name: request.name,
    role: request.role,
    approved: true,
    approvedByRole: approverRole,
    createdAt: new Date().toISOString(),
  });

  saveUsers(users);

  requests[requestIndex] = {
    ...request,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: approverSession.email || approverSession.username,
    approvedByRole: approverRole,
  };

  db.write(ACCESS_REQUESTS_KEY, requests);

  return { ok: true, request: requests[requestIndex] };
}

export function rejectAccessRequest(requestId, approverSession) {
  if (!approverSession) {
    return { ok: false, message: "Sessao invalida para rejeicao." };
  }

  const approverRole = approverSession.role;
  const requests = listAccessRequests();
  const requestIndex = requests.findIndex((item) => item.id === requestId);

  if (requestIndex < 0) {
    return { ok: false, message: "Solicitacao nao encontrada." };
  }

  const request = requests[requestIndex];

  if (request.status !== "pending") {
    return { ok: false, message: "Solicitacao ja processada." };
  }

  if (!canApproveRole(approverRole, request.role)) {
    return {
      ok: false,
      message: "Seu perfil nao pode rejeitar este tipo de acesso.",
    };
  }

  requests[requestIndex] = {
    ...request,
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    rejectedBy: approverSession.email || approverSession.username,
    rejectedByRole: approverRole,
  };

  db.write(ACCESS_REQUESTS_KEY, requests);
  return { ok: true, request: requests[requestIndex] };
}

export function login(username, password) {
  const credential = String(username || "").trim();
  const safePassword = String(password || "").trim();
  let user = findUserByCredential(credential);

  // Re-sincroniza os acessos demo caso dados locais tenham sido alterados.
  if (!user) {
    const synced = synchronizeSeedUsers(ensureUsers());
    saveUsers(synced);
    user = findUserByCredential(credential);
  }

  if (!user || !isPasswordValid(user, safePassword, credential)) {
    return { ok: false, message: "Usuario ou senha invalidos." };
  }

  if (!user.approved) {
    return { ok: false, message: "Acesso pendente de aprovacao." };
  }

  const session = setSessionFromUser(user);
  return { ok: true, session };
}

export function loginWithOAuthIdentity(email, provider = "oauth") {
  const safeEmail = String(email || "")
    .trim()
    .toLowerCase();
  const user = findUserByCredential(safeEmail);

  if (!user) {
    return { ok: false, message: "Conta OAuth sem permissão administrativa." };
  }

  if (!user.approved) {
    return { ok: false, message: "Acesso pendente de aprovação." };
  }

  const session = setSessionFromUser(user, {
    provider,
    oauth: true,
  });

  return { ok: true, session };
}

export function loginOrCreateAdminWithOAuthIdentity(payload = {}) {
  const safeEmail = String(payload.email || "")
    .trim()
    .toLowerCase();
  const safeName = String(payload.name || safeEmail || "Administrador OAuth")
    .trim()
    .slice(0, 120);
  const provider = String(payload.provider || "oauth")
    .trim()
    .toLowerCase();
  const requestedRole =
    payload.role === ROLE.SUPER_ADMIN ? ROLE.SUPER_ADMIN : ROLE.ADMIN;

  if (!safeEmail) {
    return { ok: false, message: "OAuth sem e-mail confirmado." };
  }

  const users = ensureUsers();
  let user = findUserByCredential(safeEmail);

  if (!user) {
    user = {
      id: db.uid("usr"),
      username: safeEmail,
      email: safeEmail,
      password: "",
      name: safeName,
      role: requestedRole,
      approved: true,
      approvedByRole: ROLE.SUPER_ADMIN,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
  }

  if (!user.approved) {
    return { ok: false, message: "Acesso pendente de aprovação." };
  }

  const session = setSessionFromUser(user, {
    provider,
    oauth: true,
  });

  return { ok: true, session, user: publicUser(user) };
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

export function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw);

    if (session?.role) {
      return session;
    }

    const users = ensureUsers();
    const credential = String(
      session?.email || session?.username || "",
    ).toLowerCase();
    const resolvedUser = users.find(
      (user) =>
        String(user.email || "").toLowerCase() === credential ||
        String(user.username || "").toLowerCase() === credential,
    );

    if (!resolvedUser) {
      return session;
    }

    const normalized = setSessionFromUser(resolvedUser, {
      provider: session.provider,
      mfa: session.mfa,
    });
    return normalized;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function isAuthenticated() {
  return !!getSession();
}

export function hasRole(roles = []) {
  const session = getSession();
  if (!session) {
    return false;
  }

  const roleList = Array.isArray(roles) ? roles : [roles];
  return roleList.includes(session.role);
}

function randomCode(length = 6) {
  return String(Math.floor(Math.random() * 10 ** length)).padStart(length, "0");
}

export function startGoogleAdminLogin() {
  const challenge = {
    provider: "google",
    role: ROLE.ADMIN,
    email: "admin.google@casaverde.com",
    name: "Administrador Google",
    code: randomCode(),
    expiresAt: Date.now() + 5 * 60 * 1000,
  };

  localStorage.setItem(ADMIN_CHALLENGE_KEY, JSON.stringify(challenge));

  return {
    ok: true,
    challenge: {
      email: challenge.email,
      expiresAt: challenge.expiresAt,
      // Em ambiente real, esse codigo deve ser enviado por e-mail/SMS e nunca exposto no front.
      devCode: challenge.code,
    },
  };
}

export function getAdminChallenge() {
  const raw = localStorage.getItem(ADMIN_CHALLENGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(ADMIN_CHALLENGE_KEY);
    return null;
  }
}

export function clearAdminChallenge() {
  localStorage.removeItem(ADMIN_CHALLENGE_KEY);
}

export function verifyAdminCode(inputCode) {
  const challenge = getAdminChallenge();

  if (!challenge) {
    return { ok: false, message: "Nenhum login Google pendente." };
  }

  if (Date.now() > challenge.expiresAt) {
    clearAdminChallenge();
    return { ok: false, message: "Codigo expirado. Tente novamente." };
  }

  const code = String(inputCode || "").trim();

  if (code !== challenge.code) {
    return { ok: false, message: "Codigo invalido." };
  }

  const users = ensureUsers();
  let user = users.find(
    (item) =>
      String(item.email || "").toLowerCase() ===
      String(challenge.email).toLowerCase(),
  );

  if (!user) {
    user = {
      id: db.uid("usr"),
      username: challenge.email,
      email: challenge.email,
      password: "",
      name: challenge.name,
      role: challenge.role,
      approved: true,
      approvedByRole: ROLE.SUPER_ADMIN,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
  }

  const session = setSessionFromUser(user, {
    provider: challenge.provider,
    mfa: true,
  });

  clearAdminChallenge();
  return { ok: true, session };
}

// Garante seed sempre que o modulo e carregado.
ensureUsers();

export { ROLE, requiredApproverRole, canApproveRole };
