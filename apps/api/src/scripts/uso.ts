import { count, sql } from 'drizzle-orm';
import { createDb, schema } from '../db/client';
import { COTA_GRATIS_NEURONS_DIA, neuronsDe } from '../custo';
import { parseEnv } from '../env';

const env = parseEnv();
const { db, close } = createDb(env.DATABASE_URL);
try {
  const linhas = await db
    .select({
      dia: sql<string>`to_char(date_trunc('day', ${schema.mensagem.criadaEm} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      respostas: sql<number>`count(*) filter (where ${schema.mensagem.tipo} = 'resposta')::int`,
      recusas: sql<number>`count(*) filter (where ${schema.mensagem.tipo} = 'recusa')::int`,
      chamadas: sql<number>`count(${schema.mensagem.tokensEntrada})::int`,
      entrada: sql<number>`coalesce(sum(${schema.mensagem.tokensEntrada}), 0)::int`,
      saida: sql<number>`coalesce(sum(${schema.mensagem.tokensSaida}), 0)::int`,
    })
    .from(schema.mensagem)
    .where(sql`${schema.mensagem.papel} = 'assistente'`)
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`)
    .limit(14);

  const [conv] = await db.select({ n: count() }).from(schema.conversa);
  console.log(`Conversas registradas: ${conv?.n ?? 0}`);
  if (!linhas.length) {
    console.log('Nenhuma mensagem registrada ainda.');
  }
  for (const l of linhas) {
    const neurons = neuronsDe(l.entrada, l.saida);
    const media = l.chamadas ? neurons / l.chamadas : 0;
    console.log(
      `${l.dia}  respostas ${l.respostas}, recusas ${l.recusas}, chamadas ao modelo ${l.chamadas}, ` +
        `tokens ${l.entrada} entrada / ${l.saida} saída, ≈ ${neurons.toFixed(1)} neurons ` +
        `(${((neurons / COTA_GRATIS_NEURONS_DIA) * 100).toFixed(1)}% da cota), ` +
        `${media.toFixed(2)} por chamada`,
    );
  }
} finally {
  await close();
}
