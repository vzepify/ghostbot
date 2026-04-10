const express = require("express");
const fetch = require("node-fetch");
const tmi = require("tmi.js");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const { Pool } = require("pg");

// ── Database ─────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL,
      display_name TEXT,
      profile_image TEXT,
      access_token TEXT,
      refresh_token TEXT,
      active BOOLEAN DEFAULT true,
      commands JSONB DEFAULT '[]',
      modded_channels JSONB DEFAULT '[]',
      timers JSONB DEFAULT '[]',
      joined_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("✅ Database ready");
}

async function getUser(id) {
  const res = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function getAllActiveUsers() {
  const res = await pool.query("SELECT * FROM users WHERE active = true");
  return res.rows;
}

async function upsertUser(user) {
  await pool.query(`
    INSERT INTO users (id, login, display_name, profile_image, access_token, refresh_token, active, commands, modded_channels, joined_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE((SELECT joined_at FROM users WHERE id = $1), NOW()))
    ON CONFLICT (id) DO UPDATE SET
      login = $2, display_name = $3, profile_image = $4,
      access_token = $5, refresh_token = $6, active = $7,
      commands = $8, modded_channels = $9
  `, [
    user.id, user.login, user.display_name || user.displayName,
    user.profile_image || user.profileImage,
    user.access_token || user.accessToken,
    user.refresh_token || user.refreshToken,
    user.active !== false,
    JSON.stringify(user.commands || []),
    JSON.stringify(user.modded_channels || user.moddedChannels || []),
  ]);
}

async function updateTokens(id, accessToken, refreshToken) {
  await pool.query(
    "UPDATE users SET access_token = $1, refresh_token = $2 WHERE id = $3",
    [accessToken, refreshToken, id]
  );
}

async function updateCommands(id, commands) {
  await pool.query("UPDATE users SET commands = $2 WHERE id = $1", [id, JSON.stringify(commands)]);
}

async function updateModdedChannels(id, moddedChannels) {
  await pool.query("UPDATE users SET modded_channels = $2 WHERE id = $1", [id, JSON.stringify(moddedChannels)]);
}

async function updateTimers(id, timers) {
  await pool.query("UPDATE users SET timers = $2 WHERE id = $1", [id, JSON.stringify(timers)]);
}

async function setActive(id, active) {
  await pool.query("UPDATE users SET active = $2 WHERE id = $1", [id, active]);
}

// ── Timer engine ─────────────────────────────────────────────
const timerState = {}; // channelId -> { timerId -> { nextFire, countdownTarget } }

async function isChannelLive(userId, token) {
  try {
    const data = await helixGet(`/streams?user_id=${userId}`, token);
    return (data.data || []).length > 0;
  } catch (e) { return false; }
}

async function runTimers() {
  try {
    const res = await pool.query("SELECT * FROM users WHERE active = true");
    for (const user of res.rows) {
      const timers = user.timers || [];
      if (!timers.length) continue;
      if (!timerState[user.id]) timerState[user.id] = {};

      let token = null;
      let live = null;

      for (const timer of timers) {
        if (!timer.enabled) continue;

        const state = timerState[user.id][timer.id] || {};
        const now = Date.now();

        // Get live status if needed (cache per tick)
        if (timer.liveOnly && live === null) {
          try {
            if (!token) token = await getValidToken(user.id);
            live = await isChannelLive(user.id, token);
          } catch (e) { live = false; }
        }
        if (timer.liveOnly && !live) continue;

        if (timer.type === 'interval') {
          const interval = (timer.intervalMinutes || 30) * 60 * 1000;
          const lastFire = state.lastFire || (now - interval); // fire immediately on first tick
          if (now - lastFire >= interval) {
            try {
              await client.say(`#${user.login}`, timer.message);
              timerState[user.id][timer.id] = { ...state, lastFire: now };
            } catch (e) {}
          } else if (!state.lastFire) {
            timerState[user.id][timer.id] = { ...state, lastFire: now };
          }
        }

        if (timer.type === 'countdown') {
          // Initialize countdown target if not set
          if (!state.countdownTarget) {
            const ms = (timer.countdownMinutes || 60) * 60 * 1000;
            timerState[user.id][timer.id] = { ...state, countdownTarget: now + ms, fired: false };
            continue;
          }
          if (!state.fired && now >= state.countdownTarget) {
            try {
              await client.say(`#${user.login}`, timer.message);
              timerState[user.id][timer.id] = { ...state, fired: true };
            } catch (e) {}
          }
        }
      }
    }
  } catch (e) {
    console.error("Timer engine error:", e.message);
  }
}

// ── Express setup ────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require("cookie-parser")());
app.use(session({
  secret: process.env.SESSION_SECRET || "changeme-local-secret",
  resave: false,
  saveUninitialized: false,
}));

// Restore session from persistent cookie
app.use(async (req, res, next) => {
  if (!req.session.userId && req.cookies?.botUserId) {
    const user = await getUser(req.cookies.botUserId).catch(() => null);
    if (user) req.session.userId = user.id;
  }
  next();
});

app.use(express.static("public"));

// ── tmi.js ───────────────────────────────────────────────────
const joinedChannels = new Set();

const client = new tmi.Client({
  identity: {
    username: process.env.BOT_USERNAME,
    password: `oauth:${process.env.BOT_TOKEN}`,
  },
  channels: [],
});

async function startBot() {
  await initDB();
  await client.connect();
  console.log("✅ Bot connected to Twitch IRC");
  const users = await getAllActiveUsers();
  users.forEach(u => joinChannel(u.login));
}

function joinChannel(login) {
  if (joinedChannels.has(login)) return;
  try { client.join(login); joinedChannels.add(login); console.log(`➕ Joined #${login}`); } catch (e) {}
}

function leaveChannel(login) {
  try { client.part(login); joinedChannels.delete(login); console.log(`➖ Left #${login}`); } catch (e) {}
}

// ── Helix helpers ────────────────────────────────────────────
async function helixGet(path, token) {
  const res = await fetch(`https://api.twitch.tv/helix${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Client-Id": process.env.TWITCH_CLIENT_ID },
  });
  return res.json();
}

async function helixPatch(path, body, token) {
  const res = await fetch(`https://api.twitch.tv/helix${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Client-Id": process.env.TWITCH_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status === 204 ? { ok: true } : res.json();
}

async function refreshUserToken(user) {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: user.refresh_token,
    }),
  });
  const data = await res.json();
  if (data.access_token) {
    await updateTokens(user.id, data.access_token, data.refresh_token || user.refresh_token);
    return data.access_token;
  }
  throw new Error("Token refresh failed");
}

async function getValidToken(userId) {
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");
  try {
    const test = await helixGet(`/users?id=${userId}`, user.access_token);
    if (test.data) return user.access_token;
  } catch (e) {}
  return refreshUserToken(user);
}

async function fetchModdedChannels(userId, token) {
  try {
    const data = await helixGet(`/moderation/channels?user_id=${userId}&first=100`, token);
    return (data.data || []).map(c => ({ id: c.broadcaster_id, login: c.broadcaster_login, displayName: c.broadcaster_name }));
  } catch (e) { return []; }
}

// ── Permission helpers ───────────────────────────────────────
function isBroadcaster(tags) { return !!tags.badges?.broadcaster; }
function isMod(tags) { return tags.mod || isBroadcaster(tags); }
function isPrivileged(tags) { return isBroadcaster(tags) || isMod(tags); }

async function canEditChannel(requestingUserId, targetChannelId) {
  if (requestingUserId === targetChannelId) return true;
  const requester = await getUser(requestingUserId);
  if (!requester) return false;
  const target = await getUser(targetChannelId);
  if (!target) return false;
  const modded = requester.modded_channels || [];
  return modded.some(c => c.id === targetChannelId);
}

// ── Variable resolver ────────────────────────────────────────
// Supports {valorant_rank:Name#Tag} and {http:https://...} in command responses
async function resolveVariables(text, tags, channelName) {
  // {valorant_rank:RiotName#Tag}
  const valorantRegex = /\{valorant_rank:([^#]+)#([^}]+)\}/g;
  let match;
  while ((match = valorantRegex.exec(text)) !== null) {
    const [full, name, tag] = match;
    try {
      const res = await fetch(`https://api.henrikdev.xyz/valorant/v2/mmr/na/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
      const data = await res.json();
      const rank = data.data?.current_data?.currenttierpatched || 'Unranked';
      const rr = data.data?.current_data?.ranking_in_tier ?? 0;
      text = text.replace(full, `${rank} ${rr}RR`);
    } catch (e) {
      text = text.replace(full, 'Could not fetch rank');
    }
  }

  // {http:https://some-api.com/endpoint} — fetches URL and uses response as text
  const httpRegex = /\{http:(https?:\/\/[^}]+)\}/g;
  while ((match = httpRegex.exec(text)) !== null) {
    const [full, url] = match;
    try {
      const res = await fetch(url);
      const result = (await res.text()).trim().slice(0, 400); // cap at 400 chars
      text = text.replace(full, result);
    } catch (e) {
      text = text.replace(full, 'Could not fetch URL');
    }
  }

  // {user} — name of person who typed the command
  text = text.replace(/\{user\}/g, tags['display-name'] || tags.username || 'someone');

  // {channel} — channel name
  text = text.replace(/\{channel\}/g, channelName);

  return text;
}

// ── Chat message handler ─────────────────────────────────────
client.on("message", async (channel, tags, message, self) => {
  if (self) return;
  if (!message.startsWith("!")) return;

  const channelName = channel.replace("#", "");
  const [cmd, ...args] = message.trim().split(/\s+/);
  const command = cmd.toLowerCase();
  const say = (text) => client.say(channel, text);

  const res = await pool.query("SELECT * FROM users WHERE login = $1", [channelName]);
  const user = res.rows[0];
  if (!user) return;

  try {
    if (command === "!commands") {
      const customCmds = (user.commands || []).filter(c => c.enabled !== false).map(c => c.command);
      const builtIn = ["!title", "!game", "!uptime", "!shoutout"];
      say(`📋 Commands: ${[...builtIn, ...customCmds].join(" | ")}`);
      return;
    }

    if (command === "!uptime") {
      const token = await getValidToken(user.id);
      const streamData = await helixGet(`/streams?user_id=${user.id}`, token);
      if (!streamData.data?.length) { say(`${channelName} is not live right now.`); return; }
      const seconds = Math.floor((Date.now() - new Date(streamData.data[0].started_at)) / 1000);
      const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
      say(`⏱️ ${channelName} has been live for ${h}h ${m}m ${s}s`);
      return;
    }

    if (!isPrivileged(tags)) {
      const match = (user.commands || []).find(c => c.command === command && c.enabled !== false && c.permission === "everyone");
      if (match) say(match.response);
      return;
    }

    if (command === "!title") {
      if (!args.length) { say("Usage: !title <new title>"); return; }
      const token = await getValidToken(user.id);
      await helixPatch(`/channels?broadcaster_id=${user.id}`, { title: args.join(" ") }, token);
      say(`✅ Title updated to: ${args.join(" ")}`);
      return;
    }

    if (command === "!game") {
      if (!args.length) { say("Usage: !game <game name>"); return; }
      const token = await getValidToken(user.id);
      const gameData = await helixGet(`/games?name=${encodeURIComponent(args.join(" "))}`, token);
      const game = gameData.data?.[0];
      if (!game) { say(`❌ Couldn't find that game. Check spelling!`); return; }
      await helixPatch(`/channels?broadcaster_id=${user.id}`, { game_id: game.id }, token);
      say(`✅ Game updated to: ${game.name}`);
      return;
    }

    if (command === "!shoutout") {
      const target = args[0]?.replace(/^@/, "").toLowerCase();
      if (!target) { say("Usage: !shoutout <username>"); return; }
      const token = await getValidToken(user.id);
      const userData = await helixGet(`/users?login=${target}`, token);
      const targetUser = userData.data?.[0];
      if (!targetUser) { say(`❌ Couldn't find user "${target}".`); return; }
      const chanData = await helixGet(`/channels?broadcaster_id=${targetUser.id}`, token);
      const lastGame = chanData.data?.[0]?.game_name;
      say(`🎉 Go check out ${targetUser.display_name}!${lastGame ? ` They were last playing ${lastGame}.` : ""} Follow them at https://twitch.tv/${targetUser.login}`);
      return;
    }

    const match = (user.commands || []).find(c => c.command === command && c.enabled !== false);
    if (match) {
      const perm = match.permission || "everyone";
      if (perm === "broadcaster" && !isBroadcaster(tags)) return;
      if (perm === "mods" && !isMod(tags)) return;
      const resolved = await resolveVariables(match.response, tags, channelName);
      say(resolved);
    }

  } catch (err) {
    console.error(`[${channelName}] Command error:`, err.message);
  }
});

// ── OAuth ────────────────────────────────────────────────────
const SCOPES = "chat:read chat:edit channel:manage:broadcast channel:bot user:read:moderated_channels";

app.get("/auth/twitch", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/auth/callback`,
    response_type: "code",
    scope: SCOPES,
    state,
    force_verify: "true",
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error || state !== req.session.oauthState) return res.redirect("/?error=auth_failed");

  try {
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${process.env.BASE_URL}/auth/callback`,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("No access token");

    const userRes = await helixGet("/users", tokens.access_token);
    const twitchUser = userRes.data?.[0];
    if (!twitchUser) throw new Error("No user data");

    const moddedChannels = await fetchModdedChannels(twitchUser.id, tokens.access_token);
    const existing = await getUser(twitchUser.id);

    await upsertUser({
      id: twitchUser.id,
      login: twitchUser.login,
      display_name: twitchUser.display_name,
      profile_image: twitchUser.profile_image_url,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      active: true,
      commands: existing?.commands || [],
      modded_channels: moddedChannels,
    });

    req.session.userId = twitchUser.id;
    if (!existing) joinChannel(twitchUser.login);

    res.cookie("botUserId", twitchUser.id, { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true });
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Auth error:", err);
    res.redirect("/?error=auth_failed");
  }
});

app.get("/auth/logout", (req, res) => {
  res.clearCookie("botUserId");
  req.session.destroy();
  res.redirect("/");
});

// ── Dashboard API ────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

app.post("/api/refresh-channels", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    const moddedChannels = await fetchModdedChannels(req.session.userId, token);
    await updateModdedChannels(req.session.userId, moddedChannels);
    res.json({ moddedChannels });
  } catch (err) {
    res.status(500).json({ error: "Failed to refresh" });
  }
});

app.get("/api/me", requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const modded = user.modded_channels || [];
  const authorizedModded = [];
  for (const c of modded) {
    const exists = await getUser(c.id);
    if (exists) authorizedModded.push(c);
  }

  const channels = [
    { id: user.id, login: user.login, displayName: user.display_name, profileImage: user.profile_image, role: "broadcaster" },
    ...authorizedModded.map(c => ({ id: c.id, login: c.login, displayName: c.displayName, profileImage: null, role: "mod" }))
  ];

  res.json({
    id: user.id, login: user.login, displayName: user.display_name,
    profileImage: user.profile_image, active: user.active,
    joinedAt: user.joined_at, channels,
    timers: user.timers || [],
  });
});

app.get("/api/commands/:channelId", requireAuth, async (req, res) => {
  const { channelId } = req.params;
  if (!await canEditChannel(req.session.userId, channelId)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  const channel = await getUser(channelId);
  if (!channel) return res.status(404).json({ error: "Channel not found" });
  res.json({ commands: channel.commands || [], active: channel.active });
});

app.post("/api/commands/:channelId", requireAuth, async (req, res) => {
  const { channelId } = req.params;
  if (!await canEditChannel(req.session.userId, channelId)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  await updateCommands(channelId, req.body.commands || []);
  res.json({ ok: true });
});

app.post("/api/deactivate", requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user) return res.status(404).json({ error: "Not found" });
  await setActive(user.id, false);
  leaveChannel(user.login);
  res.json({ ok: true });
});

app.post("/api/activate", requireAuth, async (req, res) => {
  const user = await getUser(req.session.userId);
  if (!user) return res.status(404).json({ error: "Not found" });
  await setActive(user.id, true);
  joinChannel(user.login);
  res.json({ ok: true });
});

// ── Timer API ────────────────────────────────────────────────
app.get("/api/timers/:channelId", requireAuth, async (req, res) => {
  const { channelId } = req.params;
  if (!await canEditChannel(req.session.userId, channelId)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  const channel = await getUser(channelId);
  if (!channel) return res.status(404).json({ error: "Channel not found" });
  res.json({ timers: channel.timers || [] });
});

app.post("/api/timers/:channelId", requireAuth, async (req, res) => {
  const { channelId } = req.params;
  if (!await canEditChannel(req.session.userId, channelId)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  const timers = req.body.timers || [];
  await updateTimers(channelId, timers);
  // Reset timer state so changes take effect immediately
  if (timerState[channelId]) delete timerState[channelId];
  res.json({ ok: true });
});

// Reset a specific countdown timer
app.post("/api/timers/:channelId/reset/:timerId", requireAuth, async (req, res) => {
  const { channelId, timerId } = req.params;
  if (!await canEditChannel(req.session.userId, channelId)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  if (timerState[channelId] && timerState[channelId][timerId]) {
    delete timerState[channelId][timerId];
  }
  res.json({ ok: true });
});

// ── Serve frontend ───────────────────────────────────────────
app.get("/", (req, res, next) => {
  if (req.session.userId) return res.redirect("/dashboard");
  next();
});

app.get("/dashboard", (req, res) => {
  if (!req.session.userId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/timers", (req, res) => {
  if (!req.session.userId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "timers.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

startBot().catch(console.error);

setInterval(runTimers, 30 * 1000); // runs every 30 seconds
