export const VERSAO = '1.0.0';
export const NOME_SERVIDOR = 'discord-mcp-pessoal';
export const EPOCA_DISCORD = 1420070400000n;


export class ErroMcp extends Error {
	constructor(code, message, extra = {}) {
		super(message);
		this.name = 'ErroMcp';
		this.code = code;
		this.nothingExecuted = extra.nothingExecuted ?? true;
		if (extra.executionUnknown) this.executionUnknown = true;
		if (extra.retryAfterMs != null) this.retryAfterMs = Math.max(0, Math.round(extra.retryAfterMs));
		if (extra.status != null) this.status = extra.status;
		if (extra.discord != null) this.discord = extra.discord;
		if (extra.hint) this.hint = extra.hint;
	}
	toJSON() {
		const o = { code: this.code, message: this.message, nothingExecuted: this.nothingExecuted };
		if (this.executionUnknown) o.executionUnknown = true;
		if (this.retryAfterMs != null) o.retryAfterMs = this.retryAfterMs;
		if (this.status != null) o.status = this.status;
		if (this.discord != null) o.discord = this.discord;
		if (this.hint) o.hint = this.hint;
		return o;
	}
}

export function comoErroMcp(e) {
	if (e instanceof ErroMcp) return e;
	if (e && typeof e === 'object' && typeof e.code === 'string' && typeof e.message === 'string') return new ErroMcp(e.code, e.message, e);
	if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return new ErroMcp('TIMEOUT', 'tempo limite esgotado', { nothingExecuted: false, executionUnknown: true });
	return new ErroMcp('INTERNAL', e?.message || String(e), { nothingExecuted: false, executionUnknown: true });
}


export function validar(schema, value, path = 'arguments', depth = 0) {
	if (!schema || depth > 30) return depth > 30 ? `${path}: objeto profundo demais` : '';
	const type = schema.type;
	if (type === 'object') {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path}: esperado objeto`;
		for (const name of schema.required || []) if (!Object.hasOwn(value, name)) return `${path}.${name}: obrigatorio`;
		for (const [name, v] of Object.entries(value)) {
			const sub = schema.properties?.[name];
			if (!sub && schema.additionalProperties === false) return `${path}.${name}: argumento desconhecido`;
			const error = sub && validar(sub, v, `${path}.${name}`, depth + 1);
			if (error) return error;
		}
	} else if (type === 'array') {
		if (!Array.isArray(value)) return `${path}: esperada lista`;
		if (schema.minItems != null && value.length < schema.minItems) return `${path}: lista vazia`;
		if (value.length > (schema.maxItems ?? 2000)) return `${path}: lista grande demais`;
		for (let i = 0; i < value.length; i++) { const e = validar(schema.items, value[i], `${path}[${i}]`, depth + 1); if (e) return e; }
	} else if (type === 'string') {
		if (typeof value !== 'string') return `${path}: esperado texto`;
		if (schema.minLength != null && value.length < schema.minLength) return `${path}: texto vazio`;
		if (value.length > (schema.maxLength ?? 1000000)) return `${path}: texto grande demais`;
		if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}: formato invalido`;
	} else if (type === 'integer' || type === 'number') {
		if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) return `${path}: numero invalido`;
		if (schema.minimum != null && value < schema.minimum) return `${path}: abaixo do minimo`;
		if (schema.maximum != null && value > schema.maximum) return `${path}: acima do maximo`;
	} else if (type === 'boolean' && typeof value !== 'boolean') return `${path}: esperado booleano`;
	if (schema.enum && !schema.enum.includes(value)) return `${path}: opcao invalida (${schema.enum.join('|')})`;
	return '';
}


const LIMITES = {
	ENVIOS_POR_MINUTO: [1, 120, 20],
	INTERVALO_ENVIO_MS: [0, 30000, 1500],
	TEMPO_LIMITE_MS: [2000, 60000, 15000],
	TENTATIVAS: [0, 5, 2],
	ESPERA_AUTOMATICA_MS: [0, 10000, 2500],
	INBOX_JANELA_HORAS: [1, 720, 48],
	MAX_RESULTADO: [2000, 200000, 24000],
	MAX_RESPONDIDAS: [100, 20000, 3000],
	GATEWAY_BUFFER: [50, 5000, 500],
	PORTA: [1, 65535, 8787],
};
const booleanoEnv = (v, padrao) => (v == null || v === '' ? padrao : !['0', 'false', 'nao', 'no', 'off'].includes(String(v).trim().toLowerCase()));

export function lerConfig(env = {}) {
	const cfg = {};
	for (const [chave, [min, max, padrao]] of Object.entries(LIMITES)) {
		const bruto = env[chave];
		const n = bruto == null || bruto === '' ? padrao : Number(bruto);
		cfg[chave] = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : padrao;
	}
	const token = typeof env.DISCORD_TOKEN === 'string' ? env.DISCORD_TOKEN.trim() : '';
	let modo = String(env.DISCORD_MODO || '').trim().toLowerCase();
	if (!modo) modo = /^bot\s+/i.test(token) ? 'bot' : 'user';
	if (modo !== 'user' && modo !== 'bot') modo = 'user';
	cfg.DISCORD_TOKEN = token.replace(/^bot\s+/i, '');
	cfg.DISCORD_MODO = modo;
	cfg.API_VERSAO = [6, 7, 8, 9, 10].includes(Number(env.API_VERSAO)) ? Number(env.API_VERSAO) : modo === 'bot' ? 10 : 9;
	cfg.SOMENTE_LEITURA = booleanoEnv(env.SOMENTE_LEITURA, false);
	cfg.GATEWAY = booleanoEnv(env.GATEWAY, true);
	cfg.GATEWAY_STATUS = ['online', 'idle', 'dnd', 'invisible'].includes(env.GATEWAY_STATUS) ? env.GATEWAY_STATUS : 'online';
	cfg.ACK_DISCORD = booleanoEnv(env.ACK_DISCORD, true);
	cfg.VERIFICAR_DUPLICATA_REMOTA = booleanoEnv(env.VERIFICAR_DUPLICATA_REMOTA, true);
	cfg.FUSO = typeof env.FUSO === 'string' && env.FUSO.trim() ? env.FUSO.trim() : 'America/Sao_Paulo';
	cfg.IDIOMA = typeof env.IDIOMA === 'string' && env.IDIOMA.trim() ? env.IDIOMA.trim() : 'pt-BR';
	cfg.PROTOCOLO = typeof env.PROTOCOLO === 'string' ? env.PROTOCOLO : '';
	cfg.PROTOCOLO_ARQUIVO = typeof env.PROTOCOLO_ARQUIVO === 'string' && env.PROTOCOLO_ARQUIVO.trim() ? env.PROTOCOLO_ARQUIVO.trim() : 'protocolo.md';
	cfg.DADOS_DIR = typeof env.DADOS_DIR === 'string' && env.DADOS_DIR.trim() ? env.DADOS_DIR.trim() : 'dados';
	cfg.MCP_TOKEN = typeof env.MCP_TOKEN === 'string' ? env.MCP_TOKEN.trim() : '';
	cfg.USER_AGENT = typeof env.USER_AGENT === 'string' && env.USER_AGENT.trim() ? env.USER_AGENT.trim() : '';
	cfg.CLIENT_BUILD_NUMBER = Number.isFinite(Number(env.CLIENT_BUILD_NUMBER)) && Number(env.CLIENT_BUILD_NUMBER) > 0 ? Number(env.CLIENT_BUILD_NUMBER) : 0;
	return cfg;
}


export function snowflakeParaMs(id) {
	try { return Number((BigInt(String(id)) >> 22n) + EPOCA_DISCORD); } catch { return NaN; }
}
export function snowflakeParaIso(id) {
	const ms = snowflakeParaMs(id);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export function msParaSnowflake(ms) {
	const base = BigInt(Math.max(Number(EPOCA_DISCORD), Math.floor(ms))) - EPOCA_DISCORD;
	return (base << 22n).toString();
}
export function compararSnowflakes(a, b) {
	if (a == null && b == null) return 0;
	if (a == null) return -1;
	if (b == null) return 1;
	try { const x = BigInt(String(a)), y = BigInt(String(b)); return x < y ? -1 : x > y ? 1 : 0; } catch { return String(a).localeCompare(String(b)); }
}
export const maiorSnowflake = (...ids) => ids.filter((x) => x != null && x !== '').reduce((m, x) => (compararSnowflakes(x, m) > 0 ? x : m), null);


export function cortarResultado(texto, max) {
	if (typeof texto !== 'string' || texto.length <= max) return texto;
	const omitidos = texto.length - max;
	return `${texto.slice(0, max)}\n[... cortado: ${omitidos} caracteres omitidos. Peca menos de cada vez (limit, perChannel, before/after) ou use format=json com limit menor.]`;
}

export function dormir(ms, sinal) {
	return new Promise((resolve, reject) => {
		if (ms <= 0) return resolve();
		const t = setTimeout(resolve, ms);
		if (sinal) sinal.addEventListener('abort', () => { clearTimeout(t); reject(new ErroMcp('CANCELLED', 'cancelado')); }, { once: true });
	});
}

export function idAleatorio(bytes = 16) {
	const b = new Uint8Array(bytes);
	globalThis.crypto.getRandomValues(b);
	return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}


export function contaSegura(u) {
	if (!u || typeof u !== 'object') return null;
	return { id: u.id, username: u.username, globalName: u.global_name || null, discriminator: u.discriminator && u.discriminator !== '0' ? u.discriminator : null, bot: !!u.bot, verified: u.verified ?? null, mfa: u.mfa_enabled ?? null };
}


export function dividirTexto(texto, max = 2000) {
	const partes = [];
	let resto = String(texto);
	while (resto.length > max) {
		let corte = resto.lastIndexOf('\n', max);
		if (corte < max * 0.4) corte = resto.lastIndexOf(' ', max);
		if (corte < max * 0.4) corte = max;
		partes.push(resto.slice(0, corte).trimEnd());
		resto = resto.slice(corte).trimStart();
	}
	if (resto.length) partes.push(resto);
	return partes.filter((p) => p.length);
}
