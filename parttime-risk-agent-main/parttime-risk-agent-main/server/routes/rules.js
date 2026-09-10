const express = require("express");
const db = require("../database/db");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ ok: true, rules: db.listRules() });
});

router.post("/", (req, res) => {
  const rule = db.saveRule(req.body || {});
  res.json({ ok: true, rule });
});

router.put("/:id", (req, res) => {
  const rule = db.saveRule({ ...(req.body || {}), id: req.params.id });
  res.json({ ok: true, rule });
});

router.delete("/:id", (req, res) => {
  db.deleteRule(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
