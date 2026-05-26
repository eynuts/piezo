import React, { useEffect, useState } from "react";
import "./Setting.css";
import { FiSun, FiMoon, FiTrash2 } from "react-icons/fi";

function Toggle({ checked, onChange, label, leftIcon, rightIcon }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span className="setting-icon">{checked ? rightIcon : leftIcon}</span>
        {label}
      </div>
      <button
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        type="button"
      >
        <span className="thumb" />
      </button>
    </div>
  );
}

export default function Setting() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    try {
      setLight(localStorage.getItem("theme") === "light");
    } catch {}
  }, []);

  const applyTheme = (isLight) => {
    setLight(isLight);
    try {
      if (isLight) {
        document.body.setAttribute("data-theme", "light");
        localStorage.setItem("theme", "light");
      } else {
        document.body.removeAttribute("data-theme");
        localStorage.setItem("theme", "dark");
      }
    } catch {}
    try { window.dispatchEvent(new CustomEvent("piezo-theme", { detail: { theme: isLight ? "light" : "dark" } })); } catch {}
  };

  const clearHistory = () => {
    try {
      localStorage.removeItem("historyWeekStart");
      localStorage.removeItem("historySteps");
      localStorage.removeItem("historyMah");
      localStorage.removeItem("todaySteps");
      localStorage.removeItem("todayMahPerHour");
      window.dispatchEvent(new CustomEvent("piezo-history-cleared"));
    } catch {}
  };

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-title">APPEARANCE</div>
        <Toggle
          checked={light}
          onChange={applyTheme}
          label={light ? "Light Mode" : "Dark Mode"}
          leftIcon={<FiMoon />}
          rightIcon={<FiSun />}
        />
      </div>

      <div className="settings-section">
        <div className="settings-title">DATA</div>
        <button type="button" className="btn danger" onClick={clearHistory}>
          <FiTrash2 /> Clear History
        </button>
      </div>
    </div>
  );
}
