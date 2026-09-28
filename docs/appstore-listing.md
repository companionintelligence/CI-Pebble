# Rebble store listing

Paste-ready copy for the [Rebble Developer Portal](https://dev-portal.rebble.io/) watchapp form. Field
names follow Rebble's [publishing guide](https://developer.rebble.io/guides/appstore-publishing/publishing-an-app/).
The words are proposed copy for you to review. Voice follows the CI-Common brand canon.

## Assets

| Field | File |
|---|---|
| Small icon | [`assets/appstore/icon/icon-48.png`](../assets/appstore/icon/icon-48.png) or `icon-96.png` |
| Large icon | [`assets/appstore/icon/icon-144.png`](../assets/appstore/icon/icon-144.png) |
| Light variant, 512 px master | `icon-light-512.png`, `icon-512.png` |
| Black and white icon (Aplite) | `icon-mono-48.png`, `icon-mono-96.png` |
| Screenshots, per platform | `assets/appstore/screenshots/<platform>-0{1,2,3,4}-*.png` |

The icons are built from the CI-Common brand bundle by `scripts/render-icons.mjs`. The screenshots are real
captures of the running app on the Pebble emulator, made by `scripts/emulator-shots.sh` (main menu, Ask list,
an answer, an error). Diorite shares Basalt's panel size but has its own set. Nothing is drawn by hand.

## Listing copy

**Title**
```
Companion Memory
```

**Source code URL**
```
https://github.com/companionintelligence/CI-Pebble
```

**Category.** Pick Tools & Utilities if the portal offers it. The portal's own list is the source of truth.

**Platforms.** All five: Aplite, Basalt, Chalk, Diorite, Emery.

**Teaser**
```
Your AI remembers, because it's yours. Recall and ask your Memory from your wrist.
```

**Description** (under the 1600 character limit)
```
Companion Memory puts the Memory you host on your wrist.

Recall: the latest from your Memory in one press.
Ask: pick a question, or speak your own on watches with a microphone. Your Memory searches what you saved and returns the lines that match. The answer buzzes your wrist.
Last answer: your most recent answer stays on the watch, so it is there offline.
Connection check: after you save settings, your phone tells you what works.

How it works: the watch talks to your phone. Your phone makes one authenticated HTTPS call to the Memory URL you enter. It does not use a relay or an account, and it has no analytics.

Set up in four steps:
1. In Companion Memory, create an API key with the memory scope.
2. Install this app.
3. Open its settings in the Pebble phone app.
4. Enter your Memory URL and the key, and save.

Optional location sync sends one location sample every 15 minutes to your Memory. It is off until you turn it on. Registering the watch and location sync need an unrestricted key. Recall and Ask work with a memory-scoped key.

Speaking a question uses Pebble Dictation, which is a cloud speech service. The audio goes to the speech service your Pebble platform uses, not to this app and not to your Memory. Picking a listed question sends no audio anywhere.

Needs a running Companion Memory: https://github.com/companionintelligence/CI-Server
Source, exact API calls and roadmap: https://github.com/companionintelligence/CI-Pebble
```

**Banner and header images.** Optional, and not generated here. Rebble's
[asset templates](https://developer.rebble.io/guides/appstore-publishing/appstore-assets/) apply.

## Privacy and permissions

- **Location.** Used only for the optional sync to your own Memory. Off by default. Skipped when permission is denied.
- **Configuration.** Memory URL and API key, stored on your phone.
- **Speech.** Pebble Dictation is a cloud service. See the description above.
- No health data, no contacts, no other capabilities.

## Release notes

```
1.0: Recall, Ask, Last answer, a connection check in settings, optional location sync.
```
