import { ErroMcp, VERSAO, NOME_SERVIDOR, compararSnowflakes, maiorSnowflake, msParaSnowflake, snowflakeParaIso, dividirTexto, dormir as dormirPadrao } from './nucleo.js';
import { FERRAMENTAS_SOMENTE_USER } from './ferramentas.js';
import { TIPOS_CANAL, TIPO_THREAD, TIPO_DM, TIPOS_FILTRO, normalizarMensagem, nomeUsuario, rotuloCanal } from './api-discord.js';

const LIMITE_DISCORD = 2000;
const TTL_CACHE_MS = 10 * 60 * 1000;
const MENCOES = { none: [], users: ['users'], users_roles: ['users', 'roles'], everyone: ['users', 'roles', 'everyone'] };
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const contem = (texto, query) => !query || semAcento(texto).includes(semAcento(query));
const participantes = (c, meuId) => (c?.recipients || []).filter((r) => r.id !== meuId).map((r) => ({ id: r.id, nome: nomeUsuario(r) }));

export class Executor {
	constructor({ config, cliente, estado, gateway = null, protocolo = '', agora, dormir, log } = {}) {
		this.cfg = config;
		this.cliente = cliente;
		this.estado = estado;
		this.gateway = gateway;
		this.protocolo = protocolo;
		this.agora = agora || Date.now;
		this.dormir = dormir || dormirPadrao;
		this.log = log || (() => {});
		this.cacheEu = null;
		this.cacheCanais = new Map();
		this.envios = [];
		this.ultimoEnvioEm = 0;
	}


	async executar(nome, args = {}) {
		const fn = this[`t_${nome}`];
		if (typeof fn !== 'function') throw new ErroMcp('UNKNOWN_TOOL', `ferramenta desconhecida: ${nome}`);
		if (FERRAMENTAS_SOMENTE_USER.includes(nome) && this.cfg.DISCORD_MODO === 'bot') throw new ErroMcp('UNSUPPORTED_IN_BOT_MODE', `${nome} so existe para contas de usuario (a API de bot nao oferece este recurso)`);
		await this.estado.carregar();
		this.estado.iniciarChamada(nome);
		try {
			const r = await fn.call(this, args);
			this.estado.concluirChamada(true);
			return r;
		} catch (e) {
			this.estado.concluirChamada(false);
			throw e;
		}
	}

	exigirEscrita(acao) {
		if (this.cfg.SOMENTE_LEITURA) throw new ErroMcp('READ_ONLY_MODE', `servidor em modo somente leitura: ${acao} nao executa`, { hint: 'Desligue SOMENTE_LEITURA no ambiente para permitir escrita.' });
	}

	async eu() {
		if (this.cacheEu && this.agora() - this.cacheEu.em < TTL_CACHE_MS) return this.cacheEu.user;
		const user = await this.cliente.eu();
		this.cacheEu = { user, em: this.agora() };
		return user;
	}

	async meuId() { return (await this.eu()).id; }


	async infoCanal(channelId, { tolerante = false, fresco = false } = {}) {
		const c = fresco ? null : this.cacheCanais.get(channelId);
		if (c && this.agora() - c.em < TTL_CACHE_MS) return c.canal;
		const doGateway = this.gateway?.canal?.(channelId);
		try {
			const canal = await this.cliente.canal(channelId);
			this.cacheCanais.set(channelId, { canal, em: this.agora() });
			if (this.cacheCanais.size > 500) this.cacheCanais.delete(this.cacheCanais.keys().next().value);
			return canal;
		} catch (e) {
			if (doGateway) return doGateway;
			if (tolerante) return null;
			throw e;
		}
	}

	async rotulo(channelId, meuId) {
		const c = await this.infoCanal(channelId, { tolerante: true });
		return c ? rotuloCanal(c, meuId) : undefined;
	}


	async reservarEnvio(quantidade = 1) {
		const agora = this.agora();
		this.envios = this.envios.filter((t) => agora - t < 60000);
		if (this.envios.length + quantidade > this.cfg.ENVIOS_POR_MINUTO) {
			const retry = Math.max(100, this.envios[0] + 60000 - agora);
			throw new ErroMcp('SEND_QUOTA', `cota de ${this.cfg.ENVIOS_POR_MINUTO} envios/min atingida`, { retryAfterMs: retry, hint: 'Nada foi enviado. Espere o tempo indicado; a cota protege a conta contra bloqueio por spam.' });
		}
		const faltam = this.ultimoEnvioEm + this.cfg.INTERVALO_ENVIO_MS - agora;
		if (faltam > 0) {
			if (faltam > this.cfg.ESPERA_AUTOMATICA_MS) throw new ErroMcp('SEND_QUOTA', `intervalo minimo entre envios (${this.cfg.INTERVALO_ENVIO_MS}ms) ainda nao passou`, { retryAfterMs: faltam });
			await this.dormir(faltam);
		}
	}

	registrarEnvio() {
		this.ultimoEnvioEm = this.agora();
		this.envios.push(this.ultimoEnvioEm);
		this.estado.registrarEnvio();
	}

	async marcarTratado(channelId, messageId, { ack = true, origem = 'mark_read' } = {}) {
		const cursor = this.estado.avancarCursor(channelId, messageId, origem);
		let ackResultado = null, aviso;
		if (ack && this.cfg.ACK_DISCORD && this.cfg.DISCORD_MODO === 'user' && messageId) {
			try { await this.cliente.ack(channelId, messageId); ackResultado = true; }
			catch (e) { ackResultado = false; aviso = `ack no Discord falhou: ${e.code || e.message}`; }
		}
		if (!cursor.avancou && cursor.anterior) aviso = [aviso, `cursor ja estava em #${cursor.anterior} (nao retrocede)`].filter(Boolean).join(' | ');
		return { cursorAnterior: cursor.anterior, cursor: cursor.atual, ack: ackResultado, aviso };
	}

	janelaInicial(hours) {
		const h = hours || this.cfg.INBOX_JANELA_HORAS;
		return msParaSnowflake(this.agora() - h * 3600 * 1000);
	}


	async novasDoCanal(channelId, piso, perChannel, meuId) {
		const lista = await this.cliente.mensagens(channelId, { limit: Math.min(100, perChannel + 10) });
		const ordenada = (Array.isArray(lista) ? lista : []).sort((a, b) => compararSnowflakes(a.id, b.id));
		const maisAntigas = ordenada.length > 0 && compararSnowflakes(ordenada[0].id, piso) > 0 && ordenada.length >= Math.min(100, perChannel + 10);
		const novas = ordenada.filter((m) => compararSnowflakes(m.id, piso) > 0 && m.author?.id !== meuId);
		return { novas, maisAntigas };
	}

	async lerProtocolo() {
		const p = typeof this.protocolo === 'function' ? await this.protocolo() : this.protocolo;
		return typeof p === 'string' ? p : '';
	}


	async t_discord_status() {
		const r = { servidor: NOME_SERVIDOR, versao: VERSAO, modo: this.cfg.DISCORD_MODO, somenteLeitura: this.cfg.SOMENTE_LEITURA, conta: null };
		if (!this.cfg.DISCORD_TOKEN) r.erroConta = { code: 'AUTH_MISSING', message: 'DISCORD_TOKEN nao configurado' };
		else {
			try { const u = await this.eu(); r.conta = { id: u.id, username: u.username, globalName: u.global_name || null, bot: !!u.bot, verified: u.verified ?? null, mfa: u.mfa_enabled ?? null }; }
			catch (e) { r.erroConta = { code: e.code || 'ERROR', message: e.message }; }
		}
		r.gateway = this.gateway ? this.gateway.resumo() : { disponivel: false, motivo: this.cfg.GATEWAY ? 'indisponivel neste ambiente (so o servidor local mantem gateway ao vivo)' : 'desligado por configuracao (GATEWAY=0)' };
		r.estado = this.estado.resumo();
		r.limites = { enviosPorMinuto: this.cfg.ENVIOS_POR_MINUTO, intervaloEnvioMs: this.cfg.INTERVALO_ENVIO_MS, tempoLimiteMs: this.cfg.TEMPO_LIMITE_MS, inboxJanelaHoras: this.cfg.INBOX_JANELA_HORAS, maxResultado: this.cfg.MAX_RESULTADO, tentativas: this.cfg.TENTATIVAS, fuso: this.cfg.FUSO };
		const s = this.estado.dados.estatisticas, c = this.cliente.estatisticas;
		r.estatisticas = { chamadas: s.chamadas, ok: s.ok, erro: s.erro, envios: s.envios, requisicoes: c.requisicoes, rateLimits: c.rateLimits, errosHttp: c.erros, porFerramenta: s.porFerramenta };
		const protocolo = await this.lerProtocolo();
		r.protocolo = { carregado: !!protocolo.trim(), chars: protocolo.length };
		if (r.conta && this.cfg.DISCORD_MODO === 'user' && !(r.gateway.estado === 'conectado')) r.dica = 'Sem gateway ao vivo, o inbox depende de consultas REST (DMs abertas, mencoes e canais vigiados); isso cobre o atendimento normal.';
		if (r.conta && this.cfg.DISCORD_MODO === 'bot') r.dica = 'Modo bot: list_dms, search_messages e friends nao existem; DMs e mencoes chegam ao inbox apenas pelo gateway.';
		return r;
	}

	async t_read_protocol() {
		const texto = await this.lerProtocolo();
		return { carregado: !!texto.trim(), chars: texto.length, texto };
	}

	async t_inbox(a) {
		const limit = a.limit ?? 20, perChannel = a.perChannel ?? 8;
		const meuId = await this.meuId();
		const janela = this.janelaInicial(a.hours);
		const piso = (channelId) => maiorSnowflake(this.estado.cursor(channelId), janela) || janela;
		const conversas = new Map();
		const fontes = { dms: 0, mencoes: 0, vigiados: 0, gateway: 0 };
		const avisos = [];
		let truncado = false;
		const conversa = (channelId, origem, extra = {}) => {
			if (!conversas.has(channelId)) conversas.set(channelId, { channelId, origem, mensagens: new Map(), maisAntigas: false, ...extra });
			return conversas.get(channelId);
		};
		const incluir = (conv, msgs, fonte) => { for (const m of msgs) if (!conv.mensagens.has(m.id)) { conv.mensagens.set(m.id, m); fontes[fonte]++; } };

		if (a.dms !== false) {
			if (this.cfg.DISCORD_MODO === 'bot') avisos.push('modo bot: DMs so chegam ao inbox pelo gateway');
			else {
				const dms = (await this.cliente.dmsAbertas()).filter((c) => c.last_message_id && compararSnowflakes(c.last_message_id, piso(c.id)) > 0).sort((x, y) => compararSnowflakes(y.last_message_id, x.last_message_id));
				for (const c of dms) {
					if (conversas.size >= limit) { truncado = true; break; }
					const { novas, maisAntigas } = await this.novasDoCanal(c.id, piso(c.id), perChannel, meuId);
					if (!novas.length) continue;
					const conv = conversa(c.id, 'dm', { rotulo: rotuloCanal(c, meuId) });
					conv.maisAntigas = maisAntigas;
					incluir(conv, novas, 'dms');
				}
			}
		}
		if (a.mentions !== false) {
			if (this.cfg.DISCORD_MODO === 'bot') avisos.push('modo bot: mencoes so chegam ao inbox pelo gateway');
			else {
				const mencoes = await this.cliente.mencoes(Math.min(100, Math.max(25, limit * 3)));
				for (const m of Array.isArray(mencoes) ? mencoes : []) {
					if (m.author?.id === meuId || compararSnowflakes(m.id, piso(m.channel_id)) <= 0) continue;
					if (!conversas.has(m.channel_id) && conversas.size >= limit) { truncado = true; continue; }
					const conv = conversa(m.channel_id, 'mencao', { guildId: m.guild_id });
					incluir(conv, [m], 'mencoes');
				}
			}
		}
		if (a.watched !== false) {
			for (const v of this.estado.vigiados()) {
				if (!conversas.has(v.channelId) && conversas.size >= limit) { truncado = true; break; }
				try {
					const { novas, maisAntigas } = await this.novasDoCanal(v.channelId, piso(v.channelId), perChannel, meuId);
					if (!novas.length) continue;
					const conv = conversa(v.channelId, 'vigiado', { guildId: v.guildId, rotulo: v.nome ? `#${v.nome}` : undefined });
					conv.maisAntigas = conv.maisAntigas || maisAntigas;
					incluir(conv, novas, 'vigiados');
				} catch (e) { avisos.push(`canal vigiado ${v.channelId}: ${e.code || e.message}`); }
			}
		}
		if (this.gateway) {
			for (const m of this.gateway.mensagens()) {
				if (m.author?.id === meuId || compararSnowflakes(m.id, piso(m.channel_id)) <= 0) continue;
				const dm = !m.guild_id;
				const menciona = Array.isArray(m.mentions) && m.mentions.some((u) => u?.id === meuId);
				const vigiado = !!this.estado.vigiado(m.channel_id);
				if (!dm && !menciona && !vigiado) continue;
				if (!conversas.has(m.channel_id) && conversas.size >= limit) { truncado = true; continue; }
				const conv = conversa(m.channel_id, 'gateway', { guildId: m.guild_id });
				incluir(conv, [m], 'gateway');
			}
		}

		const lista = [];
		for (const conv of conversas.values()) {
			const ordenadas = [...conv.mensagens.values()].sort((x, y) => compararSnowflakes(x.id, y.id));
			const mostradas = ordenadas.slice(-perChannel);
			const rotulo = conv.rotulo || (await this.rotulo(conv.channelId, meuId)) || conv.channelId;
			lista.push({ channelId: conv.channelId, guildId: conv.guildId || (await this.infoCanal(conv.channelId, { tolerante: true }))?.guild_id, rotulo, origem: conv.origem, novas: ordenadas.length, omitidas: ordenadas.length - mostradas.length, maisAntigas: conv.maisAntigas, ultimaId: ordenadas.at(-1).id, mensagens: mostradas.map((m) => normalizarMensagem(m, meuId)) });
		}
		lista.sort((x, y) => compararSnowflakes(y.ultimaId, x.ultimaId));
		if (a.markRead) for (const c of lista) await this.marcarTratado(c.channelId, c.ultimaId, { origem: 'inbox' });
		return { conversas: lista, total: lista.reduce((n, c) => n + c.novas, 0), fontes, avisos, markRead: !!a.markRead, truncado, janelaHoras: a.hours || this.cfg.INBOX_JANELA_HORAS };
	}

	async t_list_dms(a) {
		const meuId = await this.meuId();
		const janela = this.janelaInicial();
		const todas = (await this.cliente.dmsAbertas()).sort((x, y) => compararSnowflakes(y.last_message_id, x.last_message_id));
		let lista = todas.map((c) => {
			const piso = maiorSnowflake(this.estado.cursor(c.id), janela);
			const parts = participantes(c, meuId);
			return { channelId: c.id, tipo: c.type === 3 ? 'grupo' : 'dm', nome: c.type === 3 ? (c.name || parts.map((p) => p.nome).join(', ')) : (parts[0]?.nome || c.id), participantes: parts, ultimaMensagemId: c.last_message_id || null, ultimaEm: c.last_message_id ? snowflakeParaIso(c.last_message_id) : null, naoTratadas: !!c.last_message_id && compararSnowflakes(c.last_message_id, piso) > 0, cursor: this.estado.cursor(c.id) };
		});
		if (a.onlyUnread) lista = lista.filter((c) => c.naoTratadas);
		if (a.query) lista = lista.filter((c) => contem(c.nome, a.query) || c.participantes.some((p) => contem(p.nome, a.query)));
		return { conversas: lista.slice(0, a.limit ?? 50), total: lista.length };
	}

	async t_list_guilds(a) {
		const lista = (await this.cliente.servidores()).map((g) => ({ id: g.id, nome: g.name, dono: !!g.owner, membros: g.approximate_member_count ?? null, online: g.approximate_presence_count ?? null })).filter((g) => contem(g.nome, a.query));
		return { servidores: lista };
	}

	async t_list_channels(a) {
		let canais, fonte = 'rest';
		try { canais = await this.cliente.canaisDoServidor(a.guildId); }
		catch (e) {
			const doGateway = this.gateway?.canaisDoServidor?.(a.guildId);
			if (!doGateway?.length) throw e;
			canais = doGateway;
			fonte = `gateway (REST falhou: ${e.code})`;
		}
		const servidor = this.gateway?.servidor?.(a.guildId)?.name || (await this.cliente.get(`/guilds/${a.guildId}`).then((g) => g?.name).catch(() => undefined));
		const permitidos = a.types?.length ? new Set(a.types.flatMap((t) => TIPOS_FILTRO[t] || [])) : null;
		const categorias = new Map([[null, { id: null, nome: null, position: -1, canais: [] }]]);
		for (const c of canais.filter((c) => c.type === 4).sort((x, y) => (x.position ?? 0) - (y.position ?? 0))) categorias.set(c.id, { id: c.id, nome: c.name, position: c.position ?? 0, canais: [] });
		let total = 0;
		for (const c of canais.filter((c) => c.type !== 4).sort((x, y) => (x.type === 2 || x.type === 13) - (y.type === 2 || y.type === 13) || (x.position ?? 0) - (y.position ?? 0))) {
			if (permitidos && !permitidos.has(c.type)) continue;
			if (!contem(c.name, a.query)) continue;
			const cat = categorias.get(c.parent_id) || categorias.get(null);
			cat.canais.push({ id: c.id, nome: c.name, tipo: TIPOS_CANAL[c.type] || `tipo${c.type}`, nsfw: !!c.nsfw, topico: c.topic || null, ultimaMensagemId: c.last_message_id || null, ultimaMensagemEm: c.last_message_id ? snowflakeParaIso(c.last_message_id) : null });
			total++;
		}
		return { guildId: a.guildId, servidor, total, fonte, categorias: [...categorias.values()].filter((c) => c.canais.length) };
	}

	normalizarCanal(c, meuId) {
		const out = { id: c.id, tipo: TIPOS_CANAL[c.type] || `tipo${c.type}`, nome: c.name || null, rotulo: rotuloCanal(c, meuId), guildId: c.guild_id || null, parentId: c.parent_id || null, topico: c.topic || null, nsfw: !!c.nsfw, ultimaMensagemId: c.last_message_id || null, ultimaMensagemEm: c.last_message_id ? snowflakeParaIso(c.last_message_id) : null, cursor: this.estado.cursor(c.id) };
		if (TIPO_DM.has(c.type)) out.participantes = participantes(c, meuId);
		if (TIPO_THREAD.has(c.type)) out.thread = { arquivada: !!c.thread_metadata?.archived, trancada: !!c.thread_metadata?.locked, mensagens: c.message_count ?? null, membros: c.member_count ?? null, criadaEm: c.thread_metadata?.create_timestamp || snowflakeParaIso(c.id), autorId: c.owner_id || null };
		if (Array.isArray(c.available_tags) && c.available_tags.length) out.tags = c.available_tags.map((t) => ({ id: t.id, nome: t.name }));
		return out;
	}

	async t_get_channel(a) {
		const meuId = await this.meuId().catch(() => null);
		const c = await this.cliente.canal(a.channelId);
		this.cacheCanais.set(a.channelId, { canal: c, em: this.agora() });
		return this.normalizarCanal(c, meuId);
	}

	normalizarThread(t) {
		return { id: t.id, nome: t.name, arquivada: !!t.thread_metadata?.archived, trancada: !!t.thread_metadata?.locked, autorId: t.owner_id || null, mensagens: t.message_count ?? null, ultimaEm: t.last_message_id ? snowflakeParaIso(t.last_message_id) : null, criadaEm: t.thread_metadata?.create_timestamp || snowflakeParaIso(t.id), tags: Array.isArray(t.applied_tags) && t.applied_tags.length ? t.applied_tags : undefined };
	}

	async t_list_threads(a) {
		const limit = a.limit ?? 25, archived = !!a.archived, offset = a.offset ?? 0;
		const canal = await this.infoCanal(a.channelId, { tolerante: true });
		const avisos = [];
		let threads, hasMore = false, total, fonte;
		if (this.cfg.DISCORD_MODO === 'user') {
			try {
				const r = await this.cliente.threadsBusca(a.channelId, { archived, limit, offset });
				threads = r?.threads || [];
				hasMore = !!r?.has_more;
				total = r?.total_results;
				fonte = 'threads/search';
			} catch (e) {
				if (!['FORBIDDEN', 'NOT_FOUND', 'BAD_REQUEST', 'WRONG_CHANNEL_TYPE'].includes(e.code)) throw e;
				avisos.push(`threads/search falhou (${e.code}); usando a rota de bot`);
			}
		}
		if (!threads) {
			if (archived) { const r = await this.cliente.threadsArquivadas(a.channelId, limit); threads = r?.threads || []; hasMore = !!r?.has_more; fonte = 'threads/archived/public'; }
			else {
				const guildId = canal?.guild_id;
				if (!guildId) throw new ErroMcp('WRONG_CHANNEL_TYPE', 'este canal nao pertence a um servidor; threads so existem em canais de servidor');
				const r = await this.cliente.threadsAtivasServidor(guildId);
				threads = (r?.threads || []).filter((t) => t.parent_id === a.channelId).sort((x, y) => compararSnowflakes(y.last_message_id || y.id, x.last_message_id || x.id)).slice(offset, offset + limit);
				fonte = 'guilds/threads/active';
			}
		}
		return { channelId: a.channelId, rotulo: canal ? rotuloCanal(canal) : undefined, archived, fonte, hasMore, total, threads: threads.map((t) => this.normalizarThread(t)), avisos };
	}

	async t_read_messages(a) {
		const limit = a.limit ?? 30;
		if ([a.before, a.after, a.around].filter(Boolean).length > 1) throw new ErroMcp('VALIDATION', 'use apenas um entre before, after e around');
		const meuId = await this.meuId();
		const lista = await this.cliente.mensagens(a.channelId, { limit, before: a.before, after: a.after, around: a.around });
		const ordenada = (Array.isArray(lista) ? lista : []).sort((x, y) => compararSnowflakes(x.id, y.id));
		const r = { channelId: a.channelId, rotulo: await this.rotulo(a.channelId, meuId), mensagens: ordenada.map((m) => normalizarMensagem(m, meuId)), hasMoreBefore: ordenada.length >= limit && !a.after, markRead: false, cursor: this.estado.cursor(a.channelId) };
		if (a.markRead && ordenada.length) { const t = await this.marcarTratado(a.channelId, ordenada.at(-1).id, { origem: 'read_messages' }); r.markRead = true; r.cursor = t.cursor; if (t.aviso) r.aviso = t.aviso; }
		return r;
	}

	async t_get_message(a) {
		const meuId = await this.meuId();
		const m = await this.cliente.mensagem(a.channelId, a.messageId);
		return { channelId: a.channelId, rotulo: await this.rotulo(a.channelId, meuId), mensagem: normalizarMensagem(m, meuId) };
	}

	async t_search_messages(a) {
		if (!a.guildId && !a.channelId) throw new ErroMcp('VALIDATION', 'informe guildId (servidor) ou channelId (DM)');
		if (!a.content && !a.authorId && !a.has) throw new ErroMcp('VALIDATION', 'informe pelo menos content, authorId ou has');
		const meuId = await this.meuId();
		const r = await this.cliente.buscar({ guildId: a.guildId, channelId: a.channelId, content: a.content, authorId: a.authorId, has: a.has, before: a.before, after: a.after, offset: a.offset });
		const grupos = Array.isArray(r?.messages) ? r.messages : [];
		const hits = grupos.map((g) => (Array.isArray(g) ? g.find((m) => m.hit) || g[0] : g)).filter(Boolean).slice(0, a.limit ?? 25);
		return { escopo: a.guildId ? `servidor ${a.guildId}${a.channelId ? ` canal ${a.channelId}` : ''}` : `DM ${a.channelId}`, total: r?.total_results ?? hits.length, offset: a.offset ?? 0, indexando: false, resultados: hits.map((m) => normalizarMensagem(m, meuId)) };
	}


	async enviarTexto(channelId, a, { replyTo } = {}) {
		this.exigirEscrita('enviar mensagem');
		const texto = String(a.content);
		if (!texto.trim()) throw new ErroMcp('VALIDATION', 'content vazio');
		if (texto.length > LIMITE_DISCORD && !a.split) throw new ErroMcp('CONTENT_TOO_LONG', `content tem ${texto.length} caracteres; o Discord aceita ate ${LIMITE_DISCORD}`, { hint: 'Encurte o texto ou passe split=true para dividir em varias mensagens.' });
		const partes = texto.length > LIMITE_DISCORD ? dividirTexto(texto, LIMITE_DISCORD) : [texto];
		const meuId = await this.meuId();
		if (replyTo && !a.allowDuplicate) {
			const lembrada = this.estado.jaRespondida(replyTo);
			if (lembrada) throw new ErroMcp('ALREADY_REPLIED', `a mensagem #${replyTo} ja recebeu a resposta #${lembrada.respostaId} desta conta em ${lembrada.em}`, { hint: 'Se for intencional responder de novo, passe allowDuplicate=true.' });
			if (this.cfg.VERIFICAR_DUPLICATA_REMOTA) {
				const depois = await this.cliente.mensagens(channelId, { after: replyTo, limit: 50 }).catch(() => []);
				const minha = (Array.isArray(depois) ? depois : []).find((m) => m.author?.id === meuId && m.message_reference?.message_id === replyTo);
				if (minha) { this.estado.lembrarResposta(replyTo, { channelId, respostaId: minha.id }); throw new ErroMcp('ALREADY_REPLIED', `a mensagem #${replyTo} ja tem a resposta #${minha.id} desta conta no Discord`, { hint: 'Se for intencional responder de novo, passe allowDuplicate=true.' }); }
			}
		}
		await this.reservarEnvio(partes.length);
		let typingMs = 0;
		if (a.typing) {
			typingMs = Math.min(6000, 400 + texto.length * 30);
			try { await this.cliente.digitando(channelId); await this.dormir(typingMs); } catch { typingMs = 0; }
		}
		const parse = MENCOES[a.allowMentions || 'users'];
		const enviadas = [];
		for (let i = 0; i < partes.length; i++) {
			if (i > 0) await this.dormir(Math.max(this.cfg.INTERVALO_ENVIO_MS, 300));
			const payload = { content: partes[i], nonce: msParaSnowflake(this.agora()), tts: false, flags: a.suppressEmbeds ? 4 : 0, allowed_mentions: { parse, replied_user: a.mentionAuthor !== false } };
			if (i === 0 && replyTo) payload.message_reference = { channel_id: channelId, message_id: replyTo, fail_if_not_exists: false };
			let m;
			try { m = await this.cliente.enviar(channelId, payload); }
			catch (e) {
				if (!enviadas.length) throw e;
				throw new ErroMcp('PARTIAL_SEND', `${enviadas.length} de ${partes.length} partes enviadas (${enviadas.map((x) => '#' + x.id).join(', ')}); a parte ${i + 1} falhou: ${e.code}: ${e.message}`, { nothingExecuted: false, executionUnknown: !!e.executionUnknown, retryAfterMs: e.retryAfterMs, discord: e.discord, hint: 'Envie o restante com send_message; nao reenvie as partes ja entregues.' });
			}
			this.registrarEnvio();
			enviadas.push({ id: m.id, timestamp: m.timestamp, chars: partes[i].length });
			if (i === 0 && replyTo) this.estado.lembrarResposta(replyTo, { channelId, respostaId: m.id });
		}
		const cursor = this.estado.avancarCursor(channelId, replyTo || enviadas.at(-1).id, replyTo ? 'reply' : 'send');
		return { channelId, rotulo: await this.rotulo(channelId, meuId), replyTo: replyTo || undefined, enviadas, typingMs: typingMs || undefined, cursor: cursor.atual };
	}

	t_send_message(a) { return this.enviarTexto(a.channelId, a, { replyTo: a.replyTo }); }
	t_reply_message(a) { return this.enviarTexto(a.channelId, a, { replyTo: a.messageId }); }

	async t_edit_message(a) {
		this.exigirEscrita('editar mensagem');
		const m = await this.cliente.editar(a.channelId, a.messageId, a.content);
		return { channelId: a.channelId, rotulo: await this.rotulo(a.channelId), id: m?.id || a.messageId, editedTimestamp: m?.edited_timestamp || null };
	}

	async t_delete_message(a) {
		this.exigirEscrita('apagar mensagem');
		await this.cliente.apagar(a.channelId, a.messageId);
		return { channelId: a.channelId, rotulo: await this.rotulo(a.channelId), id: a.messageId, apagada: true };
	}

	async t_add_reaction(a) {
		this.exigirEscrita('reagir');
		const emoji = a.emoji.replace(/^<a?:([^:>]+):(\d+)>$/, '$1:$2').replace(/^:([^:]+):(\d+)$/, '$1:$2');
		if (a.remove) await this.cliente.removerReacao(a.channelId, a.messageId, emoji); else await this.cliente.reagir(a.channelId, a.messageId, emoji);
		return { channelId: a.channelId, rotulo: await this.rotulo(a.channelId), id: a.messageId, emoji, removed: !!a.remove };
	}

	async t_open_dm(a) {
		this.exigirEscrita('abrir DM');
		const meuId = await this.meuId();
		if (a.userId === meuId) throw new ErroMcp('VALIDATION', 'nao e possivel abrir DM com a propria conta');
		const c = await this.cliente.abrirDm(a.userId);
		this.cacheCanais.set(c.id, { canal: c, em: this.agora() });
		return { channelId: c.id, rotulo: rotuloCanal(c, meuId), participantes: participantes(c, meuId), ultimaMensagemId: c.last_message_id || null };
	}

	async t_mark_read(a) {
		this.exigirEscrita('marcar como tratado');
		let messageId = a.messageId;

		const canal = await this.infoCanal(a.channelId, { tolerante: !!messageId, fresco: !messageId });
		if (!messageId) messageId = canal?.last_message_id || null;
		if (!messageId) return { channelId: a.channelId, rotulo: canal ? rotuloCanal(canal) : undefined, messageId: null, ack: null, aviso: 'canal sem mensagens; nada a marcar' };
		const t = await this.marcarTratado(a.channelId, messageId, { origem: 'mark_read' });
		return { channelId: a.channelId, rotulo: canal ? rotuloCanal(canal) : undefined, messageId, cursorAnterior: t.cursorAnterior, ack: t.ack, aviso: t.aviso };
	}

	async t_watch_channel(a) {
		const action = a.action || 'list';
		let alterado;
		if (action !== 'list') {
			this.exigirEscrita('alterar canais vigiados');
			if (!a.channelId) throw new ErroMcp('VALIDATION', `channelId e obrigatorio em action=${action}`);
			if (action === 'add') {
				const c = await this.infoCanal(a.channelId);
				if (TIPO_DM.has(c.type)) throw new ErroMcp('VALIDATION', 'DMs ja entram no inbox; watch_channel e para canais de servidor');
				const novo = this.estado.vigiar(a.channelId, { nome: c.name || null, guildId: c.guild_id || null, tipo: TIPOS_CANAL[c.type] || null, note: a.note || undefined });
				alterado = `${novo ? 'adicionado' : 'atualizado'} #${c.name || a.channelId}`;
			} else {
				if (!this.estado.desvigiar(a.channelId)) throw new ErroMcp('NOT_FOUND', `canal ${a.channelId} nao estava vigiado`);
				alterado = `removido ${a.channelId}`;
			}
			await this.estado.salvarAgora();
		}
		return { action, alterado, vigiados: this.estado.vigiados() };
	}

	async t_join_thread(a) {
		this.exigirEscrita(a.leave ? 'sair de thread' : 'entrar em thread');
		if (a.leave) await this.cliente.sairThread(a.channelId); else await this.cliente.entrarThread(a.channelId);
		const c = await this.infoCanal(a.channelId, { tolerante: true });
		return { channelId: a.channelId, nome: c?.name || null, left: !!a.leave };
	}

	async t_create_thread(a) {
		this.exigirEscrita('criar thread');
		const canal = await this.infoCanal(a.channelId);
		const autoArchive = a.autoArchiveMinutes || 1440;
		if (canal.type === 15 || canal.type === 16) {
			if (!a.content) throw new ErroMcp('VALIDATION', 'content e obrigatorio para criar um post de forum');
			if (a.content.length > LIMITE_DISCORD) throw new ErroMcp('CONTENT_TOO_LONG', `content tem ${a.content.length} caracteres; o Discord aceita ate ${LIMITE_DISCORD}`);
			await this.reservarEnvio(1);
			const r = await this.cliente.criarPostForum(a.channelId, { name: a.name, content: a.content, autoArchive, tags: a.tags });
			this.registrarEnvio();
			return { id: r.id, tipo: 'post de forum', nome: r.name || a.name, parentId: a.channelId, mensagemId: r.message?.id || null };
		}
		if (![0, 5].includes(canal.type)) throw new ErroMcp('WRONG_CHANNEL_TYPE', `threads so podem ser criadas em canais de texto, anuncios ou foruns (este e ${TIPOS_CANAL[canal.type] || canal.type})`);
		if (a.tags?.length) throw new ErroMcp('VALIDATION', 'tags so se aplicam a posts de forum');
		let thread;
		if (a.messageId) thread = await this.cliente.criarThreadDeMensagem(a.channelId, a.messageId, { name: a.name, autoArchive });
		else thread = await this.cliente.criarThreadAvulsa(a.channelId, { name: a.name, autoArchive });
		const out = { id: thread.id, tipo: a.messageId ? 'thread a partir de mensagem' : 'thread', nome: thread.name || a.name, parentId: a.channelId, mensagemId: null };
		if (a.content) {
			try { const env = await this.enviarTexto(thread.id, { content: a.content, allowMentions: 'users' }); out.mensagemId = env.enviadas[0]?.id || null; }
			catch (e) { throw new ErroMcp('PARTIAL_SEND', `thread ${thread.id} criada, mas a primeira mensagem falhou: ${e.code}: ${e.message}`, { nothingExecuted: false, executionUnknown: !!e.executionUnknown, retryAfterMs: e.retryAfterMs, hint: `Envie o texto com send_message channelId=${thread.id}.` }); }
		}
		return out;
	}

	async t_join_invite(a) {
		const info = await this.cliente.convite(a.code);
		const r = { code: info.code || a.code, servidor: info.guild ? { id: info.guild.id, nome: info.guild.name, membros: info.approximate_member_count ?? null, online: info.approximate_presence_count ?? null } : null, canal: info.channel ? { id: info.channel.id, nome: info.channel.name, tipo: TIPOS_CANAL[info.channel.type] } : null, convidadoPor: info.inviter ? nomeUsuario(info.inviter) : null, expiraEm: info.expires_at || null, aceito: false, jaMembro: false };
		if (!a.accept) return r;
		this.exigirEscrita('entrar em servidor');
		if (this.cfg.DISCORD_MODO === 'bot') throw new ErroMcp('UNSUPPORTED_IN_BOT_MODE', 'bots entram em servidores pelo link de autorizacao OAuth2, nao por convite');
		const aceito = await this.cliente.aceitarConvite(a.code);
		r.aceito = true;
		r.jaMembro = aceito?.new_member === false;
		return r;
	}

	async t_get_user(a) {
		const u = await this.cliente.usuario(a.userId);
		const r = { id: u.id, username: u.username, globalName: u.global_name || null, bot: !!u.bot, criadoEm: snowflakeParaIso(u.id), avisos: [] };
		if (this.cfg.DISCORD_MODO === 'user' && !u.bot) {
			try {
				const p = await this.cliente.perfil(a.userId);
				r.bio = p?.user_profile?.bio || p?.user?.bio || null;
				r.pronomes = p?.user_profile?.pronouns || null;
				r.mutualGuilds = (p?.mutual_guilds || []).map((g) => ({ id: g.id, nome: this.gateway?.servidor?.(g.id)?.name || null, nick: g.nick || null }));
			} catch (e) { r.avisos.push(`perfil indisponivel: ${e.code}`); }
			try {
				const rel = (await this.cliente.relacoes()).find((x) => x.id === a.userId);
				if (rel) r.relacao = { 1: 'amigo', 2: 'bloqueado', 3: 'pedido de amizade recebido', 4: 'pedido de amizade enviado' }[rel.type] || `tipo ${rel.type}`;
			} catch (e) { r.avisos.push(`relacoes indisponiveis: ${e.code}`); }
		}
		if (a.guildId) {
			const m = await this.cliente.membro(a.guildId, a.userId);
			let nomes = {};
			try { nomes = Object.fromEntries((await this.cliente.cargos(a.guildId)).map((c) => [c.id, c.name])); } catch (e) { r.avisos.push(`nomes dos cargos indisponiveis: ${e.code}`); }
			r.membro = { guildId: a.guildId, servidor: this.gateway?.servidor?.(a.guildId)?.name || null, nick: m.nick || null, cargos: (m.roles || []).map((id) => nomes[id] || id), entrouEm: m.joined_at || null };
		}
		if (!r.avisos.length) delete r.avisos;
		return r;
	}

	async t_friends(a) {
		const action = a.action || 'list';
		const TIPOS = { 1: 'friends', 2: 'blocked', 3: 'incoming', 4: 'outgoing' };
		if (action === 'list') {
			const lista = (await this.cliente.relacoes()).map((x) => ({ tipo: TIPOS[x.type] || `tipo${x.type}`, userId: x.id, nome: nomeUsuario(x.user), apelido: x.nickname || null, desde: x.since || null }));
			return { action, filtro: a.type || null, relacoes: a.type ? lista.filter((x) => x.tipo === a.type) : lista };
		}
		this.exigirEscrita(action === 'accept' ? 'aceitar amizade' : 'remover relacao');
		if (!a.userId) throw new ErroMcp('VALIDATION', `userId e obrigatorio em action=${action}`);
		if (action === 'accept') await this.cliente.aceitarRelacao(a.userId); else await this.cliente.removerRelacao(a.userId);
		const nome = await this.cliente.usuario(a.userId).then((u) => nomeUsuario(u)).catch(() => undefined);
		return { action, userId: a.userId, nome };
	}
}
