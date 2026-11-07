import { useEffect } from "react";
import { useRoute, type Route } from "./routes";
import FanHarp from "./instruments/fan-harp/FanHarp";
import CrtDrums from "./instruments/crt-drums/CrtDrums";
import OpenReel from "./instruments/open-reel/OpenReel";

const TITLES: Record<Route, string> = {
  "fan-harp": "未来の扇風琴",
  "crt-drums": "未来のブラウン管",
  "open-reel": "未来のオープンリール",
};

const NAV: Route[] = ["fan-harp", "crt-drums", "open-reel"];

export default function App() {
  const route = useRoute();
  useEffect(() => { document.title = TITLES[route]; }, [route]);

  return (
    <div className="app">
      <header className="bar">
        <h1>{TITLES[route]}</h1>
        <nav className="nav" aria-label="楽器">
          {NAV.map((r) => (
            <a key={r} href={"#" + r} className={"to-" + r} aria-label={TITLES[r]} aria-current={r === route ? "page" : undefined}><i /></a>
          ))}
        </nav>
      </header>
      {route === "fan-harp" && <FanHarp title={TITLES[route]} />}
      {route === "crt-drums" && <CrtDrums title={TITLES[route]} />}
      {route === "open-reel" && <OpenReel title={TITLES[route]} />}
    </div>
  );
}
