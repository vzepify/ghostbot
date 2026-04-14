<p align="center">
  <img src="https://github.com/vzepify/ghostbot/blob/main/public/favicon.png" alt="NeoBot Logo" width="120"/>
</p>

<h1 align="center">NeoBot</h1>

<p align="center">
  A Twitch bot with a web dashboard — manage commands, timers, and moderation from your browser.
</p>

<p align="center">
  <a href="https://neobotxyz.up.railway.app">
    <img src="https://img.shields.io/badge/Add%20to%20your%20channel-9f6ef5?style=for-the-badge&logo=twitch&logoColor=white" alt="Add to Channel"/>
  </a>
  &nbsp;
  <a href="https://github.com/vzepify/ghostbot/blob/main/FAQ.md">
    <img src="https://img.shields.io/badge/FAQ-141416?style=for-the-badge&logo=github&logoColor=white" alt="FAQ"/>
  </a>
  &nbsp;
  <a href="https://ko-fi.com/neobotxyz">
    <img src="https://img.shields.io/badge/Support%20on%20Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"/>
  </a>
</p>

---

## Features

| Feature | Description |
|---|---|
| ⚡ **Custom Commands** | Add, edit and delete chat commands from the dashboard |
| ⏱️ **Timers** | Schedule interval or countdown messages in chat |
| 🚫 **Moderation** | Banned word filter with timeout, ban or delete punishment |
| 🛡️ **Mod Support** | Mods can manage commands and moderation for channels they moderate |
| 🌐 **API Variables** | Use `{http:url}` or `{valorant_rank:Name#Tag}` in command responses |
| 📱 **Mobile Friendly** | Dashboard works on desktop and mobile |

---

## Built-in Commands

| Command | Who | Description |
|---|---|---|
| `!title <text>` | Broadcaster / Mods | Update stream title |
| `!game <name>` | Broadcaster / Mods | Update stream category |
| `!uptime` | Everyone | Show how long the stream has been live |
| `!shoutout <user>` | Broadcaster / Mods | Shout out another streamer |
| `!commands` | Everyone | List all available commands |

---

## Changelog

### v0.0.3
- Added **Banned Words** moderation module
- Mods and streamers can add/edit banned words from the dashboard
- Customizable punishment: delete message, timeout, or ban
- UI improvements across all pages

### v0.0.2
- Added **Timers** module
- Interval timers — post a message every X minutes
- Countdown timers — post once after X minutes
- Live-only toggle per timer

### v0.0.1
- API variable support (`{http:url}`, `{valorant_rank:Name#Tag}`, `{user}`, `{channel}`)
- Mods can now edit and manage commands for channels they moderate

---

## License

This project is **not open source**. Viewing is permitted but unauthorized copying, redistribution, or use of this code is prohibited.

© 2026 NeoBot. All rights reserved.
