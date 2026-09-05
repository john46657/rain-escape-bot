import type { ReactNode } from 'react';

export function Card({ title, action, children, className = '' }: {
  title?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <header className="card-header">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, tone = 'default' }: {
  label: string; value: string | number; hint?: string; tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    default: 'text-slate-100',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  } as const;
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`badge ${className || 'bg-base-700 text-slate-300'}`}>{children}</span>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-base-700 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-base-700/70">
            {head.map((label) => (
              <th key={label} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-base-800">{children}</tbody>
      </table>
    </div>
  );
}
