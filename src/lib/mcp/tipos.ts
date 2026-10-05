import { z } from "zod";

/**
 * O contrato de uma ferramenta do MCP.
 *
 * ⚠ `entrada` é um esquema zod e nada mais. O JSON Schema publicado ao cliente
 * é derivado dele (`esquema.ts`), e a validação da chamada usa o mesmo objeto —
 * então é impossível o que o servidor anuncia divergir do que ele aceita. Foi o
 * primeiro desenho que tentei: escrever o JSON Schema à mão ao lado do zod. Os
 * dois divergem na terceira edição, e a divergência não dá erro de compilação.
 */
export interface ContextoMcp {
  /** "email via MCP (nome do token)" — vai para o rastro de toda chamada. */
  quem: string;
  /** Sempre "MCP". Existe para as funções de escrita serem compartilhadas. */
  origem: "MCP";
  /**
   * A PESSOA dona do token. As escritas atribuem a ela (revisadoPorId,
   * definidoPorId...), do mesmo jeito que a tela atribui ao usuário logado.
   * Só existe token pessoal neste MCP — não há token "sem dono".
   */
  userId: string;
  tokenId: string;
}

export interface Ferramenta<I extends z.ZodTypeAny = z.ZodTypeAny> {
  /** snake_case, como é convenção em MCP. */
  nome: string;
  /** Rótulo curto para a interface do cliente. */
  titulo: string;
  /**
   * O que faz, QUANDO usar e o que NÃO esperar dela.
   *
   * ⚠ É a única documentação que o modelo lê. Descrição que diz só o que a
   * ferramenta faz produz agente que a chama na hora errada; a parte que evita
   * isso é a que diz quando não usar, e qual é a lacuna conhecida.
   */
  descricao: string;
  entrada: I;
  somenteLeitura: boolean;
  /** Apaga ou sobrescreve algo difícil de recuperar. */
  destrutiva?: boolean;
  idempotente?: boolean;
  /** Fala com sistema de terceiro (a API do Conexa). */
  mundoAberto?: boolean;
  executar(args: z.infer<I>, ctx: ContextoMcp): Promise<unknown>;
}

/** Ajuda o TypeScript a inferir `args` sem `as` em cada ferramenta. */
export function ferramenta<I extends z.ZodTypeAny>(f: Ferramenta<I>): Ferramenta {
  // ⚠ O JSON Schema publicado diz `additionalProperties: false`, mas o zod por padrão só
  // DESCARTA campo desconhecido — o servidor anunciava "esquema fechado" e aceitava a
  // chamada mesmo assim, EXECUTANDO-a com o campo inventado ignorado (medido: um
  // `revisar_linha` com campo extra alterou a linha). `.strict()` faz o servidor cumprir
  // o que anuncia: campo que não existe é erro, e o agente lê o motivo e corrige.
  const entrada = f.entrada instanceof z.ZodObject ? f.entrada.strict() : f.entrada;
  return { ...f, entrada } as unknown as Ferramenta;
}
