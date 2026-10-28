import type { Language } from "./constants";

/**
 * Text the server writes in English (API errors, notifications, tool labels, approval
 * summaries, run results) and its translations. The server stores and returns English;
 * the app shows it in the owner's language with localizeServerText, and push
 * notifications are translated before they are sent.
 *
 * Keys are the English text exactly as the server writes it. {name} matches any value,
 * which is copied into the translation. Text without an entry is shown as written.
 */
type Catalog = Record<string, string>;

const PT_BR: Catalog = {
  // API and request errors
  "Not found": "Não encontrado",
  "Invalid input": "Dados inválidos",
  "Something went wrong.": "Algo deu errado.",
  "Something went wrong. Your data is safe; please try again.": "Algo deu errado. Seus dados estão seguros; tente novamente.",
  "Unknown API route": "Rota da API desconhecida",
  "Missing CSRF header.": "Cabeçalho CSRF ausente.",
  "Cross-origin request rejected.": "Solicitação de outra origem rejeitada.",
  "Cross-site request rejected.": "Solicitação de outro site rejeitada.",
  "Please sign in.": "Faça login.",
  "Request body too large.": "O corpo da solicitação é grande demais.",
  "Request body must be valid JSON.": "O corpo da solicitação precisa ser um JSON válido.",
  "Session not found": "Sessão não encontrada",
  "Talorys is unreachable.": "Não foi possível conectar ao Talorys.",
  "The backend service binding is missing. Re-run the Talorys installer.": "O service binding do backend está ausente. Execute o instalador do Talorys novamente.",
  "The Talorys backend is unreachable. Please try again shortly.": "O backend do Talorys está inacessível. Tente novamente em instantes.",

  // Sign-in and passwords
  "Incorrect password.": "Senha incorreta.",
  "Current password is incorrect.": "A senha atual está incorreta.",
  "Too many failed attempts. Please wait before trying again.": "Muitas tentativas sem sucesso. Aguarde antes de tentar novamente.",
  "Owner credentials are not configured. Run the Talorys installer, or set a strong OWNER_PASSWORD and SESSION_SECRET with `wrangler secret put`.":
    "As credenciais do proprietário não estão configuradas. Execute o instalador do Talorys ou defina OWNER_PASSWORD e SESSION_SECRET fortes com `wrangler secret put`.",
  "Use at least {min} characters.": "Use pelo menos {min} caracteres.",
  "Use at most 256 characters.": "Use no máximo 256 caracteres.",
  "Avoid repeating a single character.": "Evite repetir um único caractere.",
  "Mix letters with numbers or symbols, or use a passphrase of 16+ characters.": "Misture letras com números ou símbolos, ou use uma frase-senha com 16 ou mais caracteres.",
  "Avoid common words such as 'password'.": "Evite palavras comuns como 'senha'.",

  // AI
  "Your Cloudflare account has used its Workers AI allocation for today. Tasks, notes, memories and reminders keep working; chat will resume when the quota resets.":
    "Sua conta Cloudflare usou a cota do Workers AI de hoje. Tarefas, notas, memórias e lembretes continuam funcionando; o chat volta quando a cota reiniciar.",
  "Workers AI is busy right now. Please try again in a moment.": "O Workers AI está ocupado agora. Tente novamente em instantes.",
  "The configured AI model is not available. Choose another model in Settings.": "O modelo de IA configurado não está disponível. Escolha outro modelo em Configurações.",
  "The response was cancelled.": "A resposta foi cancelada.",
  "The AI model could not respond. Please try again.": "O modelo de IA não conseguiu responder. Tente novamente.",
  "Workers AI is not configured for this deployment. Everything else keeps working.": "O Workers AI não está configurado nesta instalação. Todo o resto continua funcionando.",
  "Workers AI is not configured.": "O Workers AI não está configurado.",
  "Talorys reached its daily limit of {max} AI requests (adjustable in Settings → AI).": "O Talorys atingiu o limite diário de {max} pedidos de IA (ajustável em Configurações → IA).",
  "A response is already being generated in this conversation.": "Uma resposta já está sendo gerada nesta conversa.",
  "Nothing to retry.": "Nada para tentar novamente.",
  "Messages restored from a backup can't be retried. Send a new message instead.": "Mensagens restauradas de um backup não podem ser repetidas. Envie uma nova mensagem.",
  "Done.": "Pronto.",
  "I've proposed a plan for you to review. Nothing is created until you confirm it.": "Propus um plano para você revisar. Nada é criado até você confirmar.",
  "I wasn't able to produce a response. Please try rephrasing.": "Não consegui gerar uma resposta. Tente reformular.",

  // Conversations, tasks, notes, memories
  "New conversation": "Nova conversa",
  "Conversation not found": "Conversa não encontrada",
  "Task not found": "Tarefa não encontrada",
  "Note not found": "Nota não encontrada",
  "Project not found": "Projeto não encontrado",
  "Memory not found": "Memória não encontrada",
  "Automation not found": "Automação não encontrada",
  "Project does not exist.": "O projeto não existe.",
  "A memory can't replace itself or one of its own replacements.": "Uma memória não pode substituir a si mesma nem uma de suas substitutas.",
  "This review no longer exists.": "Esta revisão não existe mais.",
  "One of these memories was already removed.": "Uma dessas memórias já foi removida.",
  "That is the same as the current memory.": "Isso é igual à memória atual.",
  "Same statement.": "Mesma afirmação.",
  "The new memory says “{words}” changed.": "A nova memória diz que “{words}” mudou.",
  "The new memory explicitly updates {topic}.": "A nova memória atualiza explicitamente {topic}.",
  "The new memory adds detail to this one.": "A nova memória acrescenta detalhes a esta.",
  "Both memories describe {topic}; it's unclear whether the older one still holds.": "As duas memórias descrevem {topic}; não está claro se a mais antiga ainda vale.",
  "Related but compatible.": "Relacionadas, mas compatíveis.",
  "No overlap.": "Sem relação.",
  "where you live": "onde você mora",
  "your car": "seu carro",
  "your job": "seu trabalho",
  "your diet": "sua alimentação",
  "your relationship status": "seu status de relacionamento",

  // Task plans
  "Every proposed task already exists as an open task.": "Todas as tarefas propostas já existem como tarefas abertas.",
  'Project "{name}" does not exist.': "O projeto “{name}” não existe.",
  "This plan no longer exists.": "Este plano não existe mais.",
  "“{title}” has an invalid due date.": "“{title}” tem um prazo inválido.",
  "This plan was already confirmed.": "Este plano já foi confirmado.",
  "This plan expired.": "Este plano expirou.",
  "This plan expired. Ask again to get a new one.": "Este plano expirou. Peça novamente para receber um novo.",
  "This plan was cancelled.": "Este plano foi cancelado.",
  "Tasks can be edited or removed, not added.": "As tarefas podem ser editadas ou removidas, não adicionadas.",
  "“{title}” is in the plan twice.": "“{title}” aparece duas vezes no plano.",
  "The selected project no longer exists.": "O projeto selecionado não existe mais.",
  "This plan changed or expired since you opened it. Reload to see the latest version.": "Este plano mudou ou expirou desde que você o abriu. Recarregue para ver a versão mais recente.",
  "Task plan “{title}”": "Plano de tarefas “{title}”",

  // Automations
  "A reminder needs a message.": "Um lembrete precisa de uma mensagem.",
  "An AI automation needs a prompt.": "Uma automação de IA precisa de um prompt.",
  "That time is in the past. Choose a future time.": "Esse horário já passou. Escolha um horário futuro.",
  "This automation is already running.": "Esta automação já está em execução.",
  "Access tokens cannot create or change AI prompt automations.": "Tokens de acesso não podem criar nem alterar automações de prompt de IA.",
  Reminder: "Lembrete",
  "Reminder delivered": "Lembrete entregue",
  "{overdue} overdue, {today} due today": "{overdue} atrasadas, {today} vencem hoje",
  "**Overdue ({count})**": "**Atrasadas ({count})**",
  "**Due today ({count})**": "**Vencem hoje ({count})**",
  "{count} open task(s) in total.": "{count} tarefa(s) aberta(s) no total.",
  "- {title} (due {date}) · {priority}": "- {title} (vence {date}) · {priority}",
  "- {title} (due {date})": "- {title} (vence {date})",
  "- {title} · {priority}": "- {title} · {priority}",
  high: "alta",
  urgent: "urgente",
  "Skipped: the daily budget for scheduled AI runs was reached. Adjust it in Settings → AI.":
    "Ignorado: o orçamento diário de execuções agendadas de IA foi atingido. Ajuste em Configurações → IA.",
  "Scheduled AI budget reached": "Orçamento de IA agendada atingido",
  "Skipped because a manual run was in progress.": "Ignorado porque uma execução manual estava em andamento.",

  // Backups
  "This backup was made by a newer Talorys (format v{version}). Update Talorys first.": "Este backup foi feito por um Talorys mais novo (formato v{version}). Atualize o Talorys primeiro.",

  // Remote access
  "Invalid or revoked access token.": "Token de acesso inválido ou revogado.",
  "This route is not available to access tokens.": "Esta rota não está disponível para tokens de acesso.",
  "This access token is read-only.": "Este token de acesso é somente leitura.",
  "SESSION_SECRET must be set (at least 32 characters) before creating remote access tokens.": "SESSION_SECRET precisa estar definido (pelo menos 32 caracteres) antes de criar tokens de acesso remoto.",
  "Remote access is turned off. Turn it on in Settings first.": "O acesso remoto está desligado. Ative-o em Configurações primeiro.",
  "Your session ended. Sign in again to create an access token.": "Sua sessão terminou. Entre novamente para criar um token de acesso.",
  "You can have at most {max} remote access tokens. Revoke one first.": "Você pode ter no máximo {max} tokens de acesso remoto. Revogue um primeiro.",
  "A token with this name already exists.": "Já existe um token com este nome.",
  "Too many failed access token attempts. Please wait before trying again.": "Muitas tentativas com token de acesso sem sucesso. Aguarde antes de tentar novamente.",
  "Too many requests for this access token.": "Solicitações demais para este token de acesso.",
  "Access token not found.": "Token de acesso não encontrado.",

  // Push notifications
  "Push notifications are not set up on this deployment yet.": "As notificações push ainda não estão configuradas nesta instalação.",
  "Device not found.": "Dispositivo não encontrado.",
  "At most {max} devices can receive notifications. Remove one first.": "No máximo {max} dispositivos podem receber notificações. Remova um primeiro.",
  "Push endpoint is not a valid URL.": "O endpoint de push não é uma URL válida.",
  "Push endpoint must use https.": "O endpoint de push precisa usar https.",
  "Push endpoint must not contain credentials.": "O endpoint de push não pode conter credenciais.",
  "Push endpoint must use the default https port.": "O endpoint de push precisa usar a porta https padrão.",
  "Test notification: push works on this device.": "Notificação de teste: o push funciona neste dispositivo.",

  // Semantic recall
  "Semantic memory recall is turned off.": "A busca semântica de memórias está desligada.",
  "vectorFloor.backstop ({backstop}) must not be above vectorFloor.absolute ({absolute})": "vectorFloor.backstop ({backstop}) não pode ser maior que vectorFloor.absolute ({absolute})",

  // Approvals and tool activity shown in chat
  "This action no longer exists.": "Esta ação não existe mais.",
  "This request expired. Ask again to get a new one.": "Esta solicitação expirou. Peça novamente para receber uma nova.",
  "This action was already handled.": "Esta ação já foi tratada.",
  "This item no longer exists.": "Este item não existe mais.",
  "This item changed after it was proposed, so nothing was done. Ask again to get a new approval.": "Este item mudou depois de proposto, então nada foi feito. Peça novamente para obter uma nova aprovação.",
  "This tool's inputs changed after it was proposed, so nothing was sent. Ask again to get a new approval.": "As entradas desta ferramenta mudaram depois de propostas, então nada foi enviado. Peça novamente para obter uma nova aprovação.",
  "Forget memory {title}": "Esquecer a memória {title}",
  "Rewrite note {title} ({size})": "Reescrever a nota {title} ({size})",
  "Delete note {title}": "Excluir a nota {title}",
  "Cancel reminder {title}": "Cancelar o lembrete {title}",
  "Cancel automation {title}": "Cancelar a automação {title}",
  "Delete task {title}": "Excluir a tarefa {title}",
  "Run “{tool}” on {where}": "Executar “{tool}” em {where}",
  "Saving to memory": "Salvando na memória",
  "Recalling “{query}”": "Lembrando “{query}”",
  "Updating a memory": "Atualizando uma memória",
  "Proposing to forget a memory": "Propondo esquecer uma memória",
  "Saving note “{title}”": "Salvando a nota “{title}”",
  "Searching notes for “{query}”": "Buscando “{query}” nas notas",
  "Reading a note": "Lendo uma nota",
  "Updating a note": "Atualizando uma nota",
  "Proposing to rewrite a note": "Propondo reescrever uma nota",
  "Proposing to delete a note": "Propondo excluir uma nota",
  "Checking projects": "Verificando projetos",
  "Creating project “{name}”": "Criando o projeto “{name}”",
  "Proposing plan “{title}”": "Propondo o plano “{title}”",
  "Setting reminder “{message}”": "Criando o lembrete “{message}”",
  "Scheduling “{name}”": "Agendando “{name}”",
  "Checking schedules": "Verificando agendamentos",
  "Proposing to cancel a schedule": "Propondo cancelar um agendamento",
  "Sending a notification": "Enviando uma notificação",
  "Searching for “{query}”": "Buscando “{query}”",
  "Adding task “{title}”": "Adicionando a tarefa “{title}”",
  "Checking open tasks": "Verificando tarefas abertas",
  "Checking today tasks": "Verificando tarefas de hoje",
  "Checking overdue tasks": "Verificando tarefas atrasadas",
  "Checking upcoming tasks": "Verificando próximas tarefas",
  "Checking completed tasks": "Verificando tarefas concluídas",
  "Checking all tasks": "Verificando todas as tarefas",
  "Checking {view} tasks": "Verificando tarefas ({view})",
  "Updating task “{task}”": "Atualizando a tarefa “{task}”",
  "Completing “{task}”": "Concluindo “{task}”",
  "Proposing to delete “{task}”": "Propondo excluir “{task}”",

  // MCP servers
  "MCP servers can only be managed from the Talorys app.": "Os servidores MCP só podem ser gerenciados pelo app do Talorys.",
  "MCP servers are turned off for this deployment (TALORYS_MCP=off).": "Os servidores MCP estão desligados nesta instalação (TALORYS_MCP=off).",
  "MCP server not found.": "Servidor MCP não encontrado.",
  "You can add up to {max} MCP servers.": "Você pode adicionar até {max} servidores MCP.",
  "Only bearer-token servers take a token.": "Só servidores com token Bearer aceitam um token.",
  "Enter the bearer token for this server.": "Informe o token Bearer deste servidor.",
  "This server requires authentication. Add its bearer token.": "Este servidor exige autenticação. Adicione o token Bearer dele.",
  "The stored credential can't be read (was MCP_CREDENTIAL_KEY changed?). Enter the token again.": "A credencial armazenada não pode ser lida (a MCP_CREDENTIAL_KEY mudou?). Informe o token novamente.",
  "Open Settings → Integrations and connect this server to sign in.": "Abra Configurações → Integrações e conecte este servidor para entrar.",
  "This sign-in link expired or was already used. Start again from Settings → Integrations.": "Este link de login expirou ou já foi usado. Comece novamente em Configurações → Integrações.",
  "Turn this server on before connecting.": "Ative este servidor antes de conectar.",
  "Tool not found.": "Ferramenta não encontrada.",
  "The server no longer offers this tool.": "O servidor não oferece mais esta ferramenta.",
  "This tool can't be used.": "Esta ferramenta não pode ser usada.",
  "You can enable up to {max} MCP tools at once. Turn one off first.": "Você pode ativar até {max} ferramentas MCP ao mesmo tempo. Desative uma primeiro.",
  "These tools' descriptions would take up too much of the AI's context. Turn some off first.": "As descrições dessas ferramentas ocupariam contexto demais da IA. Desative algumas primeiro.",
  "Credential storage isn't set up on this deployment. Run `npx create-talorys update` to add the MCP_CREDENTIAL_KEY secret.":
    "O armazenamento de credenciais não está configurado nesta instalação. Execute `npx create-talorys update` para adicionar o segredo MCP_CREDENTIAL_KEY.",
  "The MCP server tried to send Talorys to a different address.": "O servidor MCP tentou enviar o Talorys para um endereço diferente.",
  "The MCP server answered with a redirect. Use the server's final URL instead.": "O servidor MCP respondeu com um redirecionamento. Use a URL final do servidor.",
  "Enter a full MCP server URL, like https://example.com/mcp.": "Informe a URL completa do servidor MCP, como https://example.com/mcp.",
  "MCP servers must use https://.": "Servidores MCP precisam usar https://.",
  "Put credentials in the authentication field, not in the URL.": "Coloque as credenciais no campo de autenticação, não na URL.",
  "The MCP server URL can't contain a #fragment.": "A URL do servidor MCP não pode conter um #fragmento.",
  "This address is on a private or local network. Talorys only connects to public MCP servers.": "Este endereço está em uma rede privada ou local. O Talorys só se conecta a servidores MCP públicos.",
  "Could not look up the MCP server's address. Check the URL and try again.": "Não foi possível consultar o endereço do servidor MCP. Confira a URL e tente novamente.",
  "The MCP server's host name doesn't resolve to an address.": "O nome de host do servidor MCP não resolve para um endereço.",
  "This host name points to a private or local network address, so Talorys won't connect to it.": "Este nome de host aponta para um endereço de rede privada ou local, então o Talorys não vai se conectar.",
  "This server requires authentication, or the credential was rejected.": "Este servidor exige autenticação, ou a credencial foi rejeitada.",
  "Signing in to this server failed. Try again, or check that it supports OAuth sign-in for new apps (dynamic client registration).":
    "O login neste servidor falhou. Tente novamente, ou confira se ele suporta login OAuth para novos apps (registro dinâmico de clientes).",
  "The MCP server is temporarily unavailable.": "O servidor MCP está temporariamente indisponível.",
  "The MCP server took too long to respond.": "O servidor MCP demorou demais para responder.",
  "Talorys blocked a request the MCP server asked for.": "O Talorys bloqueou uma solicitação que o servidor MCP pediu.",
  "The MCP server sent a response Talorys couldn't use.": "O servidor MCP enviou uma resposta que o Talorys não conseguiu usar.",
  "The MCP server's response was too large.": "A resposta do servidor MCP era grande demais.",
  "Sign in to finish connecting this server.": "Entre para concluir a conexão com este servidor.",
  "Sign-in is needed again. Connect to start it.": "É preciso entrar novamente. Conecte para começar.",
  "Could not connect to the MCP server: it took too long to respond.": "Não foi possível conectar ao servidor MCP: ele demorou demais para responder.",
  "Could not connect to the MCP server. Check the URL, or try again later.": "Não foi possível conectar ao servidor MCP. Confira a URL ou tente novamente mais tarde.",
  "Could not connect: this doesn't look like a Streamable HTTP MCP server.": "Não foi possível conectar: isto não parece um servidor MCP Streamable HTTP.",
  "Sign-in was cancelled or refused. Connect again to retry.": "O login foi cancelado ou recusado. Conecte novamente para tentar outra vez.",
  "Signing in to this server failed. Connect again to retry.": "O login neste servidor falhou. Conecte novamente para tentar outra vez.",
  "The server did not return any compatible tools.": "O servidor não retornou nenhuma ferramenta compatível.",
  "Only the first {count} tools are shown.": "Apenas as primeiras {count} ferramentas são mostradas.",
  "Its input schema is too large.": "O esquema de entrada dela é grande demais.",
  "Its input schema is nested too deeply.": "O esquema de entrada dela tem aninhamento profundo demais.",
  "Its input schema isn't an object.": "O esquema de entrada dela não é um objeto.",
  "Its input schema uses features Talorys can't validate.": "O esquema de entrada dela usa recursos que o Talorys não consegue validar.",

  // Validation messages from shared schemas
  "Unknown IANA timezone": "Fuso horário IANA desconhecido",
  "Must be a Workers AI model id": "Precisa ser um ID de modelo do Workers AI",
  "Choose at least one day.": "Escolha pelo menos um dia.",
  "Expected YYYY-MM-DDTHH:MM local time": "Esperado horário local no formato AAAA-MM-DDTHH:MM",
  "Not a valid calendar date": "Não é uma data válida",
};

const CATALOGS: Partial<Record<Language, Catalog>> = { "pt-BR": PT_BR };

/** Placeholders whose value is itself server text (a topic, a priority), translated too. */
const NESTED = new Set(["topic", "priority"]);

interface Pattern {
  regex: RegExp;
  names: string[];
  translation: string;
}

const compiled = new Map<Language, Pattern[]>();

function patterns(language: Language, catalog: Catalog): Pattern[] {
  let list = compiled.get(language);
  if (!list) {
    list = Object.entries(catalog)
      .filter(([source]) => source.includes("{"))
      .map(([source, translation]) => {
        const names: string[] = [];
        const body = source
          .split(/(\{\w+\})/)
          .map((part) => {
            const name = /^\{(\w+)\}$/.exec(part)?.[1];
            if (name) {
              names.push(name);
              return "([\\s\\S]+?)";
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("");
        return { regex: new RegExp(`^${body}$`), names, translation };
      });
    compiled.set(language, list);
  }
  return list;
}

function localizeLine(line: string, language: Language, catalog: Catalog, depth = 0): string {
  const exact = catalog[line];
  if (exact !== undefined) return exact;
  for (const pattern of patterns(language, catalog)) {
    const match = pattern.regex.exec(line);
    if (!match) continue;
    return pattern.translation.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const index = pattern.names.indexOf(name);
      if (index < 0) return whole;
      const value = match[index + 1]!;
      return NESTED.has(name) && depth < 1 ? localizeLine(value, language, catalog, depth + 1) : value;
    });
  }
  // Validation errors read "field: message"; translate the message and keep the field name.
  const field = /^([\w.[\]]+): (.+)$/.exec(line);
  if (field && depth < 1) {
    const message = localizeLine(field[2]!, language, catalog, depth + 1);
    if (message !== field[2]) return `${field[1]}: ${message}`;
  }
  return line;
}

/** `text` from the server in `language`, line by line; English and unknown text stay as written. */
export function localizeServerText(text: string, language: Language): string {
  const catalog = CATALOGS[language];
  if (!catalog || !text) return text;
  return text
    .split("\n")
    .map((line) => localizeLine(line, language, catalog))
    .join("\n");
}

/** Every catalog, for tests that keep translations in step with the English text. */
export const SERVER_TEXT_CATALOGS = CATALOGS;
