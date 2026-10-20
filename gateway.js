import { superPropriedades } from './api-discord.js';

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 };
const FECHAMENTOS_FATAIS = { 4004: 'AUTH_FAILED: token recusado pelo gateway', 4010: 'shard invalido', 4011: 'sharding obrigatorio', 4012: 'versao de API invalida', 4013: 'intents invalidos', 4014: 'intents nao permitidos (ative Message Content Intent no portal do bot)' };
const INTENTS_BOT = 1 | 512 | 4096 | 32768;                                                               

export class Gateway {
	constructor({ config, WebSocketImpl, agora, log, aoEvento, setTimeoutFn, clearTimeoutFn } = {}) {
		this.cfg = config;
		this.WS = WebSocketImpl === undefined ? globalThis.WebSocket : WebSocketImpl;
		this.agora = agora || Date.now;
		this.log = log || (() => {});
		this.aoEvento = aoEvento || (() => {});
		this.setTimeout = setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
		this.clearTimeout = clearTimeoutFn || ((t) => clearTimeout(t));
		this.estado = 'desligado';
		this.motivo = this.WS ? null : 'WebSocket global indisponivel neste runtime (use Node 22+ ou GATEWAY=0)';
		this.ws = null;
		this.seq = null;
		this.sessaoId = null;
		this.urlResume = null;
		this.heartbeatTimer = null;
		this.heartbeatAck = true;
		this.reconexoes = 0;
		this.tentativa = 0;
		this.parado = false;
		this.ultimoEvento = null;
		this.buffer = [];
		this.canais = new Map();
		this.servidores = new Map();
		this.readState = new Map();
		this.usuario = null;
		this.conectadoEm = null;
	}

	get disponivel() { return !!this.WS; }

	iniciar() {
		if (!this.WS) { this.estado = 'indisponivel'; return this; }
		if (!this.cfg.DISCORD_TOKEN) { this.estado = 'indisponivel'; this.motivo = 'sem DISCORD_TOKEN'; return this; }
		this.parado = false;
		this.conectar();
		return this;
	}

	parar() {
		this.parado = true;
		this.limparHeartbeat();
		if (this.ws) { try { this.ws.close(1000, 'parando'); } catch {} }
		this.ws = null;
		this.estado = 'desligado';
	}

	conectar() {
		if (this.parado) return;
		const base = this.sessaoId && this.urlResume ? this.urlResume : 'wss://gateway.discord.gg';
		const url = `${base.replace(/\/$/, '')}/?v=${this.cfg.API_VERSAO}&encoding=json`;
		this.estado = this.sessaoId ? 'reconectando' : 'conectando';
		let ws;
		try { ws = new this.WS(url); } catch (e) { this.falhar(`nao abriu WebSocket: ${e?.message || e}`); return; }
		this.ws = ws;
		this.heartbeatAck = true;
		ws.onopen = () => { this.log('info', 'gateway: socket aberto'); };
		ws.onmessage = (ev) => { this.receber(typeof ev.data === 'string' ? ev.data : String(ev.data)); };
		ws.onerror = (ev) => { this.log('warn', `gateway: erro de socket ${ev?.message || ''}`.trim()); };
		ws.onclose = (ev) => { this.aoFechar(ev?.code, ev?.reason); };
	}

	enviar(op, d) {
		if (!this.ws || this.ws.readyState !== 1) return false;
		try { this.ws.send(JSON.stringify({ op, d })); return true; } catch (e) { this.log('warn', `gateway: falha ao enviar op ${op}: ${e?.message || e}`); return false; }
	}

	identificar() {
		if (this.cfg.DISCORD_MODO === 'bot') {
			return this.enviar(OP.IDENTIFY, { token: this.cfg.DISCORD_TOKEN, intents: INTENTS_BOT, properties: { os: 'linux', browser: 'discord-mcp-pessoal', device: 'discord-mcp-pessoal' }, presence: { status: this.cfg.GATEWAY_STATUS, since: 0, activities: [], afk: false } });
		}
		const props = JSON.parse(decodeURIComponent(escape(atob(superPropriedades(this.cfg)))));
		return this.enviar(OP.IDENTIFY, { token: this.cfg.DISCORD_TOKEN, capabilities: 0, properties: props, presence: { status: this.cfg.GATEWAY_STATUS, since: 0, activities: [], afk: false }, compress: false, client_state: { guild_versions: {} } });
	}

	retomar() { return this.enviar(OP.RESUME, { token: this.cfg.DISCORD_TOKEN, session_id: this.sessaoId, seq: this.seq }); }

	receber(texto) {
		let pacote;
		try { pacote = JSON.parse(texto); } catch { return; }
		if (pacote.s != null) this.seq = pacote.s;
		switch (pacote.op) {
			case OP.HELLO: {
				const intervalo = Number(pacote.d?.heartbeat_interval) || 41250;
				this.iniciarHeartbeat(intervalo);
				if (this.sessaoId && this.seq != null) this.retomar(); else this.identificar();
				break;
			}
			case OP.HEARTBEAT: this.enviar(OP.HEARTBEAT, this.seq); break;
			case OP.HEARTBEAT_ACK: this.heartbeatAck = true; break;
			case OP.RECONNECT: this.log('info', 'gateway: pedido de reconexao'); this.fecharParaReconectar(4000); break;
			case OP.INVALID_SESSION: {
				const retomavel = pacote.d === true;
				this.log('warn', `gateway: sessao invalida (retomavel=${retomavel})`);
				if (!retomavel) { this.sessaoId = null; this.seq = null; }
				this.setTimeout(() => { if (this.sessaoId) this.retomar(); else this.identificar(); }, 1000 + Math.floor(Math.random() * 4000));
				break;
			}
			case OP.DISPATCH: this.despachar(pacote.t, pacote.d); break;
			default: break;
		}
	}

	despachar(tipo, d) {
		this.ultimoEvento = new Date(this.agora()).toISOString();
		switch (tipo) {
			case 'READY': {
				this.sessaoId = d.session_id;
				this.urlResume = d.resume_gateway_url || this.urlResume;
				this.usuario = d.user || this.usuario;
				this.estado = 'conectado';
				this.motivo = null;
				this.tentativa = 0;
				this.conectadoEm = new Date(this.agora()).toISOString();
				for (const g of d.guilds || []) this.registrarServidor(g);
				for (const c of d.private_channels || []) this.canais.set(c.id, c);
				const rs = Array.isArray(d.read_state) ? d.read_state : Array.isArray(d.read_state?.entries) ? d.read_state.entries : [];
				for (const r of rs) if (r?.id) this.readState.set(r.id, { lastMessageId: r.last_message_id, mentionCount: r.mention_count || 0 });
				this.log('info', `gateway: pronto (${this.servidores.size} servidores, ${this.canais.size} canais em cache)`);
				break;
			}
			case 'RESUMED': this.estado = 'conectado'; this.motivo = null; this.tentativa = 0; this.log('info', 'gateway: sessao retomada'); break;
			case 'MESSAGE_CREATE': {
				if (!d?.id) break;
				this.buffer.push(d);
				if (this.buffer.length > this.cfg.GATEWAY_BUFFER) this.buffer.splice(0, this.buffer.length - this.cfg.GATEWAY_BUFFER);
				const c = this.canais.get(d.channel_id);
				if (c) c.last_message_id = d.id;
				this.aoEvento('mensagem', d);
				break;
			}
			case 'MESSAGE_UPDATE': {
				const i = this.buffer.findIndex((m) => m.id === d?.id);
				if (i >= 0) this.buffer[i] = { ...this.buffer[i], ...d };
				break;
			}
			case 'MESSAGE_DELETE': { const i = this.buffer.findIndex((m) => m.id === d?.id); if (i >= 0) this.buffer.splice(i, 1); break; }
			case 'MESSAGE_ACK': if (d?.channel_id) this.readState.set(d.channel_id, { lastMessageId: d.message_id, mentionCount: 0 }); break;
			case 'CHANNEL_CREATE': case 'CHANNEL_UPDATE': case 'THREAD_CREATE': case 'THREAD_UPDATE': if (d?.id) this.canais.set(d.id, d); break;
			case 'CHANNEL_DELETE': case 'THREAD_DELETE': if (d?.id) this.canais.delete(d.id); break;
			case 'GUILD_CREATE': this.registrarServidor(d); break;
			case 'GUILD_DELETE': if (d?.id && !d.unavailable) { this.servidores.delete(d.id); for (const [id, c] of this.canais) if (c.guild_id === d.id) this.canais.delete(id); } break;
			default: break;
		}
	}

	registrarServidor(g) {
		if (!g?.id) return;
		const props = g.properties || g;
		this.servidores.set(g.id, { id: g.id, name: props.name, ownerId: props.owner_id, memberCount: g.member_count ?? null });
		for (const c of g.channels || []) this.canais.set(c.id, { ...c, guild_id: g.id });
		for (const t of g.threads || []) this.canais.set(t.id, { ...t, guild_id: g.id });
	}

	iniciarHeartbeat(intervalo) {
		this.limparHeartbeat();
		const bater = () => {
			if (!this.heartbeatAck) { this.log('warn', 'gateway: sem ACK de heartbeat; reconectando'); this.fecharParaReconectar(4000); return; }
			this.heartbeatAck = false;
			this.enviar(OP.HEARTBEAT, this.seq);
			this.heartbeatTimer = this.setTimeout(bater, intervalo);
		};
		this.heartbeatTimer = this.setTimeout(bater, Math.floor(intervalo * Math.random()));
	}

	limparHeartbeat() { if (this.heartbeatTimer) { this.clearTimeout(this.heartbeatTimer); this.heartbeatTimer = null; } }

	fecharParaReconectar(codigo) {
		this.limparHeartbeat();
		const ws = this.ws;
		this.ws = null;
		if (ws) { ws.onclose = null; try { ws.close(codigo, 'reconectar'); } catch {} }
		this.agendarReconexao();
	}

	aoFechar(codigo, razao) {
		this.limparHeartbeat();
		this.ws = null;
		if (this.parado) { this.estado = 'desligado'; return; }
		const fatal = FECHAMENTOS_FATAIS[codigo];
		if (fatal) { this.falhar(`${fatal} (codigo ${codigo})`); return; }
		if (codigo === 4007 || codigo === 4009) { this.sessaoId = null; this.seq = null; }
		this.log('warn', `gateway: fechado (${codigo || '?'}${razao ? ` ${razao}` : ''}); reconectando`);
		this.agendarReconexao();
	}

	agendarReconexao() {
		if (this.parado) return;
		this.estado = 'reconectando';
		this.reconexoes++;
		const espera = Math.min(60000, 1000 * 2 ** Math.min(6, this.tentativa++)) + Math.floor(Math.random() * 500);
		this.motivo = `reconectando em ${espera}ms`;
		this.setTimeout(() => this.conectar(), espera);
	}

	falhar(motivo) {
		this.limparHeartbeat();
		this.estado = 'falhou';
		this.motivo = motivo;
		this.parado = true;
		this.ws = null;
		this.log('error', `gateway: ${motivo}`);
	}


	mensagens() { return this.buffer.slice(); }
	canal(channelId) { return this.canais.get(channelId) || null; }
	canaisDoServidor(guildId) { return [...this.canais.values()].filter((c) => c.guild_id === guildId && ![10, 11, 12].includes(c.type)); }
	servidor(guildId) { return this.servidores.get(guildId) || null; }
	resumo() {
		return { disponivel: this.disponivel, estado: this.estado, motivo: this.motivo || undefined, ultimoEvento: this.ultimoEvento, eventosNoBuffer: this.buffer.length, reconexoes: this.reconexoes, conectadoEm: this.conectadoEm, servidoresEmCache: this.servidores.size, canaisEmCache: this.canais.size };
	}
}
