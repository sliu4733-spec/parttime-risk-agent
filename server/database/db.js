const records = [];
const rules = [];

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function insertRecord(record) {
  const saved = {
    id: createId("record"),
    createdAt: new Date().toISOString(),
    ...record
  };
  records.unshift(saved);
  return saved;
}

function listRecords() {
  return records.slice(0, 50);
}

function getRecord(id) {
  return records.find((item) => item.id === id) || null;
}

function listRules() {
  return rules;
}

function saveRule(rule) {
  const saved = {
    id: rule.id || createId("rule"),
    enabled: rule.enabled !== false,
    ...rule
  };
  const index = rules.findIndex((item) => item.id === saved.id);
  if (index >= 0) rules[index] = saved;
  else rules.push(saved);
  return saved;
}

function deleteRule(id) {
  const index = rules.findIndex((item) => item.id === id);
  if (index >= 0) rules.splice(index, 1);
}

module.exports = {
  insertRecord,
  listRecords,
  getRecord,
  listRules,
  saveRule,
  deleteRule
};
