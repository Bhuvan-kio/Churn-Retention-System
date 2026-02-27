const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const platforms = ["Netflix", "Prime Video", "Disney+ Hotstar", "Crunchyroll", "Aha"];
const defaultDataset = path.join(__dirname, "../data/data.csv");
const datasetPath = process.env.DATASET_PATH || defaultDataset;

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

const featureDefs = [
  { key: "account length", name: "Account Tenure", type: "num" },
  { key: "international plan", name: "International Plan", type: "boolYes" },
  { key: "voice mail plan", name: "Voicemail Plan", type: "boolYes" },
  { key: "number vmail messages", name: "Voicemail Usage", type: "num" },
  { key: "total day minutes", name: "Day Usage", type: "num" },
  { key: "total eve minutes", name: "Evening Usage", type: "num" },
  { key: "total night minutes", name: "Night Usage", type: "num" },
  { key: "total intl minutes", name: "International Usage", type: "num" },
  { key: "customer service calls", name: "Service Calls", type: "num" },
];

let state = {
  kpis: { activeSessions: 0, avgChurnRisk: 0, predictedChurners: 0, totalMinutes: 0, avgServiceCalls: 0 },
  platformMetrics: [],
  riskDistribution: [],
  trend: [],
  liveFeed: [],
  topRiskCustomers: [],
  alerts: [],
  modelStats: null,
  states: [],
  platforms,
  streamCustomers: [],
  updateAt: new Date().toISOString(),
  datasetInfo: { path: datasetPath, rows: 0 },
};

let mappedRows = [];
let model = null;
let currentDatasetPath = datasetPath;
let cursor = 0;
let streamWindow = [];
let trendWindow = [];

function initData(csvPath) {
  try {
    const rawRows = loadDataset(csvPath);
    const modelingRows = rawRows.map((row, idx) => toModelRow(row, idx));
    model = trainLogisticRegression(modelingRows, 650, 0.07, 0.0007);
    mappedRows = modelingRows.map((row) => scoreRow(row, model));
    const allStates = [...new Set(mappedRows.map((row) => row.state))].sort();

    state.modelStats = evaluateModel(mappedRows);
    state.states = allStates;
    state.datasetInfo = { path: csvPath, rows: mappedRows.length };
    currentDatasetPath = csvPath;
    cursor = 0;
    streamWindow = [];
    trendWindow = [];
    state.liveFeed = [];
    state.trend = [];

    console.log(`Dataset initialized: ${path.resolve(csvPath)} (${mappedRows.length} rows)`);
    return true;
  } catch (err) {
    console.error("Failed to initialize dataset:", err);
    return false;
  }
}

function parseCsvLine(line) {
  const out = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === "," && !inQuotes) {
      out.push(value.trim());
      value = "";
      continue;
    }
    value += c;
  }
  out.push(value.trim());
  return out;
}

function loadDataset(csvPath) {
  const absolute = path.resolve(csvPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Dataset not found: ${absolute}`);
  }
  const raw = fs.readFileSync(absolute, "utf8").trim();
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const parts = parseCsvLine(line);
    const record = {};
    headers.forEach((header, index) => {
      record[header] = parts[index] || "";
    });
    return record;
  });
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toBoolYes(value) {
  return String(value || "").trim().toLowerCase() === "yes" ? 1 : 0;
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function featureValue(row, def) {
  if (def.type === "num") return toNum(row[def.key]);
  if (def.type === "boolYes") return toBoolYes(row[def.key]);
  return 0;
}

function featureVector(row) {
  return featureDefs.map((def) => featureValue(row, def));
}

function toModelRow(row, idx) {
  const stateCode = row.state || "NA";
  const areaCode = row["area code"] || "000";
  const platform = platforms[hashText(`${stateCode}-${areaCode}-${idx}`) % platforms.length];
  const tier =
    toNum(row["total day minutes"]) + toNum(row["total eve minutes"]) > 420
      ? "Premium"
      : toNum(row["total day minutes"]) > 210
        ? "Standard"
        : "Mobile";

  return {
    id: row["phone number"] || `${stateCode}-${idx}`,
    state: stateCode,
    platform,
    tier,
    actualChurn: String(row.churn).trim().toLowerCase() === "true" ? 1 : 0,
    minutes:
      toNum(row["total day minutes"]) +
      toNum(row["total eve minutes"]) +
      toNum(row["total night minutes"]) +
      toNum(row["total intl minutes"]),
    serviceCalls: toNum(row["customer service calls"]),
    interactionPulse: Math.round(
      (toNum(row["total day calls"]) + toNum(row["total eve calls"]) + toNum(row["total night calls"])) / 3,
    ),
    raw: row,
  };
}

function trainLogisticRegression(rows, epochs = 500, lr = 0.05, l2 = 0.0005) {
  const X = rows.map((row) => featureVector(row.raw));
  const y = rows.map((row) => row.actualChurn);
  const n = X.length;
  const m = featureDefs.length;

  const means = new Array(m).fill(0);
  const stds = new Array(m).fill(0);
  for (let j = 0; j < m; j += 1) {
    means[j] = X.reduce((acc, row) => acc + row[j], 0) / n;
    const variance = X.reduce((acc, row) => acc + (row[j] - means[j]) ** 2, 0) / Math.max(1, n - 1);
    stds[j] = Math.sqrt(variance) || 1;
  }

  const Z = X.map((row) => row.map((value, j) => (value - means[j]) / stds[j]));
  const w = new Array(m).fill(0);
  let b = 0;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const dw = new Array(m).fill(0);
    let db = 0;
    for (let i = 0; i < n; i += 1) {
      let z = b;
      for (let j = 0; j < m; j += 1) z += w[j] * Z[i][j];
      const p = sigmoid(z);
      const diff = p - y[i];
      for (let j = 0; j < m; j += 1) dw[j] += diff * Z[i][j];
      db += diff;
    }

    for (let j = 0; j < m; j += 1) {
      const grad = dw[j] / n + l2 * w[j];
      w[j] -= lr * grad;
    }
    b -= lr * (db / n);
  }

  return { weights: w, bias: b, means, stds };
}

function scoreRow(row, logisticModel) {
  const rawX = featureVector(row.raw);
  const zX = rawX.map((value, j) => (value - logisticModel.means[j]) / logisticModel.stds[j]);
  let z = logisticModel.bias;
  for (let j = 0; j < zX.length; j += 1) z += logisticModel.weights[j] * zX[j];
  const churnRisk = Number((sigmoid(z) * 100).toFixed(2));

  const contributions = featureDefs.map((def, j) => ({
    feature: def.name,
    value: rawX[j],
    effect: logisticModel.weights[j] * zX[j],
  }));

  const riskDrivers = contributions
    .slice()
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, 5)
    .map((driver) => ({
      feature: driver.feature,
      direction: driver.effect >= 0 ? "up" : "down",
      impact: Number(Math.abs(driver.effect).toFixed(3)),
    }));

  return {
    ...row,
    churnRisk,
    bufferingRate: Number((clamp01(row.serviceCalls / 8) * 6).toFixed(2)),
    satisfaction: Math.max(20, Math.min(99, Math.round(100 - churnRisk * 0.7))),
    riskDrivers,
  };
}

function evaluateModel(rows) {
  const threshold = 50;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  rows.forEach((row) => {
    const pred = row.churnRisk >= threshold ? 1 : 0;
    if (pred === 1 && row.actualChurn === 1) tp += 1;
    if (pred === 1 && row.actualChurn === 0) fp += 1;
    if (pred === 0 && row.actualChurn === 0) tn += 1;
    if (pred === 0 && row.actualChurn === 1) fn += 1;
  });
  const total = rows.length || 1;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    threshold,
    accuracy: Number((((tp + tn) / total) * 100).toFixed(2)),
    precision: Number((precision * 100).toFixed(2)),
    recall: Number((recall * 100).toFixed(2)),
    f1: Number((f1 * 100).toFixed(2)),
  };
}

function summarizePlatform(rows, platform) {
  const group = rows.filter((row) => row.platform === platform);
  if (!group.length) return { name: platform, activeUsers: 0, avgRisk: 0, serviceLoad: 0, avgMinutes: 0, satisfaction: 0 };
  const avg = (calc) => Number((calc / group.length).toFixed(2));
  return {
    name: platform,
    activeUsers: group.length,
    avgRisk: avg(group.reduce((acc, cur) => acc + cur.churnRisk, 0)),
    serviceLoad: avg(group.reduce((acc, cur) => acc + cur.serviceCalls, 0)),
    avgMinutes: avg(group.reduce((acc, cur) => acc + cur.minutes, 0)),
    satisfaction: avg(group.reduce((acc, cur) => acc + cur.satisfaction, 0)),
  };
}

function getRiskDistribution(rows) {
  const buckets = [
    { name: "Low", min: 0, max: 34, color: "#45f4b0" },
    { name: "Medium", min: 34, max: 67, color: "#73beff" },
    { name: "High", min: 67, max: 101, color: "#ff6ea6" },
  ];
  const total = rows.length || 1;
  return buckets.map((bucket) => {
    const users = rows.filter((row) => row.churnRisk >= bucket.min && row.churnRisk < bucket.max).length;
    return { ...bucket, users, share: Number(((users / total) * 100).toFixed(2)) };
  });
}

function buildAlerts(platformMetrics, highRiskCount) {
  const alerts = [];
  platformMetrics.forEach((platform) => {
    if (platform.avgRisk > 62) {
      alerts.push({
        id: `risk-${platform.name}-${Date.now()}`,
        severity: "critical",
        title: `${platform.name} risk escalation`,
        message: `Average risk at ${platform.avgRisk}% with service load ${platform.serviceLoad}.`,
      });
    }
  });
  if (highRiskCount > 40) {
    alerts.push({
      id: `cohort-${Date.now()}`,
      severity: "warning",
      title: "High-risk cohort concentration",
      message: `${highRiskCount} customers in high-risk zone in active stream window.`,
    });
  }
  return alerts.slice(0, 8);
}

function nextBatch(size = 45) {
  const out = [];
  if (mappedRows.length === 0) return out;
  for (let i = 0; i < size; i += 1) {
    out.push(mappedRows[cursor]);
    cursor = (cursor + 1) % mappedRows.length;
  }
  return out;
}

function refreshState() {
  const batch = nextBatch();
  streamWindow = [...streamWindow, ...batch].slice(-620);

  const activeSessions = streamWindow.length;
  const avgChurnRisk =
    activeSessions > 0 ? Number((streamWindow.reduce((acc, cur) => acc + cur.churnRisk, 0) / activeSessions).toFixed(2)) : 0;
  const predictedChurners = streamWindow.filter((row) => row.churnRisk >= (state.modelStats?.threshold ?? 50)).length;
  const totalMinutes = Number(streamWindow.reduce((acc, cur) => acc + cur.minutes, 0).toFixed(2));
  const avgServiceCalls =
    activeSessions > 0 ? Number((streamWindow.reduce((acc, cur) => acc + cur.serviceCalls, 0) / activeSessions).toFixed(2)) : 0;

  const platformMetrics = platforms.map((platform) => summarizePlatform(streamWindow, platform));
  const distribution = getRiskDistribution(streamWindow);
  const topRiskCustomers = [...streamWindow]
    .sort((a, b) => b.churnRisk - a.churnRisk)
    .slice(0, 14)
    .map((row) => ({
      id: row.id,
      platform: row.platform,
      state: row.state,
      tier: row.tier,
      risk: row.churnRisk,
      serviceCalls: row.serviceCalls,
      interactionPulse: row.interactionPulse,
      riskDrivers: row.riskDrivers,
    }));

  const now = new Date();
  const trendPoint = {
    time: now.toLocaleTimeString("en-US", { hour12: false }),
    risk: avgChurnRisk,
    churners: predictedChurners,
    active: activeSessions,
  };
  trendWindow = [...trendWindow, trendPoint].slice(-24);

  const pulse = batch.length > 0 ? {
    id: `${now.getTime()}-${cursor}`,
    platform: batch[batch.length - 1].platform,
    state: batch[batch.length - 1].state,
    tier: batch[batch.length - 1].tier,
    interactionPulse: batch[batch.length - 1].interactionPulse,
    risk: batch[batch.length - 1].churnRisk,
    bufferingRate: batch[batch.length - 1].bufferingRate,
    riskDrivers: batch[batch.length - 1].riskDrivers,
  } : null;

  state.kpis = { activeSessions, avgChurnRisk, predictedChurners, totalMinutes, avgServiceCalls };
  state.platformMetrics = platformMetrics;
  state.riskDistribution = distribution;
  state.trend = trendWindow;
  if (pulse) state.liveFeed = [pulse, ...state.liveFeed].slice(0, 30);
  state.topRiskCustomers = topRiskCustomers;
  state.streamCustomers = streamWindow.map((row) => ({
    id: row.id,
    platform: row.platform,
    state: row.state,
    tier: row.tier,
    risk: row.churnRisk,
    interactionPulse: row.interactionPulse,
    serviceCalls: row.serviceCalls,
    minutes: row.minutes,
    riskDrivers: row.riskDrivers,
  }));
  state.alerts = buildAlerts(platformMetrics, distribution.find((d) => d.name === "High")?.users || 0);
  state.updateAt = now.toISOString();

  io.emit("analytics:update", state);
}

app.post("/api/upload", upload.single("dataset"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const ok = initData(req.file.path);
  if (ok) {
    res.json({ success: true, message: "Dataset uploaded and model re-trained", rows: mappedRows.length });
  } else {
    res.status(500).json({ error: "Failed to initialize dataset" });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    updatedAt: state.updateAt,
    datasetRows: state.datasetInfo.rows,
    datasetPath: state.datasetInfo.path,
    modelStats: state.modelStats,
  });
});

app.get("/api/snapshot", (_req, res) => {
  res.json(state);
});

io.on("connection", (socket) => {
  socket.emit("analytics:update", state);
});

initData(datasetPath);
refreshState();
setInterval(refreshState, 2200);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Realtime churn server listening on http://localhost:${PORT}`);
  console.log(`Initial dataset: ${path.resolve(datasetPath)}`);
});
