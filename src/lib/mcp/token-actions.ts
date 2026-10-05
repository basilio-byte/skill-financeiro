"use server";
import { revalidatePath } from "next/cache";
import type { EscopoToken } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { criarTokenMcp, revogarTokenMcp } from "./tokens";

/**
 * Ações da tela Minha conta para os tokens do MCP.
 *
 * ⚠ O token em texto só sai daqui UMA vez, na resposta da criação. Não há ação de
 * "ver token de novo": o banco guarda só o hash e nem o sistema sabe qual é.
 */
export async function acaoCriarTokenMcp(nome: string, escopo: EscopoToken) {
  const u = await requireUser();
  if (escopo !== "LEITURA" && escopo !== "ESCRITA") throw new Error("Escopo inválido.");
  const r = await criarTokenMcp({ userId: u.id, nome, escopo });
  revalidatePath("/minha-conta");
  return { token: r.token, nome: r.registro.nome, escopo: r.registro.escopo };
}

export async function acaoRevogarTokenMcp(id: string) {
  const u = await requireUser();
  await revogarTokenMcp({ id, quem: u.email, userId: u.id, ehAdmin: u.role === "ADMIN" });
  revalidatePath("/minha-conta");
}
