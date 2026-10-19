# Codex LB

Check your [Codex LB](https://github.com/Soju06/codex-lb) quota without leaving Paseo.

- Compact per-account bars with shortened email prefixes in the sidebar.
- Account emails, quota credits, extra credit balances, reset countdowns, and reset-credit counts.
- Pause/resume accounts, change routing, edit aliases, and toggle quota warm-up.
- Use reset credits after confirmation, with idempotent retries if a response is lost.
- Requests, tokens, estimated cost, error rate, and a token chart.
- A pool card in Paseo's built-in Usage window.
- Dashboard password, guest login, and two-factor authentication.
- On macOS, an option to use a login already saved by Codex LB Status Bar.

## Connect

Open **Codex LB** in the sidebar. The default server is `http://127.0.0.1:2455`.
Use **Connection** to change it, then sign in with your dashboard password.
The URL is reached from the Paseo daemon; `localhost` means that machine.

Account emails appear on the main screen. Hide them under **Settings → Plugins → Codex LB** when needed.

On macOS, **Save login in Keychain** stores the login securely on the Paseo host and reconnects
automatically. Session cookies stay in memory; authentication codes are never saved.
Other daemon platforms support session-only sign-in. **Forget saved login** removes the
plugin's saved password. Existing Status Bar Keychain entries are read only when you select
**Use saved Status Bar login**.

Account changes require a dashboard login with account-write access. Reset credits are never
used automatically. The plugin connects only to your configured Codex LB server.

Inspired by [Codex LB Status Bar](https://github.com/sm1ee/codex-lb-statusbar).
