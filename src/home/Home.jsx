import React, { useEffect, useRef, useState } from "react";
import { FiZap, FiBarChart2, FiSettings } from "react-icons/fi";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import History from "./History";
import Setting from "./Setting";
import "./Home.css";

const PIEZO_MAH_PER_STEP = 0.00000042;
const PIEZOS_TOTAL = 8 * 60;
const HISTORY_EFFECTIVE_PIEZO_MAH_PER_STEP = PIEZO_MAH_PER_STEP * PIEZOS_TOTAL * 40000;

// Returns "YYYY-MM-DD" in local time
function getTodayPrefix() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function IconFoot() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 21c-1.5 0-3-1.2-3-2.7 0-1.7 2-2.6 3.6-3.6 1.3-.8 2.4-1.4 3.4-2.5l1.9-1.8c.7-.7.9-1.8.5-2.7-.4-1-1.5-1.7-2.6-1.5-1 .1-1.8.8-2.2 1.7l-1.3 2.6c-.4.8-1 1.5-1.7 2.1-1 .8-2.3 1.5-3.1 2.7C4.1 16 4 17.6 4.7 18.7 5.5 20 7.2 21 9 21Z"
        stroke="currentColor" strokeWidth="1.5"
      />
      <circle cx="17.5" cy="6" r="1.4" fill="currentColor" />
      <circle cx="19.5" cy="8.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function IconBattery() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="7" width="16" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="9" width="10" height="6" rx="1.5" fill="currentColor" />
      <rect x="19" y="10" width="2" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}

function IconCog() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
    </svg>
  );
}

function CircleStat({ title, value, max, unit, icon, highlight = "default", forceFull = false }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const numericValue = parseFloat(value) || 0;
  const percent = forceFull ? 100 : Math.min((numericValue / max) * 100, 100);
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="meter">
      <div className="meter-title">{title}</div>
      <div className="meter-wrap">
        <svg viewBox="0 0 130 130" className="meter-svg" style={{ transform: "rotate(-90deg)" }}>
          <circle className="meter-track" cx="65" cy="65" r={radius} />
          <circle
            className={`meter-progress meter-${highlight}`}
            cx="65" cy="65" r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="meter-value">
          {value}
          {unit && <span className="meter-unit">{unit}</span>}
          {icon && <div className="meter-subicon">{icon}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [steps, setSteps] = useState(0);
  const [batteryPercent, setBatteryPercent] = useState(null);
  const [batteryVoltage, setBatteryVoltage] = useState(null);
  const [tab, setTab] = useState("today");
  const [connected, setConnected] = useState(false);

  // Apply saved theme
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("theme");
      if (savedTheme === "light") document.body.setAttribute("data-theme", "light");
      else document.body.removeAttribute("data-theme");
    } catch {}
    const onTheme = (e) => {
      const t = e.detail?.theme;
      if (t === "light") document.body.setAttribute("data-theme", "light");
      else document.body.removeAttribute("data-theme");
    };
    window.addEventListener("piezo-theme", onTheme);
    return () => window.removeEventListener("piezo-theme", onTheme);
  }, []);

  // Listen to /serialInputs
  // On first snapshot: count today's entries by datetime prefix → restore today's total
  // Listen to /serialInputs — recount today's entries on every snapshot
  // This is robust against ESP reboots (millis() resets) and always correct.
  useEffect(() => {
    const stepsRef = ref(db, "serialInputs");

    const unsub = onValue(
      stepsRef,
      (snapshot) => {
        setConnected(true);
        const data = snapshot.val();
        if (!data || typeof data !== "object") return;

        // Always use local date so it matches the ESP32's datetime field
        const todayPrefix = getTodayPrefix();

        const todaySteps = Object.values(data).filter(
          (e) =>
            String(e.text || "").trim() === "1" &&
            String(e.datetime || "").startsWith(todayPrefix)
        ).length;

        setSteps(todaySteps);
      },
      (error) => {
        console.error("Firebase /serialInputs error:", error);
        setConnected(false);
      }
    );

    return () => unsub();
  }, []);

  // Listen to /battery
  useEffect(() => {
    const battRef = ref(db, "battery");
    const unsub = onValue(
      battRef,
      (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        const pct = parseFloat(data.percent);
        const volt = parseFloat(data.voltage);
        if (!isNaN(pct)) setBatteryPercent(pct);
        if (!isNaN(volt)) setBatteryVoltage(volt);
      },
      (error) => console.error("Firebase /battery error:", error)
    );
    return () => unsub();
  }, []);

  const hasBattery = batteryPercent !== null;
  const dailyMahTotal = Number((steps * HISTORY_EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6));

  // Battery capacity of the pack in mAh
  const BATTERY_CAPACITY_MAH = 40000;
  // Add the contribution from today's generated mAh to the ESP-reported base %
  const generatedContribution = (dailyMahTotal / BATTERY_CAPACITY_MAH) * 100;
  const adjustedBatteryPercent = hasBattery
    ? Math.min(100, batteryPercent + generatedContribution)
    : null;

  return (
    <div className="home">
      <div className="device">
        <div className="header">
          <div className="title">
            {tab === "today" ? "EHB Monitor" : tab === "history" ? "HISTORY" : "SETTINGS"}{" "}
            <span className="header-icon">
              {tab === "today" ? <FiZap /> : tab === "history" ? <FiBarChart2 /> : <FiSettings />}
            </span>
          </div>
          {tab === "today" && (
            <div
              className="connection-badge"
              style={{
                fontSize: "10px",
                padding: "2px 8px",
                borderRadius: "999px",
                background: connected ? "rgba(31,183,169,0.15)" : "rgba(255,100,100,0.15)",
                color: connected ? "var(--teal)" : "#ff6b6b",
                border: `1px solid ${connected ? "var(--teal)" : "#ff6b6b"}`,
              }}
            >
              {connected ? "● LIVE" : "○ OFFLINE"}
            </div>
          )}
        </div>

        <div key={tab} className={`tab-content tab-${tab}`}>
          {tab === "today" ? (
            <>
              {/* ── Desktop stat cards ── */}
              <div className="today-grid">
                <div className="stat-cards">
                  <div className="stat-card blue">
                    <div className="stat-card-label">Steps Today</div>
                    <div className="stat-card-value">
                      {steps.toLocaleString()}
                    </div>
                    <div className="stat-card-icon"><IconFoot /></div>
                  </div>
                  <div className="stat-card teal">
                    <div className="stat-card-label">Total mAh Generated</div>
                    <div className="stat-card-value">
                      {dailyMahTotal.toFixed(2)}
                      <span className="unit">mAh</span>
                    </div>
                    <div className="stat-card-icon"><IconBattery /></div>
                  </div>
                  <div className="stat-card green">
                    <div className="stat-card-label">Battery Level</div>
                    <div className="stat-card-value">
                      {adjustedBatteryPercent !== null
                        ? `${adjustedBatteryPercent.toFixed(1)}`
                        : "—"}
                      {adjustedBatteryPercent !== null && <span className="unit">%</span>}
                    </div>
                    <div className="stat-card-icon"><IconCog /></div>
                  </div>
                </div>

                {/* ── Info row ── */}
                {hasBattery && (
                  <div style={{ display: "none" }}>
                    <div className="info-card">
                      <div className="info-card-label">Battery Voltage</div>
                      <div className="info-card-value" style={{ color: "var(--teal)" }}>
                        {batteryVoltage !== null ? `${batteryVoltage.toFixed(2)} V` : "—"}
                      </div>
                    </div>
                    <div className="info-card">
                      <div className="info-card-label">Base % + Generated</div>
                      <div className="info-card-value" style={{ color: "var(--blue)" }}>
                        {batteryPercent.toFixed(1)}% + {generatedContribution.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Mobile meters (hidden on desktop via CSS) ── */}
              <div className="meter-row">
                <CircleStat title="STEPS" value={steps} max={1} forceFull icon={<IconFoot />} />
                <CircleStat
                  title="TOTAL mAh"
                  value={dailyMahTotal.toFixed(2)}
                  max={0.02}
                  unit="mAh"
                  highlight="gen"
                  icon={<IconBattery />}
                />
                <CircleStat
                  title="BATTERY %"
                  value={adjustedBatteryPercent !== null ? adjustedBatteryPercent.toFixed(1) : "—"}
                  max={100}
                  unit={adjustedBatteryPercent !== null ? "%" : ""}
                  highlight="battery"
                  icon={<IconCog />}
                />
              </div>
              <div className="screen-overlay" />
              <div className="sparkles" />
              {hasBattery && (
                <div style={{ display: "none" }}>
                  {batteryVoltage !== null
                    ? `Battery: ${batteryVoltage.toFixed(2)} V · Base: ${batteryPercent.toFixed(1)}% + ${generatedContribution.toFixed(2)}% generated`
                    : `Base: ${batteryPercent.toFixed(1)}% + ${generatedContribution.toFixed(2)}% generated`}
                </div>
              )}
            </>
          ) : tab === "history" ? (
            <History />
          ) : tab === "settings" ? (
            <Setting />
          ) : null}
        </div>

        <div className="bottom-nav">
          <div className={`nav-item ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
            <div className="icon"><FiZap /></div>
            <div className="label">TODAY</div>
            {tab === "today" && <div className="underline" />}
          </div>
          <div className={`nav-item ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
            <div className="icon"><FiBarChart2 /></div>
            <div className="label">HISTORY</div>
            {tab === "history" && <div className="underline" />}
          </div>
          <div className={`nav-item ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
            <div className="icon"><FiSettings /></div>
            <div className="label">SETTINGS</div>
            {tab === "settings" && <div className="underline" />}
          </div>
        </div>
      </div>
    </div>
  );
}
