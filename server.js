// Know-vember: hear the song, guess the year.
// One server holds the game in memory and pushes live updates over Socket.IO.

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const HOST_PIN = String(process.env.HOST_PIN || "8888");
const PUBLIC_DIR = path.join(__dirname, "public");

/* ---------- Songs ---------- */
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "songs.json"), "utf8"));
const SONGS = config.songs;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS || config.roundSeconds || 15);
const GRACE_MS = 750; // allowance for network lag on the last-second tap
const MAX_TEAMS = 60;

// Accepts a Spotify track link, a spotify:track: URI or a bare 22-character track ID
function spotifyUri(value) {
  const v = String(value || "").trim();
  const m = v.match(/track[/:]([A-Za-z0-9]{22})/) || v.match(/^([A-Za-z0-9]{22})$/);
  return m ? `spotify:track:${m[1]}` : null;
}

SONGS.forEach((s, i) => {
  const n = i + 1;
  if (!Array.isArray(s.choices) || s.choices.length !== 4) throw new Error(`Song ${n} needs exactly 4 choices`);
  if (!s.choices.includes(s.year)) throw new Error(`Song ${n}: the choices must include the answer (${s.year})`);
  s.uri = spotifyUri(s.spotify);
  if (!s.uri) console.warn(`Song ${n} (${s.title}): no valid Spotify track link. The host will be told to play track ${s.track} instead.`);
});

function points(guess, song) {
  if (guess == null) return 0;
  const d = Math.abs(guess - song.year);
  return d === 0 ? 1000 : d === 1 ? 700 : d === 2 ? 500 : d === 3 ? 300 : d <= 5 ? 100 : 0;
}

/* ---------- Web server ---------- */
const app = express();
app.set("trust proxy", true);
app.get("/healthz", (req, res) => res.send("ok"));
app.get("/host", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "host.html")));
app.get("/join-qr.svg", async (req, res) => {
  const url = `${req.protocol}://${req.get("host")}/`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#1A1A1A", light: "#FFFFFF" } });
  res.type("image/svg+xml").send(svg);
});
app.use(express.static(PUBLIC_DIR, { maxAge: "1h" }));

const server = http.createServer(app);
const io = new Server(server);

/* ---------- Game state (in memory) ---------- */
const newId = () => crypto.randomBytes(6).toString("hex");
const newToken = () => crypto.randomBytes(18).toString("hex");

const teams = new Map();  // id -> { id, token, name, answers: {q: year}, sockets }
const tokens = new Map(); // token -> team id
let game = freshGame();
let lockTimer = null;

function freshGame() {
  return { gameId: newId(), phase: "lobby", q: 0, qEndsAt: 0, results: [] };
}

function scoreList(upto) {
  const list = [...teams.values()].map(t => {
    let total = 0;
    for (let i = 0; i <= upto; i++) { const r = game.results[i]; if (r && r[t.id]) total += r[t.id].p; }
    const last = game.results[upto] && game.results[upto][t.id];
    // guess: the year picked (null = no answer); left out if the team joined after this song
    return { id: t.id, name: t.name, total, last: last ? last.p : null, ...(last ? { guess: last.g } : {}) };
  });
  list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  list.forEach((t, i) => { if (t.total !== prev) { rank = i + 1; prev = t.total; } t.rank = rank; });
  return list;
}
function standings(upto) {
  const cur = scoreList(upto);
  if (upto > 0) {
    const prev = {}; scoreList(upto - 1).forEach(t => { prev[t.id] = t.rank; });
    cur.forEach(t => { t.move = prev[t.id] != null ? prev[t.id] - t.rank : 0; });
  }
  return cur;
}

function clip(i) {
  const s = SONGS[i];
  if (!s) return null;
  return { n: i + 1, track: s.track, uri: s.uri, start: Math.max(0, Number(s.start) || 0) };
}

function viewFor(socket) {
  const { phase, q } = game;
  const revealed = phase === "board" || phase === "final";
  const s = SONGS[q];
  const view = {
    gameId: game.gameId, phase, q, total: SONGS.length, roundSeconds: ROUND_SECONDS,
    qEndsAt: game.qEndsAt, serverNow: Date.now(),
    song: phase === "lobby" ? null : { n: q + 1, choices: s.choices, ...(revealed ? { title: s.title, artist: s.artist, year: s.year } : {}) },
  };

  if (socket.data.isHost) {
    view.isHost = true;
    const answering = phase === "question" || phase === "locked";
    view.teams = [...teams.values()].map(t => ({
      id: t.id, name: t.name, connected: t.sockets > 0,
      answered: answering && t.answers[q] != null,
    }));
    if (phase !== "lobby") view.clip = clip(q);
    view.next = phase === "lobby" ? clip(0) : phase === "board" && q + 1 < SONGS.length ? clip(q + 1) : null;
    if (revealed) view.standings = standings(phase === "final" ? SONGS.length - 1 : q);
  }

  const t = socket.data.teamId && teams.get(socket.data.teamId);
  if (t) {
    view.me = { id: t.id, name: t.name, answer: phase === "lobby" ? null : (t.answers[q] ?? null) };
    if (phase !== "lobby" && phase !== "question") view.me.result = (game.results[q] && game.results[q][t.id]) || null;
    if (revealed) {
      const st = standings(phase === "final" ? SONGS.length - 1 : q);
      const mine = st.find(x => x.id === t.id);
      view.me.rank = mine ? mine.rank : null;
      view.me.total = mine ? mine.total : 0;
      view.me.of = st.length;
      view.board = st;
    }
  }
  return view;
}

function broadcast() {
  for (const s of io.sockets.sockets.values()) s.emit("state", viewFor(s));
}

/* ---------- Game flow ---------- */
function startQuestion(i) {
  clearTimeout(lockTimer);
  game.phase = "question";
  game.q = i;
  game.qEndsAt = Date.now() + ROUND_SECONDS * 1000;
  lockTimer = setTimeout(lockRound, ROUND_SECONDS * 1000 + GRACE_MS);
  broadcast();
}

function lockRound() {
  if (game.phase !== "question") return;
  clearTimeout(lockTimer);
  const q = game.q, song = SONGS[q], res = {};
  for (const t of teams.values()) {
    const g = t.answers[q] ?? null;
    res[t.id] = { name: t.name, g, p: points(g, song) };
  }
  game.results[q] = res;
  game.phase = "board"; // the answer and the leaderboard show together
  broadcast();
}

const hostActions = {
  start: () => { if (game.phase !== "lobby") return "The game has already started."; if (!teams.size) return "Wait for at least one team to join."; startQuestion(0); },
  lock: () => { if (game.phase !== "question") return "There’s no clock running."; lockRound(); },
  next: () => {
    if (game.phase !== "board") return "Finish this song first.";
    if (game.q + 1 < SONGS.length) startQuestion(game.q + 1);
    else { game.phase = "final"; broadcast(); }
  },
  restart: () => {
    clearTimeout(lockTimer);
    game = freshGame();
    for (const t of teams.values()) t.answers = {};
    broadcast();
  },
  removeTeam: ({ id }) => {
    const t = teams.get(id);
    if (!t) return;
    teams.delete(id); tokens.delete(t.token);
    for (const s of io.sockets.sockets.values()) {
      if (s.data.teamId === id) { s.data.teamId = null; s.emit("removed"); }
    }
    broadcast();
  },
  clearTeams: () => {
    if (game.phase !== "lobby") return "Teams can only be cleared in the lobby.";
    for (const t of teams.values()) hostActions.removeTeam({ id: t.id });
    broadcast();
  },
};

/* ---------- Sockets ---------- */
const failedPins = new Map(); // ip -> { count, until }

io.on("connection", socket => {
  socket.data.teamId = null;
  socket.data.isHost = false;
  socket.emit("state", viewFor(socket));

  const reply = (cb, payload) => { if (typeof cb === "function") cb(payload); };
  const attach = t => {
    if (socket.data.teamId === t.id) return;
    socket.data.teamId = t.id;
    t.sockets++;
  };

  socket.on("host:auth", (pin, cb) => {
    const ip = socket.handshake.address;
    const f = failedPins.get(ip);
    if (f && f.until > Date.now()) return reply(cb, { ok: false, error: "Too many wrong PINs. Wait a minute and try again." });
    const a = Buffer.from(String(pin || "")), b = Buffer.from(HOST_PIN);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      const count = (f && f.until <= Date.now() ? 0 : (f ? f.count : 0)) + 1;
      failedPins.set(ip, { count, until: count >= 5 ? Date.now() + 60000 : 0 });
      return reply(cb, { ok: false, error: "That PIN isn’t right. Try again." });
    }
    failedPins.delete(ip);
    socket.data.isHost = true;
    reply(cb, { ok: true });
    socket.emit("state", viewFor(socket));
  });

  socket.on("host:action", (msg, cb) => {
    if (!socket.data.isHost) return reply(cb, { error: "Enter the host PIN first." });
    const fn = msg && hostActions[msg.type];
    if (!fn) return reply(cb, { error: "Unknown action." });
    const err = fn(msg);
    reply(cb, err ? { error: err } : { ok: true });
  });

  socket.on("player:join", (name, cb) => {
    name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 28);
    if (!name) return reply(cb, { error: "Give your team a name first." });
    if ([...teams.values()].some(t => t.name.toLowerCase() === name.toLowerCase())) return reply(cb, { error: "Another team already has that name. Try a different one." });
    if (teams.size >= MAX_TEAMS) return reply(cb, { error: "The game is full." });
    if (socket.data.teamId && teams.get(socket.data.teamId)) return reply(cb, { error: "This phone has already joined a team." });
    const t = { id: newId(), token: newToken(), name, answers: {}, sockets: 0 };
    teams.set(t.id, t); tokens.set(t.token, t.id);
    attach(t);
    reply(cb, { ok: true, token: t.token });
    broadcast();
  });

  socket.on("player:resume", (token, cb) => {
    const id = tokens.get(String(token || ""));
    const t = id && teams.get(id);
    if (!t) return reply(cb, { ok: false });
    attach(t);
    reply(cb, { ok: true });
    broadcast();
  });

  socket.on("player:answer", (year, cb) => {
    const t = socket.data.teamId && teams.get(socket.data.teamId);
    if (!t) return reply(cb, { error: "Join a team first." });
    if (game.phase !== "question" || Date.now() > game.qEndsAt + GRACE_MS) return reply(cb, { error: "Time’s up for this song." });
    year = Number(year);
    if (!SONGS[game.q].choices.includes(year)) return reply(cb, { error: "Pick one of the four years." });
    t.answers[game.q] = year;
    reply(cb, { ok: true });
    broadcast();
  });

  socket.on("disconnect", () => {
    const t = socket.data.teamId && teams.get(socket.data.teamId);
    if (t) { t.sockets = Math.max(0, t.sockets - 1); broadcast(); }
  });
});

server.listen(PORT, () => {
  console.log(`Know-vember is running on port ${PORT}. Players: /  Host: /host`);
});