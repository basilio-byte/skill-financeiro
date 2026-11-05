import { Card, SectionTitle } from "@/components/ui";
import { Selo } from "@/components/selo";
import { APP_TZ } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { ultimasExportacoes } from "@/lib/exportacao/log";
import { CONJUNTOS } from "@/lib/exportacao/conjuntos";

/**
 * Histórico das exportações (ADR-0035) — só para administrador. Quem baixou o quê, com que filtros e quanto saiu;
 * o que tem dado pessoal fica marcado. Só LEITURA da tabela de log.
 */
export async function HistoricoExportacoes() {
  const linhas = await ultimasExportacoes(15);
  const titulo = (id: string) => CONJUNTOS.find((c) => c.id === id)?.titulo ?? id;
  return (
    <Card className="overflow-x-auto">
      <SectionTitle hint="15 mais recentes · só admin">Histórico de exportações</SectionTitle>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-2 pr-4">Quando</th>
            <th className="pb-2 pr-4">Quem</th>
            <th className="pb-2 pr-4">Conjunto</th>
            <th className="pb-2 pr-4 text-right">Linhas</th>
            <th className="pb-2 pr-4 text-right">Valor</th>
            <th className="pb-2 pr-4">Dados pessoais</th>
            <th className="pb-2 pr-4">Resultado</th>
            <th className="pb-2">Filtros</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="border-t border-slate-100 align-top">
              <td className="tabular py-2 pr-4 whitespace-nowrap">{l.quando.toLocaleString("pt-BR", { timeZone: APP_TZ })}</td>
              <td className="py-2 pr-4">{l.quem}</td>
              <td className="py-2 pr-4">
                {titulo(l.conjunto)} <span className="text-xs text-slate-400">.{l.formato}</span>
              </td>
              <td className="tabular py-2 pr-4 text-right">{l.resultado === "ok" ? l.linhas.toLocaleString("pt-BR") : "—"}</td>
              <td className="tabular py-2 pr-4 text-right">{l.total !== null ? formatBRL(l.total) : "—"}</td>
              <td className="py-2 pr-4">{l.dadosPessoais ? <Selo tom="atencao">Sim</Selo> : <span className="text-slate-400">não</span>}</td>
              <td className="py-2 pr-4">
                <Selo tom={l.resultado === "ok" ? "bom" : l.resultado === "recusada" || l.resultado === "cancelada" ? "atencao" : "critico"}>
                  {l.resultado === "ok" ? "Entregue" : l.resultado === "recusada" ? "Recusada" : l.resultado === "cancelada" ? "Cancelada" : "Falhou"}
                </Selo>
              </td>
              <td className="min-w-[16rem] max-w-md py-2 text-xs text-slate-500">
                <span className="break-words">{l.erro ?? l.resumoFiltros ?? "—"}</span>
              </td>
            </tr>
          ))}
          {linhas.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-6 text-center text-slate-400">
                Nenhuma exportação registrada ainda.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Card>
  );
}
