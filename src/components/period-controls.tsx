"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PERIOD_KINDS, shiftPeriodKey, type PeriodKind } from "@/lib/dates";

interface Props {
  kind: PeriodKind;
  fromKey: string; // início do período atual (para navegar anterior/próximo)
  basePath?: string;
}

export function PeriodControls({ kind, fromKey, basePath = "/" }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function push(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  function shift(dir: -1 | 1) {
    push({ ref: shiftPeriodKey(fromKey, kind, dir) });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
        {PERIOD_KINDS.map((p) => (
          <button
            key={p.value}
            onClick={() => push({ g: p.value, ref: null })}
            className={`px-3 py-1.5 text-sm font-medium transition ${
              kind === p.value ? "bg-seahub-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="inline-flex items-center gap-1">
        <button
          onClick={() => shift(-1)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-slate-600 hover:bg-slate-50"
          aria-label="Período anterior"
        >
          ‹
        </button>
        <button
          onClick={() => push({ ref: null })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Atual
        </button>
        <button
          onClick={() => shift(1)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-slate-600 hover:bg-slate-50"
          aria-label="Próximo período"
        >
          ›
        </button>
      </div>
    </div>
  );
}
