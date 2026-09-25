export function Footer({ sourceKind }: { sourceKind: 'api' | 'demo' }) {
  return (
    <footer className="footer">
      <span>
        <strong>Demo project / Демо-проект.</strong> Pulse and all site names are fictional
        {sourceKind === 'demo' ? '; data is synthetic and generated in your browser.' : '.'}
      </span>
      <span>
        Built by <a href="https://github.com/sinnercode228">sinnercode228</a> ·{' '}
        <a href="https://t.me/sinnercode">@sinnercode</a> · Press <kbd>?</kbd> for shortcuts
      </span>
    </footer>
  );
}
