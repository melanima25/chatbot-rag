/**
 * Leitura de Markdown e divisão em trechos para a busca.
 *
 * Regras (cobertas por testes):
 *  - parágrafos inteiros sempre que couberem; um título nunca fica sozinho no fim de um trecho;
 *  - parágrafo maior que o limite é quebrado por linha, depois por frase, depois por palavra;
 *  - nunca corta no meio de uma palavra (só em palavra maior que o próprio limite, caso absurdo);
 *  - cada trecho (menos o primeiro) começa repetindo o final do anterior, para não perder contexto.
 */

export type DocumentoLido = { titulo: string; corpo: string };

export type OpcoesDivisao = {
  /** Tamanho máximo de cada trecho, sem contar a sobreposição. */
  maxCaracteres?: number;
  /** Quanto do final do trecho anterior é repetido no começo do próximo. */
  sobreposicao?: number;
};

export const MAX_CARACTERES_PADRAO = 700;
export const SOBREPOSICAO_PADRAO = 100;

/** Troca CRLF por LF: o mesmo arquivo tem o mesmo hash no Windows e no Linux. */
export const normalizarQuebras = (texto: string): string => texto.replace(/\r\n?/g, '\n');

/** Extrai o título (frontmatter `titulo:`, senão o primeiro `# Título`, senão o nome do arquivo). */
export function lerMarkdown(bruto: string, nomeArquivo: string): DocumentoLido {
  const texto = normalizarQuebras(bruto);
  let corpo = texto;
  let titulo: string | undefined;

  const frontmatter = /^---\n([\s\S]*?)\n---\n?/.exec(texto);
  if (frontmatter) {
    corpo = texto.slice(frontmatter[0].length);
    const linha = /^titulo:\s*(.+)$/m.exec(frontmatter[1] ?? '');
    if (linha?.[1]) titulo = linha[1].trim().replace(/^["']|["']$/g, '');
  }
  corpo = corpo.trim();

  if (!titulo) titulo = /^#\s+(.+)$/m.exec(corpo)?.[1]?.trim();
  return { titulo: titulo || nomeArquivo.replace(/\.md$/i, ''), corpo };
}

/** Divide mantendo o separador no fim de cada pedaço (nada se perde ao juntar de novo). */
function dividirMantendo(texto: string, separador: string): string[] {
  const partes = texto.split(separador);
  return partes.map((p, i) => (i < partes.length - 1 ? p + separador : p));
}

const SEPARADORES = ['\n\n', '\n', '. ', ' '] as const;

function empacotar(partes: string[], max: number): string[] {
  const saida: string[] = [];
  let atual = '';
  for (const parte of partes) {
    if (atual && (atual + parte).trimEnd().length > max) {
      saida.push(atual);
      atual = parte;
    } else {
      atual += parte;
    }
  }
  if (atual) saida.push(atual);
  return saida;
}

function quebrar(texto: string, max: number, nivel = 0): string[] {
  if (texto.trimEnd().length <= max) return [texto];
  const separador = SEPARADORES[nivel];
  if (separador === undefined) {
    // palavra maior que o limite: corte duro (não acontece em texto normal)
    const pedacos: string[] = [];
    for (let i = 0; i < texto.length; i += max) pedacos.push(texto.slice(i, i + max));
    return pedacos;
  }
  const partes = dividirMantendo(texto, separador).flatMap((p) => quebrar(p, max, nivel + 1));
  return empacotar(partes, max);
}

const ehSoTitulo = (bloco: string): boolean => /^#{1,6}\s[^\n]*\n*$/.test(bloco);

/** Cola cada título ao bloco seguinte, para ele nunca ficar sozinho. */
function colarTitulos(blocos: string[]): string[] {
  const saida: string[] = [];
  let pendente = '';
  for (const bloco of blocos) {
    if (ehSoTitulo(bloco)) {
      pendente += bloco;
    } else {
      saida.push(pendente + bloco);
      pendente = '';
    }
  }
  if (pendente) saida.push(pendente);
  return saida;
}

/** Final do trecho anterior, começando no início de uma palavra. */
function cauda(texto: string, tamanho: number): string {
  if (tamanho <= 0 || texto.length <= tamanho) return '';
  const fim = texto.slice(-tamanho);
  const espaco = fim.search(/\s/);
  return espaco === -1 ? '' : fim.slice(espaco).trim();
}

export function dividirEmTrechos(corpo: string, opcoes: OpcoesDivisao = {}): string[] {
  const max = opcoes.maxCaracteres ?? MAX_CARACTERES_PADRAO;
  const sobreposicao = opcoes.sobreposicao ?? SOBREPOSICAO_PADRAO;
  if (max < 50) throw new Error('maxCaracteres deve ser pelo menos 50');
  if (sobreposicao < 0 || sobreposicao >= max)
    throw new Error('sobreposicao deve ser menor que maxCaracteres');

  const texto = normalizarQuebras(corpo).trim();
  if (!texto) return [];

  const blocos = colarTitulos(dividirMantendo(texto, '\n\n'));
  const base = empacotar(
    blocos.flatMap((b) => quebrar(b, max)),
    max,
  )
    .map((t) => t.trim())
    .filter(Boolean);

  return base.map((t, i) => {
    const anterior = i > 0 ? cauda(base[i - 1] ?? '', sobreposicao) : '';
    return anterior ? `${anterior}\n\n${t}` : t;
  });
}

/** Estimativa de tokens (4 caracteres por token). Serve só para ter uma ordem de grandeza. */
export const estimarTokens = (texto: string): number => Math.ceil(texto.length / 4);
