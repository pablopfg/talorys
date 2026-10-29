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
  "Notification not found": "Notificação não encontrada",
  "Changed alert preferences": "Preferências de avisos alteradas",
  "Invalid input": "Dados inválidos",
  "Something went wrong.": "Algo deu errado.",
  "Something went wrong. Your data is safe; please try again.": "Algo deu errado. Seus dados estão seguros; tente novamente.",
  "Unknown API route": "Rota da API desconhecida",
  "Missing CSRF header.": "Cabeçalho CSRF ausente.",
  "Cross-origin request rejected.": "Solicitação de outra origem rejeitada.",
  "Cross-site request rejected.": "Solicitação de outro site rejeitada.",
  "HTTPS is required.": "É preciso usar HTTPS.",
  "The client address is missing. Reach Talorys through its Cloudflare URL.": "O endereço do cliente está ausente. Acesse o Talorys pela URL da Cloudflare.",
  "Must be a 65-byte P-256 key in base64url": "Precisa ser uma chave P-256 de 65 bytes em base64url",
  "Must be 16 bytes in base64url": "Precisa ter 16 bytes em base64url",
  "Please sign in.": "Faça login.",
  "Request body too large.": "O corpo da solicitação é grande demais.",
  "Request body must be valid JSON.": "O corpo da solicitação precisa ser um JSON válido.",
  "Session not found": "Sessão não encontrada",
  "Talorys is unreachable.": "Não foi possível conectar ao Talorys.",
  "The backend service binding is missing. Re-run the Talorys installer.": "O service binding do backend está ausente. Execute o instalador do Talorys novamente.",
  "The Talorys backend is unreachable. Please try again shortly.": "O backend do Talorys está inacessível. Tente novamente em instantes.",

  // Sign-in and passwords
  "Incorrect password.": "Senha incorreta.",
  "Incorrect code.": "Código incorreto.",
  "This link has expired or was already used. Ask for a new one.": "Este link expirou ou já foi usado. Peça um novo.",
  "Enter the code from your authenticator app, or a recovery code.": "Digite o código do app autenticador ou um código de recuperação.",
  "Password recovery by e-mail is not set up.": "A recuperação de senha por e-mail não está configurada.",
  "Someone asked to reset your Talorys password. To choose a new one, open this link within 30 minutes:": "Alguém pediu para redefinir a sua senha do Talorys. Para escolher uma nova, abra este link em até 30 minutos:",
  "The link works once. If it wasn't you, ignore this e-mail: your password stays the same.": "O link funciona uma vez. Se não foi você, ignore este e-mail: a sua senha continua a mesma.",
  "Reset your password": "Redefinir a sua senha",
  "Password reset by e-mail": "Senha redefinida por e-mail",
  "Your Talorys password was reset with the link sent to your e-mail, and every session was signed out. If it wasn't you, reset the owner password on Cloudflare right away (see the security guide) and check your e-mail account.": "A sua senha do Talorys foi redefinida com o link enviado ao seu e-mail, e todas as sessões foram encerradas. Se não foi você, redefina a senha do dono na Cloudflare agora (veja o guia de segurança) e confira a sua conta de e-mail.",
  "Password reset with the e-mailed link; all sessions signed out and access tokens revoked": "Senha redefinida com o link enviado por e-mail; todas as sessões encerradas e tokens de acesso revogados",
  "Confirm that you are not a robot, then sign in.": "Confirme que você não é um robô e entre de novo.",
  "The robot check failed. Please do it again.": "A verificação contra robôs falhou. Faça-a de novo.",
  "The robot check could not be confirmed right now. Please try again shortly.": "Não foi possível confirmar a verificação contra robôs agora. Tente de novo em instantes.",
  "This sign-in has expired. Enter your password again.": "Este login expirou. Digite sua senha de novo.",
  "Too many wrong codes. Enter your password again.": "Códigos errados demais. Digite sua senha de novo.",
  "Send the password or a code.": "Envie a senha ou um código.",
  "Two-step sign-in is already on. Turn it off first to use another app.": "A verificação em duas etapas já está ativa. Desative-a antes para usar outro app.",
  "Two-step sign-in is already on.": "A verificação em duas etapas já está ativa.",
  "Two-step sign-in is off.": "A verificação em duas etapas está desativada.",
  "Incorrect code. Check that your phone's clock is right and try again.": "Código incorreto. Confira se o relógio do celular está certo e tente de novo.",
  "Wrong sign-in codes": "Códigos de login errados",
  "Someone typed your password correctly but got the two-step code wrong 3 times in a row. If it wasn't you, change your password now.":
    "Alguém digitou sua senha certa, mas errou o código da verificação em duas etapas 3 vezes seguidas. Se não foi você, troque a senha agora.",
  "Recovery code used": "Código de recuperação usado",
  "A recovery code was used to sign in. Recovery codes left: {count}. If it wasn't you, change your password now.":
    "Um código de recuperação foi usado para entrar. Códigos restantes: {count}. Se não foi você, troque a senha agora.",
  "Your last recovery code was used to sign in. Make new ones in Settings → Security. If it wasn't you, change your password now.":
    "Seu último código de recuperação foi usado para entrar. Gere novos em Configurações → Segurança. Se não foi você, troque a senha agora.",
  "Two-step sign-in on": "Verificação em duas etapas ativada",
  "Signing in now also asks for a code from your authenticator app. Other sessions were signed out.":
    "Agora o login também pede um código do seu app autenticador. As outras sessões foram encerradas.",
  "Two-step sign-in off": "Verificação em duas etapas desativada",
  "Signing in no longer asks for a code. If it wasn't you, change your password now and turn it back on in Settings → Security.":
    "O login não pede mais o código. Se não foi você, troque a senha agora e ative de novo em Configurações → Segurança.",
  "Two-step sign-in turned on": "Verificação em duas etapas ativada",
  "Two-step sign-in turned off": "Verificação em duas etapas desativada",
  "New recovery codes made": "Novos códigos de recuperação gerados",
  "Confirm your password to continue.": "Confirme sua senha para continuar.",
  "Current password is incorrect.": "A senha atual está incorreta.",
  "Too many failed attempts. Please wait before trying again.": "Muitas tentativas sem sucesso. Aguarde antes de tentar novamente.",
  "Many failed sign-ins": "Muitas tentativas de login falharam",
  "Signed out: no use": "Sessão encerrada: sem uso",
  "Signed out: no open tab": "Sessão encerrada: nenhuma aba aberta",
  "Signed out: maximum session length": "Sessão encerrada: duração máxima atingida",
  "Many sign-in attempts with a wrong password came from different networks in the last 15 minutes. Until they stop, each unknown network gets one attempt every 15 minutes; your recent networks are not affected. If this wasn't you, consider putting Cloudflare Access in front of Talorys.":
    "Muitas tentativas de login com senha errada vieram de redes diferentes nos últimos 15 minutos. Enquanto elas continuarem, cada rede desconhecida tem uma tentativa a cada 15 minutos; as suas redes recentes não são afetadas. Se não foi você, considere colocar o Cloudflare Access na frente do Talorys.",
  "Sign in through Cloudflare Access to continue.": "Entre pelo Cloudflare Access para continuar.",
  "Cloudflare Access is not configured correctly.": "O Cloudflare Access não está configurado corretamente.",
  "Owner credentials are not configured. Run the Talorys installer, or set a strong OWNER_PASSWORD and SESSION_SECRET with `wrangler secret put`.":
    "As credenciais do proprietário não estão configuradas. Execute o instalador do Talorys ou defina OWNER_PASSWORD e SESSION_SECRET fortes com `wrangler secret put`.",
  "Use at least {min} characters.": "Use pelo menos {min} caracteres.",
  "Use at most 256 characters.": "Use no máximo 256 caracteres.",
  "Avoid repeating a single character.": "Evite repetir um único caractere.",
  "This password appeared in a known data breach. Choose another one.": "Esta senha apareceu em um vazamento de dados conhecido. Escolha outra.",
  "Incorrect email or password.": "E-mail ou senha incorretos.",
  "Password changed": "Senha alterada",
  "Your Talorys password was changed and the other sessions were signed out. If it wasn't you, reset the owner password on Cloudflare right away (see the security guide).":
    "A senha do Talorys foi alterada e as outras sessões foram encerradas. Se não foi você, redefina a senha do proprietário na Cloudflare imediatamente (veja o guia de segurança).",
  "Remote access on": "Acesso remoto ativado",
  "Remote access was turned on: apps with an access token can now reach your data. If it wasn't you, turn it off in Settings → Security → Remote access and change your password.":
    "O acesso remoto foi ativado: apps com um token de acesso agora alcançam seus dados. Se não foi você, desative em Configurações → Segurança → Acesso remoto e troque a senha.",
  "Access token created": "Token de acesso criado",
  "A new access token was created. If it wasn't you, revoke it in Settings → Security → Remote access and change your password.":
    "Um novo token de acesso foi criado. Se não foi você, revogue em Configurações → Segurança → Acesso remoto e troque a senha.",
  "Telegram linked": "Telegram vinculado",
  "A Telegram chat was linked to Talorys and will receive your alerts. If it wasn't you, unlink Telegram in Settings → Alerts and change your password.":
    "Um chat do Telegram foi vinculado ao Talorys e vai receber seus avisos. Se não foi você, desvincule o Telegram em Configurações → Avisos e troque a senha.",
  "Telegram group linked": "Grupo do Telegram vinculado",
  "A Telegram group was linked and now receives your alerts. If it wasn't you, unlink Telegram in Settings → Alerts and change your password.":
    "Um grupo do Telegram foi vinculado e agora recebe seus avisos. Se não foi você, desvincule o Telegram em Configurações → Avisos e troque a senha.",
  "Telegram conversation on": "Conversa no Telegram ligada",
  "The conversation with Talorys in the Telegram chat was turned on. If it wasn't you, turn it off in Settings → Alerts and change your password.":
    "A conversa com o Talorys no chat do Telegram foi ligada. Se não foi você, desligue em Configurações → Avisos e troque a senha.",
  "Backup exported": "Backup exportado",
  "A full backup of your data was downloaded. If it wasn't you, change your password now and sign out the other sessions.":
    "Um backup completo dos seus dados foi baixado. Se não foi você, troque a senha agora e encerre as outras sessões.",
  "Backup imported": "Backup importado",
  "A backup was imported into Talorys. If it wasn't you, change your password now and check your data.":
    "Um backup foi importado no Talorys. Se não foi você, troque a senha agora e confira seus dados.",
  "This is a test e-mail from Talorys. E-mail alerts work.": "Este é um e-mail de teste do Talorys. Os avisos por e-mail estão funcionando.",
  "Test e-mail": "E-mail de teste",
  "This is the last e-mail alert for today. Until tomorrow, alerts stay in the app, push and Telegram.":
    "Este é o último aviso por e-mail de hoje. Até amanhã, os avisos ficam no app, no push e no Telegram.",
  "Other alerts stop going by e-mail for today; security and critical alerts still do.":
    "Os outros avisos param de ir por e-mail hoje; os de segurança e os críticos continuam indo.",
  "Telegram unlinked": "Telegram desvinculado",
  "Telegram was unlinked: alerts no longer reach it. If it wasn't you, link it again in Settings → Alerts and change your password.":
    "O Telegram foi desvinculado: os avisos não chegam mais lá. Se não foi você, vincule de novo em Configurações → Avisos e troque a senha.",
  "New push device": "Novo aparelho no push",
  "A new device now receives your push notifications. If it wasn't you, remove it in Settings → Alerts and change your password.":
    "Um aparelho novo passou a receber suas notificações push. Se não foi você, remova em Configurações → Avisos e troque a senha.",
  "Push device removed": "Aparelho removido do push",
  "A device was removed from push notifications. If it wasn't you, check the devices in Settings → Alerts and change your password.":
    "Um aparelho foi removido das notificações push. Se não foi você, confira os aparelhos em Configurações → Avisos e troque a senha.",
  "MCP server added": "Servidor MCP adicionado",
  "A new MCP server was added: the agent can now use its tools. If it wasn't you, remove it in Settings → Integrations and change your password.":
    "Um servidor MCP novo foi adicionado: o agente agora pode usar as ferramentas dele. Se não foi você, remova em Configurações → Integrações e troque a senha.",
  "The sign-in activity was deleted. If it wasn't you, change your password now and sign out the other sessions.":
    "A atividade de acesso foi apagada. Se não foi você, troque a senha agora e encerre as outras sessões.",
  "Talorys never asks for your password or codes by e-mail.": "O Talorys nunca pede sua senha ou códigos por e-mail.",
  "Open Talorys:": "Abrir o Talorys:",
  "Choose which alerts reach your e-mail in Settings → Alerts.": "Escolha quais avisos chegam ao seu e-mail em Configurações → Avisos.",
  "E-mail alerts are not set up on this deployment.": "Os avisos por e-mail não estão configurados nesta instalação.",
  "The daily e-mail limit was reached. Try again tomorrow.": "O limite diário de e-mails foi atingido. Tente de novo amanhã.",
  "New sign-in": "Novo login",
  "Someone signed in to Talorys from a new device or country. If it wasn't you, change your password now and sign out the other sessions. Details in Settings → Security → Sign-in activity.":
    "Alguém entrou no Talorys por um aparelho ou país novo. Se não foi você, troque a senha agora e encerre as outras sessões. Detalhes em Configurações → Segurança → Atividade de acesso.",
  "Sign-in activity exported": "Atividade de acesso exportada",
  "Sign-in activity deleted": "Atividade de acesso apagada",
  "Sign-in activity retention changed": "Prazo da atividade de acesso alterado",
  "Too predictable: common words, sequences like 1234 and your own details don't count. Add more unrelated words.":
    "Previsível demais: palavras comuns, sequências como 1234 e seus próprios dados não contam. Acrescente mais palavras sem relação entre si.",
  "Choose a password different from the current one.": "Escolha uma senha diferente da atual.",
  "Couldn't check the password against known breaches right now. Try again in a minute.":
    "Não foi possível conferir a senha contra vazamentos conhecidos agora. Tente de novo em um minuto.",
  "Your password no longer meets the minimum requirements. Change it to continue.":
    "Sua senha não atende mais aos requisitos mínimos. Troque-a para continuar.",

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
  "A recording is already being transcribed.": "Uma gravação já está sendo transcrita.",
  "The recording is too long. Record a shorter clip.": "A gravação é longa demais. Grave um trecho mais curto.",
  "Talorys reached its daily limit of {max} minutes of voice input.": "O Talorys atingiu o limite diário de {max} minutos de entrada por voz.",
  "audio: Audio must be base64.": "audio: O áudio precisa estar em base64.",
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
  "You can have at most {max} active automations. Pause or delete one first.": "Você pode ter no máximo {max} automações ativas. Pause ou exclua uma primeiro.",
  "Access tokens cannot create or change AI prompt automations.": "Tokens de acesso não podem criar nem alterar automações de prompt de IA.",
  Reminder: "Lembrete",
  "Reminder delivered": "Lembrete entregue",
  "Nothing needed your attention": "Nada precisava da sua atenção",

  // Workflows (Cloudflare Workflows)
  "Site monitor": "Monitor de sites",
  "Feed news": "Novidades de feeds",
  "Use a full https:// address.": "Use um endereço https:// completo.",
  "An address can't carry a user name or password.": "Um endereço não pode levar usuário nem senha.",
  "This address is on a private or local network. Workflows only reach public sites.": "Este endereço é de uma rede privada ou local. Os workflows só acessam sites públicos.",
  "Workflows can only be managed from the Talorys app.": "Os workflows só podem ser gerenciados pelo app do Talorys.",
  "Workflow not found": "Workflow não encontrado",
  "Add at least one site to monitor.": "Adicione pelo menos um site para monitorar.",
  "Add at least one feed to read.": "Adicione pelo menos um feed para ler.",
  "At most {max} addresses.": "No máximo {max} endereços.",
  "Each address only once.": "Cada endereço só uma vez.",
  "A workflow needs a repeating schedule.": "Um workflow precisa de um agendamento que se repete.",
  "Cloudflare Workflows is not set up in this deployment. Add the workflows binding and deploy again.": "Os Workflows da Cloudflare não estão configurados nesta instalação. Adicione o binding de workflows e faça o deploy de novo.",
  "Wait {seconds} seconds before running this workflow again.": "Aguarde {seconds} segundos antes de executar este workflow de novo.",
  "The previous run is still going.": "A execução anterior ainda está em andamento.",
  "The run stopped answering and was given up.": "A execução parou de responder e foi abandonada.",
  "Cloudflare could not start the workflow. Try again later.": "A Cloudflare não conseguiu iniciar o workflow. Tente de novo mais tarde.",
  "The workflow failed on Cloudflare.": "O workflow falhou na Cloudflare.",
  "Workflow failed: {topic}": "Workflow falhou: {topic}",
  "A run of this workflow failed on Cloudflare. See its history in Workflows.": "Uma execução deste workflow falhou na Cloudflare. Veja o histórico em Workflows.",
  "Site down: {host}": "Site fora do ar: {host}",
  "Site back up: {host}": "Site de volta: {host}",
  "It was down since {when}.": "Estava fora do ar desde {when}.",
  "Feed unavailable: {host}": "Feed indisponível: {host}",
  "It could not be read {count} times in a row.": "Não foi possível ler {count} vezes seguidas.",
  "New in your feeds": "Novidades nos seus feeds",
  "And {count} more.": "E mais {count}.",
  "{up} of {total} sites up": "{up} de {total} sites no ar",
  "{count} new item(s)": "{count} item(ns) novo(s)",
  "{count} feed(s) read for the first time": "{count} feed(s) lido(s) pela primeira vez",
  "{count} feed(s) could not be read": "{count} feed(s) não puderam ser lidos",
  "The site answered with status {status}.": "O site respondeu com o status {status}.",
  "The feed answered with status {status}.": "O feed respondeu com o status {status}.",
  "Could not look up the address.": "Não foi possível consultar o endereço.",
  "The host name doesn't resolve to an address.": "O nome do host não aponta para nenhum endereço.",
  "The host name points to a private network address.": "O nome do host aponta para um endereço de rede privada.",
  "No answer within 15 seconds.": "Sem resposta em 15 segundos.",
  "Could not connect.": "Não foi possível conectar.",
  "No answer.": "Sem resposta.",
  "Too many redirects.": "Redirecionamentos demais.",
  "The address redirected to a place workflows can't reach.": "O endereço redirecionou para um lugar que os workflows não podem acessar.",
  "This address is not an RSS or Atom feed.": "Este endereço não é um feed RSS ou Atom.",
  "Turned on workflow “{topic}”": "Workflow “{topic}” ligado",
  "Turned off workflow “{topic}”": "Workflow “{topic}” desligado",
  "Changed workflow “{topic}”": "Workflow “{topic}” alterado",
  "Only AI routines can stay quiet when there is nothing to report.": "Só rotinas de IA podem ficar em silêncio quando não há nada a avisar.",
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
  "This backup is too large to import ({kind}: more than {max}).": "Este backup é grande demais para importar ({kind}: mais de {max}).",
  "This backup was made by a newer Talorys (format v{version}). Update Talorys first.": "Este backup foi feito por um Talorys mais novo (formato v{version}). Atualize o Talorys primeiro.",

  // Remote access
  "Invalid or revoked access token.": "Token de acesso inválido ou revogado.",
  "This route is not available to access tokens.": "Esta rota não está disponível para tokens de acesso.",
  "This access token is read-only.": "Este token de acesso é somente leitura.",
  "This access token can only send events.": "Este token de acesso só pode enviar eventos.",
  "Only an events access token can send events.": "Só um token de acesso de eventos pode enviar eventos.",
  "At most {max} events an hour. Please wait before sending more.": "No máximo {max} eventos por hora. Aguarde antes de enviar mais.",
  "At most {max} events a day. Please wait before sending more.": "No máximo {max} eventos por dia. Aguarde antes de enviar mais.",
  "Other events": "Outros eventos",
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

  // Telegram
  "Telegram is not set up on this deployment. Add the TELEGRAM_BOT_TOKEN secret first.": "O Telegram não está configurado nesta instalação. Adicione primeiro o segredo TELEGRAM_BOT_TOKEN.",
  "Telegram refused the bot token. Check the TELEGRAM_BOT_TOKEN secret.": "O Telegram recusou o token do bot. Confira o segredo TELEGRAM_BOT_TOKEN.",
  "Telegram could not be reached. Try again in a moment.": "Não foi possível falar com o Telegram. Tente de novo em instantes.",
  "Unknown webhook.": "Webhook desconhecido.",
  "Link the Telegram chat first.": "Vincule primeiro o chat do Telegram.",
  "Started linking Telegram": "Vinculação do Telegram iniciada",
  "Unlinked Telegram": "Telegram desvinculado",
  "Linked the Telegram chat": "Chat do Telegram vinculado",
  "Linked a Telegram group": "Grupo do Telegram vinculado",
  "Talorys is linked to this chat. Alerts will arrive here until you link a group.": "O Talorys está vinculado a este chat. Os avisos chegam aqui até você vincular um grupo.",
  "Link the private chat with this bot first, then add it to the group again.": "Vincule primeiro o chat privado com este bot e depois adicione-o ao grupo de novo.",
  "This group now receives Talorys alerts.": "Este grupo agora recebe os avisos do Talorys.",
  "Start a new conversation": "Começar uma conversa nova",
  "What this bot does": "O que este bot faz",
  "Turned on the Telegram conversation": "Conversa pelo Telegram ligada",
  "Turned off the Telegram conversation": "Conversa pelo Telegram desligada",
  "Started a new conversation. Your next message begins it.": "Conversa nova. Sua próxima mensagem começa ela.",
  "Write or send a voice message to talk to Talorys, as in the app's chat. /new starts a new conversation. Alerts arrive in the group, or here while no group is linked.": "Escreva ou mande uma mensagem de voz para conversar com o Talorys, como no chat do app. /new começa uma conversa nova. Os avisos chegam no grupo, ou aqui enquanto nenhum grupo estiver vinculado.",
  "Alerts arrive in the group, or here while no group is linked. The conversation through Telegram is off; turn it on in Settings → Alerts → Telegram.": "Os avisos chegam no grupo, ou aqui enquanto nenhum grupo estiver vinculado. A conversa pelo Telegram está desligada; ligue em Configurações → Avisos → Telegram.",
  "The conversation through Telegram is off. Turn it on in Settings → Alerts → Telegram.": "A conversa pelo Telegram está desligada. Ligue em Configurações → Avisos → Telegram.",
  "Talorys reads text and voice messages here.": "Aqui o Talorys lê mensagens de texto e de voz.",
  "This voice message is too long. Send up to 5 minutes, or write it.": "Esta mensagem de voz é longa demais. Envie até 5 minutos, ou escreva.",
  "Talorys couldn't transcribe this voice message. Try again, or write it.": "O Talorys não conseguiu transcrever esta mensagem de voz. Tente de novo, ou escreva.",
  "Talorys couldn't make out any words in this voice message. Try again, or write it.": "O Talorys não entendeu nenhuma palavra nesta mensagem de voz. Tente de novo, ou escreva.",
  "Talorys is still answering your last message. Wait for it, then write again.": "O Talorys ainda está respondendo sua última mensagem. Espere a resposta e escreva de novo.",
  "Talorys took too long to answer. Try again.": "O Talorys demorou demais para responder. Tente de novo.",
  "The answer was stopped.": "A resposta foi interrompida.",
  "Something here needs your confirmation. Open Talorys to review it.": "Algo aqui precisa da sua confirmação. Abra o Talorys para revisar.",
  "Open in Talorys": "Abrir no Talorys",
  "Only the owner can use these buttons.": "Só o dono pode usar estes botões.",
  "This alert no longer exists.": "Este aviso não existe mais.",
  "Snoozed for 1 hour.": "Adiado por 1 hora.",
  "This alert was already handled.": "Este aviso já foi tratado.",
  "Snoozed alert. Its full text is in the notification center.": "Aviso adiado. O texto completo está na central de notificações.",
  "Marked as done.": "Marcado como feito.",
  "Done": "Feito",
  "Snooze 1 h": "Adiar 1 h",
  "Mute this alert": "Silenciar este aviso",
  "Muted. Talorys stops insisting on this alert.": "Silenciado. O Talorys para de insistir neste aviso.",
  "Try {attempt} of {max}, not confirmed yet": "Tentativa {attempt} de {max}, ainda sem confirmação",
  "Alert not confirmed after {max} tries: “{alert}”": "Aviso não confirmado depois de {max} tentativas: “{alert}”",
  "{alert} ({attempt}/{max})": "{alert} ({attempt}/{max})",
  "Security alerts stop insisting only from Telegram.": "Alertas de segurança só param de insistir pelo Telegram.",
  "This security alert is still waiting for your confirmation on Telegram.": "Este alerta de segurança ainda espera a sua confirmação no Telegram.",
  "Open Talorys": "Abrir o Talorys",
  "Open Talorys to read it.": "Abra o Talorys para ler.",
  "Reminders": "Lembretes",
  "Digests": "Resumos",
  "Routines": "Rotinas",
  "Tasks": "Tarefas",
  "System": "Sistema",
  "Security": "Segurança",
  "Events": "Eventos",
  "Low priority": "Prioridade baixa",
  "Normal priority": "Prioridade normal",
  "High priority": "Prioridade alta",
  "Critical": "Crítica",
  "Test message: Telegram alerts work.": "Mensagem de teste: os avisos pelo Telegram funcionam.",

  // Priority that learns
  "Security alerts are always critical.": "Alertas de segurança são sempre críticos.",
  "This alert profile no longer exists.": "Este perfil de aviso não existe mais.",
  "Fixed the priority of a kind of alert": "Fixou a prioridade de um tipo de aviso",
  "Let a kind of alert learn its priority again": "Deixou um tipo de aviso aprender a prioridade de novo",
  "Reset what Talorys learned about a kind of alert": "Zerou o que o Talorys aprendeu sobre um tipo de aviso",
  "Alert priority learned: {alert} one level louder": "Prioridade aprendida: {alert} um nível acima",
  "Alert priority learned: {alert} one level quieter": "Prioridade aprendida: {alert} um nível abaixo",
  "One-time reminders": "Lembretes avulsos",
  "Change priority": "Corrigir prioridade",
  "Back": "Voltar",
  "Low": "Baixa",
  "Normal": "Normal",
  "High": "Alta",
  "Priority changed to {priority}. Talorys learns from this.": "Prioridade alterada para {priority}. O Talorys aprende com isso.",
  "Louder than usual: learned from how you handle these alerts": "Mais alta que o normal: aprendido com o que você faz com estes avisos",
  "Quieter than usual: learned from how you handle these alerts": "Mais baixa que o normal: aprendido com o que você faz com estes avisos",
  "The priority you fixed for these alerts": "A prioridade que você fixou para estes avisos",

  // Watchers and the daily summary
  "Task overdue": "Tarefa atrasada",
  "Task due within the hour": "Tarefa vence na próxima hora",
  "Task due in 24 hours": "Tarefa vence em 24 horas",
  "Task stalled": "Tarefa parada",
  "“{task}” was due {when}.": "“{task}” venceu {when}.",
  "“{task}” is due {when}.": "“{task}” vence {when}.",
  "“{task}” has been in progress for {days} days without changes.": "“{task}” está em andamento há {days} dias sem mudanças.",
  "Routine failing": "Rotina falhando",
  "“{routine}” failed its last 2 runs. See the error in Automations.": "“{routine}” falhou nas 2 últimas execuções. Veja o erro em Automações.",
  "MCP server needs attention": "Servidor MCP precisa de atenção",
  "“{server}” needs you to sign in again. Open Settings → Integrations.": "“{server}” precisa que você entre de novo. Abra Configurações → Integrações.",
  "“{server}” is failing. Open Settings → Integrations to reconnect it.": "“{server}” está falhando. Abra Configurações → Integrações para reconectar.",
  "AI budget used up": "Orçamento de IA esgotado",
  "Talorys used all {max} AI requests for today. Chat and AI routines resume tomorrow, or raise the limit in Settings → AI.": "O Talorys usou todos os {max} pedidos de IA de hoje. O chat e as rotinas de IA voltam amanhã, ou aumente o limite em Configurações → IA.",
  "AI budget almost used": "Orçamento de IA quase no fim",
  "Talorys used {used} of today's {max} AI requests.": "O Talorys usou {used} dos {max} pedidos de IA de hoje.",
  "Push notifications not arriving": "Notificações push não estão chegando",
  "None of your devices received the last push notifications. Open Settings → Alerts and turn them on again on each device.": "Nenhum dos seus aparelhos recebeu as últimas notificações push. Abra Configurações → Avisos e ative de novo em cada aparelho.",
  "Push device removed for inactivity": "Aparelho removido do push por inatividade",
  "“{device}” had not opened Talorys for {days} days and no longer receives push notifications. To get them again, open Talorys on it and turn them on in Settings → Alerts.": "“{device}” não abria o Talorys havia {days} dias e não recebe mais notificações push. Para voltar a recebê-las, abra o Talorys nele e ative em Configurações → Avisos.",
  "Time for a backup": "Hora de fazer um backup",
  "Your last backup is more than {days} days old. Export one in Settings → Data.": "Seu último backup tem mais de {days} dias. Exporte um em Configurações → Dados.",
  "Update available": "Atualização disponível",
  "Talorys {latest} is available (you have {current}). See how to update in the docs.": "O Talorys {latest} está disponível (você tem a {current}). Veja como atualizar na documentação.",
  "Daily summary": "Resumo do dia",
  "**Scheduled today ({count})**": "**Agendado para hoje ({count})**",
  "**Waiting in the app ({count})**": "**Esperando no app ({count})**",
  "**Priority learned this week**": "**Prioridade aprendida nesta semana**",
  "- {alert} one level louder": "- {alert} um nível acima",
  "- {alert} one level quieter": "- {alert} um nível abaixo",
  "- {alert} (unread)": "- {alert} (não lido)",

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
  "Rewrite the description of task {title}": "Reescrever a descrição da tarefa {title}",
  "Clear the description of task {title}": "Apagar a descrição da tarefa {title}",
  "Schedule AI routine {title}": "Agendar a rotina de IA {title}",
  "Schedule quiet AI routine {title}": "Agendar a rotina de IA silenciosa {title}",
  "Run “{tool}” on {where}": "Executar “{tool}” em {where}",
  "No passkey works on this address. Use the code from your authenticator app.": "Nenhuma passkey funciona neste endereço. Use o código do seu app autenticador.",
  "Turn on two-step sign-in with an authenticator app first. Its recovery codes are the way back in if you lose your passkeys.":
    "Ative primeiro a verificação em duas etapas com um app autenticador. Os códigos de recuperação dela são o caminho de volta se você perder suas passkeys.",
  "You already have {max} passkeys. Remove one first.": "Você já tem {max} passkeys. Remova uma primeiro.",
  "This passkey couldn't be checked, or the request expired. Try again.": "Não foi possível verificar esta passkey, ou o pedido expirou. Tente de novo.",
  "This passkey wasn't accepted. Try again or use the code from your app.": "Esta passkey não foi aceita. Tente de novo ou use o código do app.",
  "Passkey not found.": "Passkey não encontrada.",
  "Passkey added": "Passkey adicionada",
  "Passkey removed": "Passkey removida",
  "A new passkey can now do the second sign-in step. If it wasn't you, remove it in Settings → Security and change your password.":
    "Uma nova passkey agora pode fazer a segunda etapa do login. Se não foi você, remova-a em Configurações → Segurança e troque a senha.",
  "A passkey was removed from your sign-in. If it wasn't you, change your password now and check Settings → Security.":
    "Uma passkey foi removida do seu login. Se não foi você, troque a senha agora e confira Configurações → Segurança.",
  "Invalid encoding.": "Codificação inválida.",
  "This MCP server isn't on the list of allowed servers (TALORYS_MCP_ALLOWED_ORIGINS).": "Este servidor MCP não está na lista de servidores permitidos (TALORYS_MCP_ALLOWED_ORIGINS).",
  "This server's sign-in address ({origin}) isn't on the list of allowed servers (TALORYS_MCP_ALLOWED_ORIGINS).":
    "O endereço de login deste servidor ({origin}) não está na lista de servidores permitidos (TALORYS_MCP_ALLOWED_ORIGINS).",
  "TALORYS_MCP_ALLOWED_ORIGINS has an entry that isn't an origin like https://mcp.example.com, so no MCP server is allowed until it is fixed.":
    "TALORYS_MCP_ALLOWED_ORIGINS tem uma entrada que não é uma origem como https://mcp.example.com, então nenhum servidor MCP é permitido até ela ser corrigida.",
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
  "Proposing to rewrite “{task}”": "Propondo reescrever “{task}”",
  "Proposing AI routine “{name}”": "Propondo a rotina de IA “{name}”",

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
  "Only tools that run without asking can be used by scheduled automations, since nobody is there to approve them.": "Só ferramentas que executam sem perguntar podem ser usadas por automações agendadas, porque não há ninguém para aprová-las.",
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
  // Google Calendar
  "Google Calendar connected": "Google Agenda conectada",
  "Google Calendar disconnected": "Google Agenda desconectada",
  "A Google account's calendars were connected to Talorys. If it wasn't you, disconnect it in Settings → Integrations, remove Talorys from your Google account's third-party access and change your password.":
    "As agendas de uma conta Google foram conectadas ao Talorys. Se não foi você, desconecte em Configurações → Integrações, remova o Talorys dos acessos de terceiros da sua conta Google e troque a senha.",
  "Google Calendar can only be managed from the Talorys app.": "A Google Agenda só pode ser gerenciada pelo app do Talorys.",
  "Google Calendar isn't set up on this deployment. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and MCP_CREDENTIAL_KEY (see the Google Calendar guide).":
    "A Google Agenda não está configurada nesta instalação. Adicione GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e MCP_CREDENTIAL_KEY (veja o guia da Google Agenda).",
  "This Google sign-in expired or was already used. Start again from Settings → Integrations.":
    "Este login do Google expirou ou já foi usado. Comece de novo em Configurações → Integrações.",
  "Google access wasn't allowed. Connect again to retry.": "O acesso ao Google não foi permitido. Conecte de novo para tentar outra vez.",
  "Google didn't grant lasting access. Connect again and allow every permission asked.": "O Google não concedeu acesso duradouro. Conecte de novo e permita todas as permissões pedidas.",
  "Allow both permissions on Google's page (see your calendars, and see and edit their events). Connect again to retry.":
    "Permita as duas permissões na página do Google (ver suas agendas, e ver e editar os eventos delas). Conecte de novo para tentar outra vez.",
  "Google didn't return your main calendar. Try connecting again.": "O Google não devolveu sua agenda principal. Tente conectar de novo.",
  "Connect Google Calendar first.": "Conecte a Google Agenda primeiro.",
  "Calendar not found.": "Agenda não encontrada.",
  "Google only lets you read this calendar.": "O Google só permite ler esta agenda.",
  "This calendar only shares free and busy times, so there's nothing to read.": "Esta agenda só compartilha horários livres e ocupados, então não há nada para ler.",
  "Google didn't return an access token. Try again.": "O Google não devolveu um token de acesso. Tente de novo.",
  "Google access was revoked or expired. Connect again in Settings → Integrations.": "O acesso ao Google foi revogado ou expirou. Conecte de novo em Configurações → Integrações.",
  "Google refused the sign-in. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and the redirect address in the Google Cloud console.":
    "O Google recusou o login. Confira GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e o endereço de redirecionamento no console do Google Cloud.",
  "Google Calendar isn't connected.": "A Google Agenda não está conectada.",
  "Google Calendar needs to be connected again.": "A Google Agenda precisa ser conectada de novo.",
  "Couldn't reach Google Calendar. Try again in a minute.": "Não foi possível acessar a Google Agenda. Tente de novo em um minuto.",
  "Google Calendar refused the request.": "A Google Agenda recusou o pedido.",
  "Google Calendar refused access. Check the connection in Settings → Integrations.": "A Google Agenda recusou o acesso. Confira a conexão em Configurações → Integrações.",
  "That calendar or event doesn't exist anymore.": "Essa agenda ou evento não existe mais.",
  "The event changed in Google Calendar after it was proposed, so nothing was done. Ask again.": "O evento mudou na Google Agenda depois de proposto, então nada foi feito. Peça de novo.",
  "Google Calendar is limiting requests right now. Try again in a minute.": "A Google Agenda está limitando pedidos agora. Tente de novo em um minuto.",
  "Google Calendar couldn't do that right now. Try again later.": "A Google Agenda não conseguiu fazer isso agora. Tente de novo mais tarde.",
  "Calendar “{name}”: off": "Agenda “{name}”: desligada",
  "Calendar “{name}”: read": "Agenda “{name}”: só leitura",
  "Calendar “{name}”: write": "Agenda “{name}”: leitura e alterações",
  "Checking the calendar": "Verificando a agenda",
  "Searching the calendar for “{query}”": "Buscando “{query}” na agenda",
  "Proposing the event “{title}”": "Propondo o evento “{title}”",
  "Proposing a calendar change": "Propondo uma alteração na agenda",
  "Proposing to delete a calendar event": "Propondo excluir um evento da agenda",
  "Create {title} on {calendar}: {when}": "Criar {title} em {calendar}: {when}",
  "Change {title} on {calendar}: {changes}": "Alterar {title} em {calendar}: {changes}",
  "Delete {title} on {calendar}: {when}": "Excluir {title} em {calendar}: {when}",
  "rename to {title}": "renomear para {title}",
  "move from {before} to {after}": "mover de {before} para {after}",
  "change the place": "mudar o local",
  "change the notes": "mudar as observações",
  "Agent created the calendar event “{title}”": "O agente criou o evento “{title}” na agenda",
  "Agent changed a calendar event": "O agente alterou um evento da agenda",
  "Agent deleted a calendar event": "O agente excluiu um evento da agenda",
  "Choose a Google calendar that is open in Settings → Integrations.": "Escolha uma agenda do Google que esteja aberta em Configurações → Integrações.",
  "Open this calendar first (read only is enough).": "Abra esta agenda primeiro (só leitura basta).",
  "Choose one of the offered times": "Escolha um dos tempos oferecidos",
  "Skipped: the Google calendar this automation depends on isn't open anymore. Open it in Settings → Integrations or edit the automation.":
    "Pulada: a agenda do Google de que esta automação depende não está mais aberta. Abra-a em Configurações → Integrações ou edite a automação.",
  "Its Google calendar isn't open": "A agenda do Google dela não está aberta",
  "No events on “{name}” today": "Nenhum evento em “{name}” hoje",
  "First event on {name} at {time}": "Primeiro evento em {name} às {time}",
  "The first event of the day on {name} starts at {time}.": "O primeiro evento do dia em {name} começa às {time}.",
  "Notice before the first event ({name})": "Aviso antes do primeiro evento ({name})",
  "Calendar “{name}”: notice {minutes} min before the first event": "Agenda “{name}”: aviso {minutes} min antes do primeiro evento",
  "Calendar “{name}”: notice off": "Agenda “{name}”: aviso desligado",
  "**Calendar today ({count})**": "**Agenda de hoje ({count})**",
  "Access tokens cannot set a calendar condition.": "Tokens de acesso não podem definir uma condição de agenda.",
  "- all day — {title}": "- dia inteiro — {title}",
};

const CATALOGS: Partial<Record<Language, Catalog>> = { "pt-BR": PT_BR };

/** Placeholders whose value is itself server text (a topic, a priority), translated too. */
const NESTED = new Set(["topic", "priority", "alert", "changes"]);

/** Nested placeholders that hold a list joined with "; ", translated item by item. */
const LISTS = new Set(["changes"]);

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
      if (!NESTED.has(name) || depth >= 1) return value;
      if (LISTS.has(name)) return value.split("; ").map((item) => localizeLine(item, language, catalog, depth + 1)).join("; ");
      return localizeLine(value, language, catalog, depth + 1);
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
