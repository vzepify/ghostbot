<p align="center">
  <img src="https://raw.githubusercontent.com/vzepify/ghostbot/main/public/favicon.png" alt="NeoBot Logo" width="80" />
</p>

<h1 align="center">Frequently Asked Questions</h1>

<p align="center">
  <a href="https://neobotxyz.up.railway.app">
    <img src="https://img.shields.io/badge/Add%20NeoBot-9f6ef5?style=for-the-badge&logo=twitch&logoColor=white" alt="Add NeoBot"/>
  </a>
  &nbsp;
  <a href="https://github.com/vzepify/ghostbot/blob/main/README.md">
    <img src="https://img.shields.io/badge/Back%20to%20README-141416?style=for-the-badge&logo=github&logoColor=white" alt="README"/>
  </a>
  &nbsp;
  <a href="https://ko-fi.com/neobotxyz">
    <img src="https://img.shields.io/badge/Support%20on%20Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"/>
  </a>
</p>

---

## Table of Contents

- [What is NeoBot?](#what-is-neobot)
- [Is NeoBot free?](#is-neobot-free)
- [Will there be bugs?](#will-there-be-bugs)
- [How do I add NeoBot to my channel?](#how-do-i-add-neobot-to-my-channel)
- [Can my mods manage commands?](#can-my-mods-manage-commands)
- [What commands does NeoBot have?](#what-commands-does-neobot-have)
- [How do I add custom commands?](#how-do-i-add-custom-commands)
- [How do timers work?](#how-do-timers-work)
- [How does the banned words filter work?](#how-does-the-banned-words-filter-work)
- [How do I report a bug or request a feature?](#how-do-i-report-a-bug-or-request-a-feature)

---

<a name="what-is-neobot"></a>
## 🤖 What is NeoBot?

NeoBot is a multi-channel Twitch bot built as a personal project. It comes with a web dashboard so you can manage everything — commands, timers, and moderation — without touching any code or restarting anything.

---

<a name="is-neobot-free"></a>
## 💸 Is NeoBot free?

Yes, completely free. If you want to support keeping the bot running you can [buy me a coffee on Ko-fi](https://ko-fi.com/neobotxyz) but there's no obligation.

---

<a name="will-there-be-bugs"></a>
## 🐛 Will there be bugs?

Yes — this is a personal project and bugs are expected. I fix things as fast as I can. If you run into something broken, feel free to open an issue on GitHub and I'll look into it.

---

<a name="how-do-i-add-neobot-to-my-channel"></a>
## ➕ How do I add NeoBot to my channel?

1. Go to **[neobotxyz.up.railway.app](https://neobotxyz.up.railway.app)**
2. Click **Connect with Twitch**
3. Authorize the bot with your Twitch account
4. You're done — NeoBot will join your chat automatically

> **Tip:** Type `/mod neobotxyz` in your chat to give the bot mod permissions so it can delete messages and issue timeouts.

---

<a name="can-my-mods-manage-commands"></a>
## 🛡️ Can my mods manage commands?

Yes. If your mods authorize their own Twitch account on the site, they'll see your channel in their dashboard under **"Moderating"** and can add, edit, or delete commands and banned words for your channel.

---

<a name="what-commands-does-neobot-have"></a>
## ⚡ What commands does NeoBot have?

| Command | Who can use | Description |
|---|---|---|
| `!title <text>` | Broadcaster / Mods | Update your stream title |
| `!game <name>` | Broadcaster / Mods | Update your stream category |
| `!uptime` | Everyone | Show how long you've been live |
| `!shoutout <user>` | Broadcaster / Mods | Shout out another streamer |
| `!commands` | Everyone | List all commands |

Plus any custom commands you create in the dashboard.

---

<a name="how-do-i-add-custom-commands"></a>
## 📝 How do I add custom commands?

1. Go to your dashboard → **Commands** page
2. Type a command name (e.g. `!discord`) and a response
3. Set who can use it — Everyone, Mods+, or Broadcaster only
4. Click **+ Add** then **Save Changes**

You can also use variables in responses:

| Variable | What it does |
|---|---|
| `{user}` | Name of the person who typed the command |
| `{channel}` | Your channel name |
| `{http:https://api.example.com}` | Fetches any URL that returns plain text |
| `{valorant_rank:Name#Tag}` | Shows your current Valorant rank and RR |

---

<a name="how-do-timers-work"></a>
## ⏱️ How do timers work?

Timers automatically post messages in your chat on a schedule. There are two types:

- **Interval** — posts a message every X minutes (e.g. post your socials every 30 minutes)
- **Countdown** — posts a message once after X minutes (e.g. "Stream starting!" fires once then stops)

Each timer can be set to only fire when you're **live**, or always run. You can manage timers from the **Timers** page in your dashboard.

---

<a name="how-does-the-banned-words-filter-work"></a>
## 🚫 How does the banned words filter work?

Go to **Moderation → Banned Words** in your dashboard. You can:

- Add words or phrases to block
- Use `*` as a wildcard (e.g. `bad*` matches "badword", "badly")
- Choose a punishment: **Delete** the message, **Timeout** the user, or **Ban** them
- Set a custom timeout duration
- Add an optional response message using `{user}`
- Exempt specific users from the filter

Mods and the broadcaster are exempt by default.

---

<a name="how-do-i-report-a-bug-or-request-a-feature"></a>
## 🐞 How do I report a bug or request a feature?

Open an [issue on GitHub](https://github.com/vzepify/ghostbot/issues) and describe what's happening. Include what you were doing when it broke if you can — it helps a lot.

---

<p align="center">
  Made with ☕ by <a href="https://twitch.tv/neonarwhai">neonarwhai</a>
</p>
