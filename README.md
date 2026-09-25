# NekoChat Reloaded — PC client

![NekoChat Reloaded desktop client](https://raw.githubusercontent.com/xKaMikax/nekochat_reloaded/pc/screenshots/nekochat-pc.png)

NekoChat Reloaded is an unofficial desktop client for NekoChat. It is for people who want a Windows XP-style chat application instead of using NekoChat in a browser tab.

## What the client includes

- Rooms and direct messages.
- Detached chat windows and voice calls.
- Windows XP-inspired themes.
- XP-style notification, login, and call sounds.

## Run on PC

Install Node.js 20+ and npm, then run these commands from the repository root:

```bash
git clone --branch pc git@github.com:xKaMikax/nekochat_reloaded.git
cd nekochat_reloaded
npm install
npm start
```

## Build for Linux

```bash
npm run build:linux
```

The AppImage and `.deb` files will be created in `release/`.

## Build for Windows

```bash
npm run build:windows
```

The NSIS installer and portable build will be created in `release/`.
