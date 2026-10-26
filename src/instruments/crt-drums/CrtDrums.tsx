// port pending: reference/crt-drums.html
export default function CrtDrums({ title }: { title: string }) {
  return (
    <main className="instrument" aria-label={title}>
      <h1>{title}</h1>
    </main>
  );
}
