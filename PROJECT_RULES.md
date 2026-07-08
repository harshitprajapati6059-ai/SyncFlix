# SyncFlix Project Rules

## Architecture

- Website manages rooms and realtime communication.
- Browser Extension controls video playback.
- Website never directly controls streaming platforms.
- Streaming content is never stored or redistributed.

## Development Principles

- Keep UI minimal.
- Prioritize functionality.
- Avoid unnecessary features.
- Use TypeScript.
- Keep code modular.

## Platform Support

Version 1:
- YouTube

Future:
- Netflix
- Prime Video
- Disney+
- Crunchyroll
- JioHotstar

Each platform must have its own extension adapter.

## Cost Goal

Keep the project free whenever possible.