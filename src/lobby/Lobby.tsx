import "./lobby.css";

// the three machines stand in the room; tap one to walk up to it
export default function Lobby() {
  return (
    <div className="wrap lobby">
      <h1>真夜中楽器</h1>
      <nav className="machines instrument" aria-label="楽器">
        <a className="machine fan" href="#fan-harp" aria-label="真夜中扇風琴"><i className="disc" /><i className="stand" /></a>
        <a className="machine crt" href="#crt-drums" aria-label="真夜中ブラウン管"><i className="tube" /></a>
        <a className="machine reel" href="#open-reel" aria-label="真夜中オープンリール"><i className="spool" /><i className="spool" /></a>
      </nav>
    </div>
  );
}
