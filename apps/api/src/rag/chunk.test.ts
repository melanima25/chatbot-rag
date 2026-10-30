import { describe, expect, it } from 'vitest';
import { dividirEmTrechos, estimarTokens, lerMarkdown } from './chunk';

const palavras = (t: string) => t.split(/\s+/).filter(Boolean);

describe('lerMarkdown', () => {
  it('pega o título do frontmatter e tira o frontmatter do corpo', () => {
    const r = lerMarkdown('---\ntitulo: Horário de funcionamento\n---\n# Outro\n\nTexto.', 'x.md');
    expect(r.titulo).toBe('Horário de funcionamento');
    expect(r.corpo.startsWith('# Outro')).toBe(true);
    expect(r.corpo).not.toContain('titulo:');
  });

  it('aceita aspas no título e quebras de linha do Windows (CRLF)', () => {
    const r = lerMarkdown('---\r\ntitulo: "Preços"\r\n---\r\nTexto\r\nmais', 'x.md');
    expect(r.titulo).toBe('Preços');
    expect(r.corpo).toBe('Texto\nmais');
  });

  it('sem frontmatter usa o primeiro "# Título"; sem nada, o nome do arquivo', () => {
    expect(lerMarkdown('# Meu título\n\ncorpo', 'a.md').titulo).toBe('Meu título');
    expect(lerMarkdown('só texto', 'faq-geral.md').titulo).toBe('faq-geral');
  });
});

describe('dividirEmTrechos', () => {
  it('texto vazio não gera trecho', () => {
    expect(dividirEmTrechos('')).toEqual([]);
    expect(dividirEmTrechos('  \n\n ')).toEqual([]);
  });

  it('texto curto vira um único trecho', () => {
    expect(dividirEmTrechos('Abrimos às 8h.')).toEqual(['Abrimos às 8h.']);
  });

  it('respeita o tamanho máximo (sem a sobreposição) e não perde nenhuma palavra', () => {
    const frase =
      'O lava jato atende carros de passeio, SUVs, pickups e motos todos os dias úteis. ';
    const texto = Array.from({ length: 30 }, () => frase).join('') + '\n\nFim do texto final.';
    const trechos = dividirEmTrechos(texto, { maxCaracteres: 200, sobreposicao: 0 });
    expect(trechos.length).toBeGreaterThan(5);
    for (const t of trechos) expect(t.length).toBeLessThanOrEqual(200);
    expect(trechos.join(' ').replace(/\s+/g, ' ')).toBe(texto.replace(/\s+/g, ' ').trim());
  });

  it('nunca corta no meio de uma palavra', () => {
    const texto = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(' ');
    const originais = new Set(palavras(texto));
    const trechos = dividirEmTrechos(texto, { maxCaracteres: 90, sobreposicao: 30 });
    for (const t of trechos) for (const p of palavras(t)) expect(originais.has(p)).toBe(true);
  });

  it('o trecho seguinte repete o final do anterior (sobreposição)', () => {
    const texto = Array.from({ length: 60 }, (_, i) => `termo${i}`).join(' ');
    const [a, b] = dividirEmTrechos(texto, { maxCaracteres: 120, sobreposicao: 40 });
    const ultimas = palavras(a ?? '').slice(-2);
    expect(b).toContain(ultimas.join(' '));
  });

  it('a sobreposição começa no início de uma linha: lista sem pontuação nunca fica com fragmento no começo', () => {
    // Sem ponto final de propósito: assim só a regra de "início de linha" salva o trecho de um fragmento.
    const linhas = Array.from(
      { length: 12 },
      (_, i) => `- Polimento, porte ${i} (sedã médio, SUV compacto): R$ ${100 + i}`,
    );
    const trechos = dividirEmTrechos(linhas.join('\n'), { maxCaracteres: 300, sobreposicao: 100 });
    expect(trechos.length).toBeGreaterThan(1);
    for (const t of trechos) {
      for (const linha of t.split('\n').filter(Boolean)) {
        expect(linha).toMatch(/^- Polimento, porte \d+ \(sedã médio, SUV compacto\): R\$ \d+$/);
      }
    }
  });

  it('em texto corrido a sobreposição começa no início de uma frase', () => {
    const texto =
      'Primeira frase longa sobre o assunto principal do documento aqui. ' +
      'Segunda frase também comprida falando de outra coisa bem diferente agora. ' +
      'Terceira frase final que encerra o trecho com bastante conteúdo útil. ' +
      'Quarta frase que já pertence ao trecho seguinte do documento todo.';
    const [a, b] = dividirEmTrechos(texto, { maxCaracteres: 150, sobreposicao: 90 });
    expect(a).toBeDefined();
    const inicioDoSeguinte = (b ?? '').split('\n\n')[0] ?? '';
    expect(/^[A-ZÁÉÍÓÚ]/.test(inicioDoSeguinte)).toBe(true);
  });

  it('mantém parágrafos inteiros quando cabem e o título junto do parágrafo seguinte', () => {
    const texto =
      '# Pagamento\n\nAceitamos Pix e dinheiro.\n\n## Cartão\n\nCrédito em até 3 vezes.';
    const trechos = dividirEmTrechos(texto, { maxCaracteres: 60, sobreposicao: 0 });
    expect(trechos).toEqual([
      '# Pagamento\n\nAceitamos Pix e dinheiro.',
      '## Cartão\n\nCrédito em até 3 vezes.',
    ]);
  });

  it('um título nunca fica sozinho no fim de um trecho', () => {
    const texto = `${'a'.repeat(40)}\n\n## Título solto\n\n${'b'.repeat(40)}`;
    const trechos = dividirEmTrechos(texto, { maxCaracteres: 60, sobreposicao: 0 });
    expect(trechos.some((t) => t.endsWith('## Título solto'))).toBe(false);
    expect(trechos.some((t) => t.startsWith('## Título solto'))).toBe(true);
  });

  it('tabela maior que o limite é quebrada por linha, sem cortar linha ao meio', () => {
    const linhas = Array.from({ length: 12 }, (_, i) => `| Serviço ${i} | R$ ${i * 10} |`);
    const trechos = dividirEmTrechos(linhas.join('\n'), { maxCaracteres: 80, sobreposicao: 0 });
    expect(trechos.length).toBeGreaterThan(1);
    for (const t of trechos) for (const l of t.split('\n')) expect(linhas).toContain(l);
  });

  it('é determinístico', () => {
    const texto = Array.from({ length: 50 }, (_, i) => `Frase número ${i}. `).join('');
    expect(dividirEmTrechos(texto)).toEqual(dividirEmTrechos(texto));
  });

  it('recusa parâmetros inválidos', () => {
    expect(() => dividirEmTrechos('x', { maxCaracteres: 10 })).toThrow();
    expect(() => dividirEmTrechos('x', { maxCaracteres: 100, sobreposicao: 100 })).toThrow();
  });
});

describe('estimarTokens', () => {
  it('usa 4 caracteres por token, arredondando para cima', () => {
    expect(estimarTokens('abcd')).toBe(1);
    expect(estimarTokens('abcde')).toBe(2);
  });
});
