// port pending: reference/fan-harp.html
export default function FanHarp({ title }: { title: string }) {
  return (
    <main className="instrument" aria-label={title}>
      <h1>{title}</h1>
    </main>
  );
}
