require("dotenv").config();

const express = require("express");
const cors = require("cors");
const analyzeRouter = require("./routes/analyze");
const historyRouter = require("./routes/history");
const rulesRouter = require("./routes/rules");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "parttime-risk-agent-server" });
});

app.use("/api", analyzeRouter);
app.use("/api/history", historyRouter);
app.use("/api/rules", rulesRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || "服务器内部错误" });
});

app.listen(port, () => {
  console.log(`Part-time risk agent server running at http://localhost:${port}`);
});
