# whatsapp-bot

WhatsApp bot built on Bun and Baileys with a plugin-based architecture.

## Overview

- Dynamic plugin discovery with hot reload in development
- Registry-driven `.help` command menu
- Owner-only commands enforced independently of help visibility
- SQLite-backed authentication and storage
- Pixelyte API integration (upscale, background removal, OCR)

## Requirements

- Bun >= 1.0
- A WhatsApp account to pair with

## Installation

```bash
./install.sh            # deps + .env setup
./install.sh --service  # also install & start the systemd service
```

The script installs system packages (ffmpeg, python3-pil), Bun if missing,
project dependencies, and asks for your pairing/owner numbers on first run.

## Configuration

| Variable           | Required | Description                                              |
| ------------------ | -------- | -------------------------------------------------------- |
| `PAIRING_NUMBER`   | yes      | WhatsApp number used to request the pairing code         |
| `OWNER_NUMBER`     | yes      | Bot owner number(s), comma-separated, no leading +       |
| `PUBLIC_MODE`      | no       | `true` lets anyone use public commands (default `false`) |
| `NODE_ENV`         | no       | `development` enables plugin hot reload                  |
| `TZ`               | no       | Application timezone                                     |

## Project Structure

```
src/
├── app/        bootstrap (bot.js), event registration (events.js), plugin entry (plugins.js)
├── config.js   environment, constants and response templates
├── core/       context, dispatcher, plugin infrastructure (plugins.js)
├── plugins/    command and trigger plugins (general/group/media/owner/tools/experimental)
├── services/   business logic (groupAdmin, crmStore, storage, savedMessage, ...)
├── utils/      format, http, media, network, arguments helpers
├── database.js SQLite connection setup and WAL tuning
├── logger.js   application-level chalk logger
└── whatsapp/   Baileys integration (auth.js, messages.js, helpers.js)
data/           runtime data (auth.db, store.db) — git-ignored
scripts/        install.sh
deploy/         systemd units (bot.service, llama.service)
tests/          bun test suites
```

## Running the Bot

```bash
bun run start     # production
bun run dev       # development (watch + hot reload)
```

The bot prints a pairing code on first run; enter it in the linked device menu.

## Testing

```bash
bun test
```

Tests use temporary directories and never touch `data/`.

## Plugin Development

Create a file under `src/plugins/<category>/`. It is discovered automatically and appears in `.help` without any other change.

Command plugin:

```js
export default {
	commands: ['example'],
	category: 'general',
	description: 'Example command.',
	usage: '.example',

	async run({ m }) {
		await m.reply('Hello!');
	},
};
```

Trigger plugin (runs without a prefix):

```js
export default {
	category: 'owner',
	description: 'Executes on a condition.',
	access: 'owner',
	match: ({ m }) => m.body?.startsWith('$'),

	async run({ m }) {
		// ...
	},
};
```

### Plugin contract

| Field         | Required        | Description                                                 |
| ------------- | --------------- | ----------------------------------------------------------- |
| `commands`    | command plugins | Array of command names (first is primary, rest are aliases) |
| `match`       | trigger plugins | Function returning truthy when the plugin should run        |
| `run`         | yes             | Handler receiving the command context                       |
| `category`    | no              | Grouping for `.help` (defaults to the folder name)          |
| `description` | command plugins | Shown in `.help`                                            |
| `usage`       | no              | Usage hint                                                  |
| `access`      | no              | `'public'` (default) or `'owner'`                           |
| `helpName`    | trigger plugins | Command name shown in `.help`                               |

A plugin must have `commands` or `match`, never both. Duplicate commands fail registration with the conflicting file names.

## Help Command

`.help` (alias `.menu`) generates its menu from the plugin registry, grouped by category and sorted alphabetically. Owner-only commands are hidden from non-owners.

## Prefix Configuration

Prefixes are configurable via env or at runtime:

- `PREFIX=.,!,/` in `.env` (comma-separated symbols; fail-fast on invalid values).
- `setprefix <p1> [p2...]` (owner) — persistent override stored in `store.db`.
- `resetprefix` (owner) — remove the runtime override.
- `prefix` — show active prefixes. Rules: 1-4 chars, no letters/digits/whitespace, max 10; `>`, `=>`, `$` are reserved by owner triggers.

Recovery if a bad prefix is stored: owner triggers `$`/`>` never need a prefix. Nuclear option:

```sh
sqlite3 data/database/store.db "DELETE FROM settings WHERE key='prefix.global'"
```

## Groups

`.kick`/`.remove`, `.promote`/`.addadmin`, `.demote`/`.deladmin` — group moderation with pre-flight target validation (membership, current admin status) before the API call; all reply text lives in one `RESPONSES` object in `src/services/group-admin.js`. `.savemsg <keyword>` / `<keyword>` replays saved messages (audio is stored as opus/ogg and replayed as a playable voice note); `.delmsg <keyword>` removes one. `.totalchat` and group analytics power usage stats.

`.stickerpack <name> | <publisher>` (experimental) — builds a real WhatsApp sticker pack: stickers are zipped with base64url sha256 filenames, the tray/thumbnail is derived from the pack's media key, and the pack is relayed as a native `stickerPackMessage` that renders in the client's sticker tray.

## Tools

- `fetch <url> [options]` — HTTP requests via native `fetch` (aliases: `get`, `http`, `curl`). Options: `--method/-X`, `--header/-H`, `--data/-d`, `--json`, `--head/-I`, `--timeout`. Replies a URL or `curl` command to fetch it instead. Non-owner requests are SSRF-guarded (no private/loopback targets) and rate-limited (3 per 8s); responses are capped at 20 MB.
- `getpp [@mention|reply|me|<number>|group]` — profile picture fetch, includes WA Business info when available (aliases: `pp`, `profilepic`, `avatar`).
- `tourl [provider]` — upload media to a file host, get a direct URL (alias: `upload`). Providers: uguu (default), tmpfiles — both return raw direct media links. Max 100 MB.

## Media

`convert <format> [url]` — media conversion via the Pixelyte API (no local ffmpeg). Formats: mp3, gif, webm, mp4 (image conversion is not supported by the API). Reply to media or pass a URL. Limits: 50 MB input, 64 MB output, 180s timeout, max 2 concurrent conversions, 1 per 10s per sender. GIF results are sent as documents.

`sticker` (aliases: `s`, `stiker`) — create a sticker from a replied/sent image or video (max 8 MB), a replied sticker (repack), a single emoji (animated Noto emoji), or a URL. Local ffmpeg crop/scale to 512×512 WebP with EXIF pack/author metadata. Options: `-wm pack|author` for custom watermark; pack defaults to "Katsumi Style", author to the sender's name.

## Production Deployment

```bash
sudo cp whatsapp-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-bot
```

The service runs `bun --env-file=.env src/index.js` with automatic restart.

## Local AI (`.llm`)

The `.llm` command chats with a local Qwen2.5 1.5B Instruct model served by llama.cpp. The model file is **not** included in the repository or the zip — it is git-ignored under `data/`.

Before the command works, install and start the service:

1. Download the model (~1.1 GB):

```bash
mkdir -p data/models
curl -L -o data/models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
	https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

2. Install and build llama.cpp (CPU-only), then expose the binary:

```bash
sudo apt-get install -y cmake build-essential git
git clone --depth 1 https://github.com/ggml-org/llama.cpp /tmp/llama.cpp
cmake -B /tmp/llama.cpp/build -S /tmp/llama.cpp -DGGML_CUDA=OFF -DLLAMA_CURL=OFF
cmake --build /tmp/llama.cpp/build --config Release -j2
sudo mkdir -p /opt/llama.cpp
sudo cp /tmp/llama.cpp/build/bin/* /opt/llama.cpp/
```

3. Install the service:

```bash
sudo cp llama-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now llama-server
```

Usage: `.llm <question>`. Without the model file and running service the command replies that the AI service is unavailable; everything else in the bot is unaffected.

## Security

- `eval` and `exec` are owner-only and enforced by the dispatcher, not just hidden from help
- `.env` and `data/` (including the auth database) are git-ignored
- Secrets are never logged

## License

ISC
