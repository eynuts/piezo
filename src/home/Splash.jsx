import React, { useEffect, useState } from "react";
import "./Splash.css";
import logo from "../assets/logo.png";

export default function Splash({ onDone }) {
  const [fakeSteps, setFakeSteps] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const target = Math.min(50, Math.floor(elapsed / 30));
      setFakeSteps(target);
      if (target < 50) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const enterTimer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDone?.(), 300);
    }, 1400);
    return () => clearTimeout(enterTimer);
  }, []);

  return (
    <div className={`splash ${exiting ? "splash-exit" : ""}`}>
      <div className="splash-inner">
        <div className="splash-logo">
          <img src={logo} alt="EHB Monitor" className="splash-logo-img" />
        </div>
        <div className="splash-title">EHB MONITOR</div>
        <div className="splash-steps">initializing… {fakeSteps} steps</div>
        <div className="splash-spinner" />
      </div>
    </div>
  );
}
