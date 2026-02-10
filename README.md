# Seafile FileLink for Thunderbird

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](LICENSE)
[![Thunderbird 128+](https://img.shields.io/badge/Thunderbird-128%2B-0A84FF?logo=thunderbird&logoColor=white)](https://www.thunderbird.net/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blueviolet)](https://developer.thunderbird.net/add-ons/manifest-v3)
[![Seafile API v2.1](https://img.shields.io/badge/Seafile_API-v2.1-orange)](https://download.seafile.com/published/web-api/home.md)
[![i18n: EN / DE](https://img.shields.io/badge/i18n-EN_%7C_DE-informational)](#localization)
[![Supporting AI: Claude Code](https://img.shields.io/badge/Supporting%20AI-Claude%20Code-red)](#)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)](#)
[![GitHub issues](https://img.shields.io/github/issues/relexx/tb-seafile-filelink)](https://github.com/relexx/tb-seafile-filelink/issues)
[![GitHub last commit](https://img.shields.io/github/last-commit/relexx/tb-seafile-filelink)](https://github.com/relexx/tb-seafile-filelink/commits)

A Thunderbird extension (Manifest V3) that integrates [Seafile](https://www.seafile.com/) as a FileLink provider. Large email attachments are automatically uploaded to your Seafile server and replaced with a download link.

## Features

- **Seafile API v2.1** – Compatible with current Seafile servers (v10+)
- **2FA / TOTP** – Two-factor authentication support with automatic UI for code entry
- **Secure credential storage** – All secrets (password, API token, share link password) are stored encrypted in Thunderbird's password manager (`nsILoginManager`), never in plain text or `storage.local`
- **Configurable library & folder** – Freely choose the upload target; directories are created automatically
- **Password-protected links** – Share links optionally secured with a password and configurable expiry
- **Compose integration** – Thunderbird's compose window shows expiry dates and password-protection indicators for shared attachments
- **Automatic token renewal** – Expired API tokens are transparently re-acquired via a 3-step strategy (cache → stored token → re-authentication)
- **File lifecycle management** – Uploaded files are deleted from Seafile when removed from the draft; upload aborts are handled gracefully
- **Account cleanup** – All stored credentials are removed when a FileLink account is deleted
- **Dark mode** – Configuration UI adapts to Thunderbird's light/dark theme via `prefers-color-scheme`
- **Fully localized** – English (default) and German; extensible via `_locales`

## Requirements

- **Thunderbird ≥ 128** (ESR, Manifest V3)
- **Seafile server** with API v2.1 (self-hosted or hosted)
- HTTPS is strongly recommended

## Project Structure

```
tb-seafile-filelink/
├── manifest.json                          # Extension manifest (MV3)
├── background.js                          # Service worker: Seafile API, upload logic
├── management.html                        # Configuration UI (cloudFile management)
├── management.js                          # UI logic, form handling
├── management.css                         # Styles (light & dark mode)
├── experiment_apis/
│   └── loginManager/
│       ├── schema.json                    # API schema for nsILoginManager access
│       └── implementation.js              # Privileged code (Experiment API)
├── _locales/
│   ├── en/
│   │   └── messages.json                  # English localization (default)
│   └── de/
│       └── messages.json                  # German localization
├── icons/
│   ├── seafile-16.png                     # Toolbar icon 16px
│   ├── seafile-32.png                     # Toolbar icon 32px
│   └── seafile-64.png                     # Toolbar icon 64px
├── build.sh                               # Build script → produces .xpi
├── .gitignore
└── README.md
```

## Local Development & Building

### Prerequisites

Only `zip` is required (pre-installed on most systems):

```bash
# Debian/Ubuntu
sudo apt install zip

# macOS (via Homebrew, if not already available)
brew install zip

# Windows (Git Bash / WSL usually includes zip)
```

### Build

```bash
# Clone the repository
git clone https://github.com/relexx/tb-seafile-filelink.git
cd tb-seafile-filelink

# Build XPI
./build.sh
```

This produces `seafile-filelink.xpi` in the project directory.

### Manual Build (without script)

```bash
cd tb-seafile-filelink
zip -r ../seafile-filelink.xpi . \
  -x '.git/*' '.gitignore' 'build.sh' 'README.md' '*.xpi'
```

### Installing in Thunderbird (Development)

1. Open Thunderbird
2. **Tools → Add-ons and Themes** (or `Ctrl+Shift+A`)
3. Gear icon → **Install Add-on From File…**
4. Select the generated `seafile-filelink.xpi`

**Alternatively as a temporary add-on (no restart required):**

1. Open Thunderbird
2. **Tools → Developer Tools → Debug Add-ons** (or enter `about:debugging` in the address bar)
3. **Load Temporary Add-on…**
4. Select the `manifest.json` in the project directory (not the .xpi)

> **Note:** Temporary add-ons are removed when Thunderbird restarts. For a permanent installation, use the .xpi file.

## Configuration

After installation, **Seafile** appears as a new FileLink provider under:

**Settings → Compose → Attachments → Outgoing → Add… → Seafile**

In the configuration panel:

1. Enter the **Server URL** (e.g. `https://cloud.example.com`)
2. Enter **Username** and **Password**
3. Click **Test Connection** (if 2FA is enabled, a TOTP field will appear)
4. Select a **Library** and **Upload Folder**
5. Optionally configure a **Link Password** and **Expiry**
6. Click **Save**

## Security Architecture

### Credential Storage

All secrets are stored encrypted in Thunderbird's password manager (`nsILoginManager`) — not in `storage.local`:

| Secret              | LoginManager Realm         | Encrypted |
| ------------------- | -------------------------- | --------- |
| Seafile password    | `Seafile FileLink`         | ✅         |
| API token           | `Seafile FileLink Token`   | ✅         |
| Share link password | `Seafile FileLink SharePW` | ✅         |

Only non-sensitive configuration values are stored in `storage.local` (server URL, repo ID, upload path, expiry days).

### Additional Measures

- **Strict CSP** – MV3 default (`script-src 'self'`), no `eval()`, no inline JavaScript
- **No `innerHTML`** – Exclusively uses `textContent` / `createElement` (XSS prevention)
- **Sender verification** – `onMessage` checks `sender.id` (OWASP recommendation)
- **Action whitelist** – Only explicitly allowed message types are processed
- **Path traversal protection** – `..` segments are stripped from paths
- **Upload link validation** – Hostname comparison against the configured server
- **No secret logging** – Console never contains tokens or passwords
- **Realm whitelist** – Experiment API only accepts defined realms

## Localization

The extension ships with English (default) and German localizations. All user-facing strings are managed via Thunderbird's `i18n` API and stored in `_locales/`. Thunderbird automatically selects the matching language based on the user's locale.

To add a new language, create a folder under `_locales/` (e.g. `_locales/fr/messages.json`) using the English file as a template.

## AI usage transparency

Most of the code was generated by me personally.<br>
However, I used [Claude Code](https://claude.ai/) for some parts during development:
* Generating code comments and the feature description (readme)
* Debugging and correcting code
* Checking the code and structure for compliance with Mozilla Thunderbird Add-On Manifest Version 3
* Generating translations

Please point out any AI slop caused by Claude. I will be happy to fix it.

## Contributing

Contributions are welcome! Whether it's a bug fix, a new feature, or a translation — every contribution helps.

1. **Fork** the repository on GitHub
2. Create a **feature branch** (`git checkout -b feature/my-awesome-improvement`)
3. **Commit** your changes (`git commit -m 'Add some feature'`)
4. **Push** to the branch (`git push origin feature/my-awesome-improvement`)
5. Open a **Pull Request** at [github.com/relexx/tb-seafile-filelink](https://github.com/relexx/tb-seafile-filelink/pulls)

Found a bug or have an idea for improvement? Please open an issue on the [issue tracker](https://github.com/relexx/tb-seafile-filelink/issues).

## Customization Before Publishing

Before publishing your own version on [addons.thunderbird.net](https://addons.thunderbird.net/), you should adjust the following:

1. **Extension ID** in `manifest.json` → set `browser_specific_settings.gecko.id` to your own ID (e.g. `seafile-filelink@your-domain.com`)
2. **Version** – Maintain the version number in `manifest.json`

## License

This project is licensed under the [Mozilla Public License 2.0](LICENSE).