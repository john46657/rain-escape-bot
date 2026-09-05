'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface TrendPoint {
  bucket: string;
  metrics: Record<string, number>;
}

/** Zeitreihe fuer Analytics-Kennzahlen. */
export function TrendChart({ series, metric, label }: { series: TrendPoint[]; metric: string; label: string }) {
  const data = series.map((point) => ({
    date: new Date(point.bucket).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
    value: point.metrics[metric] ?? 0,
  }));

  if (data.length === 0) {
    return <p className="py-10 text-center text-xs text-slate-600">Noch keine Zeitreihe vorhanden.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5865f2" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#5865f2" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1f2433" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" stroke="#4b5568" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis stroke="#4b5568" fontSize={11} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          contentStyle={{ background: '#10131c', border: '1px solid #1f2433', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#94a3b8' }}
          formatter={(value: number) => [value.toLocaleString('de-DE'), label]}
        />
        <Area type="monotone" dataKey="value" stroke="#7983f5" strokeWidth={2} fill={`url(#gradient-${metric})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
