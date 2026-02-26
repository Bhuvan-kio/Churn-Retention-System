import { useEffect, useMemo, useState } from "react";
import { m } from "framer-motion";
import { io } from "socket.io-client";
import { Activity, BellRing, CircleGauge, Database, Gauge, Moon, Sun, TrendingUp, UsersRound } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const socket = io(API_URL, { transports: ["websocket"] });

const defaultData = {
  kpis: { activeSessions: 0, avgChurnRisk: 0, predictedChurners: 0, totalMinutes: 0, avgServiceCalls: 0 },
  platformMetrics: [],
  riskDistribution: [],
  trend: [],
  liveFeed: [],
  topRiskCustomers: [],
  streamCustomers: [],
  alerts: [],
  modelStats: null,
  states: [],
  platforms: [],
  updateAt: null,
};

const MotionDiv = m.div;

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") return defaultData;
  const liveFeed =
    Array.isArray(payload.liveFeed) && payload.liveFeed.length > 0
      ? payload.liveFeed
      : Array.isArray(payload.pulse)
        ? payload.pulse.map((item) => ({
          id: item.id,
          platform: item.platform,
          state: item.state || item.region || "NA",
          tier: item.tier || "Standard",
          interactionPulse: item.interactionPulse || 0,
          risk: item.risk || item.avgRisk || 0,
          bufferingRate: item.bufferingRate || 0,
        }))
        : [];

  return {
    ...defaultData,
    ...payload,
    kpis: { ...defaultData.kpis, ...(payload.kpis || {}) },
    platformMetrics: Array.isArray(payload.platformMetrics) ? payload.platformMetrics : [],
    riskDistribution: Array.isArray(payload.riskDistribution) ? payload.riskDistribution : [],
    trend: Array.isArray(payload.trend) ? payload.trend : [],
    liveFeed,
    topRiskCustomers: Array.isArray(payload.topRiskCustomers) ? payload.topRiskCustomers : [],
    streamCustomers: Array.isArray(payload.streamCustomers) ? payload.streamCustomers : [],
    alerts: Array.isArray(payload.alerts) ? payload.alerts : [],
    states: Array.isArray(payload.states) ? payload.states : [],
    platforms: Array.isArray(payload.platforms) ? payload.platforms : [],
  };
}

function StatCard({ icon, label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-head">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const [data, setData] = useState(defaultData);
  const [filters, setFilters] = useState({ platform: "All", state: "All", riskBand: "All" });
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    fetch(`${API_URL}/api/snapshot`)
      .then((res) => res.json())
      .then((payload) => setData(normalizePayload(payload)))
      .catch(() => { });

    const onUpdate = (payload) => setData(normalizePayload(payload));
    socket.on("analytics:update", onUpdate);
    return () => socket.off("analytics:update", onUpdate);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const particles = useMemo(
    () =>
      Array.from({ length: 26 }, (_, index) => ({
        id: index,
        left: `${((index * 31) % 94) + 3}%`,
        size: `${((index * 9) % 10) + 5}px`,
        delay: `${(index * 0.4).toFixed(2)}s`,
      })),
    [],
  );

  const allCustomers = useMemo(() => {
    if (data.streamCustomers.length > 0) return data.streamCustomers;
    return data.topRiskCustomers.map((customer, index) => ({
      id: `${customer.id || "row"}-${index}`,
      platform: customer.platform || "Unknown",
      state: customer.state || "NA",
      tier: customer.tier || "Standard",
      interactionPulse: customer.interactionPulse || 0,
      risk: customer.risk || 0,
      serviceCalls: customer.serviceCalls || 0,
      minutes: customer.minutes || 0,
      riskDrivers: customer.riskDrivers || [],
    }));
  }, [data.streamCustomers, data.topRiskCustomers]);

  const filteredCustomers = useMemo(() => {
    return allCustomers.filter((row) => {
      if (filters.platform !== "All" && row.platform !== filters.platform) return false;
      if (filters.state !== "All" && row.state !== filters.state) return false;
      if (filters.riskBand === "High" && row.risk < 67) return false;
      if (filters.riskBand === "Medium" && (row.risk < 34 || row.risk >= 67)) return false;
      if (filters.riskBand === "Low" && row.risk >= 34) return false;
      return true;
    });
  }, [allCustomers, filters]);

  const filteredPlatformMetrics = useMemo(() => {
    const platforms = data.platforms.length ? data.platforms : [...new Set(allCustomers.map((row) => row.platform))];
    return platforms
      .map((platform) => {
        const group = filteredCustomers.filter((row) => row.platform === platform);
        if (!group.length) return null;
        const avg = (sum) => Number((sum / group.length).toFixed(2));
        return {
          name: platform,
          activeUsers: group.length,
          avgRisk: avg(group.reduce((acc, cur) => acc + cur.risk, 0)),
          serviceLoad: avg(group.reduce((acc, cur) => acc + (cur.serviceCalls || 0), 0)),
        };
      })
      .filter(Boolean);
  }, [filteredCustomers, data.platforms, allCustomers]);

  const filteredRiskDistribution = useMemo(() => {
    const total = filteredCustomers.length || 1;
    const riskColors =
      theme === "light"
        ? { low: "#ffe4d6", medium: "#ffb48f", high: "#df6f6f" }
        : { low: "#ffd8c4", medium: "#ffb485", high: "#ff8f98" };
    const buckets = [
      { name: "Low", color: riskColors.low, test: (r) => r < 34 },
      { name: "Medium", color: riskColors.medium, test: (r) => r >= 34 && r < 67 },
      { name: "High", color: riskColors.high, test: (r) => r >= 67 },
    ];
    return buckets.map((bucket) => {
      const users = filteredCustomers.filter((row) => bucket.test(row.risk)).length;
      return { name: bucket.name, users, color: bucket.color, share: Number(((users / total) * 100).toFixed(2)) };
    });
  }, [filteredCustomers, theme]);

  const filteredTopRisk = useMemo(
    () =>
      [...filteredCustomers]
        .sort((a, b) => b.risk - a.risk)
        .slice(0, 10)
        .map((row) => ({ ...row, riskDrivers: row.riskDrivers || [] })),
    [filteredCustomers],
  );

  const pulseRows = useMemo(() => {
    if (data.liveFeed.length > 0) {
      return data.liveFeed.filter((row) => {
        if (filters.platform !== "All" && row.platform !== filters.platform) return false;
        if (filters.state !== "All" && row.state !== filters.state) return false;
        if (filters.riskBand === "High" && row.risk < 67) return false;
        if (filters.riskBand === "Medium" && (row.risk < 34 || row.risk >= 67)) return false;
        if (filters.riskBand === "Low" && row.risk >= 34) return false;
        return true;
      });
    }
    return filteredTopRisk.map((customer, index) => ({
      id: `${customer.id || "row"}-${index}`,
      platform: customer.platform || "Unknown",
      state: customer.state || "NA",
      tier: customer.tier || "Standard",
      interactionPulse: customer.interactionPulse || 0,
      risk: customer.risk || 0,
      bufferingRate: customer.serviceCalls || 0,
    }));
  }, [data.liveFeed, filteredTopRisk, filters]);

  const nextTheme = () => {
    if (theme === "dark") return "light";
    if (theme === "light") return "amoled";
    return "dark";
  };

  const palette = theme === "light"
    ? {
      grid: "rgba(216, 134, 90, 0.25)",
      axis: "#9b5f49",
      tooltipBg: "rgba(255, 245, 239, 0.97)",
      tooltipBorder: "#efaa88",
      areaStroke: "#e8875d",
      areaFillStart: "#f5aa86",
      areaFillEnd: "#f5aa860d",
      line: "#d65888",
      high: "#d65888",
      med: "#f39a6c",
      low: "#efbe9f",
      secondary: "#f6ad83",
    }
    : {
      grid: "rgba(255, 186, 148, 0.22)",
      axis: "#f3c3aa",
      tooltipBg: "rgba(36, 27, 28, 0.95)",
      tooltipBorder: "#f0a27866",
      areaStroke: "#ffbe9c",
      areaFillStart: "#ffbe9c",
      areaFillEnd: "#ffbe9c0d",
      line: "#ff86aa",
      high: "#ff86aa",
      med: "#ffb485",
      low: "#ffd4bc",
      secondary: "#ffc6a8",
    };

  const globalDrivers = useMemo(() => {
    const aggregated = {};
    filteredCustomers.forEach((customer) => {
      customer.riskDrivers?.forEach((driver) => {
        if (driver.direction === "up") {
          if (!aggregated[driver.feature]) aggregated[driver.feature] = 0;
          aggregated[driver.feature] += driver.impact;
        }
      });
    });
    return Object.entries(aggregated)
      .map(([feature, impact]) => ({ feature, impact }))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 3);
  }, [filteredCustomers]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("dataset", file);

    try {
      const res = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (result.success) {
        alert(`Successfully uploaded dataset: ${result.rows} rows analyzed.`);
      } else {
        alert("Upload failed: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      console.error(err);
      alert("Error uploading dataset.");
    }
  };

  return (
    <div className="app-shell">
      <div className="ambient-bg" />
      <div className="grid-overlay" />
      <div className="particle-field">
        {particles.map((particle) => (
          <span
            key={particle.id}
            className="particle"
            style={{
              left: particle.left,
              width: particle.size,
              height: particle.size,
              animationDelay: particle.delay,
            }}
          />
        ))}
      </div>

      <header className="topbar glass">
        <div>
          <h1>Churn Retention System</h1>
          <p>Realtime customer behavior analysis and churn prediction command center</p>
        </div>
        <div className="topbar-actions">
          <div className="meta">Live at {data.updateAt ? new Date(data.updateAt).toLocaleTimeString() : "--:--:--"}</div>

          <label className="upload-btn" title="Upload new dataset CSV">
            <Activity size={16} />
            <span>Upload Dataset</span>
            <input type="file" accept=".csv" onChange={handleUpload} style={{ display: "none" }} />
          </label>

          <button
            className="theme-toggle"
            onClick={() => setTheme(nextTheme())}
            aria-label="Toggle theme"
            title={`Theme: ${theme}`}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      <section className="dashboard-grid">
        <aside className="glass left-rail">
          <h3>Realtime Signals</h3>
          <div className="stats-grid">
            <StatCard icon={<UsersRound size={18} />} label="Active Sessions" value={data.kpis.activeSessions.toLocaleString()} />
            <StatCard icon={<CircleGauge size={18} />} label="Avg Risk" value={`${data.kpis.avgChurnRisk}%`} />
            <StatCard icon={<BellRing size={18} />} label="Predicted Churn" value={data.kpis.predictedChurners.toLocaleString()} />
            <StatCard icon={<Activity size={18} />} label="Stream Minutes" value={data.kpis.totalMinutes.toLocaleString()} />
            <StatCard icon={<Gauge size={18} />} label="Service Calls" value={data.kpis.avgServiceCalls} />
          </div>

          <div className="model-box">
            <h4>Model Snapshot</h4>
            <div className="model-grid">
              <div>
                <small>Accuracy</small>
                <p>{data.modelStats?.accuracy ?? 0}%</p>
              </div>
              <div>
                <small>Precision</small>
                <p>{data.modelStats?.precision ?? 0}%</p>
              </div>
              <div>
                <small>Recall</small>
                <p>{data.modelStats?.recall ?? 0}%</p>
              </div>
              <div>
                <small>F1</small>
                <p>{data.modelStats?.f1 ?? 0}%</p>
              </div>
            </div>
          </div>

          <div className="drivers-box">
            <div className="dataset-head">
              <TrendingUp size={16} />
              <h4>Global Risk Drivers</h4>
            </div>
            <div className="drivers-list">
              {globalDrivers.map((driver) => (
                <div key={driver.feature} className="driver-item">
                  <div className="driver-info">
                    <span>{driver.feature}</span>
                    <small>Impact {driver.impact.toFixed(2)}</small>
                  </div>
                  <div className="impact-track">
                    <div
                      className="impact-fill"
                      style={{ width: `${Math.min(100, (driver.impact / (globalDrivers[0]?.impact || 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="dataset-box">
            <div className="dataset-head">
              <Database size={16} />
              <h4>Dataset Overview</h4>
            </div>
            <div className="dataset-grid">
              <div>
                <small>Active Source</small>
                <p title={data.datasetInfo?.path}>{data.datasetInfo?.path?.split(/[/\\]/).pop() || "None"}</p>
              </div>
              <div>
                <small>Total Records</small>
                <p>{data.datasetInfo?.rows?.toLocaleString() || 0}</p>
              </div>
              <div className="status-cell">
                <small>System Status</small>
                <p className="status-ready">Model Active</p>
              </div>
            </div>
          </div>

          <div className="alerts-box">
            <h4>Alert Stack</h4>
            {data.alerts.length === 0 && <p className="muted">No anomalies in current window.</p>}
            {data.alerts.map((alert) => (
              <MotionDiv
                key={alert.id}
                className={`alert-item ${alert.severity}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <p>{alert.title}</p>
                <small>{alert.message}</small>
              </MotionDiv>
            ))}
          </div>
        </aside>

        <main className="right-stage">
          <section className="filter-bar glass">
            <label>
              Platform
              <select value={filters.platform} onChange={(e) => setFilters((prev) => ({ ...prev, platform: e.target.value }))}>
                <option>All</option>
                {(data.platforms.length ? data.platforms : data.platformMetrics.map((item) => item.name)).map((platform) => (
                  <option key={platform}>{platform}</option>
                ))}
              </select>
            </label>
            <label>
              State
              <select value={filters.state} onChange={(e) => setFilters((prev) => ({ ...prev, state: e.target.value }))}>
                <option>All</option>
                {data.states.map((stateCode) => (
                  <option key={stateCode}>{stateCode}</option>
                ))}
              </select>
            </label>
            <label>
              Risk Band
              <select value={filters.riskBand} onChange={(e) => setFilters((prev) => ({ ...prev, riskBand: e.target.value }))}>
                <option>All</option>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </label>
            <button className="reset-btn" onClick={() => setFilters({ platform: "All", state: "All", riskBand: "All" })}>
              Reset
            </button>
          </section>

          <section className="platform-strip">
            {filteredPlatformMetrics.map((platform) => (
              <article className="glass platform-card" key={platform.name}>
                <p>{platform.name}</p>
                <strong>{platform.avgRisk}%</strong>
                <small>{platform.activeUsers} active · service load {platform.serviceLoad}</small>
              </article>
            ))}
          </section>

          <section className="analytics-grid">
            <article className="glass panel churn-card">
              <h3>Churn Dynamics</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.trend}>
                  <defs>
                    <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={palette.areaFillStart} stopOpacity={0.7} />
                      <stop offset="100%" stopColor={palette.areaFillEnd} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} />
                  <XAxis dataKey="time" stroke={palette.axis} />
                  <YAxis stroke={palette.axis} />
                  <Tooltip contentStyle={{ background: palette.tooltipBg, border: `1px solid ${palette.tooltipBorder}` }} />
                  <Area type="monotone" dataKey="risk" stroke={palette.areaStroke} fill="url(#riskFill)" strokeWidth={2.4} />
                  <Line type="monotone" dataKey="churners" stroke={palette.line} strokeWidth={2.4} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </article>

            <article className="glass panel cohort-card">
              <h3>Risk Cohorts</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={filteredRiskDistribution} dataKey="users" nameKey="name" innerRadius={64} outerRadius={108}>
                    {filteredRiskDistribution.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: palette.tooltipBg, border: `1px solid ${palette.tooltipBorder}` }} />
                </PieChart>
              </ResponsiveContainer>
            </article>

            <article className="glass panel matrix-card">
              <h3>Platform Risk Matrix</h3>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={filteredPlatformMetrics}>
                  <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} />
                  <XAxis dataKey="name" stroke={palette.axis} />
                  <YAxis stroke={palette.axis} />
                  <Tooltip
                    cursor={false}
                    contentStyle={{ background: palette.tooltipBg, border: `1px solid ${palette.tooltipBorder}` }}
                  />
                  <Bar dataKey="avgRisk" radius={[8, 8, 0, 0]}>
                    {filteredPlatformMetrics.map((item) => (
                      <Cell key={item.name} fill={item.avgRisk > 67 ? palette.high : item.avgRisk > 35 ? palette.med : palette.low} />
                    ))}
                  </Bar>
                  <Bar dataKey="serviceLoad" fill={palette.secondary} radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </article>

            <article className="glass panel toprisk-card">
              <h3>Top-Risk Customers</h3>
              <div className="risk-list">
                {filteredTopRisk.map((customer) => (
                  <div className="risk-item" key={`${customer.id}-${customer.risk}`}>
                    <div>
                      <p>{customer.id}</p>
                      <small>
                        {customer.platform} · {customer.state}
                      </small>
                      {customer.riskDrivers?.[0] && (
                        <small>
                          Driver: {customer.riskDrivers[0].feature} {customer.riskDrivers[0].direction === "up" ? "+" : "-"}
                        </small>
                      )}
                    </div>
                    <strong>{customer.risk}%</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="glass panel pulse-card">
              <h3>Live Consumer Pulse</h3>
              <div className="feed-list">
                {pulseRows.length === 0 && <p className="muted">Stream warming up. Waiting for live pulse events...</p>}
                {pulseRows.map((pulse, index) => (
                  <div key={pulse.id || `${pulse.platform}-${index}`} className="feed-item">
                    <span>{pulse.platform}</span>
                    <span>{pulse.state}</span>
                    <span>{pulse.tier}</span>
                    <span>Interaction {Number(pulse.interactionPulse || 0).toFixed(0)}</span>
                    <span>Risk {Number(pulse.risk || 0).toFixed(2)}%</span>
                    <span>Friction {Number(pulse.bufferingRate || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>
          <div className="credit-text">done by bhuvan kio💩</div>
        </main>
      </section>
    </div>
  );
}

export default App;
