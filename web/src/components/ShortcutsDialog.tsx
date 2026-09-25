import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../lib/shortcuts';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="kbd-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <h2 id="kbd-title">Keyboard shortcuts</h2>
      <dl className="shortcuts">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k}>
            <dt>
              {k.split(' / ').map((part, i) => (
                <span key={part}>
                  {i > 0 && ' / '}
                  <kbd>{part}</kbd>
                </span>
              ))}
            </dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="btn btn--sm" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}
