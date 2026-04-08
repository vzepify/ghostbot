const express = require("express");
const fetch = require("node-fetch");
const tmi = require("tmi.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require("cookie-parser")());
app.use(express.static("public"));
app.use(session({
  secret: process.env.SESSION_SECRET || "changeme-local-secret",
  resave: false,
  saveUninitialized: false,
}));

// Restore session from persistent cookie if session expired
app.use((req, res, next) => {
  if (!req.session.userId && req.cookies?.botUserId) {
    const db = loadDB();
    if (db.users[req.cookies.botUserId]) {
      req.session.userId = req.cookies.botUserId;
    }
  }
  next();
});

// ── Data store (JSON file, simple & free) ───────────────────
const DB_FILE = "./data.json";

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {}
  return { users: {} };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ── tmi.js multi-channel bot ─────────────────────────────────
const client = new tmi.Client({
  identity: {
    username: process.env.BOT_USERNAME,
    password: `oauth:${process.env.BOT_TOKEN}`,
  },
  channels: [],
});

client.connect().then(() => {
  console.log("✅ Bot connected to Twitch IRC");
  // Join all stored channels on startup
  const db = loadDB();
  Object.values(db.users).forEach(user => {
    if (user.active) joinChannel(user.login);
  });
}).catch(console.error);

function joinChannel(login) {
  try {
    client.join(login);
    console.log(`➕ Joined #${login}`);
  } catch (e) {}
}

function leaveChannel(login) {
  try {
    client.part(login);
    console.log(`➖ Left #${login}`);
  } catch (e) {}
}

// ── Helix API helpers ────────────────────────────────────────
async function helixGet(path, token) {
  const res = await fetch(`https://api.twitch.tv/helix${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": process.env.TWITCH_CLIENT_ID,
    },
  });
  return res.json();
}

async function helixPatch(path, body, token) {
  const res = await fetch(`https://api.twitch.tv/helix${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": process.env.TWITCH_CLIENT_ID,
      "Content-Type": "application/json",
    },
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
      refresh_token: user.refreshToken,
    }),
  });
  const data = await res.json();
  if (data.access_token) {
    const db = loadDB();
    db.users[user.id].accessToken = data.access_token;
    db.users[user.id].refreshToken = data.refresh_token || user.refreshToken;
    saveDB(db);
    return data.access_token;
  }
  throw new Error("Token refresh failed");
}

async function getValidToken(userId) {
  const db = loadDB();
  const user = db.users[userId];
  if (!user) throw new Error("User not found");
  // Try existing token, refresh if needed
  try {
    const test = await helixGet(`/users?id=${userId}`, user.accessToken);
    if (test.data) return user.accessToken;
  } catch (e) {}
  return refreshUserToken(user);
}

// ── Permission helpers ───────────────────────────────────────
function isBroadcaster(tags) { return !!tags.badges?.broadcaster; }
function isMod(tags) { return tags.mod || isBroadcaster(tags); }
function isPrivileged(tags) { return isBroadcaster(tags) || isMod(tags); }

// ── Chat message handler ─────────────────────────────────────
client.on("message", async (channel, tags, message, self) => {
  if (self) return;
  if (!message.startsWith("!")) return;

  const channelName = channel.replace("#", "");
  const [cmd, ...args] = message.trim().split(/\s+/);
  const command = cmd.toLowerCase();
  const say = (text) => client.say(channel, text);

  // Find this channel's user record
  const db = loadDB();
  const user = Object.values(db.users).find(u => u.login === channelName);
  if (!user) return;

  try {
    // ── Built-in commands ──────────────────────────────────
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
      // Check custom commands for everyone
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

    // ── Custom commands (mods+) ────────────────────────────
    const match = (user.commands || []).find(c => c.command === command && c.enabled !== false);
    if (match) {
      const perm = match.permission || "everyone";
      if (perm === "broadcaster" && !isBroadcaster(tags)) return;
      if (perm === "mods" && !isMod(tags)) return;
      say(match.response);
    }

  } catch (err) {
    console.error(`[${channelName}] Command error:`, err.message);
  }
});

// ── OAuth Routes ─────────────────────────────────────────────
const SCOPES = "chat:read chat:edit channel:manage:broadcast channel:bot moderator:read:chatters";

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
  if (error || state !== req.session.oauthState) {
    return res.redirect("/?error=auth_failed");
  }

  try {
    // Exchange code for tokens
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

    // Get user info
    const userRes = await helixGet("/users", tokens.access_token);
    const twitchUser = userRes.data?.[0];
    if (!twitchUser) throw new Error("No user data");

    // Save to DB
    const db = loadDB();
    const isNew = !db.users[twitchUser.id];
    db.users[twitchUser.id] = {
      id: twitchUser.id,
      login: twitchUser.login,
      displayName: twitchUser.display_name,
      profileImage: twitchUser.profile_image_url,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      active: true,
      commands: db.users[twitchUser.id]?.commands || [],
      joinedAt: db.users[twitchUser.id]?.joinedAt || new Date().toISOString(),
    };
    saveDB(db);

    req.session.userId = twitchUser.id;

    if (isNew) joinChannel(twitchUser.login);

    res.cookie("botUserId", twitchUser.id, { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true });
res.redirect("/dashboard");  
  } catch (err) {
    console.error("Auth error:", err);
    res.redirect("/?error=auth_failed");
  }
});

app.get("/auth/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// ── Dashboard API ────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

app.get("/api/me", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ id: user.id, login: user.login, displayName: user.displayName, profileImage: user.profileImage, active: user.active, commands: user.commands || [], joinedAt: user.joinedAt });
});

app.post("/api/commands", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (!user) return res.status(404).json({ error: "Not found" });
  db.users[req.session.userId].commands = req.body.commands || [];
  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/deactivate", requireAuth, (req, res) => {
  const db = loadDB();
  if (!db.users[req.session.userId]) return res.status(404).json({ error: "Not found" });
  db.users[req.session.userId].active = false;
  leaveChannel(db.users[req.session.userId].login);
  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/activate", requireAuth, (req, res) => {
  const db = loadDB();
  if (!db.users[req.session.userId]) return res.status(404).json({ error: "Not found" });
  db.users[req.session.userId].active = true;
  joinChannel(db.users[req.session.userId].login);
  saveDB(db);
  res.json({ ok: true });
});

// ── Serve frontend ───────────────────────────────────────────
// ── Serve frontend ───────────────────────────────────────────
app.get("/", (req, res, next) => {
  if (req.session.userId) return res.redirect("/dashboard");
  next();
});

app.get("/dashboard", (req, res) => {
  if (!req.session.userId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
