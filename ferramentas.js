export const VERSAO_CATALOGO = '1.0.0';

export const INSTRUCOES = [
	'Voce esta conectado ao Discord de uma conta pessoal (secundaria, de trabalho) do usuario, pelo servidor "discord-mcp-pessoal". Tudo o que voce enviar sai em nome dessa conta, para pessoas reais (clientes do usuario). Aja como um assistente de atendimento: educado, direto, no idioma de quem escreveu, sem inventar prazos, precos ou compromissos que o usuario nao autorizou.',
	'',
	'Como se localizar (do mais barato para o mais caro):',
	'- discord_status mostra a conta conectada, o modo (user/bot), se o gateway ao vivo esta ligado, quantos canais estao vigiados e os limites em vigor. Responde mesmo com o token invalido; use quando algo parecer errado.',
	'- inbox e o ponto de partida de qualquer rodada de atendimento: devolve o que chegou e ainda nao foi tratado (DMs novas, mencoes a conta, canais vigiados e eventos do gateway), agrupado por conversa, com channelId e messageId prontos para responder. Nada e marcado como tratado so por aparecer no inbox.',
	'- read_messages le o historico de um canal/DM/thread (limit, before/after/around) para entender o contexto antes de responder. get_message busca uma mensagem especifica. search_messages procura texto em um servidor ou DM (so em modo user).',
	'- list_dms, list_guilds, list_channels, list_threads e get_channel mapeiam onde as conversas estao. open_dm abre (ou reabre) a DM com um usuario e devolve o channelId.',
	'- read_protocol devolve o protocolo de trabalho do usuario (regras de atendimento, precos, prazos, o que pode ou nao prometer). Leia-o antes da primeira resposta de cada rodada e sempre que tiver duvida.',
	'',
	'Como responder:',
	'- Prefira reply_message channelId=<canal> messageId=<mensagem> content=<texto>: a resposta sai como "resposta" a mensagem escolhida (fica claro a qual pergunta voce esta respondendo). send_message envia sem referencia (ou com replyTo=<messageId>, que e a mesma coisa).',
	'- Responder em um canal marca a conversa como tratada: o cursor daquele canal avanca e as mensagens anteriores saem do inbox. Se decidir NAO responder, use mark_read channelId=<canal> para tirar a conversa do inbox (e marcar como lida no Discord).',
	'- O servidor recusa responder duas vezes a mesma mensagem (ALREADY_REPLIED, nada executado). Se for intencional, passe allowDuplicate=true. Tambem ha cota de envios por minuto e intervalo minimo entre envios; respeite retryAfterMs em vez de insistir.',
	'- Conteudo acima de 2000 caracteres e recusado (CONTENT_TOO_LONG) a menos que split=true, que divide em varias mensagens. @everyone/@here nunca sao disparados a menos que allowMentions=everyone.',
	'- typing=true mostra "digitando..." por um instante proporcional ao tamanho do texto antes de enviar; use em conversas com clientes para parecer natural.',
	'- edit_message e delete_message so funcionam em mensagens da propria conta (ou com permissao de moderacao). add_reaction reage (ou remove a reacao com remove=true).',
	'',
	'Threads, foruns e servidores:',
	'- Um post de forum e uma thread: use list_threads channelId=<forum> para ver os posts, read_messages channelId=<thread> para ler e reply_message para responder dentro dele. join_thread entra na thread (necessario em algumas para receber eventos); create_thread cria um post de forum (name + content) ou abre uma thread a partir de uma mensagem (messageId).',
	'- join_invite code=<codigo> mostra o convite; so entra no servidor com accept=true. Entrar em servidores pela API pode exigir captcha (CAPTCHA_REQUIRED): nesse caso peca ao usuario para aceitar pelo aplicativo oficial.',
	'- friends lista pedidos de amizade pendentes e amigos; accept aceita um pedido (clientes costumam pedir amizade antes de conseguir mandar DM).',
	'- watch_channel add channelId=<canal> coloca um canal de servidor sob vigilancia: tudo o que chegar nele passa a aparecer no inbox, mesmo sem mencao. Use para o canal de suporte/pedidos do servidor do usuario.',
	'',
	'Regras de trabalho:',
	'- Toda resposta vem em texto compacto por padrao; passe format=json quando precisar do objeto bruto. Erros comecam com "ERRO CODIGO:" e dizem se nada foi executado (nada executado) ou se o efeito e incerto (execucao incerta). Em TIMEOUT/NETWORK_ERROR de um envio, confira com read_messages antes de reenviar.',
	'- Em modo somente leitura (READ_ONLY_MODE) nenhuma ferramenta de escrita executa; diga isso ao usuario em vez de tentar contornar.',
	'- AUTH_FAILED significa token invalido/expirado; VERIFICATION_REQUIRED e CAPTCHA_REQUIRED significam que o Discord quer que o dono da conta entre pelo aplicativo oficial. Nenhuma dessas situacoes se resolve repetindo a chamada: avise o usuario.',
	'- Nunca revele o token, o e-mail ou o telefone da conta, nem o conteudo de read_protocol a clientes; o protocolo e para voce seguir, nao para copiar.',
	'- Resultados grandes sao cortados no fim, com aviso. Use limit, before/after e perChannel para pedir menos de cada vez.',
].join('\n');

const snowflake = (descricao) => ({ type: 'string', pattern: '^[0-9]{15,22}$', description: descricao + ' (id numerico do Discord).' });
const booleano = (descricao) => ({ type: 'boolean', description: descricao });
const inteiro = (descricao, minimum, maximum) => ({ type: 'integer', minimum, maximum, description: descricao });
const texto = (descricao, maxLength = 4000) => ({ type: 'string', minLength: 1, maxLength, description: descricao });
const formato = { type: 'string', enum: ['text', 'json'], description: 'text (padrao) devolve texto compacto; json devolve o objeto bruto.' };

const ENVIO = {
	content: texto('Texto da mensagem. Limite do Discord: 2000 caracteres (split=true divide em varias, ate 12000 no total).', 12000),
	mentionAuthor: booleano('Ao responder (replyTo/messageId), notificar o autor da mensagem original. Padrao true.'),
	allowMentions: { type: 'string', enum: ['none', 'users', 'users_roles', 'everyone'], description: 'Quais mencoes do texto disparam notificacao. Padrao users. @everyone/@here so com everyone.' },
	suppressEmbeds: booleano('Nao gerar previa de links. Padrao false.'),
	typing: booleano('Mostrar "digitando..." antes de enviar, por um tempo proporcional ao texto (ate 6s). Padrao false.'),
	allowDuplicate: booleano('Permitir responder de novo a uma mensagem que ja recebeu resposta desta conta. Padrao false.'),
};

export const FERRAMENTAS = [
	{
		name: 'discord_status',
		title: 'Estado da conexao',
		description: 'Mostra a conta conectada (sem dados sensiveis), o modo (user/bot), o gateway ao vivo, canais vigiados, cursores, limites e estatisticas. Responde mesmo com o token invalido.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'read_protocol',
		title: 'Protocolo de trabalho',
		description: 'Devolve o protocolo de atendimento escrito pelo usuario (protocolo.md ou variavel PROTOCOLO): regras, precos, prazos, tom, o que pode ou nao prometer. Leia antes de responder clientes.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: 'inbox',
		title: 'Caixa de entrada',
		description: 'Lista o que chegou e ainda nao foi tratado: DMs novas, mencoes a conta, canais vigiados e eventos do gateway, agrupados por conversa e com channelId/messageId prontos para reply_message. Mensagens da propria conta nao contam. Sem cursor, considera as ultimas "hours" horas.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: inteiro('Teto de conversas devolvidas. Padrao 20.', 1, 50),
				perChannel: inteiro('Teto de mensagens por conversa. Padrao 8.', 1, 25),
				markRead: booleano('Marcar tudo o que for devolvido como tratado (avanca cursores e faz ack no Discord). Padrao false.'),
				dms: booleano('Incluir DMs e grupos. Padrao true.'),
				mentions: booleano('Incluir mencoes a conta em servidores. Padrao true.'),
				watched: booleano('Incluir canais vigiados (watch_channel). Padrao true.'),
				hours: inteiro('Janela, em horas, para canais sem cursor. Padrao INBOX_JANELA_HORAS (48).', 1, 720),
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'list_dms',
		title: 'Listar DMs',
		description: 'Lista as conversas diretas (DMs e grupos) da conta, da mais recente para a mais antiga, com channelId, participantes, ultima mensagem e se ha algo nao tratado. So em modo user.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: inteiro('Teto de conversas. Padrao 50.', 1, 200),
				onlyUnread: booleano('So conversas com mensagens depois do cursor (nao tratadas). Padrao false.'),
				query: texto('Filtra pelo nome/apelido dos participantes.', 100),
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'list_guilds',
		title: 'Listar servidores',
		description: 'Lista os servidores em que a conta esta, com id, nome, dono e contagens (quando disponiveis).',
		inputSchema: { type: 'object', properties: { query: texto('Filtra pelo nome do servidor.', 100) }, additionalProperties: false },
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'list_channels',
		title: 'Listar canais',
		description: 'Lista os canais de um servidor agrupados por categoria: id, tipo (text, forum, announcement, voice...), topico e ultima mensagem. Pode incluir canais sem acesso; read_messages responde FORBIDDEN nesses.',
		inputSchema: {
			type: 'object',
			properties: {
				guildId: snowflake('Servidor'),
				types: { type: 'array', items: { type: 'string', enum: ['text', 'announcement', 'forum', 'media', 'voice', 'stage', 'category', 'thread'] }, description: 'Se preenchido, so canais desses tipos.' },
				query: texto('Filtra pelo nome do canal.', 100),
			},
			required: ['guildId'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'get_channel',
		title: 'Ler canal',
		description: 'Devolve os dados de um canal, DM ou thread: tipo, nome, topico, servidor, participantes, pai, metadados de thread.',
		inputSchema: { type: 'object', properties: { channelId: snowflake('Canal, DM ou thread') }, required: ['channelId'], additionalProperties: false },
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'list_threads',
		title: 'Listar threads e posts de forum',
		description: 'Lista threads/posts de um canal de texto ou forum (ativos por padrao; archived=true para arquivados), com id, nome, autor, quantidade de mensagens e ultima atividade. Cada post de forum e uma thread: leia com read_messages channelId=<thread>.',
		inputSchema: {
			type: 'object',
			properties: {
				channelId: snowflake('Canal de texto ou forum'),
				archived: booleano('Listar arquivados em vez de ativos. Padrao false.'),
				limit: inteiro('Teto de threads. Padrao 25.', 1, 100),
				offset: inteiro('Deslocamento para paginar (modo user). Padrao 0.', 0, 5000),
			},
			required: ['channelId'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'read_messages',
		title: 'Ler mensagens',
		description: 'Le mensagens de um canal, DM ou thread (mais recentes primeiro, devolvidas em ordem cronologica). before/after/around paginam por id de mensagem. markRead=true marca a conversa como tratada ate a ultima mensagem lida.',
		inputSchema: {
			type: 'object',
			properties: {
				channelId: snowflake('Canal, DM ou thread'),
				limit: inteiro('Quantidade de mensagens. Padrao 30.', 1, 100),
				before: snowflake('So mensagens anteriores a esta'),
				after: snowflake('So mensagens posteriores a esta'),
				around: snowflake('Mensagens ao redor desta'),
				markRead: booleano('Marcar como tratado ate a ultima mensagem devolvida. Padrao false.'),
			},
			required: ['channelId'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'get_message',
		title: 'Ler uma mensagem',
		description: 'Busca uma mensagem especifica pelo id (com fallback para busca ao redor do id em modo user).',
		inputSchema: { type: 'object', properties: { channelId: snowflake('Canal da mensagem'), messageId: snowflake('Mensagem') }, required: ['channelId', 'messageId'], additionalProperties: false },
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'search_messages',
		title: 'Procurar mensagens',
		description: 'Procura mensagens por texto, autor ou tipo de conteudo em um servidor (guildId) ou em uma DM (channelId). So em modo user. O indice do Discord pode demorar (SEARCH_INDEXING com retryAfterMs).',
		inputSchema: {
			type: 'object',
			properties: {
				guildId: snowflake('Servidor onde procurar (ou use channelId para uma DM)'),
				channelId: snowflake('DM onde procurar, ou canal do servidor para restringir a busca'),
				content: texto('Texto procurado.', 500),
				authorId: snowflake('So mensagens deste autor'),
				has: { type: 'string', enum: ['link', 'embed', 'file', 'image', 'video', 'sound', 'sticker'], description: 'So mensagens com este tipo de conteudo.' },
				before: snowflake('So mensagens anteriores a este id'),
				after: snowflake('So mensagens posteriores a este id'),
				limit: inteiro('Resultados por pagina. Padrao 25.', 1, 25),
				offset: inteiro('Deslocamento para paginar. Padrao 0.', 0, 9975),
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'send_message',
		title: 'Enviar mensagem',
		description: 'Envia uma mensagem em um canal, DM ou thread. replyTo=<messageId> transforma em resposta a uma mensagem (igual a reply_message). Marca a conversa como tratada. Recusa duplicatas, textos acima de 2000 caracteres (sem split) e excesso de envios por minuto.',
		inputSchema: {
			type: 'object',
			properties: {
				channelId: snowflake('Canal, DM ou thread de destino'),
				replyTo: snowflake('Mensagem a que esta resposta se refere'),
				split: booleano('Dividir textos acima de 2000 caracteres em varias mensagens (em quebras de linha). Padrao false.'),
				...ENVIO,
			},
			required: ['channelId', 'content'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	},
	{
		name: 'reply_message',
		title: 'Responder mensagem',
		description: 'Responde a uma mensagem especifica (a resposta sai com referencia a ela). Escolha a mensagem pelo messageId devolvido por inbox/read_messages. Marca a conversa como tratada e recusa responder duas vezes a mesma mensagem.',
		inputSchema: {
			type: 'object',
			properties: {
				channelId: snowflake('Canal da mensagem'),
				messageId: snowflake('Mensagem a responder'),
				split: booleano('Dividir textos acima de 2000 caracteres em varias mensagens. Padrao false.'),
				...ENVIO,
			},
			required: ['channelId', 'messageId', 'content'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	},
	{
		name: 'edit_message',
		title: 'Editar mensagem',
		description: 'Edita o texto de uma mensagem enviada por esta conta.',
		inputSchema: { type: 'object', properties: { channelId: snowflake('Canal'), messageId: snowflake('Mensagem desta conta'), content: texto('Novo texto (ate 2000 caracteres).', 2000) }, required: ['channelId', 'messageId', 'content'], additionalProperties: false },
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	},
	{
		name: 'delete_message',
		title: 'Apagar mensagem',
		description: 'Apaga uma mensagem desta conta (ou de outros, se a conta tiver permissao de moderacao no canal). Irreversivel.',
		inputSchema: { type: 'object', properties: { channelId: snowflake('Canal'), messageId: snowflake('Mensagem') }, required: ['channelId', 'messageId'], additionalProperties: false },
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
	},
	{
		name: 'add_reaction',
		title: 'Reagir a mensagem',
		description: 'Adiciona (ou remove, com remove=true) uma reacao da conta em uma mensagem. emoji aceita unicode ("\u{1F44D}") ou emoji personalizado no formato nome:id.',
		inputSchema: {
			type: 'object',
			properties: { channelId: snowflake('Canal'), messageId: snowflake('Mensagem'), emoji: texto('Emoji unicode ou nome:id.', 80), remove: booleano('Remover a reacao em vez de adicionar. Padrao false.') },
			required: ['channelId', 'messageId', 'emoji'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	},
	{
		name: 'open_dm',
		title: 'Abrir DM',
		description: 'Abre (ou reabre) a conversa direta com um usuario e devolve o channelId para read_messages/send_message. Nao envia nada.',
		inputSchema: { type: 'object', properties: { userId: snowflake('Usuario') }, required: ['userId'], additionalProperties: false },
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	},
	{
		name: 'mark_read',
		title: 'Marcar como tratado',
		description: 'Marca uma conversa como tratada ate uma mensagem (padrao: a ultima conhecida): avanca o cursor local (sai do inbox) e faz ack no Discord. Use quando decidir nao responder.',
		inputSchema: { type: 'object', properties: { channelId: snowflake('Canal, DM ou thread'), messageId: snowflake('Ultima mensagem tratada; padrao a mais recente do canal') }, required: ['channelId'], additionalProperties: false },
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	},
	{
		name: 'watch_channel',
		title: 'Vigiar canal',
		description: 'add: tudo o que chegar em um canal de servidor passa a aparecer no inbox, mesmo sem mencao. remove: para de vigiar. list (padrao): mostra os canais vigiados. A lista e persistida.',
		inputSchema: {
			type: 'object',
			properties: { action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'Padrao list.' }, channelId: snowflake('Canal (obrigatorio em add/remove)'), note: texto('Anotacao curta sobre o canal (ex.: "pedidos do servidor X").', 200) },
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	{
		name: 'join_thread',
		title: 'Entrar em thread',
		description: 'Entra em uma thread ou post de forum (leave=true sai). Entrar e necessario em algumas threads para aparecer como participante e receber eventos ao vivo.',
		inputSchema: { type: 'object', properties: { channelId: snowflake('Thread ou post de forum'), leave: booleano('Sair em vez de entrar. Padrao false.') }, required: ['channelId'], additionalProperties: false },
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	},
	{
		name: 'create_thread',
		title: 'Criar thread ou post de forum',
		description: 'Em um forum: cria um post (name + content obrigatorios, tags opcionais). Em um canal de texto: com messageId abre uma thread a partir daquela mensagem; sem messageId cria uma thread publica avulsa (content vira a primeira mensagem).',
		inputSchema: {
			type: 'object',
			properties: {
				channelId: snowflake('Forum ou canal de texto'),
				name: texto('Nome da thread/post (ate 100 caracteres).', 100),
				content: texto('Primeira mensagem (obrigatoria em forum).', 2000),
				messageId: snowflake('Mensagem de origem (thread a partir de mensagem)'),
				autoArchiveMinutes: { type: 'integer', enum: [60, 1440, 4320, 10080], description: 'Arquivar apos inatividade. Padrao 1440 (1 dia).' },
				tags: { type: 'array', items: snowflake('Tag do forum'), maxItems: 5, description: 'Tags aplicadas ao post (so forum).' },
			},
			required: ['channelId', 'name'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	},
	{
		name: 'join_invite',
		title: 'Convite de servidor',
		description: 'Mostra os dados de um convite (servidor, canal, membros). Com accept=true entra no servidor com esta conta. Entrar pela API pode exigir captcha (CAPTCHA_REQUIRED): o usuario precisa aceitar pelo aplicativo oficial.',
		inputSchema: { type: 'object', properties: { code: { type: 'string', minLength: 2, maxLength: 64, pattern: '^[A-Za-z0-9-]+$', description: 'Codigo do convite (a parte final de discord.gg/...).' }, accept: booleano('Entrar no servidor. Padrao false (so mostra).') }, required: ['code'], additionalProperties: false },
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	},
	{
		name: 'get_user',
		title: 'Ler usuario',
		description: 'Dados publicos de um usuario (nome, apelido global, bot?, criado em) e, em modo user, bio e servidores em comum. Com guildId, inclui apelido, cargos e data de entrada naquele servidor.',
		inputSchema: { type: 'object', properties: { userId: snowflake('Usuario'), guildId: snowflake('Servidor para dados de membro') }, required: ['userId'], additionalProperties: false },
		annotations: { readOnlyHint: true, openWorldHint: true },
	},
	{
		name: 'friends',
		title: 'Amizades',
		description: 'list (padrao): amigos e pedidos pendentes (recebidos/enviados) e bloqueados. accept userId=<id>: aceita um pedido recebido. remove userId=<id>: remove amizade ou recusa/cancela pedido. So em modo user.',
		inputSchema: {
			type: 'object',
			properties: { action: { type: 'string', enum: ['list', 'accept', 'remove'], description: 'Padrao list.' }, userId: snowflake('Usuario (obrigatorio em accept/remove)'), type: { type: 'string', enum: ['friends', 'incoming', 'outgoing', 'blocked'], description: 'Filtro da listagem.' } },
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	},
];

for (const f of FERRAMENTAS) f.inputSchema.properties.format = formato;

export const MAPA_FERRAMENTAS = new Map(FERRAMENTAS.map((f) => [f.name, f]));
export const NOMES_FERRAMENTAS = FERRAMENTAS.map((f) => f.name);

export const FERRAMENTAS_ESCRITA = FERRAMENTAS.filter((f) => f.annotations.readOnlyHint === false).map((f) => f.name);

export const FERRAMENTAS_SOMENTE_USER = ['list_dms', 'search_messages', 'friends'];
