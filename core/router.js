import { getSession, isAuthenticated } from "./auth.js";

export function navigateTo(route) {
  window.location.href = route;
}

export function requireAuth(redirectTo = "login.html") {
  if (!isAuthenticated()) {
    navigateTo(redirectTo);
    return false;
  }

  return true;
}

export function requireRoles(roles = [], redirectTo = "login.html") {
  if (!requireAuth(redirectTo)) {
    return false;
  }

  const allowed = Array.isArray(roles) ? roles : [roles];
  const session = getSession();

  if (!session || !allowed.includes(session.role)) {
    navigateTo(redirectTo);
    return false;
  }

  return true;
}
