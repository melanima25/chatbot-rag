import { Fragment } from 'react';

/**
 * O modelo costuma terminar a resposta com uma linha só de citações ("[1], [2]"). A lista de
 * fontes logo abaixo já mostra isso, então a linha final vira ruído. Só tira se sobrar texto.
 */
export function semLinhaFinalDeCitacoes(texto: string): string {
  const limpo = texto.replace(/\n+[ \t]*(?:\[\d+\][\s,.;]*)+$/, '').trimEnd();
  return limpo ? limpo : texto;
}

/**
 * Mostra o texto do chatbot e destaca as citações [1], [2]. O texto vira nós de texto do React
 * (nunca HTML), então nada do que o modelo escrever consegue injetar marcação na página.
 */
export function TextoComCitacoes({ texto }: { texto: string }) {
  const partes = texto.split(/(\[\d+\])/g);
  return (
    <>
      {partes.map((parte, i) =>
        /^\[\d+\]$/.test(parte) ? (
          <sup key={i} className="citacao" aria-label={`fonte ${parte.slice(1, -1)}`}>
            {parte}
          </sup>
        ) : (
          <Fragment key={i}>{parte}</Fragment>
        ),
      )}
    </>
  );
}
