import "server-only";
import type { Ferramenta } from "./tipos";
import { ferramentasDeConsulta } from "./ferramentas/consulta";
import { ferramentasDeSistema } from "./ferramentas/sistema";
import { ferramentasDeEscrita } from "./ferramentas/escrita";

/**
 * O catálogo completo de ferramentas do MCP.
 *
 * ⚠ A checagem de nome duplicado roda na importação do módulo, de propósito. Duas
 * ferramentas com o mesmo nome não dão erro em lugar nenhum: o `find` do despacho pega
 * a primeira e a segunda nunca é chamada — um bug que aparece como "essa ferramenta
 * não faz nada" meses depois. Melhor o processo não subir.
 */
function montar(): Ferramenta[] {
  const todas = [...ferramentasDeConsulta, ...ferramentasDeSistema, ...ferramentasDeEscrita];
  const vistos = new Set<string>();
  for (const f of todas) {
    if (vistos.has(f.nome)) throw new Error(`Ferramenta de MCP duplicada: "${f.nome}". Nomes precisam ser únicos.`);
    vistos.add(f.nome);
  }
  return todas;
}

export const FERRAMENTAS: Ferramenta[] = montar();

export const RESUMO_DAS_FERRAMENTAS = FERRAMENTAS.map((f) => ({
  nome: f.nome,
  titulo: f.titulo,
  escreve: !f.somenteLeitura,
  destrutiva: f.destrutiva ?? false,
  falaComTerceiro: f.mundoAberto ?? false,
}));
