# Google Agenda

O Talorys consegue ler as suas agendas do Google e propor eventos. Você conecta
uma conta Google em **Configurações → Integrações → Google Agenda** e escolhe,
agenda por agenda, o que o agente pode fazer:

| Opção | O que o agente pode fazer |
| --- | --- |
| **Oculta para o agente** (padrão) | Nada. A agenda não aparece para o agente. |
| **Só leitura** | Listar e buscar os eventos, no chat e nas automações agendadas. |
| **Ler e propor alterações** | Também propor criar, mover, renomear e excluir eventos. Cada alteração espera um cartão de aprovação no chat. |

É opcional e gratuito. Sem nada configurado, o Talorys não faz nenhuma
requisição ao Google.

## O que ela faz e o que não faz

- **Uma conta.** As agendas compartilhadas com essa conta também aparecem, com o
  acesso que o Google dá à conta. **Ler e propor alterações** só é oferecido
  onde o Google deixa a conta editar (dono ou editor). Uma agenda compartilhada
  só com horários livres e ocupados não pode ser aberta.
- **Alterações sempre perguntam antes.** Criar, alterar e excluir eventos são
  ações com aprovação, oferecidas só no chat. As automações agendadas podem ler,
  nunca alterar.
- **Os convidados nunca recebem e-mail.** Toda alteração é enviada com
  `sendUpdates=none`, e o agente não consegue adicionar convidados.
- **Uma alteração feita nesse meio-tempo no Google prevalece.** Mover ou excluir
  depois da aprovação é enviado com a versão do evento (`If-Match`). Se alguém
  editou o evento depois da proposta, o Google recusa e nada é feito.
- **Limites:** uma requisição lê no máximo 62 dias e 50 eventos.

### Recomendado: agenda de trabalho como só leitura

Para o Talorys ver uma agenda de trabalho (a de um consultório, por exemplo)
sem nenhuma chance de alterá-la, compartilhe essa agenda no Google Agenda com a
sua própria conta como **Ver todos os detalhes do evento** e depois escolha
**Só leitura** no Talorys. Aí o próprio Google recusa qualquer alteração, aconteça
o que acontecer no Talorys.

## Rotinas do dia com a agenda

O Talorys também lê as agendas abertas por conta própria, sem a IA:

- **Resumo do dia.** O resumo (**Configurações → Avisos**) lista os eventos de
  hoje de todas as agendas abertas, em ordem de horário.
- **Aviso antes do primeiro evento.** Abaixo de uma agenda, em **Configurações →
  Integrações**, escolha **Avisar N min antes do primeiro evento** e escreva o
  que lembrar ("ligar o ar-condicionado"). Nos dias com um evento com horário, o
  aviso sai uma vez, esses minutos antes do primeiro. Se o primeiro evento muda
  de horário, o aviso acompanha; eventos de dia inteiro são ignorados.
- **Rotinas só em dias com eventos.** Uma automação pode **Só rodar em dias com
  eventos** numa agenda aberta. Num dia sem eventos nela, a execução é pulada
  (e aparece no histórico). Se o Google não responder, ela roda assim mesmo. Se
  essa agenda for ocultada depois, as execuções são puladas e você recebe um
  aviso. **Executar agora** sempre executa. A condição só é definida no app,
  nunca com um token de acesso.

Em **Automações → Novo → Rotina de IA**, três rotinas prontas usam isso:

| Modelo | Quando | O quê |
| --- | --- | --- |
| **Briefing da manhã** | Todo dia, 07:00 | Eventos de hoje, tarefas que vencem hoje ou atrasadas, lembretes, o que preparar. |
| **Fechamento do dia** | Segunda a sexta, 19:00 | O que aconteceu, o que continua aberto, o que deixar pronto para amanhã. |
| **Fechamento de sábado** | Sábado, 13:00 | O mesmo, mas só nos sábados com eventos na agenda que você escolher (uma agenda de trabalho, por exemplo). |

Tudo continua editável. Contas fixas são lembretes mensais comuns: crie um 7
dias e outro 3 dias antes do vencimento.

## Configuração

Você precisa de um cliente OAuth gratuito no Google Cloud. O passo a passo
completo está em
[instalacao-cloudflare.md](instalacao-cloudflare.md#25-google-agenda). Em
resumo:

1. No console do Google Cloud, crie um projeto e ative a **Google Calendar
   API**.
2. Configure a tela de consentimento OAuth (Google Auth Platform), tipo de
   usuário **External** (ou **Internal** no Google Workspace), e adicione estes
   escopos:
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
3. Publique o app (**In production**). Enquanto ele estiver em **Testing**, o
   Google expira os logins depois de 7 dias e você teria de conectar de novo
   toda semana. Como só você usa, a verificação do Google não é necessária: na
   página de consentimento, escolha **Advanced → Go to (nome do app)**.
4. Crie um **OAuth client ID** do tipo **Web application** com este URI de
   redirecionamento autorizado (o endereço do seu Talorys):
   `https://talorys.exemplo.com.br/settings/google-calendar`
5. Adicione o ID e o segredo do cliente como os segredos `GOOGLE_CLIENT_ID` e
   `GOOGLE_CLIENT_SECRET` do Worker. `MCP_CREDENTIAL_KEY` também precisa estar
   definido: ele lacra os tokens do Google.
6. No Talorys, abra **Configurações → Integrações → Google Agenda → Conectar
   Google**, permita as duas permissões e escolha uma opção para cada agenda.

## Privacidade

- O Talorys pede ao Google só a lista de agendas e os eventos delas. Ele não vê
  o Gmail, o Drive, os contatos nem nada mais da conta.
- Os eventos são lidos quando o agente precisa deles e não ficam guardados no
  Talorys. O que o agente lê passa a fazer parte daquela conversa, como
  qualquer resultado de ferramenta.
- Títulos, locais e descrições dos eventos são escritos por quem criou o
  evento, possivelmente um estranho que mandou um convite. Eles chegam ao
  modelo como dados não confiáveis, dentro de um bloco de dados, sem caracteres
  de controle, e o modelo é instruído a nunca seguir instruções que estejam
  neles.
- O registro de atividade guarda conexões, desconexões, mudanças de opção e cada
  alteração aprovada, nunca o conteúdo dos eventos.

## Modelo de segurança

- **Só o dono.** Conectar, abrir agendas e desconectar são feitos no app, com
  uma sessão do dono. Tokens de acesso (acesso remoto, n8n) não conseguem
  gerenciar a conexão, e nenhuma ferramenta deixa o agente conectar uma conta ou
  abrir uma agenda para si mesmo.
- **Senha recente.** Conectar uma conta e abrir uma agenda para o agente pedem a
  senha digitada nos últimos minutos. Ocultar uma agenda nunca pede.
- **OAuth com PKCE e state de uso único.** O state é guardado como hash, o
  verificador PKCE fica lacrado e os dois expiram em 10 minutos. A página de
  retorno repassa a resposta do Google com a sessão do dono; um state não pode
  ser reutilizado. Se o Google conceder menos permissões do que o pedido, nada é
  salvo e, a menos que uma conta já esteja conectada (revogar encerraria a
  concessão dela também), o acesso é devolvido na hora.
- **Tokens lacrados.** Os tokens de atualização e de acesso são cifrados com
  AES-256-GCM usando `MCP_CREDENTIAL_KEY` e nunca entram em backups, exportações
  ou respostas da API. Depois de restaurar um backup, conecte de novo.
- **Uso restrito da rede.** As requisições vão só para os endereços fixos de
  OAuth e de Agenda do Google, nunca seguem redirecionamentos, expiram em 10
  segundos e leem no máximo 1 MB.
- **Alerta.** Conectar uma conta gera um alerta de segurança, para que uma
  conexão que você não fez não passe despercebida.
- **Desconectar** apaga os tokens e as opções das agendas e revoga o acesso no
  Google.

Se suspeitar de uso indevido, desconecte no Talorys, remova também o Talorys em
<https://myaccount.google.com/connections> e depois troque a sua senha do
Talorys.

## Solução de problemas

| Mensagem | O que fazer |
| --- | --- |
| A Google Agenda não está configurada | Adicione `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `MCP_CREDENTIAL_KEY` ao Worker. |
| `redirect_uri_mismatch` na página do Google | O URI de redirecionamento autorizado precisa ser exatamente o endereço do seu Talorys seguido de `/settings/google-calendar`. |
| Permita as duas permissões | Na página do Google, marque as duas caixas e conecte de novo. |
| O acesso ao Google foi revogado ou expirou | Conecte de novo. Se acontece toda semana, o app ainda está em **Testing**: publique-o. |
| Falta uma agenda | Toque em **Atualizar lista** depois de compartilhar ou criar a agenda no Google. |
