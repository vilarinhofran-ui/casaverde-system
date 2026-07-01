function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function read(key, fallback) {
  const raw = localStorage.getItem(key);

  if (raw === null) {
    return fallback;
  }

  return safeParse(raw, fallback);
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  return value;
}

function update(key, fallback, updater) {
  const current = read(key, fallback);
  const next = updater(current);
  return write(key, next);
}

function uid(prefix = "id") {
  const seed = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${seed}`;
}

export const db = {
  connect() {
    return true;
  },
  read,
  write,
  update,
  uid,
};
