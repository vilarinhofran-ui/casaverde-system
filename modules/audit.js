import { db } from "../core/db.js";

const AUDIT_KEY = "casaverde_audit_logs";

export function listAuditLogs() {
  return db.read(AUDIT_KEY, []);
}

export function logEvent(type, detail) {
  const entry = {
    id: db.uid("log"),
    type,
    detail,
    createdAt: new Date().toISOString(),
  };

  db.update(AUDIT_KEY, [], (current) => [entry, ...current].slice(0, 200));
  return entry;
}
