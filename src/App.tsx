import { useEffect } from "react";
import { useRoute, type Route } from "./routes";
import Lobby from "./lobby/Lobby";
import FanHarp from "./instruments/fan-harp/FanHarp";
import CrtDrums from "./instruments/crt-drums/CrtDrums";
import OpenReel from "./instruments/open-reel/OpenReel";

const TITLES: Record<Route, string> = {
  lobby: "真夜中楽器",
  "fan-harp": "真夜中扇風琴",
  "crt-drums": "真夜中ブラウン管",
  "open-reel": "真夜中オープンリール",
};

export default function App() {
  const route = useRoute();
  useEffect(() => { document.title = TITLES[route]; }, [route]);

  if (route === "lobby") return <Lobby />;
  return (
    <div className="wrap">
      <a className="home" href="#" aria-label="ロビーへ戻る" />
      {route === "fan-harp" && <FanHarp title={TITLES[route]} />}
      {route === "crt-drums" && <CrtDrums title={TITLES[route]} />}
      {route === "open-reel" && <OpenReel title={TITLES[route]} />}
    </div>
  );
}
