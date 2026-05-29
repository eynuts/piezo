import React, { useEffect, useState } from "react";
import "./Setting.css";
import { FiSun, FiMoon, FiTrash2, FiZapOff, FiZap } from "react-icons/fi";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";

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
  const [lightControlMode, setLightControlMode] = useState("auto"); // "auto" or "manual"
  const [lightState, setLightState] = useState(false); // true = on, false = off
  const [batterySafetyOn, setBatterySafetyOn] = useState(false);

  useEffect(() => {
    try {
      setLight(localStorage.getItem("theme") === "light");
    } catch {}
  }, []);

  // Read light control settings from Firebase
  useEffect(() => {
    const lightRef = ref(db, "lightControl");
    const unsub = onValue(
      lightRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          if (data.mode) setLightControlMode(data.mode);
          if (data.state !== undefined) setLightState(data.state === true || data.state === "true");
        }
      },
      (error) => {
        console.error("Firebase /lightControl error:", error);
      }
    );
    return () => unsub();
  }, []);

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
      window.dispatchEvent(new CustomEvent("piezo-history-cleared"));
    } catch {}
  };

  const toggleLightMode = (isManual) => {
    const newMode = isManual ? "manual" : "auto";
    setLightControlMode(newMode);
    set(ref(db, "lightControl/mode"), newMode).catch((err) => {
      console.error("Failed to update light mode:", err);
    });
  };

  const toggleLightState = (isOn) => {
    setLightState(isOn);
    set(ref(db, "lightControl/state"), isOn).catch((err) => {
      console.error("Failed to update light state:", err);
    });
  };

  const toggleBatterySafety = (isOn) => {
    setBatterySafetyOn(isOn);
    set(ref(db, "batterySafety"), isOn).catch((err) => {
      console.error("Failed to update battery safety:", err);
    });
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
        <div className="settings-title">LIGHT CONTROL</div>
        <Toggle
          checked={lightControlMode === "manual"}
          onChange={toggleLightMode}
          label={lightControlMode === "manual" ? "Manual" : "Automatic (6PM-5AM)"}
          leftIcon={<FiZap />}
          rightIcon={<FiZapOff />}
        />
        {lightControlMode === "manual" && (
          <div style={{ marginTop: "12px", paddingLeft: "16px", borderLeft: "2px solid var(--teal)" }}>
            <Toggle
              checked={lightState}
              onChange={toggleLightState}
              label={lightState ? "Light: ON" : "Light: OFF"}
              leftIcon={<FiZapOff />}
              rightIcon={<FiZap />}
            />
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-title">BATTERY SAFETY</div>
        <Toggle
          checked={batterySafetyOn}
          onChange={toggleBatterySafety}
          label={batterySafetyOn ? "Safety: ON" : "Safety: OFF"}
          leftIcon={<FiZapOff />}
          rightIcon={<FiZap />}
        />
        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "8px", paddingLeft: "8px" }}>
          When ON: mAh shows 0 until battery drops below 50%. When OFF: mAh shows normally.
        </div>
      </div>

      <div className="settings-section">
        <button type="button" className="btn danger" onClick={clearHistory}>
          <FiTrash2 /> Clear History
        </button>
      </div>
    </div>
  );
}
