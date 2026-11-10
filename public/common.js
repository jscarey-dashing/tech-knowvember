/* Shared helpers for the player and host pages */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Number(n || 0).toLocaleString("en-GB");

const titleHtml = (cls = "") => `<h1 class="title ${cls}"><span class="a">Know-</span><span class="b">vember</span></h1>`;
const mast = () => `<header class="mast"><span>Dashing Tech presents</span><span>Music ; Trivia ; Lunch</span></header>`;

function record(label, spinning, burst = true) {
  return `<div class="recordzone"><div class="halftone"></div>
    <div class="disc ${spinning ? "spin" : ""}"><div class="label">${esc(label)}</div></div>
    ${burst ? `<div class="burst">WHAT<br>YEAR?</div>` : ""}</div>`;
}

const scoringTable = () => `<div class="scoring">
  <span>Spot on</span><b>1,000</b><span>1 year off</span><b>700</b><span>2 years off</span><b>500</b>
  <span>3 years off</span><b>300</b><span>4–5 years off</span><b>100</b></div>`;

function stepsList(where) {
  return `<ol class="steps"><li><span>01</span>We play a song.</li><li><span>02</span>Your team has 15 seconds.</li><li><span>03</span>Pick the year ${where}.</li></ol>`;
}

/* chosen: the year this team picked (player) or null; host: big-screen tiles that can't be tapped */
function choiceTiles(choices, chosen, host) {
  return `<div class="choices ${host ? "host" : ""} ${chosen != null ? "has" : ""}">${choices.map((y, i) => host
    ? `<div class="choice c${i}"><span class="ltr">${"ABCD"[i]}</span>${y}</div>`
    : `<button class="choice c${i} ${chosen === y ? "on" : ""}" aria-pressed="${chosen === y}" data-year="${y}"><span class="ltr">${"ABCD"[i]}</span>${y}</button>`
  ).join("")}</div>`;
}

function boardRows(list, showGain) {
  const top = Math.max(1, ...list.map(t => t.total));
  return `<div class="rows">${list.map(t => {
    const mv = t.move > 0 ? `<span class="mv up" aria-label="up ${t.move}">▲${t.move}</span>`
      : t.move < 0 ? `<span class="mv dn" aria-label="down ${-t.move}">▼${-t.move}</span>` : "";
    const gain = showGain && t.last != null ? `<span class="gain">+${fmt(t.last)}</span>` : `<span></span>`;
    return `<div class="row ${t.rank === 1 && t.total > 0 ? "lead" : ""}">
      <span class="rk">${String(t.rank).padStart(2, "0")}</span>
      <span class="nm">${esc(t.name)}${mv}</span>${gain}<span class="tot">${fmt(t.total)}</span>
      <div class="bar"><i data-w="${Math.round(t.total / top * 100)}" style="width:0"></i></div></div>`;
  }).join("")}</div>`;
}

/* Re-render only when the markup changes, keeping focus and caret in text fields */
let __lastHtml = "";
function paint(app, html) {
  if (html === __lastHtml) return false;
  __lastHtml = html;
  const a = document.activeElement; const fid = a && a.id; const sel = a && a.selectionStart;
  app.innerHTML = html;
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch (e) {} } }
  requestAnimationFrame(() => app.querySelectorAll(".bar i[data-w]").forEach(i => { i.style.width = i.dataset.w + "%"; }));
  return true;
}

const store = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
  set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} },
  del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch (e) {} },
};
