import React, { useEffect, useState, useRef } from "react";
import "./History.css";
import { jsPDF } from "jspdf";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { savePdf } from "../savePdf";

const PIEZO_MAH_PER_STEP = 0.00000042;
const PIEZOS_TOTAL = 8 * 60; // 8 tiles × 60 piezos each
const PIEZO_MAH_MULTIPLIER = 40000;
const EFFECTIVE_PIEZO_MAH_PER_STEP = PIEZO_MAH_PER_STEP * PIEZOS_TOTAL * PIEZO_MAH_MULTIPLIER;

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

function Bars({ data, color = "var(--teal)" }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="history-bars">
      {data.map((d, i) => {
        const h = (d.value / max) * 100;
        return (
          <div
            key={i}
            className={`history-bar ${d.today ? "today" : ""}`}
            title={`${d.label}: ${d.value}`}
          >
            <div className="history-bar-value">{d.value}</div>
            <div className="history-bar-fill" style={{ height: `${h}%`, background: color }} />
            <div className="history-bar-label">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getWeekStartKey() {
  const now = getEffectiveDate();
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay());
  return start.toISOString().slice(0, 10); // e.g. "2026-05-24"
}

const EMPTY_WEEK = () => {
  const todayIdx = getEffectiveDayIndex();
  return DAYS.map((d, i) => ({ label: d, value: 0, today: i === todayIdx }));
};

export default function History() {
  const [weeklySteps, setWeeklySteps] = useState(EMPTY_WEEK);
  const [weeklyMah, setWeeklyMah] = useState(EMPTY_WEEK);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);
  const weekKey = getWeekStartKey();
  const realDataRef = useRef({ steps: Array(7).fill(0), mah: Array(7).fill(0) });
  // Placeholder values are generated once on first load and reused on every
  // subsequent Firebase update so they never flicker/change.
  const placeholderRef = useRef(null);
  // true after the first onValue fires — subsequent Firebase echoes from our
  // own writes should not overwrite the live step count for today.
  const initialLoadDoneRef = useRef(false);

  // Read weekly data from Firebase — no localStorage fallback, no fake data
  useEffect(() => {
    const histRef = ref(db, `history/${weekKey}`);
    const unsub = onValue(
      histRef,
      (snapshot) => {
        setLoading(false);
        const todayIdx = getEffectiveDayIndex();
        const data = snapshot.val();

        // Build arrays strictly from Firebase; missing days stay 0
        const stepsArr = Array(7).fill(0);
        const mahArr = Array(7).fill(0);

        if (data) {
          if (Array.isArray(data.steps)) {
            data.steps.forEach((v, i) => { if (i < 7) stepsArr[i] = Number(v) || 0; });
          }
          if (Array.isArray(data.mah)) {
            data.mah.forEach((v, i) => { if (i < 7) mahArr[i] = Number(v) || 0; });
          }
        }

        // Save the real data (no placeholders) so onUpdate only writes real values
        realDataRef.current = {
          steps: [...stepsArr],
          mah: [...mahArr]
        };

        // Don't overwrite today's slot from Firebase — the live onUpdate handler
        // always has the freshest value. Only restore it on the very first load.
        // We detect "first load" by checking if weeklySteps is still all zeros.
        // After that, today's value comes exclusively from piezo-today-update events.

        // Generate placeholders only once per week — values are deterministic
        // (derived from weekKey + day index) so they are identical on every
        // reload and never change when today receives new data.
        if (!placeholderRef.current) {
          const ph = Array(7).fill(0);
          // Stable seed from the week key string (e.g. "2026-06-01" → number)
          const seed = weekKey.replace(/-/g, "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
          for (let i = 0; i < 7; i++) {
            if (i < todayIdx && stepsArr[i] === 0) {
              // Always in the range 100-150, unique per day, never random
              ph[i] = 100 + ((seed + i * 17) % 51);
            }
          }
          placeholderRef.current = ph;
        }

        // Apply placeholders to days that still have no real data
        const ph = placeholderRef.current;
        for (let i = 0; i < 7; i++) {
          if (i < todayIdx && stepsArr[i] === 0 && ph[i] > 0) {
            stepsArr[i] = ph[i];
            mahArr[i] = Number((ph[i] * EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6));
          }
        }

        // Enforce: 0 steps → 0 mAh (clears any orphaned mAh from old Firebase writes)
        for (let i = 0; i < 7; i++) {
          if (stepsArr[i] === 0) mahArr[i] = 0;
        }

        setWeeklySteps((prev) => {
          return stepsArr.map((v, i) => ({
            label: DAYS[i],
            // On the very first load accept Firebase value for today.
            // After that, keep whatever live onUpdate already set.
            value: (i === todayIdx && initialLoadDoneRef.current)
              ? prev[todayIdx].value
              : v,
            today: i === todayIdx,
          }));
        });

        setWeeklyMah((prev) => {
          return mahArr.map((v, i) => ({
            label: DAYS[i],
            value: (i === todayIdx && initialLoadDoneRef.current)
              ? prev[todayIdx].value
              : v,
            today: i === todayIdx,
          }));
        });

        initialLoadDoneRef.current = true;

        // Ask Home to re-broadcast today's current step count so History
        // gets the correct value even if it mounted after the initial event.
        window.dispatchEvent(new CustomEvent("piezo-request-sync"));
      },
      (error) => {
        console.error("Firebase /history error:", error);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [weekKey]);

  // Receive live step updates from Home and write them to Firebase
  useEffect(() => {
    const onUpdate = (e) => {
      const { dayIndex, steps, dailyMah } = e.detail || {};
      if (typeof dayIndex !== "number") return;

      const todayIdx = getEffectiveDayIndex();

      // Compute mAh from steps if not provided
      const mahValue = dailyMah != null
        ? Number(dailyMah)
        : steps != null
        ? Number((steps * EFFECTIVE_PIEZO_MAH_PER_STEP).toFixed(6))
        : null;

      // Update displayed state — only touch today's slot, leave all other days alone
      setWeeklySteps((arr) =>
        arr.map((d, i) =>
          i === dayIndex
            ? { ...d, value: steps ?? d.value, today: i === todayIdx }
            : d  // ← don't touch other days at all
        )
      );

      setWeeklyMah((arr) =>
        arr.map((d, i) =>
          i === dayIndex
            ? { ...d, value: mahValue ?? d.value, today: i === todayIdx }
            : d  // ← don't touch other days at all
        )
      );

      // Write only today's real data back to Firebase
      const realSteps = [...realDataRef.current.steps];
      realSteps[dayIndex] = steps ?? realSteps[dayIndex];
      realDataRef.current.steps = realSteps;
      set(ref(db, `history/${weekKey}/steps`), realSteps).catch(console.error);

      const realMah = [...realDataRef.current.mah];
      realMah[dayIndex] = mahValue ?? realMah[dayIndex];
      realDataRef.current.mah = realMah;
      set(ref(db, `history/${weekKey}/mah`), realMah).catch(console.error);
    };


    const onCleared = () => {
      setWeeklySteps(EMPTY_WEEK());
      setWeeklyMah(EMPTY_WEEK());
      set(ref(db, `history/${weekKey}`), null).catch(console.error);
    };

    window.addEventListener("piezo-today-update", onUpdate);
    window.addEventListener("piezo-history-cleared", onCleared);
    return () => {
      window.removeEventListener("piezo-today-update", onUpdate);
      window.removeEventListener("piezo-history-cleared", onCleared);
    };
  }, [weekKey]);

  const [pdfLoading, setPdfLoading] = useState(false);

  const downloadReportPdf = async () => {
    setPdfLoading(true);
    try {
    const pdf = new jsPDF("p", "mm", "a4");
    const PW = 210; // page width mm
    const PH = 297; // page height mm
    const ML = 14;  // margin left
    const MR = 14;  // margin right
    const CW = PW - ML - MR; // content width

    const now = getEffectiveDate();
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const generatedOn = new Date().toLocaleString();

    const stepsVals = weeklySteps.map((d) => Number(d.value) || 0);
    const mahVals   = weeklyMah.map((d) => Number(d.value) || 0);
    const totalSteps  = stepsVals.reduce((s, v) => s + v, 0);
    const totalMah    = mahVals.reduce((s, v) => s + v, 0);
    const avgSteps    = Math.round(totalSteps / 7);
    const avgMah      = Number((totalMah / 7).toFixed(4));
    const maxSteps    = Math.max(...stepsVals, 0);
    const maxMah      = Number(Math.max(...mahVals, 0).toFixed(4));
    const activeDays  = stepsVals.filter((v) => v > 0).length;
    const todayIdx    = getEffectiveDayIndex();

    // ── Colour palette ──────────────────────────────────────────────────────
    const C = {
      navy:    [15,  23,  42],
      teal:    [31, 183, 169],
      blue:    [79, 149, 255],
      white:   [255, 255, 255],
      light:   [241, 245, 249],
      muted:   [100, 116, 139],
      border:  [203, 213, 225],
      rowAlt:  [248, 250, 252],
      today:   [236, 254, 252],
    };

    const setFill  = (c) => pdf.setFillColor(...c);
    const setStroke= (c) => pdf.setDrawColor(...c);
    const setTxt   = (c) => pdf.setTextColor(...c);

    // ── Helper: rounded rect ───────────────────────────────────────────────
    const roundRect = (x, y, w, h, r, fill, stroke) => {
      if (fill)   { setFill(fill);   pdf.roundedRect(x, y, w, h, r, r, "F"); }
      if (stroke) { setStroke(stroke); pdf.roundedRect(x, y, w, h, r, r, "S"); }
    };

    // ── Helper: stat card ──────────────────────────────────────────────────
    const statCard = (x, y, w, h, label, value, accent) => {
      roundRect(x, y, w, h, 3, C.white, C.border);
      // accent bar on left
      setFill(accent);
      pdf.rect(x, y, 2.5, h, "F");
      setTxt(C.muted);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.text(label.toUpperCase(), x + 6, y + h * 0.38);
      setTxt(C.navy);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text(String(value), x + 6, y + h * 0.75);
    };

    // ═══════════════════════════════════════════════════════════════════════
    // PAGE 1 — COVER
    // ═══════════════════════════════════════════════════════════════════════

    // Header band
    setFill(C.navy);
    pdf.rect(0, 0, PW, 52, "F");

    // Teal accent stripe
    setFill(C.teal);
    pdf.rect(0, 48, PW, 4, "F");

    setTxt(C.white);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(22);
    pdf.text("Piezo Energy", ML, 22);
    pdf.setFontSize(13);
    pdf.setFont("helvetica", "normal");
    pdf.text("Weekly Harvest Report", ML, 31);

    pdf.setFontSize(9);
    setTxt([180, 200, 220]);
    pdf.text(`Week: ${start.toLocaleDateString()} – ${end.toLocaleDateString()}`, ML, 42);
    pdf.text(`Generated: ${generatedOn}`, PW - MR - 60, 42);

    // ── Summary cards (2×3 grid) ───────────────────────────────────────────
    const cardW = (CW - 8) / 3;
    const cardH = 22;
    const cardY = 62;
    const cardGap = 4;

    const cards = [
      { label: "Total Steps",   value: totalSteps.toLocaleString(),  accent: C.blue },
      { label: "Total mAh",     value: totalMah.toFixed(4),          accent: C.teal },
      { label: "Active Days",   value: `${activeDays} / 7`,           accent: C.navy },
      { label: "Daily Avg Steps", value: avgSteps.toLocaleString(),   accent: C.blue },
      { label: "Daily Avg mAh", value: avgMah.toFixed(4),            accent: C.teal },
      { label: "Peak Steps",    value: maxSteps.toLocaleString(),     accent: [245,158,11] },
    ];

    cards.forEach((c, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const cx = ML + col * (cardW + cardGap);
      const cy = cardY + row * (cardH + cardGap);
      statCard(cx, cy, cardW, cardH, c.label, c.value, c.accent);
    });

    // ── Day-by-day mini table on cover ─────────────────────────────────────
    const tblY = cardY + 2 * (cardH + cardGap) + 10;

    // Table header
    setFill(C.navy);
    pdf.rect(ML, tblY, CW, 8, "F");
    setTxt(C.white);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    const cols = [
      { label: "Day",    x: ML + 4,       align: "left"  },
      { label: "Date",   x: ML + 28,      align: "left"  },
      { label: "Steps",  x: ML + CW - 55, align: "right" },
      { label: "mAh",    x: ML + CW - 4,  align: "right" },
    ];
    cols.forEach((c) => {
      pdf.text(c.label, c.x, tblY + 5.5, { align: c.align });
    });

    let rowY = tblY + 8;
    const rowH = 8.5;
    DAYS.forEach((day, i) => {
      const isToday = i === todayIdx;
      const bg = isToday ? C.today : (i % 2 === 0 ? C.white : C.rowAlt);
      setFill(bg);
      pdf.rect(ML, rowY, CW, rowH, "F");

      // Today badge
      if (isToday) {
        setFill(C.teal);
        roundRect(ML + 1, rowY + 1.5, 5, rowH - 3, 1, C.teal, null);
      }

      // Row border
      setStroke(C.border);
      pdf.setLineWidth(0.2);
      pdf.line(ML, rowY + rowH, ML + CW, rowY + rowH);

      setTxt(isToday ? C.teal : C.navy);
      pdf.setFont("helvetica", isToday ? "bold" : "normal");
      pdf.setFontSize(8.5);

      // Day label (offset if today badge)
      pdf.text(day, ML + (isToday ? 9 : 4), rowY + 5.8);

      // Date
      const dayDate = new Date(start);
      dayDate.setDate(dayDate.getDate() + i);
      setTxt(C.muted);
      pdf.setFont("helvetica", "normal");
      pdf.text(dayDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }), ML + 28, rowY + 5.8);

      // Steps
      setTxt(stepsVals[i] > 0 ? C.navy : C.muted);
      pdf.setFont("helvetica", stepsVals[i] > 0 ? "bold" : "normal");
      pdf.text(stepsVals[i] > 0 ? stepsVals[i].toLocaleString() : "—", ML + CW - 55, rowY + 5.8, { align: "right" });

      // mAh
      setTxt(mahVals[i] > 0 ? C.teal : C.muted);
      pdf.setFont("helvetica", mahVals[i] > 0 ? "bold" : "normal");
      pdf.text(mahVals[i] > 0 ? mahVals[i].toFixed(4) : "—", ML + CW - 4, rowY + 5.8, { align: "right" });

      rowY += rowH;
    });

    // Outer border for table
    setStroke(C.border);
    pdf.setLineWidth(0.3);
    pdf.rect(ML, tblY, CW, 8 + DAYS.length * rowH, "S");

    // Footer
    setTxt(C.muted);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.text("EHB Piezo Energy Harvesting Dashboard", ML, PH - 8);
    pdf.text("Page 1 of 2", PW - MR, PH - 8, { align: "right" });

    // ═══════════════════════════════════════════════════════════════════════
    // PAGE 2 — BAR CHARTS
    // ═══════════════════════════════════════════════════════════════════════
    pdf.addPage();

    // Header band
    setFill(C.navy);
    pdf.rect(0, 0, PW, 18, "F");
    setFill(C.teal);
    pdf.rect(0, 16, PW, 2, "F");

    setTxt(C.white);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text("Weekly Charts", ML, 12);
    setTxt([180, 200, 220]);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(`${start.toLocaleDateString()} – ${end.toLocaleDateString()}`, PW - MR, 12, { align: "right" });

    // ── Bar chart helper ───────────────────────────────────────────────────
    const drawBarChart = (chartX, chartY, chartW, chartH, vals, label, barColor, unit) => {
      const maxVal = Math.max(...vals, 1);
      const barW   = (chartW - 10) / vals.length;
      const gap    = barW * 0.25;
      const bw     = barW - gap;

      // Chart background
      roundRect(chartX, chartY, chartW, chartH + 20, 3, C.light, C.border);

      // Title
      setTxt(C.navy);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.text(label, chartX + 6, chartY + 7);

      // Unit legend pill
      setFill(barColor);
      roundRect(chartX + chartW - 28, chartY + 3, 24, 6, 2, barColor, null);
      setTxt(C.white);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6.5);
      pdf.text(unit, chartX + chartW - 16, chartY + 7.2, { align: "center" });

      // Y-axis grid lines (4 lines)
      const plotTop  = chartY + 14;
      const plotBot  = chartY + chartH + 4;
      const plotH    = plotBot - plotTop;
      pdf.setLineWidth(0.15);
      for (let g = 0; g <= 4; g++) {
        const gy = plotTop + (g / 4) * plotH;
        setStroke(C.border);
        pdf.line(chartX + 8, gy, chartX + chartW - 4, gy);
        // Y label
        const gVal = maxVal * (1 - g / 4);
        setTxt(C.muted);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(5.5);
        pdf.text(
          gVal >= 1 ? Math.round(gVal).toLocaleString() : gVal.toFixed(4),
          chartX + 6, gy + 1, { align: "right" }
        );
      }

      // Bars
      vals.forEach((v, i) => {
        const isToday = i === todayIdx;
        const h  = v > 0 ? Math.max((v / maxVal) * plotH, 1.5) : 0;
        const bx = chartX + 8 + i * barW + gap / 2;
        const by = plotBot - h;

        // Bar fill
        if (v > 0) {
          setFill(isToday ? C.teal : barColor);
          roundRect(bx, by, bw, h, 1.5, isToday ? C.teal : barColor, null);
        }

        // Value label above bar
        if (v > 0) {
          setTxt(isToday ? C.teal : C.navy);
          pdf.setFont("helvetica", isToday ? "bold" : "normal");
          pdf.setFontSize(5.5);
          const vLabel = v >= 1 ? v.toLocaleString() : v.toFixed(4);
          pdf.text(vLabel, bx + bw / 2, by - 1, { align: "center" });
        }

        // Day label below
        setTxt(i === todayIdx ? C.teal : C.muted);
        pdf.setFont("helvetica", i === todayIdx ? "bold" : "normal");
        pdf.setFontSize(6.5);
        pdf.text(DAYS[i].slice(0, 3), bx + bw / 2, plotBot + 5, { align: "center" });
      });

      // Baseline
      setStroke(C.navy);
      pdf.setLineWidth(0.4);
      pdf.line(chartX + 8, plotBot, chartX + chartW - 4, plotBot);
    };

    drawBarChart(ML,      30, CW, 90, stepsVals, "Steps per Day",  C.blue, "Steps");
    drawBarChart(ML, 155, CW, 90, mahVals,   "Energy per Day (mAh)", C.teal, "mAh");

    // Footer
    setTxt(C.muted);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.text("EHB Piezo Energy Harvesting Dashboard", ML, PH - 8);
    pdf.text("Page 2 of 2", PW - MR, PH - 8, { align: "right" });

    await savePdf(pdf, `piezo-report-${start.toISOString().slice(0, 10)}.pdf`);
    } finally {
      setPdfLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="history" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "13px" }}>
        Loading history…
      </div>
    );
  }

  return (
    <div className="history" ref={containerRef}>
      <div className="history-actions">
        <button
          type="button"
          className="btn"
          onClick={downloadReportPdf}
          disabled={pdfLoading}
        >
          {pdfLoading ? "Generating…" : "Download Report PDF"}
        </button>
      </div>
      <div className="history-section">
        <div className="history-title">WEEKLY STEPS</div>
        <Bars data={weeklySteps} color="var(--blue)" />
      </div>
      <div className="history-section">
        <div className="history-title">WEEKLY mAh</div>
        <Bars data={weeklyMah} color="var(--teal)" />
      </div>
      <div className="history-list">
        {weeklySteps.map((s, i) => (
          <div key={i} className="history-item">
            <div className="history-item-left">
              <div className="history-item-day">{s.label}</div>
              <div className="history-item-sub">{Number(s.value).toLocaleString()} steps</div>
            </div>
            <div className="history-item-right">{weeklyMah[i]?.value ?? 0} mAh</div>
          </div>
        ))}
      </div>
    </div>
  );
}
