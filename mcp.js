import { ErroMcp, VERSAO, NOME_SERVIDOR, validar, cortarResultado, comoErroMcp, idAleatorio } from './nucleo.js';
import { FERRAMENTAS, MAPA_FERRAMENTAS, INSTRUCOES, VERSAO_CATALOGO } from './ferramentas.js';
import { renderizar, renderizarErro } from './formato.js';

export const PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const JSONRPC = '2.0';

export class ServidorMcp {
	constructor({ executor, config, log } = {}) {
		this.executor = executor;
		this.cfg = config;
		this.log = log || (() => {});
		this.sessoes = new Set();
	}


	async executarFerramenta(nome, argumentos) {
		const def = MAPA_FERRAMENTAS.get(nome);
		const args = argumentos && typeof argumentos === 'object' && !Array.isArray(argumentos) ? { ...argumentos } : argumentos;
		const formato = args?.format === 'json' ? 'json' : 'text';
		if (args && typeof args === 'object') delete args.format;
		const falha = (erro) => ({ ok: false, erro: erro.toJSON(), formato, texto: formato === 'json' ? JSON.stringify({ error: erro.toJSON() }) : renderizarErro(erro.toJSON()) });
		if (!def) return falha(new ErroMcp('UNKNOWN_TOOL', `ferramenta desconhecida: ${nome}`));
		const problema = validar(def.inputSchema, args ?? {});
		if (problema) return falha(new ErroMcp('VALIDATION', problema, { hint: `Veja os parametros em tools/list (${nome}).` }));
		const inicio = Date.now();
		try {
			const valor = await this.executor.executar(nome, args ?? {});
			const texto = formato === 'json' ? JSON.stringify(valor) : (renderizar(nome, valor, { fuso: this.cfg.FUSO }) ?? JSON.stringify(valor, null, 1));
			this.log('info', `${nome} ok em ${Date.now() - inicio}ms`);
			return { ok: true, valor, formato, texto: cortarResultado(texto, this.cfg.MAX_RESULTADO) };
		} catch (e) {
			const erro = comoErroMcp(e);
			this.log('warn', `${nome} ${erro.code} em ${Date.now() - inicio}ms: ${erro.message}`);
			return falha(erro);
		}
	}

	resultadoFerramenta(r) {
		const out = { content: [{ type: 'text', text: r.texto }] };
		if (!r.ok) out.isError = true;
		if (r.formato === 'json') out.structuredContent = r.ok ? { result: r.valor } : { error: r.erro };
		return out;
	}


	async tratar(mensagem, contexto = {}) {
		if (Array.isArray(mensagem)) {
			if (!mensagem.length) return { jsonrpc: JSONRPC, id: null, error: { code: -32600, message: 'lote vazio' } };
			const respostas = (await Promise.all(mensagem.map((m) => this.tratar(m, contexto)))).filter((r) => r !== null);
			return respostas.length ? respostas : null;
		}
		if (!mensagem || typeof mensagem !== 'object' || mensagem.jsonrpc !== JSONRPC || typeof mensagem.method !== 'string') {
			return { jsonrpc: JSONRPC, id: mensagem?.id ?? null, error: { code: -32600, message: 'requisicao JSON-RPC invalida' } };
		}
		const { id, method, params } = mensagem;
		const notificacao = id === undefined;
		const responder = (result) => (notificacao ? null : { jsonrpc: JSONRPC, id, result });
		const erro = (code, message, data) => (notificacao ? null : { jsonrpc: JSONRPC, id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
		try {
			switch (method) {
				case 'initialize': {
					const pedido = params?.protocolVersion;
					const versao = PROTOCOLOS.includes(pedido) ? pedido : PROTOCOLOS[0];
					const sessao = idAleatorio(16);
					this.sessoes.add(sessao);
					if (this.sessoes.size > 1000) this.sessoes.delete(this.sessoes.values().next().value);
					if (contexto.aoIniciar) contexto.aoIniciar(sessao);
					this.log('info', `initialize de ${params?.clientInfo?.name || 'cliente'} ${params?.clientInfo?.version || ''} (protocolo ${pedido || '?'} -> ${versao})`);
					return responder({ protocolVersion: versao, capabilities: { tools: { listChanged: false }, logging: {} }, serverInfo: { name: NOME_SERVIDOR, title: 'Discord (conta pessoal)', version: VERSAO, catalogo: VERSAO_CATALOGO }, instructions: INSTRUCOES });
				}
				case 'notifications/initialized': case 'notifications/cancelled': case 'notifications/roots/list_changed': return null;
				case 'ping': return responder({});
				case 'tools/list': return responder({ tools: FERRAMENTAS });
				case 'tools/call': {
					if (!params || typeof params.name !== 'string') return erro(-32602, 'params.name obrigatorio');
					if (params.arguments != null && (typeof params.arguments !== 'object' || Array.isArray(params.arguments))) return erro(-32602, 'params.arguments deve ser um objeto');
					if (!MAPA_FERRAMENTAS.has(params.name)) return erro(-32602, `ferramenta desconhecida: ${params.name}`, { ferramentas: [...MAPA_FERRAMENTAS.keys()] });
					const r = await this.executarFerramenta(params.name, params.arguments || {});
					return responder(this.resultadoFerramenta(r));
				}
				case 'resources/list': return responder({ resources: [] });
				case 'resources/templates/list': return responder({ resourceTemplates: [] });
				case 'prompts/list': return responder({ prompts: [] });
				case 'logging/setLevel': return responder({});
				default: return erro(-32601, `metodo nao suportado: ${method}`);
			}
		} catch (e) {
			this.log('error', `erro interno em ${method}: ${e?.message || e}`);
			return erro(-32603, 'erro interno', { message: String(e?.message || e) });
		}
	}


	async tratarTexto(texto, contexto) {
		let mensagem;
		try { mensagem = JSON.parse(texto); } catch { return { jsonrpc: JSONRPC, id: null, error: { code: -32700, message: 'JSON invalido' } }; }
		return this.tratar(mensagem, contexto);
	}
}
