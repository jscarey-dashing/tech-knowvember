/* Team phone */
const socket = io();
const P = { state: null, offset: 0, offline: false, joined: false, nameDraft: "", err: "", busy: false };
const app = document.getElementById("app");

const timeLeft = s => Math.max(0, (s.qEndsAt - (Date.now() + P.offset)) / 1000);

socket.on("connect", () => {
  P.offline = false;
  const token = store.get("kv-token");
  if (token) socket.emit("player:resume", token, res => {
    if (!res || !res.ok) store.del("kv-token");
    render();
  });
  render();
});
socket.on("disconnect", () => { P.offline = true; render(); });
socket.on("state", s => { P.offset = s.serverNow - Date.now(); P.state = s; render(); });
socket.on("removed", () => { store.del("kv-token"); P.err = "The host removed your team. Join again with a new name."; render(); });

function join() {
  const name = (document.getElementById("teamName")?.value || P.nameDraft).trim();
  if (!name) { P.err = "Give your team a name first."; render(); return; }
  P.busy = true; P.err = ""; render();
  socket.emit("player:join", name, res => {
    P.busy = false;
    if (res && res.ok) { store.set("kv-token", res.token); P.nameDraft = ""; }
    else P.err = (res && res.error) || "Couldn’t join. Try again.";
    render();
  });
}

function answer(year) {
  const s = P.state;
  if (!s || s.phase !== "question" || timeLeft(s) <= 0) return;
  if (s.me && s.me.answer === year) return;
  socket.emit("player:answer", year, res => {
    P.err = res && res.error ? res.error : "";
    render();
  });
}

app.addEventListener("click", e => {
  const tile = e.target.closest("button.choice[data-year]");
  if (tile) return answer(Number(tile.dataset.year));
  if (e.target.closest("#joinBtn")) join();
});
app.addEventListener("input", e => { if (e.target.id === "teamName") P.nameDraft = e.target.value; });
app.addEventListener("keydown", e => { if (e.target.id === "teamName" && e.key === "Enter") join(); });

function view() {
  const s = P.state;
  const top = titleHtml("sm");
  const errBox = P.err ? `<div class="err" role="alert">${esc(P.err)}</div>` : "";
  if (!s) return `<div class="phone">${top}<p class="note mt">Connecting…</p></div>`;

  const me = s.me;
  if (!me) {
    return `<div class="phone">${top}
      <p class="tagline mt" style="font-size:30px">Hear the <span class="p">song.</span> Guess the <span class="bl">year.</span></p>
      <label class="mono" for="teamName" style="display:block;margin-top:22px;font-weight:700">Team name</label>
      <input id="teamName" class="field" maxlength="28" autocomplete="off" value="${esc(P.nameDraft)}">
      ${errBox}<button id="joinBtn" class="btn pink wide" ${P.busy ? "disabled" : ""}>Join the game</button>
      <p class="hint" style="margin-top:36px">One phone per team. ${s.phase !== "lobby" ? "The game has started, so you’ll pick up from the current song." : ""}</p></div>`;
  }

  const nameTag = `<p class="mono" style="font-weight:700;margin:0 0 6px">${esc(me.name)}</p>`;
  const song = s.song;

  if (s.phase === "lobby") return `<div class="phone">${top}
    <div class="ticket mt"><div class="k">You’re in</div><div class="v pink">${esc(me.name)}</div></div>
    <div class="panel mt"><p style="margin:0 0 6px;font-weight:800">Waiting for the host to start.</p>
    ${stepsList("here")}${scoringTable()}</div></div>`;

  if (s.phase === "question" || s.phase === "locked") {
    const has = me.answer != null;
    const open = s.phase === "question" && timeLeft(s) > 0;
    if (!open) return `<div class="phone">${nameTag}<p class="counter">Song ${song.n} of ${s.total}</p>
      <div class="rec-sm">${record("19??", false)}</div>
      <div class="timer" aria-hidden="true"><i id="tbar" style="width:0"></i></div>
      <p class="counter" id="tleft">0 seconds left</p>
      <p class="big pink" style="margin-top:10px">Time’s up!</p>
      <p style="font-weight:800;font-size:22px">${has ? `You locked in ${me.answer}.` : "No answer locked in, so 0 points this round."}</p>
      <p class="status note">Waiting for the reveal.</p></div>`;
    return `<div class="phone">${nameTag}<p class="counter">Song ${song.n} of ${s.total}</p>
      <div class="rec-sm">${record("19??", true)}</div>
      <div class="timer" aria-hidden="true"><i id="tbar"></i></div>
      <p class="counter" id="tleft" style="margin-bottom:16px">${s.roundSeconds} seconds left</p>
      ${choiceTiles(song.choices, has ? me.answer : null, false)}
      ${errBox}
      <p class="status note" aria-live="polite">${has ? `Locked in: <b>${me.answer}</b>. Tap another year to change it before time runs out.` : "Tap a year to lock it in."}</p></div>`;
  }

  if (s.phase === "board") {
    const r = me.result;
    const verdict = !r ? "You joined after this one." : r.g == null ? "No answer this round." : r.p === 1000 ? "Spot on!" : r.p > 0 ? `You said ${r.g}. Close!` : `You said ${r.g}. Not this time.`;
    return `<div class="phone">${nameTag}<div class="result">
      <p class="counter">Song ${song.n}: ${esc(song.title)}, ${esc(song.artist)}</p>
      <p class="big blue" style="margin-top:6px">${song.year}</p>
      <p style="font-weight:800;font-size:22px;margin:8px 0 0">${verdict}</p>
      <p class="pts">+${fmt(r ? r.p : 0)}</p></div>
      ${me.rank ? `<div class="ticket"><div class="k">Your position</div><div class="v pink">${me.rank}<span style="font-size:.5em"> of ${me.of}</span></div>
        <div class="k" style="margin-top:6px">${fmt(me.total)} points</div></div>` : ""}
      <h2 class="counter mt">Leaderboard</h2>
      ${boardRows(s.board || [], true, me.id)}
      <p class="status note">Next song coming up.</p></div>`;
  }

  if (s.phase === "final") return `<div class="phone">${top}
    <div class="ticket mt"><div class="k">You finished</div>
    <div class="v pink">${me.rank || "–"}<span style="font-size:.5em"> of ${me.of}</span></div>
    <div class="k" style="margin-top:6px">${fmt(me.total)} points</div></div>
    <h2 class="counter mt">Final leaderboard</h2>
    ${boardRows(s.board || [], false, me.id)}<p class="status note">Thanks for playing. Enjoy the food!</p></div>`;
  return "";
}

function render() {
  paint(app, `<div class="phone">${mast()}</div>` + view() + (P.offline ? `<div class="offline" role="status">Reconnecting…</div>` : ""));
  tick();
}

function tick() {
  const s = P.state;
  if (!s || s.phase !== "question") return;
  const remain = timeLeft(s);
  const el = document.getElementById("tleft"), bar = document.getElementById("tbar");
  if (el) el.textContent = `${Math.ceil(remain)} seconds left`;
  if (bar) bar.style.width = (remain / s.roundSeconds * 100) + "%";
  render.pending || (render.pending = true, queueMicrotask(() => { render.pending = false; paint(app, `<div class="phone">${mast()}</div>` + view() + (P.offline ? `<div class="offline" role="status">Reconnecting…</div>` : "")); }));
}
setInterval(tick, 250);
render();