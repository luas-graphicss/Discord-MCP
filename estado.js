import { compararSnowflakes } from './nucleo.js';

const VERSAO_ESTADO = 1;

export class ArmazemMemoria {
	constructor() { this.descricao = 'memoria (nao persiste entre reinicios)'; this.conteudo = null; }
	async ler() { return this.conteudo; }
	async gravar(texto) { this.conteudo = texto; }
}


export class ArmazemArquivo {
	constructor(caminho, fs, path) {
		this.caminho = caminho;
		this.fs = fs;
		this.path = path;
		this.descricao = `arquivo ${caminho}`;
	}
	async ler() {
		try { return await this.fs.readFile(this.caminho, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
	}
	async gravar(texto) {
		await this.fs.mkdir(this.path.dirname(this.caminho), { recursive: true });
		const tmp = `${this.caminho}.${process.pid}.tmp`;
		await this.fs.writeFile(tmp, texto, 'utf8');
		await this.fs.rename(tmp, this.caminho);
	}
}

export class ArmazemDurable {
	constructor(storage, chave = 'estado') { this.storage = storage; this.chave = chave; this.descricao = 'storage do Durable Object'; }
	async ler() { const v = await this.storage.get(this.chave); return v == null ? null : String(v); }
	async gravar(texto) { await this.storage.put(this.chave, texto); }
}

export function estadoVazio(agora = Date.now) {
	return { versao: VERSAO_ESTADO, criadoEm: new Date(agora()).toISOString(), cursores: {}, vigiados: {}, respondidas: {}, estatisticas: { chamadas: 0, ok: 0, erro: 0, envios: 0, porFerramenta: {} } };
}

export class Estado {
	constructor({ armazem, config, agora, atrasoSalvarMs = 250, log } = {}) {
		this.armazem = armazem || new ArmazemMemoria();
		this.cfg = config || {};
		this.agora = agora || Date.now;
		this.atrasoSalvarMs = atrasoSalvarMs;
		this.log = log || (() => {});
		this.dados = estadoVazio(this.agora);
		this.carregado = false;
		this.sujo = false;
		this.timer = null;
		this.gravando = null;
		this.erroPersistencia = null;
	}

	async carregar() {
		if (this.carregado) return this;
		try {
			const texto = await this.armazem.ler();
			if (texto) {
				const lido = JSON.parse(texto);
				if (lido && typeof lido === 'object') this.dados = { ...estadoVazio(this.agora), ...lido, estatisticas: { ...estadoVazio(this.agora).estatisticas, ...(lido.estatisticas || {}) } };
			}
		} catch (e) {
			this.erroPersistencia = `falha ao ler estado: ${e?.message || e}`;
			this.log('error', this.erroPersistencia);
		}
		this.carregado = true;
		return this;
	}

	marcarSujo() {
		this.sujo = true;
		if (this.atrasoSalvarMs <= 0) return this.salvarAgora();
		if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.salvarAgora().catch(() => {}); }, this.atrasoSalvarMs);
		if (typeof this.timer?.unref === 'function') this.timer.unref();
		return null;
	}

	async salvarAgora() {
		if (this.timer) { clearTimeout(this.timer); this.timer = null; }
		if (!this.sujo) return;
		if (this.gravando) await this.gravando.catch(() => {});
		this.sujo = false;
		this.gravando = this.armazem.gravar(JSON.stringify(this.dados)).then(() => { this.erroPersistencia = null; }).catch((e) => {
			this.sujo = true;
			this.erroPersistencia = `falha ao gravar estado: ${e?.message || e}`;
			this.log('error', this.erroPersistencia);
		});
		await this.gravando;
		this.gravando = null;
	}


	cursor(channelId) { return this.dados.cursores[channelId]?.ultimaTratada ?? null; }
	avancarCursor(channelId, messageId, origem = 'manual') {
		const anterior = this.cursor(channelId);
		if (messageId == null || compararSnowflakes(messageId, anterior) <= 0) return { anterior, atual: anterior, avancou: false };
		this.dados.cursores[channelId] = { ultimaTratada: String(messageId), atualizadoEm: new Date(this.agora()).toISOString(), origem };
		this.marcarSujo();
		return { anterior, atual: String(messageId), avancou: true };
	}


	vigiados() { return Object.entries(this.dados.vigiados).map(([channelId, v]) => ({ channelId, ...v })).sort((a, b) => (a.nome || '').localeCompare(b.nome || '')); }
	vigiado(channelId) { return this.dados.vigiados[channelId] || null; }
	vigiar(channelId, info = {}) {
		const atual = this.dados.vigiados[channelId];
		this.dados.vigiados[channelId] = { ...(atual || {}), ...info, adicionadoEm: atual?.adicionadoEm || new Date(this.agora()).toISOString() };
		this.marcarSujo();
		return !atual;
	}
	desvigiar(channelId) {
		if (!this.dados.vigiados[channelId]) return false;
		delete this.dados.vigiados[channelId];
		this.marcarSujo();
		return true;
	}


	jaRespondida(messageId) { return this.dados.respondidas[messageId] || null; }
	lembrarResposta(messageId, { channelId, respostaId }) {
		this.dados.respondidas[messageId] = { channelId, respostaId, em: new Date(this.agora()).toISOString() };
		const max = this.cfg.MAX_RESPONDIDAS || 3000;
		const chaves = Object.keys(this.dados.respondidas);
		if (chaves.length > max) {
			chaves.sort((a, b) => compararSnowflakes(a, b));
			for (const k of chaves.slice(0, chaves.length - max)) delete this.dados.respondidas[k];
		}
		this.marcarSujo();
	}


	iniciarChamada(nome) {
		const s = this.dados.estatisticas;
		s.chamadas++;
		s.porFerramenta[nome] = (s.porFerramenta[nome] || 0) + 1;
		s.ultimaChamadaEm = new Date(this.agora()).toISOString();
		this.marcarSujo();
	}
	concluirChamada(ok) {
		const s = this.dados.estatisticas;
		if (ok) s.ok++; else s.erro++;
		this.marcarSujo();
	}
	registrarChamada(nome, ok) {
		this.iniciarChamada(nome);
		this.concluirChamada(ok);
	}
	registrarEnvio() { this.dados.estatisticas.envios++; this.marcarSujo(); }

	resumo() {
		return {
			cursores: Object.keys(this.dados.cursores).length,
			vigiados: Object.keys(this.dados.vigiados).length,
			respondidas: Object.keys(this.dados.respondidas).length,
			persistencia: this.erroPersistencia ? `${this.armazem.descricao} | ERRO: ${this.erroPersistencia}` : this.armazem.descricao,
		};
	}
}
