import React, { useEffect, useRef, useState } from "react";
import { FiZap, FiBarChart2, FiSettings } from "react-icons/fi";
import History from "./History";
import Setting from "./Setting";
import "./Home.css";

const PIEZO_MAH_PER_STEP = 0.0042;
const UPDATE_INTERVAL = 1000;
const MAX_CAPACITY = 3000;
const DEFAULT_BASELINE_LOAD = 80;

function IconFoot() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M9 21c-1.5 0-3-1.2-3-2.7 0-1.7 2-2.6 3.6-3.6 1.3-.8 2.4-1.4 3.4-2.5l1.9-1.8c.7-.7.9-1.8.5-2.7-.4-1-1.5-1.7-2.6-1.5-1 .1-1.8.8-2.2 1.7l-1.3 2.6c-.4.8-1 1.5-1.7 2.1-1 .8-2.3 1.5-3.1 2.7C4.1 16 4 17.6 4.7 18.7 5.5 20 7.2 21 9 21Z" stroke="currentColor" strokeWidth="1.5" />
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
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CircleStat({
  title,
  value,
  max,
  unit,
  icon,
  highlight = "default",
  forceFull = false,
}) {
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
  const [steps, setSteps] = useState(0);
  const [genRateMahPerHour, setGenRateMahPerHour] = useState(0);
  const [battery, setBattery] = useState(1420);
  const [simulated, setSimulated] = useState(true);
  const [tab, setTab] = useState("today");
  const [series, setSeries] = useState([]);
  const lastSteps = useRef(0);
  const emaRef = useRef(0); // smoothing for mAh/h
  const stepsUrlRef = useRef(null);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("theme");
      if (savedTheme === "light") document.body.setAttribute("data-theme", "light");
      else document.body.removeAttribute("data-theme");
      const simPref = localStorage.getItem("simulated");
      if (simPref != null) setSimulated(simPref !== "false");
      stepsUrlRef.current = localStorage.getItem("stepsUrl") || "http://192.168.1.13:3001/steps";
    } catch {}
    const onTheme = (e) => {
      const t = e.detail?.theme;
      if (t === "light") document.body.setAttribute("data-theme", "light");
      else document.body.removeAttribute("data-theme");
    };
    const onSim = (e) => setSimulated(!!e.detail?.enabled);
    const onUrl = (e) => {
      if (e.detail?.url) stepsUrlRef.current = e.detail.url;
    };
    window.addEventListener("piezo-theme", onTheme);
    window.addEventListener("piezo-sim-toggle", onSim);
    window.addEventListener("piezo-steps-url", onUrl);
    return () => {
      window.removeEventListener("piezo-theme", onTheme);
      window.removeEventListener("piezo-sim-toggle", onSim);
      window.removeEventListener("piezo-steps-url", onUrl);
    };
  }, []);

  useEffect(() => {
    const alpha = 0.3; // EMA smoothing factor
    const timer = setInterval(() => {
      if (simulated) {
        // Simulate ~1 step/sec with randomness (0,1,2)
        const rnd = Math.random();
        const k = rnd < 0.15 ? 0 : rnd < 0.9 ? 1 : 2;
        if (k > 0) {
          setSteps((s) => {
            const ns = s + k;
            try { localStorage.setItem("todaySteps", String(ns)); } catch {}
            return ns;
          });
          const addedEnergy = k * PIEZO_MAH_PER_STEP;
          setBattery((b) => b + addedEnergy);
        }
        const instRate = k * PIEZO_MAH_PER_STEP * 3600; // mAh per hour
        emaRef.current = emaRef.current * (1 - alpha) + instRate * alpha;
        setGenRateMahPerHour(emaRef.current);
        try { localStorage.setItem("todayMahPerHour", String(emaRef.current)); } catch {}
        setSeries((arr) => {
          const next = [...arr, emaRef.current];
          if (next.length > 60) next.shift();
          return next;
        });
        try {
          const idx = new Date().getDay();
          window.dispatchEvent(new CustomEvent("piezo-today-update", { detail: { dayIndex: idx, steps: Number(localStorage.getItem("todaySteps") || "0"), mahPerHour: emaRef.current } }));
        } catch {}
      } else {
        // Live mode: poll backend steps each second
        fetch(stepsUrlRef.current || "http://192.168.1.13:3001/steps")
          .then((res) => res.json())
          .then((data) => {
            const s = Number(data.steps) || 0;
            setSteps(s);
            const delta = Math.max(0, s - lastSteps.current);
            if (delta > 0) {
              const addedEnergy = delta * PIEZO_MAH_PER_STEP;
              setBattery((b) => b + addedEnergy);
            }
            const instRate = delta * PIEZO_MAH_PER_STEP * 3600;
            emaRef.current = emaRef.current * (1 - alpha) + instRate * alpha;
            setGenRateMahPerHour(emaRef.current);
            try {
              localStorage.setItem("todaySteps", String(s));
              localStorage.setItem("todayMahPerHour", String(emaRef.current));
            } catch {}
            setSeries((arr) => {
              const next = [...arr, emaRef.current];
              if (next.length > 60) next.shift();
              return next;
            });
            try {
              const idx = new Date().getDay();
              window.dispatchEvent(new CustomEvent("piezo-today-update", { detail: { dayIndex: idx, steps: s, mahPerHour: emaRef.current } }));
            } catch {}
            lastSteps.current = s;
          })
          .catch(() => {
            // Stay or switch to simulated if fetch fails
            setSimulated(true);
          });
      }
    }, UPDATE_INTERVAL);
    return () => clearInterval(timer);
  }, [simulated]);

  // Try to auto-switch to live if backend responds once
  useEffect(() => {
    const controller = new AbortController();
    fetch((stepsUrlRef.current || "http://192.168.1.13:3001/steps"), { signal: controller.signal })
      .then((r) => r.json())
      .then(() => setSimulated(false))
      .catch(() => setSimulated(true));
    return () => controller.abort();
  }, []);

  const batteryPercent = ((battery / MAX_CAPACITY) * 100).toFixed(1);
  const makePath = (vals, width = 320, height = 80) => {
    if (!vals.length) return "";
    const max = Math.max(...vals, 1);
    const min = 0;
    const step = width / Math.max(1, vals.length - 1);
    let d = "";
    for (let i = 0; i < vals.length; i++) {
      const x = i * step;
      const y = height - ((vals[i] - min) / Math.max(1e-6, max - min)) * height;
      d += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
    }
    return d;
  };
  const dynamicPath = makePath(series, 320, 80);
  const baselineLoad = Number(localStorage.getItem("baselineLoadMahPerHour") || DEFAULT_BASELINE_LOAD);
  const remainingMah = Math.max(0, MAX_CAPACITY - battery);
  const timeToFullHours = genRateMahPerHour > 0 ? remainingMah / genRateMahPerHour : null;
  const netRate = genRateMahPerHour - baselineLoad;
  const timeToDrainHours = netRate < 0 ? battery / (-netRate) : null;
  const fmtHours = (hrs) => {
    if (!hrs || !isFinite(hrs)) return "—";
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
        </div>

        <div key={tab} className={`tab-content tab-${tab}`}>
          {tab === "today" ? (
            <>
              <div className="meter-row">
                <CircleStat title="STEPS" value={steps} max={1} forceFull icon={<IconFoot />} />
                <CircleStat
                  title="mAh / HOUR"
                  value={genRateMahPerHour.toFixed(2)}
                  max={20}
                  unit="mAh/h"
                  highlight="gen"
                  icon={<IconBattery />}
                />
                <CircleStat
                  title="BATTERY %"
                  value={batteryPercent}
                  max={100}
                  unit="%"
                  highlight="battery"
                  icon={<IconCog />}
                />
              </div>
              <div className="screen-overlay" />
              <div className="sparkles" />
              <div className="graph">
                <svg viewBox="0 0 320 80" preserveAspectRatio="none">
                  <path d={dynamicPath} className="graph-line" />
                </svg>
                <div className="graph-label">DAILY ENERGY PRODUCTION</div>
              </div>
              <div className="projection">
                <div className="projection-item">
                  <div className="projection-label">Full at current rate</div>
                  <div className="projection-value">{fmtHours(timeToFullHours)}</div>
                </div>
                <div className="projection-item">
                  <div className="projection-label">Empty at net rate</div>
                  <div className="projection-value">{timeToDrainHours ? fmtHours(timeToDrainHours) : netRate >= 0 ? "Charging" : "—"}</div>
                </div>
              </div>
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
