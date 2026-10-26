# 真夜中楽器 (mayonaka-gakki)

Playable browser versions of the electromagnetic instruments (電磁楽器) built by Ei Wada.
Each one makes its sound the way the real hardware does.

| Instrument | How it sounds |
|---|---|
| 真夜中扇風琴 — electric fan harp | Light from a bulb flickers through rings of holes in a spinning disc; a pick-shaped light sensor turns the flicker into sound. Pitch = holes × rpm / 60. |
| 真夜中ブラウン管 — CRT TV drums | Your hand picks up each TV's picture line by line. More stripes on screen means a higher note. |
| 真夜中オープンリール — open-reel tape | A tape loop runs across the playback head at whatever speed it moves: grab a reel to scratch it forwards or backwards, tap the tape to knock it against the head, or record onto it from your microphone. |

The interface is in Japanese.

## Development

Requires Node.js 24 or later.

```bash
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest)
npm run build      # typecheck and build to dist/
npm run test:e2e   # browser tests (Playwright) against the build
```

Built with Vite, React and TypeScript. Sound uses the Web Audio API (the tape head runs in an AudioWorklet); the CRT screens use WebGL.

## About

A fan-made project, not affiliated with Ei Wada or ELECTRONICOS FANTASTICOS!.
See [eiwada.com](https://eiwada.com/) for the real instruments.
