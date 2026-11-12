# Know-vember

Hear the song. Guess the year. A live team music quiz for Dashing Tech's lunch.

- **Players** open the site on one phone per team, enter a team name and pick one of four years for each song.
- **The host** opens `/host` on the projector laptop, enters the PIN and runs the game. Each song plays through a Spotify player on the laptop (covered, so the title stays hidden), a 30-second clock runs, answers lock automatically at zero, and a leaderboard follows every song.

No accounts are needed for players.

## Project layout

```
server.js            game server (Express + Socket.IO), holds the game in memory
songs.json           the questions: title, artist, year, the 4 choices, Spotify link, start second
public/index.html    player page            public/player.js
public/host.html     host / projector page  public/host.js
public/common.js     shared rendering       public/style.css
render.yaml          optional Render blueprint
```

## Music (Spotify)

Each song in `songs.json` has a `spotify` link (copy it from Spotify with **Share → Copy song link**). The host screen plays it through Spotify's embedded player, docked in the bottom-right corner under a "Now playing" cover so nobody can read the title.

- **Log in to Spotify in the host browser** (open.spotify.com, ideally a Premium account). Logged in, the full song plays and `"start"` (in seconds) lets you jump to the chorus. Logged out, Spotify plays its 30-second preview instead, which roughly covers a 30-second round, but `"start"` may be ignored.
- Clicking **Start with song 1** or **Play song N** starts the music. The next song is loaded in advance during the leaderboard so it starts straight away.
- If Spotify doesn't start, the host screen says so: click **Play clip again**, or play that track number from your playlist (the `track` field). The playlist order matches the song order.
- Do a test run in the browser and on the network you'll use on the day.

## Change the songs

Edit `songs.json`. Each song needs exactly 4 `choices`, and one of them must be the `year`. The server refuses to start if a song breaks either rule, and tells you which one.
`roundSeconds` sets the answer clock (30 by default).

## Run it locally

```
npm install
npm start
```

Players: http://localhost:3000. Host: http://localhost:3000/host (PIN `8888` unless you set `HOST_PIN`).
To test with phones on the same Wi-Fi, use your laptop's local IP address instead of `localhost`.

## Deploy on Render

1. Push this folder to a **private** GitHub repository.
2. In Render, choose **New → Web Service** and connect the repository.
3. Settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
4. Under **Environment**, add `HOST_PIN` with your PIN (otherwise it's `8888`).
5. Deploy. Players go to `https://<your-service>.onrender.com`, the host to `https://<your-service>.onrender.com/host`.

Alternatively, choose **New → Blueprint** and Render reads `render.yaml`. Change the `HOST_PIN` value in Render afterwards.

### Before the event

- **Free instances sleep when idle.** On Render's free plan the service spins down after a period with no traffic and takes a little while to wake up. Open the site about 10 minutes before lunch and keep the host screen open. A paid instance doesn't sleep.
- **Run one instance only.** The game lives in the server's memory, so don't scale it beyond one instance. A restart or redeploy clears the game, so don't deploy during the event.
- **Do a test run** with two phones: join, play a song, check the clip plays from the laptop speakers, and restart the game from the host screen.

## How the game runs

| Host clicks | What happens |
|---|---|
| Start with song 1 | Song 1 plays, the 30-second clock starts on every screen |
| (clock hits zero) | Answers lock and the answer shows straight away with the leaderboard: each team's guess (✓ spot on, ≈ close, ✗ no points), points for the song, total and rank movement. Phones show the same leaderboard with the team's own row highlighted |
| Stop the clock and reveal | Does the same early, if every team has answered |
| Play song N | Next song plays and the next clock starts |
| Restart game | Clears all scores and goes back to the lobby; teams stay joined |

Scoring: spot on 1,000; 1 year off 700; 2 off 500; 3 off 300; 4–5 off 100. A team that doesn't answer gets 0 for that song.

Teams that refresh their phone or lose signal rejoin automatically as the same team. The host can remove a team from the lobby.