const express = require("express");
const db = require("../database/db");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ ok: true, history: db.listRecords() });
});

router.get("/:id", (req, res) => {
  const record = db.getRecord(req.params.id);
  if (!record) {
    return res.status(404).json({ ok: false, error: "历史记录不存在" });
  }
  res.json({ ok: true, record });
});

module.exports = router;
