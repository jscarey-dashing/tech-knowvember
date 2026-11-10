/* Host / projector screen */
const socket = io();
const APP_VERSION = "2026-11-10.3"; // shown on the host screen so you can check the deploy is current
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
  // The song keeps playing over the answer + leaderboard. It only stops when you press Pause,
  // when "Play song N" swaps in the next song, or when a 30-second Spotify preview runs out.
  if (s.phase === "lobby" || s.phase === "final") pauseClip();
  sync();
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

/* ---------- Spotify players ----------
   Two Spotify embeds take turns: one plays the current song while the other loads
   the next one in the background. Phones only start a song that is already loaded
   when you tap, so "Play song N" simply presses play on the waiting player. */
const SP = { api: null, players: [], active: null, expectN: null, requested: false, failed: false, paused: true, msg: "", watchdog: null };
const dock = document.getElementById("spotify-dock");
const keyOf = c => c.uri + "@" + c.start;

function makePlayer(slotId, wrapId, clip) {
  return new Promise(resolve => {
    SP.api.createController(document.getElementById(slotId), { uri: clip.uri, width: "100%", height: "80" }, ctrl => {
      const p = { ctrl, wrap: document.getElementById(wrapId), key: clip.uri + "@0", startedKey: null, paused: true, pendingPlay: false };
      ctrl.addListener("ready", () => { if (p.pendingPlay) { p.pendingPlay = false; ctrl.play(); } });
      ctrl.addListener("playback_update", e => {
        const d = e.data || {};
        p.paused = !!d.isPaused;
        if (!p.paused && !d.isBuffering) {
          p.startedKey = p.key;
          if (p === SP.active) { clearTimeout(SP.watchdog); SP.msg = ""; }
          else ctrl.pause(); // only the active player should ever be heard
        }
        SP.paused = SP.active ? SP.active.paused : true;
        sync();
        render();
      });
      resolve(p);
    });
  });
}

function loadSpotify() {
  const s = H.state;
  if (SP.requested || !s) return;
  const first = s.clip || s.next;
  if (!first || !first.uri) return;
  SP.requested = true;
  dock.hidden = false;
  window.onSpotifyIframeApiReady = async api => {
    SP.api = api;
    const a = await makePlayer("spotify-embed-a", "slot-a", first);
    const n = H.state && H.state.next;
    const b = await makePlayer("spotify-embed-b", "slot-b", n && n.uri ? n : first);
    SP.players = [a, b];
    sync();
    render();
  };
  const sc = document.createElement("script");
  sc.src = "https://open.spotify.com/embed/iframe-api/v1";
  sc.async = true;
  sc.onerror = () => { SP.failed = true; render(); };
  document.head.appendChild(sc);
  setTimeout(() => { if (!SP.players.length) { SP.failed = true; render(); } }, 12000);
}

function cue(p, c) {
  if (!p || !c || !c.uri || p.key === keyOf(c)) return;
  p.key = keyOf(c);
  p.startedKey = null;
  p.ctrl.loadUri(c.uri, false, c.start);
}

// Keep the player holding the current song active, and load the next song into the other one
function sync() {
  const s = H.state;
  if (!s || SP.players.length < 2) return;
  const cur = s.phase === "lobby" || s.phase === "final" ? null : s.clip;
  // Just after a tap the server hasn't moved to the new song yet: keep the player that was tapped
  const waiting = SP.expectN && (!cur || cur.n < SP.expectN);
  if (!waiting) {
    SP.expectN = null;
    if (cur) {
      const holder = SP.players.find(p => p.key === keyOf(cur));
      if (holder) SP.active = holder;
    } else if (SP.active && SP.active.paused) SP.active = null;
  }
  const idle = SP.players.find(p => p !== SP.active);
  // Load the next song into the waiting player (never one that's playing, and not mid-handoff)
  if (!waiting && idle && idle.paused && s.next && !(SP.active && SP.active.key === keyOf(s.next))) cue(idle, s.next);
  const front = SP.active || idle;
  SP.players.forEach(p => p.wrap.classList.toggle("front", p === front));
  SP.paused = SP.active ? SP.active.paused : true;
}

// Runs inside the host's tap/click so the browser allows sound
function playClip(c) {
  SP.msg = "";
  if (!c) return;
  if (!c.uri) { SP.msg = `No Spotify link for song ${c.n}. Play track ${c.track} from the playlist.`; return; }
  if (SP.players.length < 2) {
    SP.msg = SP.failed ? `Spotify didn’t load. Play track ${c.track} from the playlist.` : "Spotify is still loading. Try ▶ Play in a moment.";
    return;
  }
  const key = keyOf(c);
  let p = SP.players.find(x => x.key === key);
  SP.players.forEach(x => { if (x !== p && !x.paused) x.ctrl.pause(); });
  if (!p) {
    // Not loaded in advance (e.g. the page was just reloaded): load it now and play when ready
    p = SP.players.find(x => x !== SP.active) || SP.players[0];
    p.key = key; p.startedKey = null; p.pendingPlay = true;
    p.ctrl.loadUri(c.uri, false, c.start);
    setTimeout(() => { if (p.pendingPlay) { p.pendingPlay = false; p.ctrl.play(); } }, 1500);
  } else if (p.startedKey === key) {
    p.ctrl.seek(c.start); p.ctrl.resume();
  } else {
    p.ctrl.play();
  }
  SP.active = p;
  SP.expectN = c.n;
  SP.players.forEach(x => x.wrap.classList.toggle("front", x === p));
  clearTimeout(SP.watchdog);
  SP.watchdog = setTimeout(() => {
    if (SP.active === p && p.paused) { SP.msg = `Spotify didn’t start. Tap ▶ Play, or play track ${c.track} from the playlist.`; render(); }
  }, 7000);
}

function pauseClip() {
  clearTimeout(SP.watchdog);
  SP.players.forEach(p => { if (!p.paused) p.ctrl.pause(); });
}

// Play/Pause toggle: pausing keeps the position, playing carries on from there
function togglePlay() {
  const c = H.state && H.state.clip;
  if (!c) return;
  const p = SP.active;
  if (p && !p.paused) { pauseClip(); return; }
  if (p && p.key === keyOf(c) && p.startedKey === keyOf(c)) { SP.msg = ""; p.ctrl.resume(); }
  else playClip(c);
}

/* ---------- Clicks ---------- */
const actions = {
  unlock: () => auth((document.getElementById("hostPin")?.value || "").trim(), false),
  start: () => { playClip(H.state.next); act("start"); },
  lock: () => act("lock"),
  next: () => { if (H.state.next) playClip(H.state.next); else pauseClip(); act("next"); },
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
    <button class="link" data-act="restart">${H.restartArmed ? "Tap again to restart from song 1" : "Restart game"}</button></div>
    <p class="hint" style="margin-top:18px">Version ${APP_VERSION}</p>`;
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

  if (s.phase === "question") {
    const answered = teams.filter(t => t.answered);
    return `${mast()}<div>
      <p class="counter">Song ${song.n} of ${s.total}</p>
      <div class="timer" aria-hidden="true" style="max-width:none"><i id="tbar"></i></div>
      <p class="counter" id="tleft">&nbsp;</p>
      <p class="counter">${answered.length} of ${teams.length} locked in</p>
      <div class="chips">${teams.map(t => `<span class="chip ${t.answered ? "done" : ""} ${t.connected ? "" : "away"}">${esc(t.name)}</span>`).join("")}</div>
      ${audioBar()}
    </div>
    ${choiceTiles(song.choices, null, true)}
    ${foot(`<button class="btn pink" data-act="lock">Stop the clock and reveal</button>`)}`;
  }

  // Answer + leaderboard in one screen
  if (s.phase === "board") {
    const last = song.n >= s.total;
    return `${mast()}<p class="counter">Song ${song.n} of ${s.total}</p>
      <div class="answerline"><p class="big pink">${song.year}</p>
        <div><h2 class="songt">${esc(song.title)}</h2><p class="artist">${esc(song.artist)}</p></div></div>
      ${audioBar()}
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
  if (left) left.textContent = remain > 0 ? `${Math.ceil(remain)} seconds left` : "Time’s up. Revealing…";
}
setInterval(tick, 250);
render();