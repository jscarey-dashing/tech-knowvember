/* Host / projector screen */
const socket = io();
const H = { state: null, offset: 0, offline: false, authed: false, pinDraft: "", err: "", restartArmed: false, audioMsg: "", playingN: null };
const app = document.getElementById("app");
const audio = new Audio();
audio.preload = "auto";

const timeLeft = s => Math.max(0, (s.qEndsAt - (Date.now() + H.offset)) / 1000);

/* ---------- Connection ---------- */
socket.on("connect", () => {
  H.offline = false;
  const pin = store.get("kv-pin", true);
  if (pin) auth(pin, true); else render();
});
socket.on("disconnect", () => { H.offline = true; render(); });
socket.on("state", s => {
  H.offset = s.serverNow - Date.now();
  H.state = s;
  if ((s.phase === "board" || s.phase === "lobby") && !audio.paused) fadeOut();
  render();
});

function auth(pin, silent) {
  socket.emit("host:auth", pin, res => {
    if (res && res.ok) { H.authed = true; H.err = ""; store.set("kv-pin", pin, true); }
    else { H.authed = false; store.del("kv-pin", true); if (!silent) H.err = (res && res.error) || "That PIN isn’t right."; }
    H.pinDraft = "";
    render();
  });
}
function act(type, extra = {}) {
  socket.emit("host:action", { type, ...extra }, res => {
    H.err = res && res.error ? res.error : "";
    render();
  });
}

/* ---------- Audio ---------- */
// Playback has to start inside a click, or the browser blocks it. So the
// button that starts a song also starts its clip, before the server replies.
function playClip(c) {
  H.audioMsg = "";
  if (!c) return;
  if (!c.audio) { H.audioMsg = `No clip for song ${c.n}. Play track ${c.track} from the playlist.`; audio.pause(); return; }
  clearInterval(fadeOut.timer);
  audio.volume = 1;
  audio.src = c.audio + (c.start ? `#t=${c.start}` : "");
  H.playingN = c.n;
  audio.play().catch(() => { H.audioMsg = `Couldn’t play the clip. Use “Play clip again”, or play track ${c.track} from the playlist.`; render(); });
}
function fadeOut() {
  clearInterval(fadeOut.timer);
  fadeOut.timer = setInterval(() => {
    audio.volume = Math.max(0, audio.volume - 0.08);
    if (audio.volume <= 0.01) { clearInterval(fadeOut.timer); audio.pause(); audio.volume = 1; render(); }
  }, 80);
}
audio.addEventListener("error", () => {
  if (!audio.getAttribute("src")) return;
  H.audioMsg = "The clip file couldn’t be loaded. Check it’s in public/audio and named as in songs.json.";
  render();
});
audio.addEventListener("play", () => render());
audio.addEventListener("pause", () => render());

/* ---------- Clicks ---------- */
const actions = {
  unlock: () => auth((document.getElementById("hostPin")?.value || "").trim(), false),
  start: () => { playClip(H.state.next); act("start"); },
  lock: () => act("lock"),
  reveal: () => act("reveal"),
  board: () => act("board"),
  next: () => { if (H.state.next) playClip(H.state.next); act("next"); },
  replay: () => playClip(H.state.clip),
  pause: () => audio.pause(),
  remove: el => act("removeTeam", { id: el.dataset.id }),
  clearTeams: () => act("clearTeams"),
  restart: () => {
    if (!H.restartArmed) { H.restartArmed = true; render(); setTimeout(() => { H.restartArmed = false; render(); }, 3500); return; }
    H.restartArmed = false; audio.pause(); act("restart");
  },
};
app.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (el && actions[el.dataset.act] && !el.disabled) actions[el.dataset.act](el);
});
app.addEventListener("input", e => { if (e.target.id === "hostPin") H.pinDraft = e.target.value; });
app.addEventListener("keydown", e => { if (e.target.id === "hostPin" && e.key === "Enter") actions.unlock(); });

/* ---------- Screens ---------- */
function view() {
  const s = H.state;
  const errBox = H.err ? `<div class="err" role="alert">${esc(H.err)}</div>` : "";

  if (!H.authed) return `${mast()}<div class="phone">${titleHtml("sm")}
    <label class="mono" for="hostPin" style="display:block;margin-top:22px;font-weight:700">Host PIN</label>
    <input id="hostPin" class="field" type="password" inputmode="numeric" autocomplete="off" value="${esc(H.pinDraft)}">
    ${errBox}<button class="btn pink wide" data-act="unlock">Unlock host screen</button></div>`;
  if (!s) return `${mast()}<p class="note">Connecting…</p>`;

  const teams = s.teams || [];
  const foot = primary => `${errBox}<div class="controls">${primary}<span class="spacer"></span>
    <button class="link" data-act="restart">${H.restartArmed ? "Tap again to restart from song 1" : "Restart game"}</button></div>`;
  const audioBar = () => {
    const c = s.clip;
    if (!c) return "";
    const playing = !audio.paused && H.playingN === c.n;
    return `<div class="audiobar">
      ${c.audio ? `<button class="btn small ghost" data-act="replay">Play clip again</button>
        ${playing ? `<button class="btn small ghost" data-act="pause">Pause</button>` : ""}` : ""}
      ${H.audioMsg ? `<p class="note">${esc(H.audioMsg)}</p>` : !c.audio ? `<p class="note">No clip for this song. Play track ${c.track} from the playlist.</p>` : ""}
    </div>`;
  };

  if (s.phase === "lobby") return `${mast()}<div class="split">
    <div>${titleHtml()}</div>
    <div><p class="tagline">Hear the <span class="p">song.</span><br>Guess the <span class="bl">year.</span></p>
      ${stepsList("on your phone")}${scoringTable()}</div></div>
    <div class="mt"><div class="joinbox"><div class="qr"><img src="/join-qr.svg" alt="QR code to join the game"></div>
      <div><p class="counter" style="margin:0">Scan or go to</p><p class="joinurl" style="margin:4px 0 0">${esc(location.host)}</p>
      <p class="note">One phone per team.</p></div></div>
      <p class="counter mt">${teams.length} ${teams.length === 1 ? "team" : "teams"} in</p>
      <div class="chips">${teams.length ? teams.map(t => `<span class="chip ${t.connected ? "" : "away"}">${esc(t.name)}<button aria-label="Remove ${esc(t.name)}" data-act="remove" data-id="${esc(t.id)}">×</button></span>`).join("") : `<span class="note">Teams appear here as they join.</span>`}</div>
      ${teams.length ? `<button class="link" data-act="clearTeams">Remove all teams</button>` : ""}</div>
    ${foot(`<button class="btn pink" data-act="start" ${teams.length ? "" : "disabled"}>Start with song 1</button>`)}`;

  const song = s.song;

  if (s.phase === "question" || s.phase === "locked") {
    const live = s.phase === "question";
    const answered = teams.filter(t => t.answered);
    return `${mast()}<div class="split"><div>
      <p class="counter">Song ${song.n} of ${s.total}</p>
      <div class="timer" aria-hidden="true"><i id="tbar" ${live ? "" : 'style="width:0"'}></i></div>
      <p class="counter" id="tleft">${live ? "&nbsp;" : "Time’s up. Answers are locked."}</p>
      <p class="counter">${answered.length} of ${teams.length} locked in</p>
      <div class="chips">${teams.map(t => `<span class="chip ${t.answered ? "done" : ""} ${t.connected ? "" : "away"}">${esc(t.name)}</span>`).join("")}</div>
      ${audioBar()}
    </div><div>${record("19??", live)}</div></div>
    ${choiceTiles(song.choices, null, true)}
    ${foot(live
      ? `<button class="btn" data-act="lock">Stop the clock now</button>`
      : `<button class="btn pink" data-act="reveal">Reveal the answer</button>`)}`;
  }

  if (s.phase === "reveal") {
    const list = s.results || [];
    return `${mast()}<div class="split"><div>
      <p class="counter">Song ${song.n} of ${s.total}</p>
      <p class="big pink">${song.year}</p>
      <h2 class="songt">${esc(song.title)}</h2><p class="artist">${esc(song.artist)}</p>
      <div class="rows">${list.map(t => `<div class="row"><span class="rk">${t.g ?? "—"}</span><span class="nm">${esc(t.name)}</span>
        <span class="gain">${t.g == null ? "no answer" : t.p === 1000 ? "spot on" : ""}</span><span class="tot">+${fmt(t.p)}</span></div>`).join("") || `<p class="note">No teams answered.</p>`}</div>
      ${audioBar()}
    </div><div>${record(String(song.year), false, false)}</div></div>
    ${foot(`<button class="btn pink" data-act="board">Show leaderboard</button>`)}`;
  }

  if (s.phase === "board") {
    const last = song.n >= s.total;
    return `${mast()}<p class="counter">Leaderboard after song ${song.n} of ${s.total}</p>
      <h1 class="title" style="font-size:clamp(64px,10vw,150px)"><span class="b">Standings</span></h1>
      ${boardRows(s.standings || [], true)}
      ${foot(`<button class="btn pink" data-act="next">${last ? "Reveal the winners" : `Play song ${song.n + 1}`}</button>`)}`;
  }

  if (s.phase === "final") {
    const list = s.standings || []; const [a, b, c] = list;
    const pod = (t, cls, r) => t ? `<div class="pod ${cls}"><div class="r">${r}</div><div class="n">${esc(t.name)}</div><div class="s">${fmt(t.total)}</div></div>` : `<div></div>`;
    return `${mast()}<h1 class="title"><span class="a">Know-</span><span class="b">winners</span></h1>
      <div class="podium">${pod(b, "p2", "2nd")}${pod(a, "p1", "1st")}${pod(c, "p3", "3rd")}</div>
      ${list.length > 3 ? boardRows(list.slice(3).map(t => ({ ...t, move: 0 })), false) : ""}
      ${foot("")}`;
  }
  return "";
}

function render() {
  paint(app, view() + (H.offline ? `<div class="offline" role="status">Reconnecting to the server…</div>` : ""));
  tick();
}
function tick() {
  const s = H.state;
  if (!s || s.phase !== "question") return;
  const remain = timeLeft(s);
  const bar = document.getElementById("tbar"), left = document.getElementById("tleft");
  if (bar) bar.style.width = (remain / s.roundSeconds * 100) + "%";
  if (left) left.textContent = remain > 0 ? `${Math.ceil(remain)} seconds left` : "Time’s up. Locking answers…";
}
setInterval(tick, 250);
render();
