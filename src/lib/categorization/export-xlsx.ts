import { buildXlsx, T, H, BRL, BRLB, type Sheet } from "@/lib/xlsx/writer";
import { sum, roundMoney, toAmountString } from "@/lib/money";

/** Formato mínimo necessário para gerar a planilha — compatível com o retorno do Prisma. */
export interface ExportableLine {
  crConexaId: number;
  unidade: string | null;
  faturamento: string | null;
  clienteConexaId: number | null;
  cpfCnpj: string | null;
  razaoSocial: string | null;
  planoContratado: string | null;
  categoria: string;
  proporcionado: string;
  tipo: string | null;
  status: string | null;
  parcela: string | null;
  valorRecebidoCat: unknown; // Prisma.Decimal
  valorRecebidoTotal: unknown;
  valorBruto: unknown;
  valorDesconto: unknown;
  vencimento: Date | null;
  quitacao: Date | null;
  competencia: Date | null;
  emissao: Date | null;
  dataCredito: Date | null;
  conta: string | null;
  observacoes: string | null;
  tags: string | null;
}

const HEADER = [
  "ID",
  "Unidade",
  "Faturamento",
  "ID Cliente",
  "CPF/CNPJ",
  "Razão Social Cliente",
  "Plano(s) Contratado(s)",
  "Categoria",
  "Proporcionado",
  "Tipo",
  "Status",
  "Parcela",
  "Valor Recebido Cat.",
  "Valor Recebido Total",
  "Valor Bruto",
  "Valor Desconto",
  "Vencimento",
  "Quitação",
  "Competência",
  "Emissão",
  "Data Crédito",
  "Conta",
  "Observações",
  "Tags",
];

function formatDate(d: Date | null): string {
  if (!d) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

export function buildCategorizationXlsx(linhas: ExportableLine[]): Buffer {
  const sheet: Sheet = {
    name: "Categorizacao",
    colWidths: HEADER.map(() => 18),
    rows: [
      HEADER.map((h) => H(h)),
      ...linhas.map((l) => [
        T(l.crConexaId),
        T(l.unidade ?? ""),
        T(l.faturamento ?? ""),
        T(l.clienteConexaId ?? ""),
        T(l.cpfCnpj ?? ""),
        T(l.razaoSocial ?? ""),
        T(l.planoContratado ?? ""),
        T(l.categoria),
        T(l.proporcionado),
        T(l.tipo ?? ""),
        T(l.status ?? ""),
        T(l.parcela ?? ""),
        BRL(String(l.valorRecebidoCat)),
        BRL(String(l.valorRecebidoTotal)),
        BRL(String(l.valorBruto ?? "0")),
        BRL(String(l.valorDesconto ?? "0")),
        T(formatDate(l.vencimento)),
        T(formatDate(l.quitacao)),
        T(formatDate(l.competencia)),
        T(formatDate(l.emissao)),
        T(formatDate(l.dataCredito)),
        T(l.conta ?? ""),
        T(l.observacoes ?? ""),
        T(l.tags ?? ""),
      ]),
      [
        ...Array(12).fill(T("")),
        BRLB(toAmountString(roundMoney(sum(linhas.map((l) => String(l.valorRecebidoCat)))))),
        BRLB(""),
        ...Array(10).fill(T("")),
      ],
    ],
  };

  return buildXlsx([sheet]);
}
