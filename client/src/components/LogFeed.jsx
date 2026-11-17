export default function LogFeed({ logs, onClear }) {
  return (
    <section className="panel feed-panel">
      <div className="feed-head">
        <h2>Live responses</h2>
        <button className="quiet" onClick={onClear} disabled={!logs.length}>Clear</button>
      </div>
      <ol className="feed" aria-live="polite">
        {logs.length === 0 && <li className="empty">Nothing yet. Send a claim to see the gateway's answer here.</li>}
        {logs.map((l) => (
          <li key={l.id} className={l.tone}>
            <time>{l.time}</time>
            <span>{l.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
