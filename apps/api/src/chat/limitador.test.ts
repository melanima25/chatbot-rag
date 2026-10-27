import { describe, expect, it } from 'vitest';
import { combinar, criarLimitador } from './limitador';

function relogio(inicio = 1_000_000) {
  let t = inicio;
  return { agora: () => t, avancar: (ms: number) => (t += ms) };
}

describe('criarLimitador', () => {
  it('deixa passar até o máximo e bloqueia o seguinte, informando a espera', () => {
    const r = relogio();
    const l = criarLimitador({ max: 2, janelaMs: 60_000, agora: r.agora });
    expect(l.tentar('a').permitido).toBe(true);
    r.avancar(10_000);
    expect(l.tentar('a').permitido).toBe(true);
    r.avancar(10_000);
    const bloqueado = l.tentar('a');
    expect(bloqueado.permitido).toBe(false);
    expect(bloqueado.reiniciaEmSeg).toBe(40); // o 1º pedido sai da janela daqui a 40 s
  });

  it('volta a liberar quando os pedidos antigos saem da janela', () => {
    const r = relogio();
    const l = criarLimitador({ max: 1, janelaMs: 60_000, agora: r.agora });
    l.tentar('a');
    expect(l.tentar('a').permitido).toBe(false);
    r.avancar(60_001);
    expect(l.tentar('a').permitido).toBe(true);
  });

  it('pedido bloqueado não estende o bloqueio', () => {
    const r = relogio();
    const l = criarLimitador({ max: 1, janelaMs: 60_000, agora: r.agora });
    l.tentar('a');
    for (let i = 0; i < 5; i++) {
      r.avancar(10_000);
      l.tentar('a');
    }
    r.avancar(10_001); // 60 s desde o único pedido aceito
    expect(l.tentar('a').permitido).toBe(true);
  });

  it('chaves diferentes não se afetam', () => {
    const l = criarLimitador({ max: 1, janelaMs: 60_000 });
    expect(l.tentar('a').permitido).toBe(true);
    expect(l.tentar('b').permitido).toBe(true);
    expect(l.tentar('a').permitido).toBe(false);
  });

  it('não guarda chaves sem limite: IPs demais não enchem a memória', () => {
    const r = relogio();
    const l = criarLimitador({ max: 1, janelaMs: 60_000, agora: r.agora, maxChaves: 3 });
    for (const ip of ['a', 'b', 'c', 'd', 'e']) l.tentar(ip);
    // 'a' foi descartada para caber as novas: volta a ser aceita (limite é de memória, não bypass total)
    expect(l.tentar('e').permitido).toBe(false);
    expect(l.tentar('a').permitido).toBe(true);
  });
});

describe('combinar', () => {
  it('só passa se todos passarem, e a espera é a maior', () => {
    const r = relogio();
    const minuto = criarLimitador({ max: 1, janelaMs: 60_000, agora: r.agora });
    const hora = criarLimitador({ max: 100, janelaMs: 3_600_000, agora: r.agora });
    const l = combinar(minuto, hora);
    expect(l.tentar('a').permitido).toBe(true);
    const r2 = l.tentar('a');
    expect(r2.permitido).toBe(false);
    expect(r2.reiniciaEmSeg).toBe(60);
  });
});
