// Preços de neurons do modelo padrão (página de preços da Cloudflare, levantada em 17/10/2026).
// É uma conta, não uma fatura: confira no painel da Cloudflare.
export const NEURONS_POR_MILHAO_ENTRADA = 4119;
export const NEURONS_POR_MILHAO_SAIDA = 34868;
export const COTA_GRATIS_NEURONS_DIA = 10_000;

export function neuronsDe(tokensEntrada: number, tokensSaida: number): number {
  return (
    (tokensEntrada / 1_000_000) * NEURONS_POR_MILHAO_ENTRADA +
    (tokensSaida / 1_000_000) * NEURONS_POR_MILHAO_SAIDA
  );
}
