import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnviarPergunta, ErroChat, Fonte } from './api';

export const LIMITE_PERGUNTA = 500;

export type MensagemChat = {
  id: number;
  papel: 'cliente' | 'assistente';
  texto: string;
  tipo?: 'resposta' | 'recusa';
  fontes?: Fonte[];
};

/** Por que o campo de pergunta está travado de vez (até começar outra conversa). */
export type Bloqueio = 'nenhum' | 'conversa_cheia' | 'limite_diario';

export function textoDoErro(erro: ErroChat): string {
  switch (erro.tipo) {
    case 'muitas_requisicoes':
      return 'Muitas perguntas em pouco tempo. Aguarde um instante para perguntar de novo.';
    case 'conversa_cheia':
      return 'Esta conversa chegou ao limite de perguntas. Comece uma nova conversa.';
    case 'limite_diario':
      return 'A demonstração atingiu o limite de uso de hoje. Volte amanhã.';
    case 'pedido_invalido':
      return erro.mensagem;
    case 'rede':
      return 'Não consegui falar com o servidor. Verifique sua conexão e tente de novo.';
    default:
      return 'Algo deu errado do nosso lado. Tente de novo em instantes.';
  }
}

export function useChat(enviarPergunta: EnviarPergunta) {
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bloqueio, setBloqueio] = useState<Bloqueio>('nenhum');
  const [esperaSeg, setEsperaSeg] = useState(0);
  const [rascunho, setRascunho] = useState('');
  const proximoId = useRef(1);

  // Contagem regressiva do "tente de novo em N segundos".
  useEffect(() => {
    if (esperaSeg <= 0) return;
    const t = setTimeout(() => setEsperaSeg((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [esperaSeg]);

  const enviar = useCallback(
    async (textoBruto: string) => {
      const texto = textoBruto.trim();
      if (!texto || carregando || bloqueio !== 'nenhum' || esperaSeg > 0) return;

      const idPergunta = proximoId.current++;
      setMensagens((m) => [...m, { id: idPergunta, papel: 'cliente', texto }]);
      setRascunho('');
      setAviso(null);
      setCarregando(true);

      let resultado = await enviarPergunta(texto, conversaId);
      // A conversa sumiu do servidor (ex.: banco limpo): começa outra sem incomodar a pessoa.
      if (!resultado.ok && resultado.erro.tipo === 'conversa_nao_encontrada') {
        setConversaId(null);
        resultado = await enviarPergunta(texto, null);
      }
      setCarregando(false);

      if (resultado.ok) {
        const { dados } = resultado;
        setConversaId(dados.conversaId);
        setMensagens((m) => [
          ...m,
          {
            id: proximoId.current++,
            papel: 'assistente',
            texto: dados.resposta,
            tipo: dados.tipo,
            fontes: dados.fontes,
          },
        ]);
        return;
      }

      // Falhou: tira a pergunta da conversa e devolve o texto ao campo, para a pessoa não perder o que escreveu.
      setMensagens((m) => m.filter((x) => x.id !== idPergunta));
      setRascunho((atual) => atual || texto);
      setAviso(textoDoErro(resultado.erro));
      if (resultado.erro.tipo === 'muitas_requisicoes') setEsperaSeg(resultado.erro.esperaSeg);
      if (resultado.erro.tipo === 'conversa_cheia') setBloqueio('conversa_cheia');
      if (resultado.erro.tipo === 'limite_diario') setBloqueio('limite_diario');
    },
    [bloqueio, carregando, conversaId, enviarPergunta, esperaSeg],
  );

  const novaConversa = useCallback(() => {
    setMensagens([]);
    setConversaId(null);
    setAviso(null);
    setBloqueio((b) => (b === 'limite_diario' ? b : 'nenhum'));
    setRascunho('');
  }, []);

  return {
    mensagens,
    carregando,
    aviso,
    bloqueio,
    esperaSeg,
    rascunho,
    setRascunho,
    enviar,
    novaConversa,
  };
}
