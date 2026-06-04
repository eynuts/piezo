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

// Returns "YYYY-MM-DD" for today (used to filter /serialInputs by datetime)
function getTodayPrefix() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // e.g. "2026-06-04"
}

function getEffectiveDayIndex() {
  return new Date().getDay();
}

function getWeekStartKey() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - now.getDay());
  return now.toISOString().slice(0, 10);
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

  const isFirstLoadRef = useRef(true);
  const lastTimestampRef = useRef(0);

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

  // When History mounts late and requests a sync, re-broadcast today's count
  useEffect(() => {
    const onSyncRequest = () => {
      setSteps((current) => {
        const dailyMah = Number((current * HISTORY_EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6));
        window.dispatchEvent(
          new CustomEvent("piezo-today-update", {
            detail: {
              dayIndex: getEffectiveDayIndex(),
              steps: current,
              mahPerHour: 0,
              dailyMah,
            },
          })
        );
        return current; // don't change the value
      });
    };
    window.addEventListener("piezo-request-sync", onSyncRequest);
    return () => window.removeEventListener("piezo-request-sync", onSyncRequest);
  }, []);

  // Listen to /serialInputs
  // On first snapshot: count today's entries by datetime prefix → restore today's total
  // On subsequent snapshots: count only entries newer than lastTimestamp → add increments
  useEffect(() => {
    const stepsRef = ref(db, "serialInputs");
    const todayPrefix = getTodayPrefix(); // "2026-06-04"

    const unsub = onValue(
      stepsRef,
      (snapshot) => {
        setConnected(true);
        const data = snapshot.val();
        if (!data || typeof data !== "object") return;

        const entries = Object.values(data);

        if (isFirstLoadRef.current) {
          isFirstLoadRef.current = false;

          // Count all step pulses whose datetime belongs to today
          const todaySteps = entries.filter(
            (e) =>
              String(e.text || "").trim() === "1" &&
              String(e.datetime || "").startsWith(todayPrefix)
          ).length;

          // Remember the highest timestamp already in DB so we don't recount them
          const maxTs = entries.reduce((m, e) => Math.max(m, e.timestamp || 0), 0);
          lastTimestampRef.current = maxTs;

          setSteps(todaySteps);

          // Sync restored count into History tab
          const dailyMah = Number((todaySteps * HISTORY_EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6));
          window.dispatchEvent(
            new CustomEvent("piezo-today-update", {
              detail: {
                dayIndex: getEffectiveDayIndex(),
                steps: todaySteps,
                mahPerHour: 0,
                dailyMah,
              },
            })
          );
          return;
        }

        // Live updates — only entries with a timestamp we haven't seen yet
        const newEntries = entries
          .filter((e) => (e.timestamp || 0) > lastTimestampRef.current)
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        newEntries.forEach((entry) => {
          const ts = entry.timestamp || 0;
          const text = String(entry.text || "").trim();
          lastTimestampRef.current = ts;

          if (text === "1") {
            setSteps((s) => {
              const ns = s + 1;
              const dailyMah = Number((ns * HISTORY_EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6));
              window.dispatchEvent(
                new CustomEvent("piezo-today-update", {
                  detail: {
                    dayIndex: getEffectiveDayIndex(),
                    steps: ns,
                    mahPerHour: 0,
                    dailyMah,
                  },
                })
              );
              return ns;
            });
          }
        });
      },
      (error) => {
        console.error("Firebase /serialInputs error:", error);
        setConnected(false);
      }
    );

    return () => unsub();
  }, []); // runs once — todayPrefix is captured at mount, correct for the day

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
