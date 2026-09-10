const express = require("express");
const { analyzeJobText } = require("../services/agentService");
const db = require("../database/db");

const router = express.Router();

router.post("/analyze", async (req, res, next) => {
  try {
    const text = String(req.body.text || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: "兼职招聘文本不能为空" });
    }
    const result = await analyzeJobText(text, "");
    const record = db.insertRecord({
      inputText: text,
      jobType: result.extracted.jobType,
      riskLevel: result.report?.riskLevel || result.preliminary?.riskLevel,
      score: result.report?.score || result.preliminary?.score,
      report: result
    });
    res.json({ ok: true, recordId: record.id, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/follow-up", async (req, res, next) => {
  try {
    const text = String(req.body.text || "").trim();
    const followUp = String(req.body.followUp || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: "原始兼职文本不能为空" });
    }
    const result = await analyzeJobText(text, followUp);
    const record = db.insertRecord({
      inputText: text,
      followUpText: followUp,
      jobType: result.extracted.jobType,
      riskLevel: result.report?.riskLevel || result.preliminary?.riskLevel,
      score: result.report?.score || result.preliminary?.score,
      report: result
    });
    res.json({ ok: true, recordId: record.id, ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
