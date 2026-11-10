# Know-vember

Hear the song. Guess the year. A live team music quiz for Dashing Tech's lunch.

- **Players** open the site on one phone per team, enter a team name and pick one of four years for each song.
- **The host** opens `/host` on the projector laptop, enters the PIN and runs the game. Each song's clip plays from the laptop, a 15-second clock runs, answers lock automatically at zero, and a leaderboard follows every song.

No accounts are needed for players.

## Project layout

```
server.js            game server (Express + Socket.IO), holds the game in memory
songs.json           the questions: title, artist, year, the 4 choices, audio file, clip start
public/audio/        the song clips (MP3)
public/index.html    player page            public/player.js
public/host.html     host / projector page  public/host.js
public/common.js     shared rendering       public/style.css
render.yaml          optional Render blueprint
```

## Add the audio

1. Put one clip per song in `public/audio/`, named exactly as the `audio` field in `songs.json` (`01-poison.mp3`, `02-everybody.mp3`, …).
2. Use MP3. Keep clips short (15–30 seconds) so they load instantly.
3. If a clip should start partway through the file, set `"start"` (in seconds) for that song in `songs.json`.

When the server starts it lists any clip it can't find. A song without a clip still works: the host screen says which playlist track to play instead.

> These are commercial recordings, so keep the GitHub repository **private**.

## Change the songs

Edit `songs.json`. Each song needs exactly 4 `choices`, and one of them must be the `year`. The server refuses to start if a song breaks either rule, and tells you which one.
`roundSeconds` sets the answer clock (15 by default).

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
| Start with song 1 | Clip 1 plays, the 15-second clock starts on every screen |
| (clock hits zero) | Answers lock automatically; late taps are refused by the server |
| Stop the clock now | Locks early if every team has answered |
| Reveal the answer | Shows the year, the song and every team's guess and points |
| Show leaderboard | Standings with movement since the last song |
| Play song N | Next clip plays and the next clock starts |
| Restart game | Clears all scores and goes back to the lobby; teams stay joined |

Scoring: spot on 1,000; 1 year off 700; 2 off 500; 3 off 300; 4–5 off 100. A team that doesn't answer gets 0 for that song.

Teams that refresh their phone or lose signal rejoin automatically as the same team. The host can remove a team from the lobby.
