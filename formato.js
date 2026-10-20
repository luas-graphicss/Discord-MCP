const esc = (s) => String(s ?? '').replace(/\r?\n/g, '\\n');
const linhas = (arr) => arr.filter((l) => l !== null && l !== undefined && l !== '').join('\n');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const corta = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 3) + '...' : t; };

const FUSO_PADRAO = 'America/Sao_Paulo';
const formatadores = new Map();
function formatador(fuso) {
	const chave = fuso || FUSO_PADRAO;
	if (!formatadores.has(chave)) {
		let fmt;
		try { fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: chave, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
		catch { fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
		formatadores.set(chave, fmt);
	}
	return formatadores.get(chave);
}
export function quando(iso, fuso) {
	if (!iso) return '??/?? ??:??';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '??/?? ??:??';
	const partes = Object.fromEntries(formatador(fuso).formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
	return `${partes.day}/${partes.month} ${partes.hour === '24' ? '00' : partes.hour}:${partes.minute}`;
}
const tamanho = (bytes) => { const n = Number(bytes) || 0; return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`; };
const nomeAutor = (a) => a ? (a.globalName && a.globalName !== a.username ? `${a.globalName} (@${a.username})` : `@${a.username || a.id || '?'}`) : '?';


export function linhaMensagem(m, fuso, { recuo = '' } = {}) {
	const out = [];
	const autor = `${nomeAutor(m.author)}${m.mine ? ' (eu)' : ''}${m.author?.bot ? ' [bot]' : ''}`;
	const marcas = [m.mentionsMe ? 'menciona voce' : '', m.pinned ? 'fixada' : '', m.editedTimestamp ? 'editada' : ''].filter(Boolean);
	const corpo = m.content ? m.content.split('\n') : [];
	const cabeca = `${recuo}[${quando(m.timestamp, fuso)}] ${autor} #${m.id}${marcas.length ? ` {${marcas.join(', ')}}` : ''}:`;
	if (corpo.length) { out.push(`${cabeca} ${corpo[0]}`); for (const l of corpo.slice(1)) out.push(`${recuo}    ${l}`); }
	else out.push(`${cabeca} ${m.embeds ? `[${plural(m.embeds, 'embed', 'embeds')}]` : m.attachments?.length ? '' : m.stickers?.length ? `[figurinha ${m.stickers.join(', ')}]` : m.type ? `[mensagem de sistema tipo ${m.type}]` : '[sem texto]'}`.trimEnd());
	if (m.replyTo) out.push(`${recuo}    -> responde a #${m.replyTo.id}${m.replyTo.authorName ? ` de ${m.replyTo.authorName}` : ''}${m.replyTo.content ? `: "${corta(esc(m.replyTo.content), 120)}"` : m.replyTo.missing ? ' (mensagem original apagada ou inacessivel)' : ''}`);
	for (const a of m.attachments || []) out.push(`${recuo}    anexo: ${a.name} (${tamanho(a.size)}${a.contentType ? `, ${a.contentType}` : ''}) ${a.url}`);
	if (m.embeds && corpo.length) out.push(`${recuo}    [${plural(m.embeds, 'embed', 'embeds')}]`);
	if (m.reactions?.length) out.push(`${recuo}    reacoes: ${m.reactions.map((r) => `${r.emoji} ${r.count}${r.me ? '(eu)' : ''}`).join(', ')}`);
	return out;
}

const cabecalhoCanal = (r) => `${r.rotulo || r.channelId}${r.rotulo ? ` (canal ${r.channelId})` : ''}`;

const R = {
	discord_status(r, o) {
		if (!r?.servidor) return null;
		const out = [`# ${r.servidor} ${r.versao} | modo=${r.modo} | conta ${r.conta ? `${nomeAutor(r.conta)} id=${r.conta.id}` : 'INDISPONIVEL'}${r.somenteLeitura ? ' | SOMENTE LEITURA' : ''}`];
		if (r.erroConta) out.push(`conta: ERRO ${r.erroConta.code || ''}: ${esc(r.erroConta.message || r.erroConta)}`.replace('ERRO : ', 'ERRO: '));
		const g = r.gateway || {};
		out.push(`gateway: ${g.disponivel === false ? `indisponivel${g.motivo ? ` (${g.motivo})` : ''}` : `${g.estado || 'desligado'}${g.ultimoEvento ? ` | ultimo evento ${quando(g.ultimoEvento, o.fuso)}` : ''}${g.eventosNoBuffer != null ? ` | ${g.eventosNoBuffer} evento(s) no buffer` : ''}${g.reconexoes ? ` | reconexoes=${g.reconexoes}` : ''}${g.motivo && g.disponivel !== false ? ` (${g.motivo})` : ''}`}`);
		const e = r.estado || {};
		out.push(`estado: ${e.cursores ?? 0} cursor(es), ${e.vigiados ?? 0} canal(is) vigiado(s), ${e.respondidas ?? 0} resposta(s) lembrada(s)${e.persistencia ? ` | ${e.persistencia}` : ''}`);
		const l = r.limites || {};
		out.push(`limites: ${l.enviosPorMinuto ?? '?'} envios/min, intervalo ${l.intervaloEnvioMs ?? '?'}ms, timeout ${l.tempoLimiteMs ?? '?'}ms, janela inbox ${l.inboxJanelaHoras ?? '?'}h, resultado ate ${l.maxResultado ?? '?'} chars`);
		const s = r.estatisticas || {};
		out.push(`chamadas: ${s.chamadas ?? 0} ok=${s.ok ?? 0} erro=${s.erro ?? 0} | envios=${s.envios ?? 0} | rate limits=${s.rateLimits ?? 0} | requisicoes=${s.requisicoes ?? 0}`);
		out.push(`protocolo: ${r.protocolo?.carregado ? `carregado (${r.protocolo.chars} chars; read_protocol)` : 'nao configurado (crie protocolo.md ou a variavel PROTOCOLO)'}`);
		if (r.dica) out.push(r.dica);
		return linhas(out);
	},
	read_protocol(r) { return r?.carregado ? `# protocolo de trabalho (${r.chars} chars)\n${r.texto}` : r ? 'Nenhum protocolo configurado. Peca ao usuario para escrever protocolo.md (ou a variavel PROTOCOLO) com regras, precos, prazos e tom de atendimento.' : null; },
	inbox(r, o) {
		if (!Array.isArray(r?.conversas)) return null;
		const f = r.fontes || {};
		const out = [`# inbox: ${plural(r.conversas.length, 'conversa', 'conversas')} com ${plural(r.total ?? 0, 'mensagem nova', 'mensagens novas')} | dms=${f.dms ?? 0} mencoes=${f.mencoes ?? 0} vigiados=${f.vigiados ?? 0} gateway=${f.gateway ?? 0}${r.markRead ? ' | marcadas como tratadas' : ''}${r.truncado ? ' | TRUNCADO (aumente limit)' : ''}`];
		if (!r.conversas.length) out.push('Nada novo. Mensagens da propria conta e conversas ja tratadas (respondidas ou mark_read) nao aparecem aqui.');
		for (const c of r.conversas) {
			out.push(`## ${c.rotulo} | channelId=${c.channelId}${c.guildId ? ` guildId=${c.guildId}` : ''} | ${c.novas} nova(s)${c.omitidas ? `, ${c.omitidas} omitida(s) (read_messages para ver tudo)` : ''}${c.maisAntigas ? ' | pode haver mais antigas nao mostradas (read_messages before=)' : ''} | origem=${c.origem}`);
			for (const m of c.mensagens || []) out.push(...linhaMensagem(m, o.fuso, { recuo: '  ' }));
		}
		if (r.conversas.length) out.push(`Para responder: reply_message channelId=<channelId> messageId=<#id> content=... | para dispensar: mark_read channelId=<channelId>`);
		for (const a of r.avisos || []) out.push(`aviso: ${a}`);
		return linhas(out);
	},
	list_dms(r, o) {
		if (!Array.isArray(r?.conversas)) return null;
		const out = [`# ${plural(r.conversas.length, 'conversa direta', 'conversas diretas')}${r.total != null && r.total !== r.conversas.length ? ` de ${r.total}` : ''}`];
		for (const c of r.conversas) out.push(`${c.naoTratadas ? '*' : ' '} ${c.tipo === 'grupo' ? 'grupo' : 'dm'} ${c.nome} | channelId=${c.channelId}${c.participantes?.length ? ` | ${c.participantes.map((p) => `${p.nome} (${p.id})`).join(', ')}` : ''}${c.ultimaEm ? ` | ultima ${quando(c.ultimaEm, o.fuso)}` : ' | sem mensagens'}${c.ultimaMensagemId ? ` #${c.ultimaMensagemId}` : ''}`);
		if (r.conversas.length) out.push('* = tem mensagens depois do cursor (nao tratadas).');
		return linhas(out);
	},
	list_guilds(r) {
		if (!Array.isArray(r?.servidores)) return null;
		return linhas([`# ${plural(r.servidores.length, 'servidor', 'servidores')}`, ...r.servidores.map((g) => `${g.nome} | guildId=${g.id}${g.dono ? ' | DONO' : ''}${g.membros != null ? ` | ${g.membros} membros` : ''}${g.online != null ? ` (${g.online} online)` : ''}`)]);
	},
	list_channels(r, o) {
		if (!Array.isArray(r?.categorias)) return null;
		const out = [`# ${r.servidor || r.guildId}: ${plural(r.total ?? 0, 'canal', 'canais')}${r.fonte && r.fonte !== 'rest' ? ` | fonte=${r.fonte}` : ''}`];
		for (const cat of r.categorias) {
			out.push(cat.id ? `## ${cat.nome} (categoria ${cat.id})` : '## (sem categoria)');
			for (const c of cat.canais) out.push(`  ${c.tipo === 'voice' || c.tipo === 'stage' ? '<)' : '#'}${c.nome} | channelId=${c.id} | ${c.tipo}${c.nsfw ? ' nsfw' : ''}${c.ultimaMensagemEm ? ` | ultima ${quando(c.ultimaMensagemEm, o.fuso)}` : ''}${c.topico ? ` | ${corta(esc(c.topico), 100)}` : ''}`);
		}
		return linhas(out);
	},
	get_channel(r, o) {
		if (!r?.id) return null;
		const out = [`# ${r.rotulo || r.nome || r.id} | channelId=${r.id} | tipo=${r.tipo}${r.guildId ? ` | guildId=${r.guildId}` : ''}${r.parentId ? ` | pai=${r.parentId}` : ''}${r.nsfw ? ' | nsfw' : ''}`];
		if (r.topico) out.push(`topico: ${esc(r.topico)}`);
		if (r.participantes?.length) out.push(`participantes: ${r.participantes.map((p) => `${p.nome} (${p.id})`).join(', ')}`);
		if (r.thread) out.push(`thread: ${r.thread.arquivada ? 'ARQUIVADA' : 'ativa'}${r.thread.trancada ? ', trancada' : ''} | ${r.thread.mensagens ?? '?'} mensagens | ${r.thread.membros ?? '?'} membros${r.thread.criadaEm ? ` | criada ${quando(r.thread.criadaEm, o.fuso)}` : ''}${r.thread.autorId ? ` | autor ${r.thread.autorId}` : ''}`);
		if (r.tags?.length) out.push(`tags do forum: ${r.tags.map((t) => `${t.nome} (${t.id})`).join(', ')}`);
		if (r.ultimaMensagemId) out.push(`ultima mensagem: #${r.ultimaMensagemId}${r.ultimaMensagemEm ? ` em ${quando(r.ultimaMensagemEm, o.fuso)}` : ''}`);
		if (r.cursor) out.push(`cursor local: #${r.cursor}`);
		return linhas(out);
	},
	list_threads(r, o) {
		if (!Array.isArray(r?.threads)) return null;
		const out = [`# ${plural(r.threads.length, 'thread', 'threads')}${r.total != null ? ` de ${r.total}` : ''} em ${r.rotulo || r.channelId}${r.archived ? ' (arquivadas)' : ''}${r.hasMore ? ' | ha mais (use offset)' : ''} | fonte=${r.fonte}`];
		for (const t of r.threads) out.push(`${t.nome} | channelId=${t.id}${t.arquivada ? ' | ARQUIVADA' : ''}${t.autorId ? ` | autor ${t.autorId}` : ''} | ${t.mensagens ?? '?'} msgs${t.ultimaEm ? ` | ultima ${quando(t.ultimaEm, o.fuso)}` : ''}${t.criadaEm ? ` | criada ${quando(t.criadaEm, o.fuso)}` : ''}${t.tags?.length ? ` | tags ${t.tags.join(',')}` : ''}`);
		if (r.threads.length) out.push('Leia um post com read_messages channelId=<channelId da thread>; responda dentro dele com reply_message.');
		for (const a of r.avisos || []) out.push(`aviso: ${a}`);
		return linhas(out);
	},
	read_messages(r, o) {
		if (!Array.isArray(r?.mensagens)) return null;
		const out = [`# ${cabecalhoCanal(r)} | ${plural(r.mensagens.length, 'mensagem', 'mensagens')}${r.hasMoreBefore ? ` | ha mais antes de #${r.mensagens[0]?.id} (before=)` : ''}${r.markRead ? ' | marcadas como tratadas' : ''}${r.cursor ? ` | cursor=#${r.cursor}` : ''}`];
		if (!r.mensagens.length) out.push('(nenhuma mensagem neste intervalo)');
		for (const m of r.mensagens) out.push(...linhaMensagem(m, o.fuso));
		return linhas(out);
	},
	get_message(r, o) { return r?.mensagem ? linhas([`# ${cabecalhoCanal(r)}`, ...linhaMensagem(r.mensagem, o.fuso)]) : null; },
	search_messages(r, o) {
		if (!Array.isArray(r?.resultados)) return null;
		const out = [`# busca em ${r.escopo}: ${r.total ?? r.resultados.length} resultado(s), mostrando ${r.resultados.length} (offset=${r.offset ?? 0})${r.indexando ? ' | indice ainda incompleto' : ''}`];
		for (const m of r.resultados) out.push(...linhaMensagem(m, o.fuso), `    canal ${m.channelId}`);
		return linhas(out);
	},
	send_message(r, o) {
		if (!Array.isArray(r?.enviadas)) return null;
		return linhas([`ok ${plural(r.enviadas.length, 'mensagem enviada', 'mensagens enviadas')} em ${cabecalhoCanal(r)}${r.replyTo ? ` em resposta a #${r.replyTo}` : ''}${r.typingMs ? ` | digitando ${r.typingMs}ms` : ''}`, ...r.enviadas.map((m) => `  #${m.id} ${quando(m.timestamp, o.fuso)}${m.chars != null ? ` (${m.chars} chars)` : ''}`), r.cursor ? `cursor do canal avancado para #${r.cursor} (conversa tratada)` : null]);
	},
	reply_message(r, o) { return R.send_message(r, o); },
	edit_message(r, o) { return r?.id ? `ok mensagem #${r.id} editada em ${cabecalhoCanal(r)}${r.editedTimestamp ? ` as ${quando(r.editedTimestamp, o.fuso)}` : ''}` : null; },
	delete_message(r) { return r?.apagada ? `ok mensagem #${r.id} apagada em ${cabecalhoCanal(r)}` : null; },
	add_reaction(r) { return r?.emoji ? `ok reacao ${r.emoji} ${r.removed ? 'removida de' : 'adicionada em'} #${r.id} (${cabecalhoCanal(r)})` : null; },
	open_dm(r) { return r?.channelId ? `ok ${r.rotulo} | channelId=${r.channelId}${r.participantes?.length ? ` | ${r.participantes.map((p) => `${p.nome} (${p.id})`).join(', ')}` : ''}` : null; },
	mark_read(r) { return r?.channelId ? `ok ${cabecalhoCanal(r)} tratado ate #${r.messageId || '(sem mensagens)'}${r.cursorAnterior ? ` (antes #${r.cursorAnterior})` : ''} | ack no Discord: ${r.ack === true ? 'sim' : r.ack === false ? 'nao' : 'desligado'}${r.aviso ? ` | ${r.aviso}` : ''}` : null; },
	watch_channel(r, o) {
		if (!Array.isArray(r?.vigiados)) return null;
		const out = [`# ${r.action}: ${plural(r.vigiados.length, 'canal vigiado', 'canais vigiados')}${r.alterado ? ` | ${r.alterado}` : ''}`];
		for (const v of r.vigiados) out.push(`  ${v.nome || v.channelId} | channelId=${v.channelId}${v.guildId ? ` guildId=${v.guildId}` : ''}${v.note ? ` | ${esc(v.note)}` : ''} | desde ${quando(v.adicionadoEm, o.fuso)}`);
		return linhas(out);
	},
	join_thread(r) { return r?.channelId ? `ok ${r.left ? 'saiu de' : 'entrou em'} ${r.nome ? `"${r.nome}"` : 'thread'} | channelId=${r.channelId}` : null; },
	create_thread(r) { return r?.id ? `ok ${r.tipo} "${r.nome}" criada | channelId=${r.id} | em ${r.parentId}${r.mensagemId ? ` | primeira mensagem #${r.mensagemId}` : ''}` : null; },
	join_invite(r, o) {
		if (!r?.code) return null;
		const out = [`# convite ${r.code}: ${r.servidor?.nome || '?'} | guildId=${r.servidor?.id || '?'}${r.servidor?.membros != null ? ` | ${r.servidor.membros} membros` : ''}${r.servidor?.online != null ? ` (${r.servidor.online} online)` : ''}${r.canal ? ` | canal #${r.canal.nome} (${r.canal.id})` : ''}${r.convidadoPor ? ` | por ${r.convidadoPor}` : ''}${r.expiraEm ? ` | expira ${quando(r.expiraEm, o.fuso)}` : ''}`];
		out.push(r.jaMembro ? 'A conta ja e membro deste servidor (nada mudou).' : r.aceito ? 'ENTROU no servidor com esta conta.' : 'Nao entrou (accept=true para entrar).');
		return linhas(out);
	},
	get_user(r, o) {
		if (!r?.id) return null;
		const out = [`# ${nomeAutor(r)} | userId=${r.id}${r.bot ? ' | BOT' : ''}${r.criadoEm ? ` | conta criada ${quando(r.criadoEm, o.fuso)}` : ''}${r.pronomes ? ` | ${r.pronomes}` : ''}`];
		if (r.bio) out.push(`bio: ${esc(r.bio)}`);
		if (r.mutualGuilds?.length) out.push(`servidores em comum: ${r.mutualGuilds.map((g) => `${g.nome || g.id}`).join(', ')}`);
		if (r.membro) out.push(`membro de ${r.membro.servidor || r.membro.guildId}: ${r.membro.nick ? `apelido "${r.membro.nick}" | ` : ''}cargos=[${(r.membro.cargos || []).join(', ')}]${r.membro.entrouEm ? ` | entrou ${quando(r.membro.entrouEm, o.fuso)}` : ''}`);
		if (r.relacao) out.push(`relacao: ${r.relacao}`);
		for (const a of r.avisos || []) out.push(`aviso: ${a}`);
		return linhas(out);
	},
	friends(r) {
		if (!r?.action) return null;
		if (r.action !== 'list') return `ok ${r.action} userId=${r.userId}${r.nome ? ` (${r.nome})` : ''}`;
		if (!Array.isArray(r.relacoes)) return null;
		const grupos = { incoming: 'pedidos recebidos', outgoing: 'pedidos enviados', friends: 'amigos', blocked: 'bloqueados' };
		const out = [`# ${plural(r.relacoes.length, 'relacao', 'relacoes')}${r.filtro ? ` (${grupos[r.filtro] || r.filtro})` : ''}`];
		for (const tipo of ['incoming', 'outgoing', 'friends', 'blocked']) {
			const lista = r.relacoes.filter((x) => x.tipo === tipo);
			if (!lista.length) continue;
			out.push(`## ${grupos[tipo]} (${lista.length})`);
			for (const x of lista) out.push(`  ${x.nome} | userId=${x.userId}${x.apelido ? ` | apelido ${x.apelido}` : ''}${x.desde ? ` | desde ${x.desde.slice(0, 10)}` : ''}`);
		}
		if (r.relacoes.some((x) => x.tipo === 'incoming')) out.push('Aceite um pedido com friends action=accept userId=<id>.');
		return linhas(out);
	},
};

export function renderizar(tool, valor, opcoes = {}) {
	if (valor == null || typeof valor !== 'object') return null;
	const fn = R[tool];
	if (!fn) return null;
	try { return fn(valor, opcoes); } catch { return null; }
}

export function renderizarErro(e) {
	if (typeof e === 'string') return `ERRO: ${e}`;
	if (!e || typeof e !== 'object') return `ERRO: ${String(e)}`;
	const { code, message, ...rest } = e;
	const flags = [];
	if (rest.nothingExecuted === true) { flags.push('nada executado'); delete rest.nothingExecuted; }
	else if (rest.nothingExecuted === false) delete rest.nothingExecuted;
	if (rest.executionUnknown) { flags.push('execucao incerta'); delete rest.executionUnknown; }
	if (rest.retryAfterMs != null) { flags.push(`retryAfterMs=${rest.retryAfterMs}`); delete rest.retryAfterMs; }
	const out = [`ERRO ${code || ''}: ${esc(message || '')}${flags.length ? ` (${flags.join('; ')})` : ''}`.replace(/^ERRO : /, 'ERRO: ')];
	if (rest.discord) { out.push(`discord: ${typeof rest.discord === 'string' ? rest.discord : JSON.stringify(rest.discord)}`); delete rest.discord; }
	if (rest.hint) { out.push(rest.hint); delete rest.hint; }
	delete rest.status;
	const sobra = Object.keys(rest);
	if (sobra.length) out.push(JSON.stringify(rest));
	return linhas(out);
}
