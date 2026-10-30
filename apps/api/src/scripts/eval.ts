import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../db/client';
import { parseEnv } from '../env';
import { estadoDoCaso, resumir, type ResultadoCaso } from '../eval/avaliar';
import { posicaoDaFonte, tabelaLimiar, type CasoComCandidatos } from '../eval/calibrar';
import { resolverCaminho } from '../eval/caminho';
import { fontesEsperadas, lerCasos } from '../eval/casos';
import { rodarEval } from '../eval/rodar';
import { buscarTrechos } from '../rag/busca';
import { criarProvedor } from '../rag/embeddings';
import { criarLlm } from '../rag/llm';
import { COTA_GRATIS_NEURONS_DIA } from '../custo';

const PADRAO = fileURLToPath(new URL('../../../../evals/perguntas.json', import.meta.url));

function flag(nome: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a === `--${nome}` || a.startsWith(`--${nome}=`));
  if (!arg) return undefined;
  return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : 'true';
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : '-');
const corta = (t: string, n = 170) =>
  t.length > n ? `${t.slice(0, n).replace(/\s+/g, ' ')}…` : t.replace(/\s+/g, ' ');

const env = parseEnv();
const arquivoFlag = flag('arquivo');
const arquivo = arquivoFlag ? resolverCaminho(arquivoFlag) : PADRAO;
let casos = lerCasos(JSON.parse(await readFile(arquivo, 'utf-8')));
const ids = flag('id')?.split(',').map(Number);
if (ids) casos = casos.filter((c) => ids.includes(c.id));
if (!casos.length) throw new Error('Nenhum caso para avaliar (confira --id).');

const { db, close } = createDb(env.DATABASE_URL);
const embeddings = criarProvedor(env);

try {
  if (flag('calibrar')) {
    // Só embeddings (centésimos de neuron): não chama o modelo de texto.
    const comCand: CasoComCandidatos[] = [];
    for (const caso of casos) {
      const r = await buscarTrechos(db, embeddings, caso.pergunta, 10);
      comCand.push({
        caso,
        candidatos: r.map((x) => ({ caminho: x.documentoCaminho, similaridade: x.similaridade })),
      });
    }

    console.log(
      `\nMelhor trecho de cada pergunta e posição do documento esperado (modelo: ${embeddings.modelo})\n`,
    );
    for (const { caso, candidatos } of comCand) {
      const melhor = candidatos[0];
      const fontes = fontesEsperadas(caso).map((f) => {
        const p = posicaoDaFonte(candidatos, f);
        return p
          ? `${f.slice(0, 2)}: #${p.posicao} (${p.similaridade.toFixed(3)})`
          : `${f.slice(0, 2)}: fora do top 10`;
      });
      console.log(
        `${String(caso.id).padStart(3)} ${caso.esperado.padEnd(18)} melhor ${melhor ? melhor.similaridade.toFixed(3) : '-'}  ${fontes.join(' | ')}  ${caso.pergunta.slice(0, 50)}`,
      );
    }

    const limiares = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
    if (!limiares.includes(env.SIMILARIDADE_MINIMA)) limiares.push(env.SIMILARIDADE_MINIMA);
    limiares.sort((a, b) => a - b);
    const linhas = tabelaLimiar(comCand, limiares, env.TOP_K, env.MARGEM_CONTEXTO);
    console.log(
      `\nO que cada limite faria (TOP_K=${env.TOP_K}; margem ${env.MARGEM_CONTEXTO}; limite atual: ${env.SIMILARIDADE_MINIMA})\n`,
    );
    console.log(
      'limite | falsas recusas | vazamentos (fora da base que passam) | documento certo fora do contexto',
    );
    for (const l of linhas) {
      const marca = l.limiar === env.SIMILARIDADE_MINIMA ? ' <- atual' : '';
      console.log(
        `${l.limiar.toFixed(2)}   | ${String(l.falsasRecusas).padStart(2)} de ${l.respostasEsperadas}       | ${String(l.vazamentos).padStart(2)} de ${l.recusasEsperadas}                                  | ${l.fonteForaDoContexto}${marca}`,
      );
    }
    console.log(
      '\nFalsa recusa = o chatbot recusaria uma pergunta que a base responde. Vazamento = uma pergunta fora da base passaria pelo limite e chegaria ao modelo.',
    );
  } else {
    const repeticoes = Math.max(1, Number(flag('repeticoes') ?? 1));
    const llm = criarLlm(env);
    console.log(
      `\nAvaliando ${casos.length} casos x ${repeticoes} (modelo: ${llm.modelo}, limite ${env.SIMILARIDADE_MINIMA}, margem ${env.MARGEM_CONTEXTO}, TOP_K ${env.TOP_K})\n`,
    );

    const mostrar = (rc: ResultadoCaso) => {
      const estado = estadoDoCaso(rc);
      const oks = rc.tentativas.filter((t) => t.veredito.ok).length;
      const icone = estado === 'passou' ? 'OK   ' : estado === 'instavel' ? 'VARIA' : 'FALHA';
      const conhecida = rc.caso.falhaConhecida ? ' (falha conhecida)' : '';
      const cont = repeticoes > 1 ? ` [${oks}/${rc.tentativas.length}]` : '';
      console.log(
        `${icone} ${String(rc.caso.id).padStart(3)}${cont}${conhecida}  ${rc.caso.pergunta}`,
      );
      if (estado !== 'passou') {
        const pior = rc.tentativas.find((t) => !t.veredito.ok);
        if (pior) {
          console.log(`        motivo: ${pior.veredito.falhas.join('; ')}`);
          if (pior.resultado)
            console.log(
              `        resposta (${pior.resultado.tipo}): ${corta(pior.resultado.texto)}`,
            );
        }
      }
    };

    const resultados = await rodarEval({
      db,
      embeddings,
      llm,
      casos,
      repeticoes,
      opcoes: {
        k: env.TOP_K,
        similaridadeMinima: env.SIMILARIDADE_MINIMA,
        margemContexto: env.MARGEM_CONTEXTO,
        maxTokens: env.MAX_TOKENS_RESPOSTA,
      },
      aoTerminarCaso: mostrar,
    });

    const r = resumir(resultados);
    console.log('\n================ RESUMO ================');
    console.log(`Casos: ${r.total} (${r.revisados} revisados por humano)`);
    console.log(
      `Passaram: ${r.passaram} (${pct(r.passaram, r.total)}) | instáveis: ${r.instaveis} | falhas novas: ${r.falhasNovas.length} | falhas conhecidas: ${r.falhasConhecidas.length}`,
    );
    console.log(
      `Perguntas que a base cobre: ${r.respostasEsperadas.certas}/${r.respostasEsperadas.total} execuções certas (${pct(r.respostasEsperadas.certas, r.respostasEsperadas.total)}); recusou sem precisar: ${r.respostasEsperadas.falsasRecusas}`,
    );
    console.log(
      `Perguntas fora da base: ${r.recusasEsperadas.certas}/${r.recusasEsperadas.total} execuções recusadas (${pct(r.recusasEsperadas.certas, r.recusasEsperadas.total)}); respondeu indevidamente: ${r.recusasEsperadas.respostasIndevidas}`,
    );
    console.log(
      `Fonte certa recuperada: ${r.fonte.recuperada}/${r.fonte.total} execuções (${pct(r.fonte.recuperada, r.fonte.total)}); fonte certa citada: ${r.fonte.citada}/${r.fonte.total} (${pct(r.fonte.citada, r.fonte.total)})`,
    );
    console.log(
      `Uso: ${r.tokensEntrada} tokens de entrada, ${r.tokensSaida} de saída, ≈ ${r.neurons.toFixed(1)} neurons (${((r.neurons / COTA_GRATIS_NEURONS_DIA) * 100).toFixed(1)}% da cota do dia)`,
    );
    if (r.falhasNovas.length)
      console.log(`\nFALHAS NOVAS (regressões): casos ${r.falhasNovas.join(', ')}`);
    if (r.conhecidasQuePassam.length)
      console.log(
        `Falhas conhecidas que agora passam (tire a marca "falhaConhecida"): casos ${r.conhecidasQuePassam.join(', ')}`,
      );

    const salvar = flag('salvar');
    if (salvar) {
      const relatorio = {
        data: new Date().toISOString(),
        modeloTexto: llm.modelo,
        modeloEmbedding: embeddings.modelo,
        opcoes: {
          limite: env.SIMILARIDADE_MINIMA,
          margem: env.MARGEM_CONTEXTO,
          topK: env.TOP_K,
          repeticoes,
        },
        resumo: r,
        casos: resultados.map((rc) => ({
          id: rc.caso.id,
          pergunta: rc.caso.pergunta,
          estado: estadoDoCaso(rc),
          tentativas: rc.tentativas.map((t) => ({
            ok: t.veredito.ok,
            falhas: t.veredito.falhas,
            tipo: t.resultado?.tipo ?? null,
            texto: t.resultado?.texto ?? null,
            fontes:
              t.resultado?.fontes.map((f) => ({
                caminho: f.caminho,
                similaridade: Number(f.similaridade.toFixed(3)),
                citada: f.citada,
              })) ?? [],
          })),
        })),
      };
      const destino = resolverCaminho(salvar);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf-8');
      console.log(`\nRelatório salvo em ${destino}`);
    }
    if (r.falhasNovas.length) process.exitCode = 1;
  }
} finally {
  await close();
}
