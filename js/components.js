"use strict";
// Reusable presentation components. Each returns an HTML string; behaviour (tooltips, tabs, sorting,
// copy buttons, remembered open sections) is wired once with event delegation at the bottom of this file.

// expandable sections, notes and tabs the user has opened or chosen, so a recalculation does not reset them
const openState = {};
const isOpen = (key, byDefault = false) => (key in openState ? openState[key] : byDefault);

const symHTML = (s) => (s ? ` <var>${s}</var>` : "");
const unitHTML = (u) => (u ? `<span class="u">${u}</span>` : "");
// status indicator: a glyph and a word, never colour alone
const chip = (tone, text) => `<span class="tag ${tone}">${text}</span>`;
const tipHTML = (text) => (text ? `<i class="tip" tabindex="0" data-tip="${esc(text)}"></i>` : "");

// Results are ranked in levels, each with one fixed place and one style:
//   0 verdict      the answer: status word, R and what governs. The only place colour is used.
//   1 key results  the 2–4 values the engineer acts on: larger, uncoloured.
//   2 supporting   aligned name / value rows that explain level 1.
// Status words are the same in every analysis module.
const STATUS = { good: "Pass", bad: "Fail", warn: "Check", none: "No load" };

// ---------- level 0: verdict ----------
// {tone: good|bad|warn|none, word (defaults to STATUS[tone]), R (number, optional), text, tip}
function verdict({ tone = "none", word, R, text = "", tip = "" }) {
  const r = R === undefined ? "" : `<span class="v-r"><var>R</var> ${fmtR(R)}${tipHTML(tip)}</span>`;
  return `<div class="verdict ${tone}"><span class="v-word">${word || STATUS[tone]}</span>${r}` +
    (text ? `<div class="v-text">${text}</div>` : "") + "</div>";
}

// ---------- level 1: key results ----------
// items: {name, sym, value, unit, note, tip, text: true for words}
function primary(items) {
  const list = items.filter(Boolean);
  return '<div class="keys">' + list.map((it) =>
    `<div><div class="key-k">${it.name}${symHTML(it.sym)}${tipHTML(it.tip)}</div>` +
    `<div class="key-v${it.text ? " text" : ""}">${it.value}${unitHTML(it.unit)}</div>` +
    (it.note ? `<div class="key-n">${it.note}</div>` : "") + "</div>").join("") + "</div>";
}
// ---------- level 2: supporting results, aligned name / value rows ----------
function secondary(items, cls = "") {
  return `<dl class="kv${cls ? " " + cls : ""}">` + items.filter(Boolean).map((it) =>
    `<div><dt>${it.name}${symHTML(it.sym)}</dt><dd${it.text ? ' class="text"' : ""}>${it.value}${unitHTML(it.unit)}</dd>` +
    (it.note ? `<div class="note">${it.note}</div>` : "") + "</div>").join("") + "</dl>";
}
// ---------- inspector section ----------
// an empty title gives a section without a heading (the key results need none: their place says what they are)
const isec = (title, html, tip = "") => (html ? `<div class="isec">${title ? `<h3>${title}${tipHTML(tip)}</h3>` : ""}${html}</div>` : "");
// ---------- detail behind an expandable section ----------
function more(key, title, html, byDefault = false, meta = "") {
  return html ? `<details class="xp" data-key="${key}"${isOpen(key, byDefault) ? " open" : ""}><summary>${title}${meta ? `<span class="meta">${meta}</span>` : ""}</summary><div class="xpb">${html}</div></details>` : "";
}
// ---------- messages ----------
const msgHTML = (tone, text) => `<div class="msg ${tone}">${text}</div>`;
const errHTML = (msg) => msgHTML("bad", esc(msg));
const msgs = (list) => (list.length ? `<div class="msgs">${list.join("")}</div>` : "");
// a warning that says what is wrong in one line, with the explanation one click away
function noteHTML(tone, summary, detail = "") {
  if (!detail) return msgHTML(tone, summary);
  const key = "note:" + summary.replace(/<[^>]*>|[^\w]+/g, "").slice(0, 60);
  return `<div class="msg ${tone}"><details class="mdet" data-key="${key}"${isOpen(key) ? " open" : ""}><summary>${summary}</summary><div>${detail}</div></details></div>`;
}
const logBlock = (log) => (log && log.trim() ? `<pre class="log">${esc(log.trim())}</pre>` : "");
// the last bottom tab of every module: assumptions first, the raw library output collapsed below them
function assumeTab(key, html, log) {
  const lg = logBlock(log);
  return { id: "log", title: html ? "Assumptions & log" : "Log", html: (html || "") + (lg ? (html ? more(key + "-log", "Library output", lg) : lg) : "") };
}
const emptyHTML = (text) => `<p class="ih-empty">${text}</p>`;

// ---------- matrices ----------
// One scale per matrix: every cell has the same number of decimals, so the columns line up, and the largest term
// shows 4 significant figures. Outside 10⁻³ … 10⁵ a shared power of 1000 moves into the unit label.
let copyStore = [];
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const supNum = (n) => String(n).replace(/[-0-9]/g, (c) => SUP[c]);
function matrixScale(M) {
  const max = Math.max(...M.flat().map((v) => Math.abs(v ?? 0)));
  if (!(max > 0)) return { max, exp: 0, dec: 0 };
  const e = Math.floor(Math.log10(max)), exp = e >= 5 || e <= -3 ? 3 * Math.floor(e / 3) : 0;
  return { max, exp, dec: Math.max(0, SIG_MAX - 1 - (e - exp)) };
}
function matrixHTML(M, splitAt = 0, sc = matrixScale(M)) {
  const { exp, dec } = sc, k = 10 ** -exp, tiny = 0.5 * 10 ** -dec;
  return '<div class="mxw"><span class="mxbr"><table class="mx">' + M.map((r) => "<tr>" + r.map((v, j) => {
    const x = (v ?? 0) * k, zero = Math.abs(x) < tiny;
    const cls = [zero ? "z" : "", splitAt && j === splitAt ? "sep" : ""].filter(Boolean).join(" ");
    return `<td${cls ? ` class="${cls}"` : ""}>${zero ? "0" : x.toFixed(dec).replace("-", "−")}</td>`;
  }).join("") + "</tr>").join("") + "</table></span></div>";
}
function matrixBlock(title, unit, M, info = "", splitAt = 0) {
  copyStore.push(M.map((r) => r.join(",")).join("\n"));
  const sc = matrixScale(M);
  return `<div class="mxb"><div class="mxh"><b>${title}</b>${tipHTML(info)}<span class="u">${sc.exp ? `×10${supNum(sc.exp)} ` : ""}${unit}</span>` +
    `<button class="btn ghost sm" type="button" data-copy="${copyStore.length - 1}" title="Copy as CSV">Copy</button></div>${matrixHTML(M, splitAt, sc)}</div>`;
}

// ---------- tabs ----------
// panes: [{id, title, html}]; the chosen tab is remembered per key
function tabsHTML(key, panes) {
  const list = panes.filter((p) => p && p.html);
  if (!list.length) return "";
  const cur = list.some((p) => p.id === openState["tab:" + key]) ? openState["tab:" + key] : list[0].id;
  return `<div class="tabbar" role="tablist" data-tabs="${key}">` + list.map((p) =>
    `<button type="button" role="tab" data-pane="${p.id}" aria-selected="${p.id === cur}">${p.title}</button>`).join("") + "</div>" +
    list.map((p) => `<div role="tabpanel" data-pane-of="${key}" data-pane="${p.id}"${p.id === cur ? "" : " hidden"}${p.flush ? "" : ' class="pb"'}>${p.html}</div>`).join("");
}

// ---------- module status: the sidebar dot, so modules can be scanned without opening them ----------
// the verdict line in the results panel carries the same status in words; text defaults to the standard word
function setStatus(mod, tone, text = STATUS[tone] || "") {
  const nd = document.querySelector(`[data-nd="${mod}"]`);
  if (nd) { nd.className = "nd " + (tone === "good" || tone === "bad" || tone === "warn" ? tone : "none"); nd.title = text; }
}

// ---------- behaviour ----------
(function wireComponents() {
  const box = $("tipbox");
  let tipFor = null;
  const place = (el) => {
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), m = 8;
    let x = r.left + r.width / 2 - b.width / 2, y = r.bottom + 6;
    if (y + b.height > innerHeight - m) y = r.top - b.height - 6;
    x = Math.max(m, Math.min(x, innerWidth - b.width - m));
    box.style.left = x + "px"; box.style.top = Math.max(m, y) + "px";
  };
  const show = (el) => {
    const html = el.dataset.tip || (el.dataset.tipHtml ? el.dataset.tipHtml : "");
    if (!html) return;
    tipFor = el; box.innerHTML = html; box.hidden = false; place(el);
  };
  const hide = () => { tipFor = null; box.hidden = true; };
  document.addEventListener("mouseover", (e) => { const t = e.target.closest("[data-tip]"); if (t && t !== tipFor) show(t); else if (!t && tipFor) hide(); });
  document.addEventListener("focusin", (e) => { const t = e.target.closest("[data-tip]"); if (t) show(t); });
  document.addEventListener("focusout", (e) => { if (e.target.closest("[data-tip]")) hide(); });
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  // a tooltip that follows the pointer, for drawings (SVG elements with data-hover)
  window.hoverTip = (html, ev) => {
    if (!html) { hide(); return; }
    box.innerHTML = html; box.hidden = false;
    const b = box.getBoundingClientRect();
    box.style.left = Math.min(ev.clientX + 14, innerWidth - b.width - 8) + "px";
    box.style.top = Math.min(ev.clientY + 14, innerHeight - b.height - 8) + "px";
  };

  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".tabbar [data-pane]");
    if (tab) {
      const bar = tab.parentElement, key = bar.dataset.tabs;
      openState["tab:" + key] = tab.dataset.pane;
      bar.querySelectorAll("[data-pane]").forEach((b) => b.setAttribute("aria-selected", b === tab));
      bar.parentElement.querySelectorAll(`[data-pane-of="${key}"]`).forEach((p) => (p.hidden = p.dataset.pane !== tab.dataset.pane));
    }
    const c = e.target.closest("[data-copy]");
    if (c && navigator.clipboard) navigator.clipboard.writeText(copyStore[+c.dataset.copy]).then(() => { c.textContent = "Copied"; setTimeout(() => (c.textContent = "Copy"), 1200); });
    const th = e.target.closest("th[data-sort]");
    if (th) sortTable(th);
  });
  // remember which expandable sections are open
  document.addEventListener("toggle", (e) => { if (e.target.dataset && e.target.dataset.key) openState[e.target.dataset.key] = e.target.open; }, true);
})();

// ---------- sortable tables: th[data-sort="n"|"s"], cells may carry data-v ----------
const sortState = {};
function sortTable(th, keep = false) {
  const table = th.closest("table"), idx = [...th.parentElement.children].indexOf(th), body = table.tBodies[0];
  const key = table.id + ":" + idx;
  let dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
  if (keep) dir = sortState[table.id]?.dir || "ascending";
  table.querySelectorAll("th[aria-sort]").forEach((h) => h.removeAttribute("aria-sort"));
  th.setAttribute("aria-sort", dir);
  sortState[table.id] = { idx, dir, key };
  const val = (tr) => { const td = tr.children[idx]; const v = td ? (td.dataset.v ?? td.textContent) : ""; return th.dataset.sort === "n" ? (v === "" || v === "—" ? Infinity : parseFloat(v)) : String(v).toLowerCase(); };
  const rows = [...body.rows].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (dir === "ascending" ? 1 : -1); });
  rows.forEach((r) => body.appendChild(r));
}
// re-apply the user's sort after a table is re-rendered
function resort(tableId) {
  const s = sortState[tableId], t = $(tableId);
  if (!s || !t) return;
  const th = t.tHead && t.tHead.rows[t.tHead.rows.length - 1].children[s.idx];
  if (th && th.dataset.sort) sortTable(th, true);
}
