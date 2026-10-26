// not started: see the open-reel plan in docs/handover.md §6
export default function OpenReel({ title }: { title: string }) {
  return <main className="instrument" aria-label={title} />;
}
