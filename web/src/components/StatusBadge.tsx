import type { MonitorStatus } from '@pulse/core';

const TEXT: Record<MonitorStatus, string> = {
  up: 'Up',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Pending',
};

export function StatusBadge({ status }: { status: MonitorStatus }) {
  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {TEXT[status]}
    </span>
  );
}
