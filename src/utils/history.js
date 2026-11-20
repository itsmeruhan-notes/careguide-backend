const HIDDEN = new Set(['passwordHash']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const actorOf = (user) => ({ byId: user ? String(user._id) : 'system', byName: user ? user.name : 'system' });

export const createdAudit = (user) => {
  const { byId, byName } = actorOf(user);
  return {
    createdBy: byId,
    createdByName: byName,
    updatedBy: byId,
    updatedByName: byName,
    history: [{ action: 'created', at: new Date(), byId, byName, before: {}, after: {} }],
  };
};

export const applyChanges = (doc, changes, user, action = 'updated', extra = {}) => {
  const before = {};
  const after = {};
  for (const [key, value] of Object.entries(changes)) {
    const current = doc.get(key);
    const plainCurrent = current && typeof current.toObject === 'function' ? current.toObject() : current;
    if (same(plainCurrent, value)) continue;
    before[key] = HIDDEN.has(key) ? '[hidden]' : plainCurrent;
    after[key] = HIDDEN.has(key) ? '[changed]' : value;
    doc.set(key, value);
  }
  if (!Object.keys(after).length && !Object.keys(extra).length) return false;
  const { byId, byName } = actorOf(user);
  doc.updatedBy = byId;
  doc.updatedByName = byName;
  doc.history.push({ action, at: new Date(), byId, byName, before, after, ...extra });
  return true;
};

export const historyPage = (doc, { page, limit }) => {
  const items = [...(doc.history || [])].reverse();
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    page,
    limit,
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / limit)),
  };
};
