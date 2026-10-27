import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { perguntar, type EnviarPergunta } from './api';
import { semLinhaFinalDeCitacoes, TextoComCitacoes } from './TextoComCitacoes';
import { LIMITE_PERGUNTA, useChat, type MensagemChat } from './useChat';

const SUGESTOES = [
  'Quais são os horários de funcionamento?',
  'Quanto custa polir um SUV?',
  'Posso parcelar no cartão?',
  'Como cancelo um agendamento?',
];

const REPOSITORIO = 'https://github.com/melanima25/chatbot-rag';

function Balao({ mensagem }: { mensagem: MensagemChat }) {
  if (mensagem.papel === 'cliente') {
    return (
      <li className="linha cliente">
        <p className="balao">{mensagem.texto}</p>
      </li>
    );
  }
  const citadas = (mensagem.fontes ?? []).filter((f) => f.citada);
  return (
    <li className="linha assistente">
      <div className={`balao ${mensagem.tipo === 'recusa' ? 'recusa' : ''}`}>
        <p>
          <TextoComCitacoes
            texto={citadas.length > 0 ? semLinhaFinalDeCitacoes(mensagem.texto) : mensagem.texto}
          />
        </p>
        {citadas.length > 0 && (
          <p className="fontes">
            <span>Fontes:</span>{' '}
            {citadas.map((f) => (
              <span key={f.numero} className="fonte">
                [{f.numero}] {f.documento}
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

export function App({ enviarPergunta = perguntar }: { enviarPergunta?: EnviarPergunta }) {
  const chat = useChat(enviarPergunta);
  const fim = useRef<HTMLLIElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const travado = chat.bloqueio !== 'nenhum';
  const desativado = travado || chat.carregando || chat.esperaSeg > 0;
  const tamanho = chat.rascunho.length;

  useEffect(() => {
    fim.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [chat.mensagens.length, chat.carregando]);

  // Depois de uma resposta (ou do fim da espera), devolve o cursor ao campo.
  useEffect(() => {
    if (!desativado) campo.current?.focus();
  }, [desativado]);

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    void chat.enviar(chat.rascunho);
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void chat.enviar(chat.rascunho);
    }
  }

  return (
    <div className="pagina">
      <header className="topo">
        <div>
          <h1>Lava Jato Exemplo</h1>
          <p className="subtitulo">Atendimento que responde só com base nos documentos</p>
        </div>
        <button
          type="button"
          className="secundario"
          onClick={chat.novaConversa}
          disabled={chat.mensagens.length === 0 && !chat.aviso}
        >
          Nova conversa
        </button>
      </header>

      <p className="aviso-demo">
        Projeto de demonstração com <strong>dados fictícios</strong>. As perguntas ficam guardadas
        para medir o uso: não escreva dados pessoais.
      </p>

      <main className="conversa">
        {chat.mensagens.length === 0 && (
          <section className="boas-vindas" aria-label="Sugestões">
            <p>Olá! Pergunte sobre serviços, preços, horários, pagamento ou agendamento.</p>
            <ul className="sugestoes">
              {SUGESTOES.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => void chat.enviar(s)}
                    disabled={desativado}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ol className="mensagens" role="log" aria-label="Conversa" aria-live="polite">
          {chat.mensagens.map((m) => (
            <Balao key={m.id} mensagem={m} />
          ))}
          {chat.carregando && (
            <li className="linha assistente">
              <div className="balao digitando">
                <span className="sr-only">Digitando a resposta…</span>
                <span className="ponto" aria-hidden="true" />
                <span className="ponto" aria-hidden="true" />
                <span className="ponto" aria-hidden="true" />
              </div>
            </li>
          )}
          <li ref={fim} aria-hidden="true" />
        </ol>
      </main>

      {chat.aviso && (
        <p className="erro" role="alert">
          {chat.aviso}
          {chat.esperaSeg > 0 && <strong> ({chat.esperaSeg} s)</strong>}
        </p>
      )}

      <form className="envio" onSubmit={aoEnviar}>
        <label htmlFor="pergunta" className="sr-only">
          Sua pergunta
        </label>
        <textarea
          id="pergunta"
          ref={campo}
          rows={2}
          maxLength={LIMITE_PERGUNTA}
          value={chat.rascunho}
          onChange={(e) => chat.setRascunho(e.target.value)}
          onKeyDown={aoTeclar}
          disabled={desativado}
          placeholder={
            travado
              ? 'Conversa encerrada'
              : 'Escreva sua pergunta (Enter envia, Shift+Enter quebra a linha)'
          }
        />
        <div className="acoes">
          <span className="contador" aria-live="off">
            {tamanho >= LIMITE_PERGUNTA - 100 && `${tamanho}/${LIMITE_PERGUNTA}`}
          </span>
          {chat.bloqueio === 'conversa_cheia' && (
            <button type="button" onClick={chat.novaConversa}>
              Começar nova conversa
            </button>
          )}
          <button type="submit" disabled={desativado || chat.rascunho.trim().length < 2}>
            Enviar
          </button>
        </div>
      </form>

      <footer className="rodape">
        Código e decisões técnicas no{' '}
        <a href={REPOSITORIO} target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </footer>
    </div>
  );
}
