import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/**
 * IP de quem chamou. Só confia num cabeçalho (ex.: `cf-connecting-ip`, que a Cloudflare define)
 * se ele for configurado: um cabeçalho qualquer pode ser forjado pelo cliente e anularia o limite.
 * Sem cabeçalho configurado, usa o endereço da conexão. Se não der para saber, todos caem na
 * mesma chave "desconhecido" (mais restritivo, nunca mais permissivo).
 */
export function obterIp(c: Context, cabecalhoConfiavel?: string): string {
  if (cabecalhoConfiavel) {
    const valor = c.req.header(cabecalhoConfiavel)?.split(',')[0]?.trim();
    if (valor) return valor;
  }
  try {
    return getConnInfo(c).remote.address ?? 'desconhecido';
  } catch {
    return 'desconhecido';
  }
}
