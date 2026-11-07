# 未来の楽器 (mayonaka-gakki)

Playable browser versions of the electromagnetic instruments (電磁楽器) built by Ei Wada.
Each one makes its sound the way the real hardware does.

| Instrument | How it sounds |
|---|---|
| 未来の扇風琴 — electric fan harp | Light from a bulb flickers through rings of holes in a spinning disc; a pick-shaped light sensor turns the flicker into sound. Pitch = holes × rpm / 60. |
| 未来のブラウン管 — CRT TV drums | Your hand picks up each TV's picture line by line. More stripes on screen means a higher note. |
| 未来のオープンリール — open-reel tape | Set up the Open Reel Ensemble way: an upright deck with one reel; the tape runs down past the heads and out of the box to a lever. Swing the lever to drag the tape across the head and back; let go and it springs back to rest, leaving the tape where it was, so each push moves you along. Or record onto it from your microphone. |

The interface is in Japanese.

## Development

Requires Node.js 24 or later.

```bash
npm install
npm run dev        # dev server
npm run dev:lan    # HTTPS on your network, for trying it on a phone
npm test           # unit tests (Vitest)
npm run build      # typecheck and build to dist/
npm run test:e2e   # browser tests (Playwright) against the build
```

Built with Vite, React and TypeScript. Sound uses the Web Audio API (the tape head runs in an AudioWorklet); the CRT screens use WebGL.

## About

A fan-made project, not affiliated with Ei Wada or ELECTRONICOS FANTASTICOS!.
See [eiwada.com](https://eiwada.com/) for the real instruments.
