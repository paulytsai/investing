// Dependency-free SVG line chart for daily closes. Usage: renderChart(el, points, {locale})
(function () {
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceStep(range, target) {
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
    return 10 * mag;
  }
  function fmtPrice(v) {
    return v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
  }
  function fmtDate(d, locale, short) {
    const dt = new Date(d + "T00:00:00Z");
    const opts = short ? { year: "2-digit", month: "short" } : { year: "numeric", month: "short", day: "numeric" };
    return dt.toLocaleDateString(locale === "ja" ? "ja-JP" : locale === "zh-TW" ? "zh-TW" : "en-US", { ...opts, timeZone: "UTC" });
  }

  window.renderChart = function renderChart(container, points, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!points || points.length < 2) {
      container.textContent = "—";
      return;
    }
    const W = container.clientWidth || 800;
    const H = opts.height || 280;
    const pad = { l: 56, r: 16, t: 14, b: 28 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const ys = points.map((p) => p[1]);
    let min = Math.min(...ys), max = Math.max(...ys);
    if (max === min) { max += 1; min -= 1; }
    const span = max - min;
    min -= span * 0.05; max += span * 0.05;
    const x = (i) => pad.l + (i / (points.length - 1)) * iw;
    const y = (v) => pad.t + (1 - (v - min) / (max - min)) * ih;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-svg" }, container);
    const up = ys[ys.length - 1] >= ys[0];
    const color = up ? "#1a7f37" : "#c93c37";
    const gradId = "g" + Math.random().toString(36).slice(2);
    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.22 }, grad);
    el("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }, grad);

    // horizontal grid + y labels
    const step = niceStep(max - min, 5);
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
      el("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "chart-grid" }, svg);
      const t = el("text", { x: pad.l - 6, y: y(v) + 4, class: "chart-label", "text-anchor": "end" }, svg);
      t.textContent = fmtPrice(v);
    }
    // x labels
    const nx = Math.min(W < 520 ? 4 : 6, points.length);
    for (let k = 0; k < nx; k++) {
      const i = Math.round((k / (nx - 1)) * (points.length - 1));
      const t = el("text", { x: x(i), y: H - 8, class: "chart-label", "text-anchor": k === 0 ? "start" : k === nx - 1 ? "end" : "middle" }, svg);
      t.textContent = fmtDate(points[i][0], opts.locale, true);
    }
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    el("path", { d: `${path}L${x(points.length - 1).toFixed(1)},${(pad.t + ih).toFixed(1)}L${pad.l},${(pad.t + ih).toFixed(1)}Z`, fill: `url(#${gradId})` }, svg);
    el("path", { d: path, fill: "none", stroke: color, "stroke-width": 1.6, "stroke-linejoin": "round" }, svg);

    // hover
    const vline = el("line", { x1: 0, x2: 0, y1: pad.t, y2: pad.t + ih, class: "chart-cursor", visibility: "hidden" }, svg);
    const dot = el("circle", { r: 3.5, fill: color, visibility: "hidden" }, svg);
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.style.visibility = "hidden";
    container.appendChild(tip);
    const hit = el("rect", { x: pad.l, y: pad.t, width: iw, height: ih, fill: "transparent" }, svg);
    hit.addEventListener("mousemove", (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / iw) * (points.length - 1))));
      vline.setAttribute("x1", x(i)); vline.setAttribute("x2", x(i)); vline.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(points[i][1])); dot.setAttribute("visibility", "visible");
      tip.textContent = `${fmtDate(points[i][0], opts.locale)}  $${fmtPrice(points[i][1])}`;
      tip.style.visibility = "visible";
      const left = (x(i) / W) * rect.width;
      tip.style.left = Math.min(rect.width - 170, Math.max(0, left - 80)) + "px";
    });
    hit.addEventListener("mouseleave", () => {
      vline.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.style.visibility = "hidden";
    });
  };
})();
