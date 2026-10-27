/** Limite de pedidos por chave (o IP). Fica na memória do servidor: simples, sem banco. */
export type Limitador = {
  tentar(chave: string): { permitido: boolean; reiniciaEmSeg: number };
};

type Opcoes = {
  /** Quantos pedidos cabem na janela. */
  max: number;
  janelaMs: number;
  /** Relógio injetável para testes. */
  agora?: () => number;
  /** Teto de chaves guardadas, para um atacante não encher a memória com IPs diferentes. */
  maxChaves?: number;
};

/** Janela deslizante: guarda o horário dos últimos pedidos de cada chave. */
export function criarLimitador({
  max,
  janelaMs,
  agora = Date.now,
  maxChaves = 10_000,
}: Opcoes): Limitador {
  const pedidos = new Map<string, number[]>();

  function limpar(t: number) {
    for (const [chave, horarios] of pedidos) {
      if (horarios.every((h) => h <= t - janelaMs)) pedidos.delete(chave);
    }
    // Ainda cheio: descarta as chaves mais antigas (o Map guarda a ordem de inserção).
    for (const chave of pedidos.keys()) {
      if (pedidos.size < maxChaves) break;
      pedidos.delete(chave);
    }
  }

  return {
    tentar(chave) {
      const t = agora();
      if (!pedidos.has(chave) && pedidos.size >= maxChaves) limpar(t);
      const recentes = (pedidos.get(chave) ?? []).filter((h) => h > t - janelaMs);
      if (recentes.length >= max) {
        pedidos.set(chave, recentes);
        const libera = (recentes[0] ?? t) + janelaMs - t;
        return { permitido: false, reiniciaEmSeg: Math.max(1, Math.ceil(libera / 1000)) };
      }
      recentes.push(t);
      pedidos.set(chave, recentes);
      return { permitido: true, reiniciaEmSeg: 0 };
    },
  };
}

/** Passa só se TODOS os limitadores deixarem; em caso de bloqueio, devolve a espera maior. */
export function combinar(...limitadores: Limitador[]): Limitador {
  return {
    tentar(chave) {
      let espera = 0;
      let permitido = true;
      for (const l of limitadores) {
        const r = l.tentar(chave);
        if (!r.permitido) {
          permitido = false;
          espera = Math.max(espera, r.reiniciaEmSeg);
        }
      }
      return { permitido, reiniciaEmSeg: espera };
    },
  };
}
