# Companion Memory for Pebble: product video storyboard

> **Private & Confidential, Property of Lifescope Inc. Do not distribute.**

`storyboard.json` is the whole film: copy, narration and structure. Both cuts (16:9 and 9:16) are
built from it with the `ci-video` kit (video-kit 0.35.0). Videos are build output and are not committed.

## Footage honesty

- Every picture is a real capture of the running app on the **Pebble emulator**, taken by
  `scripts/emulator-shots.sh` and committed as `assets/appstore/screenshots/`. They are copied here
  unchanged apart from an integer 4x nearest-neighbour enlargement (`assets/plates/`), so the 144 px
  panels stay sharp instead of being smoothed by the renderer.
- The memory lines in the answer shot (for example "Ada Lovelace: mathematician") are **sample
  data** from the emulator run, not a real person's Memory. Every frame carries the pill
  "Emulator captures, sample data. No watch footage." (`meta.label`).
- **Hardware-footage gap:** there is no footage of a physical Pebble on a wrist, and none is implied.
  Add it as a `clip` scene when it exists.
- Copy comes from `README.md` and `docs/appstore-listing.md`. The app is not published
  (`release: not published`), so the film does not say it is available in the Rebble store.

## Rebuild

```bash
KIT=<CI-Common checkout at origin/main>/packages/video-kit
node --experimental-strip-types $KIT/bin/ci-video.ts narrate    # only scenes with no mp3
node --experimental-strip-types $KIT/bin/ci-video.ts build && ... check && ... render
```

Changing a `narration` line leaves the old mp3: run `ci-video narrate --stale`.
