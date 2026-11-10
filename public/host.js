/* Host / projector screen */
const socket = io();
const H = { state: null, offset: 0, offline: false, authed: false, pinDraft: "", err: "", restartArmed: false };
const app = document.getElementById("app");

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
  if (H.authed) loadSpotify();
  if (s.phase === "board" || s.phase === "lobby" || s.phase === "final") { if (!SP.paused) pauseClip(); cue(s.next); }
  render();
});

function auth(pin, silent) {
  socket.emit("host:auth", pin, res => {
    if (res && res.ok) { H.authed = true; H.err = ""; store.set("kv-pin", pin, true); loadSpotify(); }
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

/* ---------- Spotify player ----------
   The Spotify embed sits in a dock in the corner. The game drives it through
   Spotify's iFrame API, and the host can also use the player's own controls. */
const SP = { ctrl: null, requested: false, failed: false, loadedKey: null, startedKey: null, paused: true, pendingPlay: false, msg: "", watchdog: null };
const dock = document.getElementById("spotify-dock");
const keyOf = c => c.uri + "@" + c.start;

function loadSpotify() {
  const s = H.state;
  const first = s && (s.next || s.clip);
  if (SP.requested || !first || !first.uri) return;
  SP.requested = true;
  dock.hidden = false;
  window.onSpotifyIframeApiReady = api => {
    api.createController(document.getElementById("spotify-embed"), { uri: first.uri, width: "100%", height: "80" }, ctrl => {
      SP.ctrl = ctrl;
      SP.loadedKey = first.uri + "@0";
      ctrl.addListener("ready", () => { if (SP.pendingPlay) { SP.pendingPlay = false; ctrl.play(); } });
      ctrl.addListener("playback_update", e => {
        const d = e.data || {};
        const paused = !!d.isPaused;
        if (!paused && !d.isBuffering) { clearTimeout(SP.watchdog); SP.startedKey = SP.loadedKey; if (SP.msg) { SP.msg = ""; render(); } }
        if (paused !== SP.paused) { SP.paused = paused; render(); }
      });
      const s2 = H.state;
      if (s2 && (s2.phase === "lobby" || s2.phase === "board")) cue(s2.next);
      render();
    });
  };
  const sc = document.createElement("script");
  sc.src = "https://open.spotify.com/embed/iframe-api/v1";
  sc.async = true;
  sc.onerror = () => { SP.failed = true; render(); };
  document.head.appendChild(sc);
  setTimeout(() => { if (!SP.ctrl) { SP.failed = true; render(); } }, 12000);
}

// Load a song ahead of time so it starts instantly when the host clicks
function cue(c) {
  if (!SP.ctrl || !c || !c.uri || SP.loadedKey === keyOf(c)) return;
  SP.loadedKey = keyOf(c);
  SP.startedKey = null;
  SP.ctrl.loadUri(c.uri, false, c.start);
}

// Must run inside the host's click so the browser allows sound
function playClip(c) {
  SP.msg = "";
  if (!c) return;
  if (!c.uri) { SP.msg = `No Spotify link for song ${c.n}. Play track ${c.track} from the playlist.`; return; }
  if (!SP.ctrl) {
    SP.msg = SP.failed ? `Spotify didn’t load. Play track ${c.track} from the playlist.` : "Spotify is still loading. Try “Play clip again” in a moment.";
    return;
  }
  const key = keyOf(c);
  if (SP.loadedKey !== key) {
    SP.loadedKey = key; SP.startedKey = null; SP.pendingPlay = true;
    SP.ctrl.loadUri(c.uri, false, c.start);
    setTimeout(() => { if (SP.pendingPlay) { SP.pendingPlay = false; SP.ctrl.play(); } }, 1500);
  } else if (SP.startedKey === key) {
    SP.ctrl.seek(c.start); SP.ctrl.resume();
  } else {
    SP.ctrl.play();
  }
  clearTimeout(SP.watchdog);
  SP.watchdog = setTimeout(() => {
    if (SP.paused) { SP.msg = `Spotify didn’t start. Click “Play clip again”, or play track ${c.track} from the playlist.`; render(); }
  }, 7000);
}
function pauseClip() { clearTimeout(SP.watchdog); if (SP.ctrl) SP.ctrl.pause(); }

// Play/Pause toggle: pausing keeps the position, playing carries on from there
function togglePlay() {
  const c = H.state && H.state.clip;
  if (!c) return;
  if (!SP.paused) { pauseClip(); return; }
  if (SP.ctrl && SP.loadedKey === keyOf(c) && SP.startedKey === keyOf(c)) { SP.msg = ""; SP.ctrl.resume(); }
  else playClip(c);
}

/* ---------- Clicks ---------- */
const actions = {
  unlock: () => auth((document.getElementById("hostPin")?.value || "").trim(), false),
  start: () => { playClip(H.state.next); act("start"); },
  lock: () => act("lock"),
  reveal: () => act("reveal"),
  board: () => act("board"),
  next: () => { if (H.state.next) playClip(H.state.next); act("next"); },
  replay: () => playClip(H.state.clip),
  toggle: () => togglePlay(),
  remove: el => act("removeTeam", { id: el.dataset.id }),
  clearTeams: () => act("clearTeams"),
  restart: () => {
    if (!H.restartArmed) { H.restartArmed = true; render(); setTimeout(() => { H.restartArmed = false; render(); }, 3500); return; }
    H.restartArmed = false; pauseClip(); act("restart");
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
    return `<div class="audiobar">
      ${c.uri ? `<button class="btn small ${SP.paused ? "pink" : "ghost"}" data-act="toggle" aria-label="${SP.paused ? "Play the song" : "Pause the song"}">${SP.paused ? "▶ Play" : "❚❚ Pause"}</button>
        <button class="btn small ghost" data-act="replay">↺ Start from the top</button>` : ""}
      ${SP.msg ? `<p class="note">${esc(SP.msg)}</p>` : !c.uri ? `<p class="note">No Spotify link for this song. Play track ${c.track} from the playlist.</p>` : ""}
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
  dock.hidden = !H.authed || !SP.requested;
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