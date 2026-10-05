"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHROME, TOTAL_RECEBIDO } from "@/lib/viz/palette";
import { formatBRL, formatBRLCompact } from "@/lib/money";

export interface PeriodPoint {
  key: string;
  label: string;
  total: number;
}

/**
 * Total recebido por rodada — série ÚNICA (uma matiz, sem legenda: o título já
 * nomeia a série). Grade e eixos hairline recessivos; tooltip no hover; os
 * mesmos valores estão na tabela gêmea do ChartCard.
 */
export function PeriodBarChart({ data, height = 240 }: { data: PeriodPoint[]; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} barCategoryGap="24%">
          <CartesianGrid stroke={CHROME.gridline} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: CHROME.muted }}
            tickLine={false}
            axisLine={{ stroke: CHROME.axis }}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v: number) => formatBRLCompact(v)}
            tick={{ fontSize: 11, fill: CHROME.muted, fontVariant: "tabular-nums" }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            cursor={{ fill: "rgb(var(--slate-400) / 0.12)" }}
            formatter={(value: number) => [formatBRL(value), "Total recebido"]}
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${CHROME.gridline}`,
              fontSize: 12,
              color: CHROME.textPrimary,
              backgroundColor: CHROME.surface,
              boxShadow: "var(--sombra-2)",
            }}
          />
          <Bar dataKey="total" name="Total recebido" fill={TOTAL_RECEBIDO} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
