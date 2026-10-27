import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { semLinhaFinalDeCitacoes } from './TextoComCitacoes';
import type { EnviarPergunta, ErroChat, RespostaChat } from './api';

const ID = '3f2b8c1e-5d4a-4e7b-9a10-2c6f8e1d7b90';

const resposta = (extra: Partial<RespostaChat> = {}): RespostaChat => ({
  conversaId: ID,
  tipo: 'resposta',
  resposta: 'Não aceitamos cheque. [1]',
  fontes: [
    { numero: 1, documento: 'Formas de pagamento', caminho: '08.md', citada: true },
    { numero: 2, documento: 'Duração dos serviços', caminho: '05.md', citada: false },
  ],
  ...extra,
});

const sucesso = (extra?: Partial<RespostaChat>) => ({ ok: true as const, dados: resposta(extra) });
const falha = (erro: ErroChat) => ({ ok: false as const, erro });

function montar(enviar: EnviarPergunta) {
  const user = userEvent.setup();
  render(<App enviarPergunta={enviar} />);
  return { user, campo: () => screen.getByLabelText('Sua pergunta') };
}

afterEach(() => vi.useRealTimers());

describe('conversa', () => {
  it('começa com sugestões; clicar em uma envia a pergunta', async () => {
    const enviar = vi.fn<EnviarPergunta>().mockResolvedValue(sucesso());
    const { user } = montar(enviar);

    await user.click(screen.getByRole('button', { name: 'Posso parcelar no cartão?' }));

    expect(enviar).toHaveBeenCalledWith('Posso parcelar no cartão?', null);
    expect(await screen.findByText(/Não aceitamos cheque/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Sugestões')).not.toBeInTheDocument();
  });

  it('mostra a pergunta, o indicador de digitando e depois a resposta com a fonte citada', async () => {
    let resolver!: (r: Awaited<ReturnType<EnviarPergunta>>) => void;
    const enviar = vi.fn<EnviarPergunta>(() => new Promise((r) => (resolver = r)));
    const { user, campo } = montar(enviar);

    await user.type(campo(), 'Vocês aceitam cheque?{Enter}');

    expect(screen.getByText('Vocês aceitam cheque?')).toBeInTheDocument();
    expect(screen.getByText('Digitando a resposta…')).toBeInTheDocument();
    expect(campo()).toBeDisabled();

    await act(async () => resolver(sucesso()));

    expect(screen.queryByText('Digitando a resposta…')).not.toBeInTheDocument();
    expect(screen.getByText(/Não aceitamos cheque/)).toBeInTheDocument();
    // só a fonte citada aparece
    expect(screen.getByText(/\[1\] Formas de pagamento/)).toBeInTheDocument();
    expect(screen.queryByText(/Duração dos serviços/)).not.toBeInTheDocument();
    expect(campo()).toBeEnabled();
  });

  it('Enter envia; Shift+Enter só quebra a linha; texto vazio não envia', async () => {
    const enviar = vi.fn<EnviarPergunta>().mockResolvedValue(sucesso());
    const { user, campo } = montar(enviar);

    await user.type(campo(), '   {Enter}');
    expect(enviar).not.toHaveBeenCalled();

    await user.type(campo(), 'primeira{Shift>}{Enter}{/Shift}segunda');
    expect(enviar).not.toHaveBeenCalled();
    expect(campo()).toHaveValue('   primeira\nsegunda');

    await user.keyboard('{Enter}');
    expect(enviar).toHaveBeenCalledWith('primeira\nsegunda', null);
  });

  it('reaproveita o conversaId nas perguntas seguintes', async () => {
    const enviar = vi.fn<EnviarPergunta>().mockResolvedValue(sucesso());
    const { user, campo } = montar(enviar);

    await user.type(campo(), 'primeira{Enter}');
    await screen.findByText(/Não aceitamos cheque/);
    await user.type(campo(), 'segunda{Enter}');

    await waitFor(() => expect(enviar).toHaveBeenCalledTimes(2));
    expect(enviar).toHaveBeenNthCalledWith(1, 'primeira', null);
    expect(enviar).toHaveBeenNthCalledWith(2, 'segunda', ID);
  });

  it('se a conversa sumiu do servidor (404), começa outra e repete a pergunta sozinha', async () => {
    const enviar = vi
      .fn<EnviarPergunta>()
      .mockResolvedValueOnce(sucesso())
      .mockResolvedValueOnce(falha({ tipo: 'conversa_nao_encontrada' }))
      .mockResolvedValueOnce(sucesso({ resposta: 'Segunda resposta.', conversaId: 'nova-id' }));
    const { user, campo } = montar(enviar);

    await user.type(campo(), 'primeira{Enter}');
    await screen.findByText(/Não aceitamos cheque/);
    await user.type(campo(), 'segunda{Enter}');

    expect(await screen.findByText('Segunda resposta.')).toBeInTheDocument();
    expect(enviar).toHaveBeenNthCalledWith(2, 'segunda', ID);
    expect(enviar).toHaveBeenNthCalledWith(3, 'segunda', null);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recusa aparece destacada e sem fontes', async () => {
    const enviar = vi
      .fn<EnviarPergunta>()
      .mockResolvedValue(
        sucesso({ tipo: 'recusa', resposta: 'Não encontrei essa informação.', fontes: [] }),
      );
    const { user, campo } = montar(enviar);
    await user.type(campo(), 'capital da França?{Enter}');

    const texto = await screen.findByText('Não encontrei essa informação.');
    expect(texto.closest('.balao')).toHaveClass('recusa');
    expect(screen.queryByText('Fontes:')).not.toBeInTheDocument();
  });

  it('o que o modelo escrever é exibido como texto, nunca como HTML', async () => {
    const enviar = vi
      .fn<EnviarPergunta>()
      .mockResolvedValue(
        sucesso({ resposta: '<img src=x onerror="alert(1)"> <b>negrito</b> [1]', fontes: [] }),
      );
    const { user, campo } = montar(enviar);
    await user.type(campo(), 'oi?{Enter}');

    await screen.findByText(/negrito/);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it('as citações [n] ganham destaque', async () => {
    const enviar = vi
      .fn<EnviarPergunta>()
      .mockResolvedValue(sucesso({ resposta: 'Custa R$ 320. [1], [3]' }));
    const { user, campo } = montar(enviar);
    await user.type(campo(), 'SUV?{Enter}');
    await screen.findByText(/Custa R\$ 320/);
    expect([...document.querySelectorAll('sup.citacao')].map((e) => e.textContent)).toEqual([
      '[1]',
      '[3]',
    ]);
  });
});

describe('limites e erros', () => {
  it('erro de rede: mostra o aviso e devolve o texto ao campo para tentar de novo', async () => {
    const enviar = vi.fn<EnviarPergunta>().mockResolvedValue(falha({ tipo: 'rede' }));
    const { user, campo } = montar(enviar);

    await user.type(campo(), 'Aceitam Pix?{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui falar com o servidor');
    expect(campo()).toHaveValue('Aceitam Pix?');
    expect(screen.queryByText('Aceitam Pix?', { selector: '.balao' })).not.toBeInTheDocument();
    expect(campo()).toBeEnabled();
  });

  it('limite por IP: trava o envio com contagem regressiva e libera no fim', async () => {
    const enviar = vi
      .fn<EnviarPergunta>()
      .mockResolvedValueOnce(falha({ tipo: 'muitas_requisicoes', esperaSeg: 3 }))
      .mockResolvedValueOnce(sucesso());
    const { user, campo } = montar(enviar);
    await user.type(campo(), 'Aceitam Pix?{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('(3 s)');
    expect(campo()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();

    // a contagem anda de 1 em 1 segundo
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('(2 s)'), {
      timeout: 2500,
    });
    await waitFor(() => expect(campo()).toBeEnabled(), { timeout: 4500 });

    expect(campo()).toHaveValue('Aceitam Pix?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/Não aceitamos cheque/)).toBeInTheDocument();
  }, 10_000);

  it('conversa cheia: trava, oferece "Começar nova conversa" e ela volta ao início', async () => {
    const enviar = vi
      .fn<EnviarPergunta>()
      .mockResolvedValueOnce(sucesso())
      .mockResolvedValueOnce(falha({ tipo: 'conversa_cheia' }));
    const { user, campo } = montar(enviar);

    await user.type(campo(), 'primeira{Enter}');
    await screen.findByText(/Não aceitamos cheque/);
    await user.type(campo(), 'segunda{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('limite de perguntas');
    expect(campo()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Começar nova conversa' }));

    expect(campo()).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Não aceitamos cheque/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sugestões')).toBeInTheDocument();
  });

  it('limite diário: trava de vez; "Nova conversa" não destrava', async () => {
    const enviar = vi.fn<EnviarPergunta>().mockResolvedValue(falha({ tipo: 'limite_diario' }));
    const { user, campo } = montar(enviar);

    await user.type(campo(), 'Aceitam Pix?{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Volte amanhã');
    expect(campo()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Nova conversa' }));
    expect(campo()).toBeDisabled();
  });

  it('"Nova conversa" limpa a conversa e esquece o conversaId', async () => {
    const enviar = vi.fn<EnviarPergunta>().mockResolvedValue(sucesso());
    const { user, campo } = montar(enviar);

    await user.type(campo(), 'primeira{Enter}');
    await screen.findByText(/Não aceitamos cheque/);
    await user.click(screen.getByRole('button', { name: 'Nova conversa' }));
    expect(screen.queryByText(/Não aceitamos cheque/)).not.toBeInTheDocument();

    await user.type(campo(), 'outra{Enter}');
    await waitFor(() => expect(enviar).toHaveBeenCalledTimes(2));
    expect(enviar).toHaveBeenLastCalledWith('outra', null);
  });
});

describe('campo de pergunta', () => {
  it('limita a 500 caracteres e mostra o contador perto do limite', async () => {
    const { user, campo } = montar(vi.fn<EnviarPergunta>());
    expect(campo()).toHaveAttribute('maxlength', '500');
    expect(screen.queryByText(/\/500/)).not.toBeInTheDocument();

    await user.click(campo());
    await user.paste('x'.repeat(450));
    expect(screen.getByText('450/500')).toBeInTheDocument();
  });

  it('avisa que os dados são fictícios e que as perguntas são guardadas', () => {
    montar(vi.fn<EnviarPergunta>());
    expect(screen.getByText(/dados fictícios/)).toBeInTheDocument();
    expect(screen.getByText(/não escreva dados pessoais/)).toBeInTheDocument();
  });
});

describe('linha final só de citações', () => {
  it.each([
    ['Custa R$ 320.\n\n[1], [3]', 'Custa R$ 320.'],
    ['Aceitamos Pix.\n[1]', 'Aceitamos Pix.'],
    ['Aceitamos Pix. [1] E cartão. [2]', 'Aceitamos Pix. [1] E cartão. [2]'],
    ['[1]', '[1]'],
    ['Texto\n\n[1], [2].', 'Texto'],
  ])('%j vira %j', (entrada, esperado) => {
    expect(semLinhaFinalDeCitacoes(entrada)).toBe(esperado);
  });

  it('na tela, a linha final some e a lista de fontes continua lá', async () => {
    const enviar = vi
      .fn<EnviarPergunta>()
      .mockResolvedValue(sucesso({ resposta: 'Não aceitamos cheque.\n\n[1]' }));
    const { user, campo } = montar(enviar);
    await user.type(campo(), 'cheque?{Enter}');

    await screen.findByText(/Não aceitamos cheque/);
    expect(document.querySelectorAll('sup.citacao')).toHaveLength(0);
    expect(screen.getByText(/\[1\] Formas de pagamento/)).toBeInTheDocument();
  });
});
