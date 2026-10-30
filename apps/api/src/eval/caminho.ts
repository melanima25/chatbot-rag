import { resolve } from 'node:path';

/**
 * Resolve um caminho digitado pelo usuário. O npm roda o script dentro de `apps/api`, então um caminho
 * relativo como `evals/resultados/x.json` precisa ser lido a partir da pasta onde o comando foi
 * digitado (o npm guarda essa pasta em INIT_CWD), e não da pasta do script.
 */
export function resolverCaminho(
  caminho: string,
  ambiente: { INIT_CWD?: string } = process.env,
  cwd: string = process.cwd(),
): string {
  return resolve(ambiente.INIT_CWD ?? cwd, caminho);
}
