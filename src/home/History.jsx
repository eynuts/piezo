import React, { useEffect, useState, useRef } from "react";
import "./History.css";
import { jsPDF } from "jspdf";

function Bars({ data, color = "var(--teal)" }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="history-bars">
      {data.map((d, i) => {
        const h = (d.value / max) * 100;
        return (
          <div key={i} className={`history-bar ${d.today ? "today" : ""}`} title={`${d.label}: ${d.value}`}>
            <div className="history-bar-value">{d.value}</div>
            <div className="history-bar-fill" style={{ height: `${h}%`, background: color }} />
            <div className="history-bar-label">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function History() {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const [weeklySteps, setWeeklySteps] = useState([]);
  const [weeklyMah, setWeeklyMah] = useState([]);
  const containerRef = useRef(null);

  useEffect(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const key = String(start.getTime());

    const loadArray = (k, fallback) => {
      try {
        const raw = localStorage.getItem(k);
        const arr = raw ? JSON.parse(raw) : null;
        return Array.isArray(arr) && arr.length === 7 ? arr : fallback;
      } catch {
        return fallback;
      }
    };

    let stepsArr, mahArr;
    const storedKey = localStorage.getItem("historyWeekStart");
    if (storedKey === key) {
      stepsArr = loadArray("historySteps", Array(7).fill(0));
      mahArr = loadArray("historyMah", Array(7).fill(0));
    } else {
      stepsArr = Array(7).fill(0).map(() => Math.floor(2000 + Math.random() * 6000));
      mahArr = Array(7).fill(0).map(() => Number((5 + Math.random() * 20).toFixed(1)));
      localStorage.setItem("historyWeekStart", key);
    }

    const idx = now.getDay();
    const todaySteps = Number(localStorage.getItem("todaySteps") || "0");
    const todayMah = Number(localStorage.getItem("todayMahPerHour") || "0");
    stepsArr[idx] = todaySteps;
    mahArr[idx] = Number(todayMah.toFixed ? todayMah.toFixed(1) : todayMah);

    localStorage.setItem("historySteps", JSON.stringify(stepsArr));
    localStorage.setItem("historyMah", JSON.stringify(mahArr));
    setWeeklySteps(stepsArr.map((v, i) => ({ label: days[i], value: v, today: i === idx })));
    setWeeklyMah(mahArr.map((v, i) => ({ label: days[i], value: v, today: i === idx })));

    const onUpdate = (e) => {
      const { dayIndex, steps, mahPerHour } = e.detail || {};
      if (typeof dayIndex !== "number") return;
      setWeeklySteps((arr) => {
        const next = arr.map((d, i) => (i === dayIndex ? { ...d, value: steps ?? d.value, today: true } : { ...d, today: i === dayIndex }));
        try { localStorage.setItem("historySteps", JSON.stringify(next.map((x) => x.value))); } catch {}
        return next;
      });
      setWeeklyMah((arr) => {
        const next = arr.map((d, i) => (i === dayIndex ? { ...d, value: Number((mahPerHour ?? d.value).toFixed ? (mahPerHour).toFixed(1) : mahPerHour), today: true } : { ...d, today: i === dayIndex }));
        try { localStorage.setItem("historyMah", JSON.stringify(next.map((x) => x.value))); } catch {}
        return next;
      });
    };
    window.addEventListener("piezo-today-update", onUpdate);
    const onCleared = () => {
      setWeeklySteps(days.map((d, i) => ({ label: d, value: 0, today: i === now.getDay() })));
      setWeeklyMah(days.map((d, i) => ({ label: d, value: 0, today: i === now.getDay() })));
    };
    window.addEventListener("piezo-history-cleared", onCleared);
    return () => {
      window.removeEventListener("piezo-today-update", onUpdate);
      window.removeEventListener("piezo-history-cleared", onCleared);
    };
  }, []);

  const downloadReportPdf = () => {
    const pdf = new jsPDF("p", "mm", "a4");
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const totalSteps = weeklySteps.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const avgMah =
      weeklyMah.length > 0
        ? Number(
            (
              weeklyMah.reduce((sum, d) => sum + (Number(d.value) || 0), 0) /
              weeklyMah.length
            ).toFixed(1)
          )
        : 0;
    const stepsVals = weeklySteps.map((d) => Number(d.value) || 0);
    const mahVals = weeklyMah.map((d) => Number(d.value) || 0);
    const maxSteps = Math.max(...stepsVals, 1);
    const minSteps = Math.min(...stepsVals, 0);
    const maxMah = Math.max(...mahVals, 1);
    const minMah = Math.min(...mahVals, 0);

    pdf.setFontSize(16);
    pdf.text("Piezo Energy Weekly Report", 14, 18);
    pdf.setFontSize(11);
    pdf.text(`Week: ${start.toLocaleDateString()} - ${end.toLocaleDateString()}`, 14, 26);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(`Total Steps: ${totalSteps.toLocaleString()}`, 14, 40);
    pdf.text(`Average mAh/h: ${avgMah}`, 14, 48);
    pdf.text(`Max Steps: ${maxSteps.toLocaleString()}`, 14, 56);
    pdf.text(`Min Steps: ${minSteps.toLocaleString()}`, 14, 64);
    pdf.text(`Max mAh/h: ${maxMah}`, 14, 72);
    pdf.text(`Min mAh/h: ${minMah}`, 14, 80);

    pdf.addPage();
    let y = 20;
    const x = 14;
    const colW = [30, 60, 30];
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("Day", x, y);
    pdf.text("Steps", x + colW[0], y);
    pdf.text("mAh/h", x + colW[0] + colW[1], y);
    pdf.setDrawColor(180);
    pdf.line(x, y + 2, x + colW[0] + colW[1] + colW[2], y + 2);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    y += 8;
    weeklySteps.forEach((s, i) => {
      const stepsStr = Number(s.value || 0).toLocaleString();
      const mahStr = String(weeklyMah[i]?.value ?? 0);
      pdf.text(s.label, x, y);
      pdf.text(stepsStr, x + colW[0], y);
      pdf.text(mahStr, x + colW[0] + colW[1], y);
      pdf.setDrawColor(230);
      pdf.line(x, y + 2, x + colW[0] + colW[1] + colW[2], y + 2);
      y += 8;
    });

    pdf.addPage();
    const chartX = 14;
    const chartY = 20;
    const chartW = 180;
    const chartH = 80;
    pdf.setDrawColor(180);
    pdf.rect(chartX, chartY, chartW, chartH);
    const stepX = chartW / Math.max(1, stepsVals.length - 1);
    pdf.setLineWidth(0.6);
    pdf.setDrawColor(79, 183, 255);
    for (let i = 1; i < stepsVals.length; i++) {
      const x1 = chartX + (i - 1) * stepX;
      const y1 = chartY + chartH - ((stepsVals[i - 1] - minSteps) / Math.max(1e-6, maxSteps - minSteps)) * chartH;
      const x2 = chartX + i * stepX;
      const y2 = chartY + chartH - ((stepsVals[i] - minSteps) / Math.max(1e-6, maxSteps - minSteps)) * chartH;
      pdf.line(x1, y1, x2, y2);
    }
    pdf.setDrawColor(31, 183, 169);
    for (let i = 1; i < mahVals.length; i++) {
      const x1 = chartX + (i - 1) * stepX;
      const y1 = chartY + chartH - ((mahVals[i - 1] - minMah) / Math.max(1e-6, maxMah - minMah)) * chartH;
      const x2 = chartX + i * stepX;
      const y2 = chartY + chartH - ((mahVals[i] - minMah) / Math.max(1e-6, maxMah - minMah)) * chartH;
      pdf.line(x1, y1, x2, y2);
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("Steps (blue) and mAh/h (teal) trend", chartX, chartY + chartH + 10);

    pdf.save(
      `history-report-${start.toISOString().slice(0, 10)}.pdf`
    );
  };

  return (
    <div className="history" ref={containerRef}>
      <div className="history-actions">
        <button type="button" className="btn" onClick={downloadReportPdf}>Download Report PDF</button>
      </div>
      <div className="history-section">
        <div className="history-title">WEEKLY STEPS</div>
        <Bars data={weeklySteps} color="var(--blue)" />
      </div>
      <div className="history-section">
        <div className="history-title">WEEKLY mAh/H AVG</div>
        <Bars data={weeklyMah} color="var(--teal)" />
      </div>
      <div className="history-list">
        {weeklySteps.map((s, i) => (
          <div key={i} className="history-item">
            <div className="history-item-left">
              <div className="history-item-day">{s.label}</div>
              <div className="history-item-sub">{s.value.toLocaleString()} steps</div>
            </div>
            <div className="history-item-right">{weeklyMah[i]?.value ?? 0} mAh/h</div>
          </div>
        ))}
      </div>
    </div>
  );
}
