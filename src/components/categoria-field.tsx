"use client";

import { useState } from "react";

/**
 * Campo de categoria: escolhe uma das já existentes OU digita uma nova.
 *
 * A maioria dos itens é categorizada com uma categoria que já existe, então a
 * lista é o caminho padrão — digitar à mão convidava a erro de digitação, e
 * como os relatórios agrupam por string exata, um "Serviços de Espaço " com
 * espaço sobrando vira uma categoria separada no Panorama.
 *
 * `<select>` nativo em vez de combobox próprio: já vem com navegação por
 * teclado, busca por digitação e suporte a leitor de tela, e o mobile abre o
 * seletor do sistema. Ao escolher "Outra…", o select é DESMONTADO e o input
 * assume o mesmo `name` — só um dos dois existe no DOM por vez, então nunca há
 * dois valores concorrendo no submit.
 */

const OUTRA = "__outra__";

export function CategoriaField({
  categorias,
  id,
  label = "Categoria",
  defaultValue,
  name = "categoria",
}: {
  categorias: string[];
  id: string;
  label?: string;
  defaultValue?: string;
  name?: string;
}) {
  // Valor que não está na lista (ex.: categoria antiga já gravada numa linha)
  // precisa abrir direto em modo texto, senão o select silenciosamente trocaria
  // o valor da linha ao salvar.
  const [manual, setManual] = useState(
    Boolean(defaultValue) && !categorias.includes(defaultValue as string),
  );

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>

      {manual ? (
        <div className="flex items-center gap-2">
          <input
            className="input"
            id={id}
            name={name}
            defaultValue={defaultValue}
            placeholder="Nome da nova categoria"
            required
            autoFocus
          />
          {categorias.length > 0 ? (
            <button
              type="button"
              className="btn-secondary whitespace-nowrap px-2 py-1 text-xs"
              onClick={() => setManual(false)}
            >
              Ver lista
            </button>
          ) : null}
        </div>
      ) : (
        <select
          className="input"
          id={id}
          name={name}
          defaultValue={defaultValue ?? ""}
          required
          onChange={(e) => {
            if (e.target.value === OUTRA) setManual(true);
          }}
        >
          <option value="" disabled>
            Selecione uma categoria…
          </option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={OUTRA}>Outra… (digitar)</option>
        </select>
      )}
    </div>
  );
}
