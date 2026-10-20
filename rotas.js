import { VERSAO, NOME_SERVIDOR, idAleatorio } from './nucleo.js';
import { MAPA_FERRAMENTAS, NOMES_FERRAMENTAS } from './ferramentas.js';
import { ajudaTerminal, listarFerramentas, descreverFerramenta, argumentosDeTexto, coagir, cliPython, cliBash } from './terminal.js';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,HEAD,POST,DELETE,OPTIONS',
	'Access-Control-Allow-Headers': '*',
	'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version, Retry-After',
	'Access-Control-Max-Age': '86400',
};

const STATUS_POR_CODIGO = {
	VALIDATION: 400, BAD_REQUEST: 400, INVALID_FORM_BODY: 400, CONTENT_TOO_LONG: 400, WRONG_CHANNEL_TYPE: 400, EMPTY_MESSAGE: 400, UNSUPPORTED_IN_BOT_MODE: 400,
	AUTH_MISSING: 401, AUTH_FAILED: 401,
	FORBIDDEN: 403, READ_ONLY_MODE: 403, BANNED: 403, CANNOT_DM: 403, CAPTCHA_REQUIRED: 403, VERIFICATION_REQUIRED: 403, BLOCKED: 403,
	UNKNOWN_TOOL: 404, NOT_FOUND: 404,
	ALREADY_REPLIED: 409, THREAD_ARCHIVED: 409, THREAD_LOCKED: 409, LIMIT: 409,
	RATE_LIMITED: 429, SEND_QUOTA: 429, SLOWMODE: 429,
	PARTIAL_SEND: 500, INTERNAL: 500,
	NETWORK_ERROR: 502, DISCORD_UNAVAILABLE: 502, DISCORD_ERROR: 502,
	SEARCH_INDEXING: 503,
	TIMEOUT: 504,
};

export const statusDoErro = (e) => STATUS_POR_CODIGO[e?.code] ?? (e?.nothingExecuted === false ? 500 : 400);
export const cabecalhos = (extra = {}) => ({ ...CORS, 'X-Discord-Mcp': VERSAO, ...extra });
export const respostaTexto = (corpo, status = 200, extra = {}) => new Response(corpo, { status, headers: cabecalhos({ 'Content-Type': 'text/plain; charset=utf-8', ...extra }) });
export const respostaJson = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: cabecalhos({ 'Content-Type': 'application/json; charset=utf-8', ...extra }) });
const rpcErro = (code, message, status = 400) => respostaJson({ jsonrpc: '2.0', id: null, error: { code, message } }, status);


export function igualSeguro(a, b) {
	const x = String(a ?? ''), y = String(b ?? '');
	if (!x || !y) return false;
	let diff = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
	return diff === 0;
}

export function autorizado(req, url, segredo) {
	if (!segredo) return true;
	const auth = req.headers.get('authorization') || '';
	if (auth.toLowerCase().startsWith('bearer ') && igualSeguro(auth.slice(7).trim(), segredo)) return true;
	if (igualSeguro(req.headers.get('x-mcp-chave'), segredo)) return true;
	return url.searchParams.has('chave') && igualSeguro(url.searchParams.get('chave'), segredo);
}

export class Rotas {
	constructor({ servidor, segredo = '', prefixo = '/mcp', maxCorpo = 1_000_000, maxStreams = 50, log } = {}) {
		this.servidor = servidor;
		this.segredo = String(segredo || '').trim();
		this.prefixo = '/' + String(prefixo || '').split('/').filter(Boolean).join('/');
		this.maxCorpo = maxCorpo;
		this.maxStreams = maxStreams;
		this.log = log || (() => {});
		this.streams = new Map();
	}


	async tratar(req) {
		try { return await this.rotear(req); }
		catch (e) {
			this.log('error', `rota ${req.method} ${new URL(req.url).pathname}: ${e?.message || e}`);
			return respostaJson({ error: { code: 'INTERNAL', message: String(e?.message || e), nothingExecuted: false, executionUnknown: true } }, 500);
		}
	}

	async rotear(req) {
		const url = new URL(req.url);
		if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhos() });
		const pre = this.prefixo.split('/').filter(Boolean);
		let partes = url.pathname.split('/').filter(Boolean);
		if (!pre.every((s, i) => partes[i] === s)) {
			if (!partes.length || (partes.length === 1 && ['health', 'status'].includes(partes[0]))) return this.saude(url);
			return respostaTexto(`nao encontrado. O MCP esta em ${url.origin}${this.prefixo}\n`, 404);
		}
		partes = partes.slice(pre.length);
		let base = `${url.origin}${this.prefixo}`;
		if (this.segredo) {
			if (partes.length && igualSeguro(partes[0], this.segredo)) { partes.shift(); base += `/${this.segredo}`; }
			else if (autorizado(req, url, this.segredo)) base += `/${this.segredo}`;
			else return respostaJson({ error: { code: 'UNAUTHORIZED', message: 'MCP_TOKEN obrigatorio: Authorization: Bearer <token>, cabecalho X-Mcp-Chave, ?chave=<token> ou /mcp/<token>/...', nothingExecuted: true } }, 401, { 'WWW-Authenticate': 'Bearer realm="discord-mcp"' });
		}
		const [r0, r1, r2] = partes;
		if (!r0) return this.rotaMcp(req, url, base);
		if (partes.length > 2) return respostaTexto(`rota desconhecida: ${url.pathname}\n`, 404);
		const leitura = req.method === 'GET' || req.method === 'HEAD';
		if (r0 === 'health' || r0 === 'status') return this.saude(url);
		if (r0 === 'tools' && leitura) {
			if (!r1) return respostaTexto(listarFerramentas() + '\n');
			const d = descreverFerramenta(r1);
			return d ? respostaTexto(d + '\n') : respostaTexto(`ferramenta desconhecida: ${r1}\n\n${listarFerramentas()}\n`, 404);
		}
		if (r0 === 'cli' && leitura && !r1) return respostaTexto(cliPython(base));
		if (r0 === 'cli.sh' && leitura && !r1) return respostaTexto(cliBash(base));
		if (r0 === 'call') return this.rotaChamada(req, url, r1, r2);
		return respostaTexto(`rota desconhecida: ${url.pathname}\n\n${ajudaTerminal(base)}`, 404);
	}

	saude(url) {
		return respostaJson({ ok: true, servidor: NOME_SERVIDOR, versao: VERSAO, mcp: `${url.origin}${this.prefixo}${this.segredo ? '/<MCP_TOKEN>' : ''}`, ferramentas: NOMES_FERRAMENTAS.length, autenticacao: this.segredo ? 'MCP_TOKEN' : 'nenhuma' });
	}

	async lerCorpo(req) {
		const tamanho = Number(req.headers.get('content-length'));
		if (Number.isFinite(tamanho) && tamanho > this.maxCorpo) throw Object.assign(new Error(`corpo grande demais (${tamanho} bytes; maximo ${this.maxCorpo})`), { status: 413 });
		const texto = await req.text();
		if (texto.length > this.maxCorpo) throw Object.assign(new Error(`corpo grande demais (maximo ${this.maxCorpo} bytes)`), { status: 413 });
		return texto;
	}


	async argumentos(req, url) {
		const args = {};
		for (const [k, v] of url.searchParams) if (k !== 'chave') args[k] = coagir(v);
		const corpo = (await this.lerCorpo(req)).trim();
		if (!corpo) return args;
		const tipo = (req.headers.get('content-type') || '').toLowerCase();
		if (corpo[0] === '{' || tipo.includes('json')) {
			let obj;
			try { obj = JSON.parse(corpo); } catch { throw new Error('corpo JSON invalido'); }
			if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('o corpo JSON deve ser um objeto {chave: valor}');
			return Object.assign(args, obj);
		}
		if (tipo.includes('x-www-form-urlencoded') && corpo.includes('&') && !/\s/.test(corpo)) {
			for (const [k, v] of new URLSearchParams(corpo)) args[k] = coagir(v);
			return args;
		}
		return Object.assign(args, argumentosDeTexto(corpo));
	}

	async rotaChamada(req, url, nome, sobra) {
		if (sobra) return respostaTexto(`rota desconhecida: ${url.pathname}\n`, 404);
		if (req.method !== 'POST') return respostaTexto(`use POST ${url.pathname} com o corpo em JSON ou chave=valor\n`, 405, { Allow: 'POST, OPTIONS' });
		if (!nome) return respostaTexto(`informe a ferramenta: POST .../call/<nome>\n\n${listarFerramentas()}\n`, 400);
		if (!MAPA_FERRAMENTAS.has(nome)) return respostaTexto(`ERRO UNKNOWN_TOOL: ferramenta desconhecida: ${nome} (nada executado)\nFerramentas: ${NOMES_FERRAMENTAS.join(', ')}\n`, 404);
		let args;
		try { args = await this.argumentos(req, url); } catch (e) { return respostaTexto(`ERRO VALIDATION: ${e.message} (nada executado)\nUse ${url.origin}${this.prefixo}/tools/${nome} para ver os parametros.\n`, e.status || 400); }
		const r = await this.servidor.executarFerramenta(nome, args);
		const extra = {};
		if (!r.ok && r.erro.retryAfterMs != null) extra['Retry-After'] = String(Math.max(1, Math.ceil(r.erro.retryAfterMs / 1000)));
		const status = r.ok ? 200 : statusDoErro(r.erro);
		if (r.formato === 'json') return respostaJson(r.ok ? { result: r.valor } : { error: r.erro }, status, extra);
		return respostaTexto(r.texto.endsWith('\n') ? r.texto : r.texto + '\n', status, extra);
	}

	async rotaMcp(req, url, base) {
		const sse = url.searchParams.get('transport') === 'sse' || url.searchParams.get('sse') === '1';
		if (req.method === 'GET' || req.method === 'HEAD') {
			if (sse && req.method === 'GET') return this.abrirSse(req, url);
			const aceita = (req.headers.get('accept') || '').toLowerCase();
			if (aceita.includes('text/event-stream') && !aceita.includes('text/plain') && !aceita.includes('text/html')) {
				return respostaTexto('Este servidor nao abre stream GET (sem notificacoes do servidor). Envie as requisicoes por POST; SSE legado: ?transport=sse\n', 405, { Allow: 'POST, DELETE, OPTIONS' });
			}
			return respostaTexto(ajudaTerminal(base));
		}
		if (req.method === 'DELETE') {
			const sessao = req.headers.get('mcp-session-id');
			if (sessao) this.servidor.sessoes.delete(sessao);
			return new Response(null, { status: 204, headers: cabecalhos() });
		}
		if (req.method !== 'POST') return respostaTexto('use POST (Streamable HTTP) ou GET para a ajuda\n', 405, { Allow: 'GET, POST, DELETE, OPTIONS' });
		let texto;
		try { texto = await this.lerCorpo(req); } catch (e) { return rpcErro(-32600, e.message, e.status || 400); }
		let corpo;
		try { corpo = JSON.parse(texto); } catch { return rpcErro(-32700, 'JSON invalido'); }
		const lote = Array.isArray(corpo) ? corpo : [corpo];
		if (!lote.length || lote.length > 50) return rpcErro(-32600, 'o lote deve ter de 1 a 50 mensagens');
		let sessao = req.headers.get('mcp-session-id') || '';
		const saida = await this.servidor.tratar(corpo, { aoIniciar: (s) => { sessao = s; } });
		const extra = {};
		if (sessao) extra['Mcp-Session-Id'] = sessao;
		const versaoProtocolo = req.headers.get('mcp-protocol-version');
		if (versaoProtocolo) extra['Mcp-Protocol-Version'] = versaoProtocolo;
		const cid = url.searchParams.get('cid');
		if (sse && cid) {
			const escrever = this.streams.get(cid);
			if (!escrever) return respostaTexto('stream SSE encerrado; reconecte\n', 404);
			for (const m of Array.isArray(saida) ? saida : saida ? [saida] : []) escrever('message', JSON.stringify(m));
			return respostaTexto('Accepted', 202, extra);
		}
		if (saida === null) return new Response(null, { status: 202, headers: cabecalhos(extra) });
		return respostaJson(saida, 200, extra);
	}


	abrirSse(req, url) {
		if (this.streams.size >= this.maxStreams) return respostaTexto('limite de streams SSE simultaneos atingido\n', 503, { 'Retry-After': '30' });
		const cid = idAleatorio(12);
		const stream = new TransformStream();
		const writer = stream.writable.getWriter();
		const codificador = new TextEncoder();
		let morto = false, ping = null;
		const fechar = () => {
			if (morto) return;
			morto = true;
			if (ping) clearInterval(ping);
			this.streams.delete(cid);
			writer.close().catch(() => {});
		};
		const escrever = (evento, dados) => { if (!morto) writer.write(codificador.encode(`event: ${evento}\ndata: ${dados}\n\n`)).catch(fechar); };
		this.streams.set(cid, escrever);
		const endpoint = new URL(url);
		endpoint.searchParams.set('transport', 'sse');
		endpoint.searchParams.set('cid', cid);
		endpoint.searchParams.delete('sse');
		escrever('endpoint', endpoint.toString());
		ping = setInterval(() => { if (!morto) writer.write(codificador.encode(': ping\n\n')).catch(fechar); }, 20000);
		if (typeof ping?.unref === 'function') ping.unref();
		req.signal?.addEventListener('abort', fechar, { once: true });
		return new Response(stream.readable, { status: 200, headers: cabecalhos({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }) });
	}
}
