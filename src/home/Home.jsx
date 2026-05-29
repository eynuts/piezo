import React, { useEffect, useRef, useState } from "react";
import { FiZap, FiBarChart2, FiSettings } from "react-icons/fi";
import { ref, onValue, set, get } from "firebase/database";
import { db } from "../firebase";
import History from "./History";
import Setting from "./Setting";
import "./Home.css";

// Estimated mAh generated per piezo step pulse. Keep very small for realistic plate output.
const PIEZO_MAH_PER_STEP = 0.00000042;
const PIEZOS_TOTAL = 8 * 60; // 8 tiles × 60 piezos each
const HOME_PIEZO_MAH_MULTIPLIER = 1;
const HISTORY_PIEZO_MAH_MULTIPLIER = 40000;
const HOME_EFFECTIVE_PIEZO_MAH_PER_STEP = PIEZO_MAH_PER_STEP * PIEZOS_TOTAL * HOME_PIEZO_MAH_MULTIPLIER;
const HISTORY_EFFECTIVE_PIEZO_MAH_PER_STEP = PIEZO_MAH_PER_STEP * PIEZOS_TOTAL * HISTORY_PIEZO_MAH_MULTIPLIER;

const getEffectiveDate = (base = new Date()) => {
  const d = new Date(base);
  if (d.getHours() === 0) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(0, 0, 0, 0);
  return d;
};

const getEffectiveDayIndex = (base = new Date()) => getEffectiveDate(base).getDay();

const getEffectiveWeekKey = (base = new Date()) => {
  const effective = getEffectiveDate(base);
  const start = new Date(effective);
  start.setDate(start.getDate() - start.getDay());
  return start.toISOString().slice(0, 10);
};

const getNextDayBoundary = (base = new Date()) => {
  const next = new Date(base);
  if (next.getHours() < 1) {
    next.setHours(1, 0, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(1, 0, 0, 0);
  }
  return next;
};

function IconFoot() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 21c-1.5 0-3-1.2-3-2.7 0-1.7 2-2.6 3.6-3.6 1.3-.8 2.4-1.4 3.4-2.5l1.9-1.8c.7-.7.9-1.8.5-2.7-.4-1-1.5-1.7-2.6-1.5-1 .1-1.8.8-2.2 1.7l-1.3 2.6c-.4.8-1 1.5-1.7 2.1-1 .8-2.3 1.5-3.1 2.7C4.1 16 4 17.6 4.7 18.7 5.5 20 7.2 21 9 21Z"
        stroke="currentColor"
        strokeWidth="1.5"
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
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
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
            cx="65"
            cy="65"
            r={radius}
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
  // All values start at 0/null — only populated from Firebase
  const [steps, setSteps] = useState(0);
  const [genRateMahPerHour, setGenRateMahPerHour] = useState(0);
  const [batteryPercent, setBatteryPercent] = useState(null); // null = not yet received
  const [batteryVoltage, setBatteryVoltage] = useState(null);
  const [batterySafetyOn, setBatterySafetyOn] = useState(false);
  const [tab, setTab] = useState("today");
  const [series, setSeries] = useState([]);
  const [connected, setConnected] = useState(false);
  const [weekKey, setWeekKey] = useState(getEffectiveWeekKey());
  const [todayIdx, setTodayIdx] = useState(getEffectiveDayIndex());
  const [hasHistoryData, setHasHistoryData] = useState(false);
  const [initialSerialCount, setInitialSerialCount] = useState(null);
  const [initialSerialLoaded, setInitialSerialLoaded] = useState(false);

  const lastTimestampRef = useRef(null);
  const lastStepTimestampRef = useRef(null);
  const isFirstLoadRef = useRef(true);
  const emaRef = useRef(0);

  // Helper to calculate mAh respecting battery safety setting
  const calculateHomeMah = (stepCount) => Number((stepCount * HOME_EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6));
  const calculateHistoryMah = (stepCount) => Number((stepCount * HISTORY_EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6));

  const calculateHomeMahWithSafety = (stepCount) => {
    if (batterySafetyOn && batteryPercent !== null) {
      if (batteryPercent >= 100) return 0; // Battery full, no mAh recording
      if (batteryPercent >= 50) return 0; // Battery >= 50%, wait to drop below 50%
      // Battery < 50%, allow normal mAh
    }
    return calculateHomeMah(stepCount);
  };

  const calculateHistoryMahWithSafety = (stepCount) => {
    if (batterySafetyOn && batteryPercent !== null) {
      if (batteryPercent >= 100) return 0; // Battery full, no mAh recording
      if (batteryPercent >= 50) return 0; // Battery >= 50%, wait to drop below 50%
      // Battery < 50%, allow normal mAh
    }
    return calculateHistoryMah(stepCount);
  };

  // Apply saved theme on mount
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

  useEffect(() => {
    let timerId;
    const schedule = () => {
      const next = getNextDayBoundary();
      const ms = next.getTime() - Date.now();
      timerId = window.setTimeout(() => {
        setTodayIdx(getEffectiveDayIndex());
        setWeekKey(getEffectiveWeekKey());
        schedule();
      }, Math.max(ms, 0));
    };

    schedule();
    return () => {
      if (timerId) window.clearTimeout(timerId);
    };
  }, []);

  useEffect(() => {
    // Listen to the full history node for this week so we don't treat a missing
    // `steps` array as an absence of history when `mah` (or other data) exists.
    const historyRef = ref(db, `history/${weekKey}`);
    const unsub = onValue(
      historyRef,
      async (snapshot) => {
        const data = snapshot.val() || {};
        const has = snapshot.exists() && (data.steps !== undefined || data.mah !== undefined);
        setHasHistoryData(!!has);

        const stepsArr = Array.isArray(data.steps) ? data.steps : null;
        if (has) {
          setSteps(Number(stepsArr?.[todayIdx] ?? 0));
          return;
        }

        // If no data found for the computed weekKey, try adjacent week keys
        // (covers cases where earlier writes used a different week-start calculation).
        try {
          const prevKey = getEffectiveWeekKey(new Date(Date.now() - 86400000));
          const nextKey = getEffectiveWeekKey(new Date(Date.now() + 86400000));

          const prevSnap = await get(ref(db, `history/${prevKey}`));
          if (prevSnap.exists()) {
            const prevData = prevSnap.val() || {};
            const prevSteps = Array.isArray(prevData.steps) ? prevData.steps : null;
            setHasHistoryData(true);
            setSteps(Number(prevSteps?.[todayIdx] ?? 0));
            return;
          }

          const nextSnap = await get(ref(db, `history/${nextKey}`));
          if (nextSnap.exists()) {
            const nextData = nextSnap.val() || {};
            const nextSteps = Array.isArray(nextData.steps) ? nextData.steps : null;
            setHasHistoryData(true);
            setSteps(Number(nextSteps?.[todayIdx] ?? 0));
            return;
          }
        } catch (err) {
          console.error("Error checking adjacent history keys:", err);
        }

        // No history found nearby — fall back to zero for now
        setSteps(0);
      },
      (error) => {
        console.error("Firebase /history error:", error);
      }
    );

    return () => unsub();
  }, [weekKey, todayIdx]);

  // Read battery safety setting from Firebase
  useEffect(() => {
    const batteryRef = ref(db, "batterySafety");
    const unsub = onValue(
      batteryRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data !== null) {
          setBatterySafetyOn(data === true || data === "true");
        }
      },
      (error) => {
        console.error("Firebase /batterySafety error:", error);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!initialSerialLoaded || !isFirstLoadRef.current) return;
    if (hasHistoryData) {
      isFirstLoadRef.current = false;
      return;
    }

    const count = initialSerialCount || 0;
    setSteps(count);

    const today = getEffectiveDayIndex();
    const historySteps = Array(7).fill(0);
    const historyMah = Array(7).fill(0);
    historySteps[today] = count;
    historyMah[today] = calculateHistoryMahWithSafety(count);
    set(ref(db, `history/${weekKey}/steps`), historySteps).catch((err) => {
      console.error("Failed to write fallback history steps:", err);
    });
    set(ref(db, `history/${weekKey}/mah`), historyMah).catch((err) => {
      console.error("Failed to write fallback history mAh:", err);
    });

    isFirstLoadRef.current = false;
  }, [initialSerialLoaded, hasHistoryData, initialSerialCount, weekKey]);

  // Listen to /serialInputs — each new write with text="1" is one step pulse
  useEffect(() => {
    const stepsRef = ref(db, "serialInputs");
    const alpha = 0.3;

    const unsub = onValue(
      stepsRef,
      (snapshot) => {
        setConnected(true);
        const data = snapshot.val();
        if (!data || typeof data !== "object") return;

        const entries = Object.values(data);
        const maxExistingTs = entries.reduce((max, entry) => Math.max(max, entry.timestamp || 0), 0);
        const existingStepCount = entries.filter((entry) => String(entry.text || "").trim() === "1").length;

        if (isFirstLoadRef.current) {
          lastTimestampRef.current = maxExistingTs;
          setInitialSerialCount(existingStepCount);
          setInitialSerialLoaded(true);
          return;
        }

        entries
          .filter((entry) => (entry.timestamp || 0) > (lastTimestampRef.current || 0))
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          .forEach((entry) => {
            const ts = entry.timestamp;
            const text = String(entry.text || "").trim();

            if (ts > (lastTimestampRef.current || 0)) {
              lastTimestampRef.current = ts;

              if (text === "1") {
                setSteps((s) => {
                  const ns = s + 1;
                  // Notify History so it can update the weekly chart
                  try {
                    const idx = getEffectiveDayIndex();
                    const dailyMah = calculateHistoryMahWithSafety(ns);
                    window.dispatchEvent(
                      new CustomEvent("piezo-today-update", {
                        detail: { dayIndex: idx, steps: ns, mahPerHour: emaRef.current, dailyMah },
                      })
                    );
                  } catch {}
                  return ns;
                });

                // Update EMA generation rate using actual step interval.
                let instRate = 0;
                if (lastStepTimestampRef.current && ts > lastStepTimestampRef.current) {
                  const deltaMs = ts - lastStepTimestampRef.current;
                  instRate = (HOME_EFFECTIVE_PIEZO_MAH_PER_STEP * 3600 * 1000) / deltaMs; // mAh/h
                }
                lastStepTimestampRef.current = ts;

                if (instRate > 0) {
                  emaRef.current = emaRef.current * (1 - alpha) + instRate * alpha;
                  setGenRateMahPerHour(emaRef.current);

                  setSeries((arr) => {
                    const next = [...arr, emaRef.current];
                    if (next.length > 60) next.shift();
                    return next;
                  });
                }
              }
            }
          });
      },
      (error) => {
        console.error("Firebase /serialInputs error:", error);
        setConnected(false);
      }
    );

    return () => unsub();
  }, []);

  // Listen to /battery — voltage and percent written by ESP32
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
      (error) => {
        console.error("Firebase /battery error:", error);
      }
    );
    return () => unsub();
  }, []);

  const makePath = (vals, width = 320, height = 80) => {
    if (vals.length < 2) return "";
    const max = Math.max(...vals, 1);
    const step = width / (vals.length - 1);
    return vals
      .map((v, i) => {
        const x = i * step;
        const y = height - (v / max) * height;
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  };

  const dynamicPath = makePath(series, 320, 80);

  // Projections — only shown when battery data is available from ESP
  const hasBattery = batteryPercent !== null;
  const timeToFullHours =
    hasBattery && genRateMahPerHour > 0
      ? ((100 - batteryPercent) / 100) / (genRateMahPerHour / (genRateMahPerHour + 1e-9)) * 100
      : null;
  // Simpler: time to full = remaining% / rate_per_percent_per_hour
  // rate_per_percent_per_hour = genRateMahPerHour / (batteryCapacity/100)
  // We don't know capacity, so just show drain direction from ESP data
  const fmtHours = (hrs) => {
    if (!hrs || !isFinite(hrs) || hrs <= 0) return "—";
    const h = Math.floor(hrs);
    const m = Math.round((hrs - h) * 60);
    return `${h}h ${m}m`;
  };

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
                <CircleStat
                  title="STEPS"
                  value={steps}
                  max={1}
                  forceFull
                  icon={<IconFoot />}
                />
                <CircleStat
                  title="EST. mAh / HOUR"
                  value={genRateMahPerHour.toFixed(4)}
                  max={2}
                  unit="mAh/h"
                  highlight="gen"
                  icon={<IconBattery />}
                />
                <CircleStat
                  title="BATTERY %"
                  value={hasBattery ? batteryPercent.toFixed(1) : "—"}
                  max={100}
                  unit={hasBattery ? "%" : ""}
                  highlight="battery"
                  icon={<IconCog />}
                />
              </div>
              <div className="screen-overlay" />
              <div className="sparkles" />
              <div className="graph">
                <svg viewBox="0 0 320 80" preserveAspectRatio="none">
                  {dynamicPath ? (
                    <path d={dynamicPath} className="graph-line" />
                  ) : (
                    <text x="50%" y="50%" textAnchor="middle" fill="var(--muted)" fontSize="10">
                      Waiting for data…
                    </text>
                  )}
                </svg>
                <div className="graph-label" style={{ opacity: 0, display: "none" }}>LIVE EST. ENERGY RATE (mAh/h)</div>
              </div>

              <div
                style={{
                  textAlign: "center",
                  fontSize: "12px",
                  color: "var(--muted)",
                  marginTop: "6px",
                  opacity: 0,
                  display: "none"
                }}
              >
                Estimated generated: {Number((steps * HOME_EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6))} mAh
              </div>

              {hasBattery && (
                <div
                  style={{
                    textAlign: "center",
                    fontSize: "11px",
                    color: "var(--muted)",
                    marginTop: "4px",
                    opacity: 0,
                    display: "none"
                  }}
                >
                  {batteryVoltage !== null
                    ? `Battery: ${batteryVoltage.toFixed(2)} V · ${batteryPercent.toFixed(1)}%`
                    : `Battery: ${batteryPercent.toFixed(1)}%`}
                </div>
              )}

              {!connected && (
                <div
                  style={{
                    textAlign: "center",
                    fontSize: "11px",
                    color: "#ff6b6b",
                    marginTop: "8px",
                  }}
                >
                  Waiting for ESP32 data…
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
          <div
            className={`nav-item ${tab === "today" ? "active" : ""}`}
            onClick={() => setTab("today")}
          >
            <div className="icon"><FiZap /></div>
            <div className="label">TODAY</div>
            {tab === "today" && <div className="underline" />}
          </div>
          <div
            className={`nav-item ${tab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
          >
            <div className="icon"><FiBarChart2 /></div>
            <div className="label">HISTORY</div>
            {tab === "history" && <div className="underline" />}
          </div>
          <div
            className={`nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <div className="icon"><FiSettings /></div>
            <div className="label">SETTINGS</div>
            {tab === "settings" && <div className="underline" />}
          </div>
        </div>
      </div>
    </div>
  );
}
