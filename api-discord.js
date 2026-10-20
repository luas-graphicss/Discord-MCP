import { ErroMcp, dormir as dormirPadrao } from './nucleo.js';

const UA_PADRAO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const BUILD_PADRAO = 420000;

export const TIPOS_CANAL = { 0: 'text', 1: 'dm', 2: 'voice', 3: 'group', 4: 'category', 5: 'announcement', 10: 'announcement_thread', 11: 'thread', 12: 'private_thread', 13: 'stage', 14: 'directory', 15: 'forum', 16: 'media' };
export const TIPO_THREAD = new Set([10, 11, 12]);
export const TIPO_DM = new Set([1, 3]);
export const TIPOS_FILTRO = { text: [0], announcement: [5], forum: [15], media: [16], voice: [2], stage: [13], category: [4], thread: [10, 11, 12] };

const CODIGOS = {
	10003: ['NOT_FOUND', 'canal desconhecido'],
	10004: ['NOT_FOUND', 'servidor desconhecido'],
	10006: ['NOT_FOUND', 'convite desconhecido ou expirado'],
	10008: ['NOT_FOUND', 'mensagem desconhecida'],
	10013: ['NOT_FOUND', 'usuario desconhecido'],
	10062: ['NOT_FOUND', 'interacao desconhecida'],
	20009: ['BLOCKED', 'conteudo explicito bloqueado pelo filtro do canal'],
	20016: ['SLOWMODE', 'modo lento do canal: aguarde antes de enviar de novo'],
	20028: ['RATE_LIMITED', 'limite de escrita do canal atingido'],
	30003: ['LIMIT', 'limite de mensagens fixadas'],
	40002: ['VERIFICATION_REQUIRED', 'o Discord exige verificar a conta (e-mail/telefone) antes desta acao; faca isso no aplicativo oficial'],
	40003: ['RATE_LIMITED', 'abrindo DMs rapido demais'],
	40007: ['BANNED', 'a conta esta banida deste servidor'],
	40058: ['FORBIDDEN', 'sem permissao de ler o historico para responder a esta mensagem'],
	50001: ['FORBIDDEN', 'sem acesso a este recurso'],
	50006: ['EMPTY_MESSAGE', 'mensagem vazia'],
	50007: ['CANNOT_DM', 'nao e possivel enviar DM a este usuario (bloqueio, privacidade ou sem servidor em comum)'],
	50013: ['FORBIDDEN', 'sem permissao para esta acao'],
	50021: ['BAD_REQUEST', 'acao impossivel em mensagem de sistema'],
	50024: ['WRONG_CHANNEL_TYPE', 'acao impossivel neste tipo de canal'],
	50033: ['BAD_REQUEST', 'destinatario invalido'],
	50035: ['INVALID_FORM_BODY', 'corpo da requisicao invalido'],
	50083: ['THREAD_ARCHIVED', 'a thread esta arquivada; reabra antes de agir nela'],
	160005: ['THREAD_LOCKED', 'a thread esta trancada'],
	160006: ['LIMIT', 'limite de threads ativas atingido'],
	200000: ['BLOCKED', 'mensagem bloqueada pelo AutoMod do servidor'],
	200001: ['BLOCKED', 'mensagem bloqueada pelo AutoMod do servidor'],
	110000: ['SEARCH_INDEXING', 'o indice de busca ainda esta sendo montado'],
};

function chaveBucket(metodo, caminho) {
	const major = caminho.match(/^\/(?:channels|guilds)\/(\d+)/)?.[1] || '';
	const generica = caminho.replace(/\/reactions\/[^/]+/, '/reactions/:emoji').replace(/\d{15,22}/g, ':id');
	return `${metodo} ${generica} ${major}`;
}

export function montarQuery(params) {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
	const s = q.toString();
	return s ? `?${s}` : '';
}

export function superPropriedades(cfg) {
	const ua = cfg.USER_AGENT || UA_PADRAO;
	const versao = ua.match(/Chrome\/([\d.]+)/)?.[1] || '136.0.0.0';
	const props = { os: 'Windows', browser: 'Chrome', device: '', system_locale: cfg.IDIOMA || 'pt-BR', browser_user_agent: ua, browser_version: versao, os_version: '10', referrer: '', referring_domain: '', referrer_current: '', referring_domain_current: '', release_channel: 'stable', client_build_number: cfg.CLIENT_BUILD_NUMBER || BUILD_PADRAO, client_event_source: null };
	return btoa(unescape(encodeURIComponent(JSON.stringify(props))));
}

export class ClienteDiscord {
	constructor({ config, fetch: fetchFn, dormir, agora, log } = {}) {
		this.cfg = config;
		this.fetch = fetchFn || globalThis.fetch?.bind(globalThis);
		this.dormir = dormir || dormirPadrao;
		this.agora = agora || Date.now;
		this.log = log || (() => {});
		this.base = `https://discord.com/api/v${config.API_VERSAO}`;
		this.buckets = new Map();
		this.globalAte = 0;
		this.estatisticas = { requisicoes: 0, rateLimits: 0, erros: 0, tentativasExtras: 0, ultimaRequisicaoEm: null };
		this.modo = config.DISCORD_MODO;
	}

	cabecalhos(json) {
		const cfg = this.cfg;
		const h = { Authorization: this.modo === 'bot' ? `Bot ${cfg.DISCORD_TOKEN}` : cfg.DISCORD_TOKEN, Accept: '*/*' };
		if (json) h['Content-Type'] = 'application/json';
		if (this.modo === 'bot') {
			h['User-Agent'] = cfg.USER_AGENT || 'DiscordBot (https://github.com/discord-mcp-pessoal, 1.0.0)';
		} else {
			h['User-Agent'] = cfg.USER_AGENT || UA_PADRAO;
			h['X-Super-Properties'] = superPropriedades(cfg);
			h['X-Discord-Locale'] = cfg.IDIOMA || 'pt-BR';
			h['X-Discord-Timezone'] = cfg.FUSO || 'America/Sao_Paulo';
			h['X-Debug-Options'] = 'bugReporterEnabled';
			h['Accept-Language'] = `${cfg.IDIOMA || 'pt-BR'},en-US;q=0.9`;
			h.Origin = 'https://discord.com';
			h.Referer = 'https://discord.com/channels/@me';
			h['Sec-Fetch-Dest'] = 'empty';
			h['Sec-Fetch-Mode'] = 'cors';
			h['Sec-Fetch-Site'] = 'same-origin';
		}
		return h;
	}


	mapearErro(status, corpo, { criaConteudo = false } = {}) {
		const codigo = corpo && typeof corpo === 'object' ? corpo.code : undefined;
		const mensagemDiscord = corpo && typeof corpo === 'object' ? corpo.message : typeof corpo === 'string' ? corpo.slice(0, 300) : '';
		const extra = { status, nothingExecuted: true };
		if (corpo && typeof corpo === 'object' && (codigo != null || corpo.errors)) extra.discord = { code: codigo, message: mensagemDiscord, ...(corpo.errors ? { errors: corpo.errors } : {}) };
		else if (mensagemDiscord) extra.discord = mensagemDiscord;
		const retry = corpo && typeof corpo === 'object' && Number.isFinite(Number(corpo.retry_after)) ? Math.ceil(Number(corpo.retry_after) * 1000) : null;
		if (retry != null) extra.retryAfterMs = retry;
		if (status === 401) return new ErroMcp('AUTH_FAILED', 'token recusado pelo Discord (invalido, expirado ou conta desconectada)', { ...extra, hint: 'Gere um novo token na conta secundaria e atualize DISCORD_TOKEN. Nenhuma chamada vai funcionar ate la.' });
		if (status === 429) return new ErroMcp('RATE_LIMITED', `limite de taxa do Discord${corpo?.global ? ' (global)' : ''}; aguarde ${retry ?? '?'}ms`, { ...extra, retryAfterMs: retry ?? 5000 });
		if (corpo && typeof corpo === 'object' && corpo.captcha_key) return new ErroMcp('CAPTCHA_REQUIRED', 'o Discord pediu captcha para esta acao; conclua pelo aplicativo oficial', { ...extra, discord: { captcha_key: corpo.captcha_key, captcha_service: corpo.captcha_service } });
		const conhecido = CODIGOS[codigo];
		if (conhecido) return new ErroMcp(conhecido[0], conhecido[1], extra);
		if (status === 403) return new ErroMcp('FORBIDDEN', mensagemDiscord || 'acesso negado', extra);
		if (status === 404) return new ErroMcp('NOT_FOUND', mensagemDiscord || 'recurso nao encontrado', extra);
		if (status === 400 || status === 405 || status === 422) return new ErroMcp('BAD_REQUEST', mensagemDiscord || `requisicao recusada (${status})`, extra);
		if (status >= 500) return new ErroMcp('DISCORD_UNAVAILABLE', `Discord indisponivel (${status})`, { ...extra, nothingExecuted: !criaConteudo, executionUnknown: criaConteudo, retryAfterMs: 3000 });
		return new ErroMcp('DISCORD_ERROR', mensagemDiscord || `resposta inesperada (${status})`, { ...extra, nothingExecuted: !criaConteudo, executionUnknown: criaConteudo });
	}

	async esperarBucket(chave, criaConteudo) {
		const agora = this.agora();
		const espera = Math.max(this.globalAte - agora, (() => { const b = this.buckets.get(chave); return b && b.remaining <= 0 ? b.resetAt - agora : 0; })());
		if (espera <= 0) return;
		if (espera <= this.cfg.ESPERA_AUTOMATICA_MS) { await this.dormir(espera); return; }
		throw new ErroMcp('RATE_LIMITED', `limite de taxa local para esta rota; aguarde ${espera}ms`, { retryAfterMs: espera, nothingExecuted: true, hint: criaConteudo ? 'Nada foi enviado. Espere o tempo indicado e chame de novo.' : undefined });
	}

	registrarBucket(chave, res) {
		const remaining = Number(res.headers.get('x-ratelimit-remaining'));
		const resetAfter = Number(res.headers.get('x-ratelimit-reset-after'));
		if (Number.isFinite(remaining) && Number.isFinite(resetAfter)) this.buckets.set(chave, { remaining, resetAt: this.agora() + resetAfter * 1000 });
		if (this.buckets.size > 500) this.buckets.delete(this.buckets.keys().next().value);
	}


	async requisitar(metodo, caminho, { body, query, criaConteudo = false, aceitar202 = false } = {}) {
		if (!this.cfg.DISCORD_TOKEN) throw new ErroMcp('AUTH_MISSING', 'DISCORD_TOKEN nao configurado', { hint: 'Defina DISCORD_TOKEN (token da conta secundaria) no ambiente ou no .env.' });
		const chave = chaveBucket(metodo, caminho);
		const url = `${this.base}${caminho}${montarQuery(query)}`;
		const maxTentativas = 1 + (criaConteudo ? 0 : this.cfg.TENTATIVAS);
		let ultimo;
		for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
			await this.esperarBucket(chave, criaConteudo);
			if (tentativa > 1) this.estatisticas.tentativasExtras++;
			this.estatisticas.requisicoes++;
			this.estatisticas.ultimaRequisicaoEm = new Date(this.agora()).toISOString();
			const controle = new AbortController();
			const timer = setTimeout(() => controle.abort(), this.cfg.TEMPO_LIMITE_MS);
			let res;
			try {
				res = await this.fetch(url, { method: metodo, headers: this.cabecalhos(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined, signal: controle.signal, redirect: 'manual' });
			} catch (e) {
				clearTimeout(timer);
				const timeout = e?.name === 'AbortError';
				ultimo = new ErroMcp(timeout ? 'TIMEOUT' : 'NETWORK_ERROR', timeout ? `sem resposta do Discord em ${this.cfg.TEMPO_LIMITE_MS}ms` : `falha de rede: ${e?.message || e}`, { nothingExecuted: !criaConteudo, executionUnknown: criaConteudo, retryAfterMs: 2000, hint: criaConteudo ? 'O envio pode ter acontecido. Confira com read_messages antes de reenviar.' : undefined });
				this.log('warn', `${metodo} ${caminho}: ${ultimo.code}`, { tentativa });
				if (tentativa < maxTentativas) continue;
				this.estatisticas.erros++;
				throw ultimo;
			}
			clearTimeout(timer);
			this.registrarBucket(chave, res);
			const texto = await res.text();
			let corpo = null;
			if (texto) { try { corpo = JSON.parse(texto); } catch { corpo = texto; } }
			if (res.status === 202 && aceitar202) return { __status: 202, ...(corpo && typeof corpo === 'object' ? corpo : {}) };
			if (res.ok) return corpo;
			const erro = this.mapearErro(res.status, corpo, { criaConteudo });
			if (res.status === 429) {
				this.estatisticas.rateLimits++;
				const ms = erro.retryAfterMs ?? 5000;
				if (corpo?.global) this.globalAte = this.agora() + ms; else this.buckets.set(chave, { remaining: 0, resetAt: this.agora() + ms });
				if (tentativa < maxTentativas && ms <= this.cfg.ESPERA_AUTOMATICA_MS) { await this.dormir(ms); ultimo = erro; continue; }
			} else if (res.status >= 500 && tentativa < maxTentativas) {
				this.log('warn', `${metodo} ${caminho}: ${res.status}`, { tentativa });
				await this.dormir(Math.min(this.cfg.ESPERA_AUTOMATICA_MS, 500 * tentativa));
				ultimo = erro;
				continue;
			}
			this.estatisticas.erros++;
			throw erro;
		}
		this.estatisticas.erros++;
		throw ultimo || new ErroMcp('INTERNAL', 'sem resposta');
	}

	get = (caminho, query) => this.requisitar('GET', caminho, { query });
	post = (caminho, body, extra) => this.requisitar('POST', caminho, { body: body ?? {}, criaConteudo: true, ...extra });
	put = (caminho, body) => this.requisitar('PUT', caminho, { body });
	patch = (caminho, body) => this.requisitar('PATCH', caminho, { body });
	delete = (caminho) => this.requisitar('DELETE', caminho, {});


	eu() { return this.get('/users/@me'); }
	dmsAbertas() { return this.get('/users/@me/channels'); }
	abrirDm(userId) { return this.requisitar('POST', '/users/@me/channels', { body: this.modo === 'bot' ? { recipient_id: userId } : { recipients: [userId] } }); }
	servidores() { return this.get('/users/@me/guilds', { with_counts: true }); }
	mencoes(limit = 25) { return this.get('/users/@me/mentions', { limit: Math.min(100, Math.max(1, limit)), roles: true, everyone: false }); }
	relacoes() { return this.get('/users/@me/relationships'); }
	aceitarRelacao(userId) { return this.put(`/users/@me/relationships/${userId}`, {}); }
	removerRelacao(userId) { return this.delete(`/users/@me/relationships/${userId}`); }
	usuario(userId) { return this.get(`/users/${userId}`); }
	perfil(userId) { return this.get(`/users/${userId}/profile`, { with_mutual_guilds: true, with_mutual_friends_count: false }); }
	membro(guildId, userId) { return this.get(`/guilds/${guildId}/members/${userId}`); }
	cargos(guildId) { return this.get(`/guilds/${guildId}/roles`); }


	canal(channelId) { return this.get(`/channels/${channelId}`); }
	canaisDoServidor(guildId) { return this.get(`/guilds/${guildId}/channels`); }
	mensagens(channelId, { limit = 50, before, after, around } = {}) { return this.get(`/channels/${channelId}/messages`, { limit: Math.min(100, Math.max(1, limit)), before, after, around }); }
	async mensagem(channelId, messageId) {
		if (this.modo === 'bot') return this.get(`/channels/${channelId}/messages/${messageId}`);
		const lista = await this.mensagens(channelId, { around: messageId, limit: 3 });
		const m = Array.isArray(lista) ? lista.find((x) => x.id === messageId) : null;
		if (!m) throw new ErroMcp('NOT_FOUND', 'mensagem nao encontrada neste canal', { status: 404 });
		return m;
	}
	enviar(channelId, payload) { return this.requisitar('POST', `/channels/${channelId}/messages`, { body: payload, criaConteudo: true }); }
	editar(channelId, messageId, content) { return this.patch(`/channels/${channelId}/messages/${messageId}`, { content }); }
	apagar(channelId, messageId) { return this.delete(`/channels/${channelId}/messages/${messageId}`); }
	reagir(channelId, messageId, emoji) { return this.put(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, undefined); }
	removerReacao(channelId, messageId, emoji) { return this.delete(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`); }
	digitando(channelId) { return this.requisitar('POST', `/channels/${channelId}/typing`, { body: undefined }); }
	ack(channelId, messageId) { return this.requisitar('POST', `/channels/${channelId}/messages/${messageId}/ack`, { body: { token: null } }); }
	fixadas(channelId) { return this.get(`/channels/${channelId}/pins`); }


	async buscar({ guildId, channelId, content, authorId, has, before, after, offset }) {
		const query = { content, author_id: authorId, has, max_id: before, min_id: after, offset: offset || undefined, channel_id: guildId ? channelId : undefined };
		const caminho = guildId ? `/guilds/${guildId}/messages/search` : `/channels/${channelId}/messages/search`;
		const r = await this.requisitar('GET', caminho, { query, aceitar202: true });
		if (r && r.__status === 202) throw new ErroMcp('SEARCH_INDEXING', 'o Discord ainda esta indexando este conteudo; tente de novo em instantes', { retryAfterMs: Number.isFinite(Number(r.retry_after)) ? Math.ceil(Number(r.retry_after) * 1000) : 3000, status: 202 });
		return r;
	}


	threadsBusca(channelId, { archived = false, limit = 25, offset = 0 } = {}) { return this.get(`/channels/${channelId}/threads/search`, { archived, sort_by: 'last_message_time', sort_order: 'desc', limit: Math.min(25, Math.max(1, limit)), offset: offset || undefined, tag_setting: 'match_some' }); }
	threadsAtivasServidor(guildId) { return this.get(`/guilds/${guildId}/threads/active`); }
	threadsArquivadas(channelId, limit = 25) { return this.get(`/channels/${channelId}/threads/archived/public`, { limit: Math.min(100, Math.max(1, limit)) }); }
	entrarThread(channelId) { return this.put(`/channels/${channelId}/thread-members/@me`, undefined); }
	sairThread(channelId) { return this.delete(`/channels/${channelId}/thread-members/@me`); }
	criarPostForum(channelId, { name, content, autoArchive, tags }) { return this.requisitar('POST', `/channels/${channelId}/threads`, { body: { name, auto_archive_duration: autoArchive, message: { content }, applied_tags: tags?.length ? tags : undefined }, criaConteudo: true }); }
	criarThreadDeMensagem(channelId, messageId, { name, autoArchive }) { return this.requisitar('POST', `/channels/${channelId}/messages/${messageId}/threads`, { body: { name, auto_archive_duration: autoArchive }, criaConteudo: true }); }
	criarThreadAvulsa(channelId, { name, autoArchive }) { return this.requisitar('POST', `/channels/${channelId}/threads`, { body: { name, auto_archive_duration: autoArchive, type: 11 }, criaConteudo: true }); }


	convite(code) { return this.get(`/invites/${encodeURIComponent(code)}`, { with_counts: true, with_expiration: true }); }
	aceitarConvite(code) { return this.requisitar('POST', `/invites/${encodeURIComponent(code)}`, { body: { session_id: null }, criaConteudo: true }); }
}


export function normalizarMensagem(m, meuId, { canalRotulo } = {}) {
	if (!m || typeof m !== 'object') return null;
	const autor = m.author || {};
	const mencionado = !!meuId && (Array.isArray(m.mentions) && m.mentions.some((u) => u?.id === meuId) || (m.referenced_message?.author?.id === meuId && m.type === 19));
	const out = {
		id: m.id,
		channelId: m.channel_id,
		guildId: m.guild_id || undefined,
		author: { id: autor.id, username: autor.username, globalName: autor.global_name || null, bot: !!autor.bot },
		mine: !!meuId && autor.id === meuId,
		content: m.content || '',
		timestamp: m.timestamp,
		editedTimestamp: m.edited_timestamp || null,
		type: m.type && m.type !== 19 ? m.type : undefined,
		pinned: !!m.pinned,
		mentionsMe: mencionado,
		mentionsEveryone: !!m.mention_everyone,
	};
	if (canalRotulo) out.channel = canalRotulo;
	if (m.message_reference?.message_id) {
		const ref = m.referenced_message;
		out.replyTo = { id: m.message_reference.message_id, authorName: ref?.author ? `@${ref.author.username}` : undefined, content: ref?.content ? ref.content.slice(0, 200) : undefined, missing: ref === null };
	}
	if (Array.isArray(m.attachments) && m.attachments.length) out.attachments = m.attachments.map((a) => ({ id: a.id, name: a.filename, size: a.size, contentType: a.content_type || null, url: a.url }));
	if (Array.isArray(m.embeds) && m.embeds.length) out.embeds = m.embeds.length;
	if (Array.isArray(m.sticker_items) && m.sticker_items.length) out.stickers = m.sticker_items.map((s) => s.name);
	if (Array.isArray(m.reactions) && m.reactions.length) out.reactions = m.reactions.map((r) => ({ emoji: r.emoji?.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji?.name, count: r.count, me: !!r.me }));
	if (m.thread?.id) out.thread = { id: m.thread.id, name: m.thread.name };
	return out;
}

export const nomeUsuario = (u) => (u ? (u.global_name && u.global_name !== u.username ? `${u.global_name} (@${u.username})` : `@${u.username || u.id}`) : '?');

export function rotuloCanal(c, meuId) {
	if (!c || typeof c !== 'object') return String(c?.id || '?');
	const tipo = TIPOS_CANAL[c.type] || `tipo${c.type}`;
	if (c.type === 1) { const outro = (c.recipients || []).find((r) => r.id !== meuId) || (c.recipients || [])[0]; return `DM com ${nomeUsuario(outro)}`; }
	if (c.type === 3) return `grupo ${c.name || (c.recipients || []).map((r) => r.username).join(', ') || c.id}`;
	if (TIPO_THREAD.has(c.type)) return `thread "${c.name || c.id}"`;
	return `#${c.name || c.id} (${tipo})`;
}
