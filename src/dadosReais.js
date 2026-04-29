// =============================================================================
// dadosReais.js — Consome dados do FrotaIQ via /api/dados (Supabase)
// =============================================================================
// Suporta tanto o dia atual (modo tempo real) quanto dias passados (snapshot
// salvo na tabela historico_dia pelo job /api/fechar-dia que roda 23:55).
//
// Uso:
//   getVeiculosReais()              → hoje, em tempo real
//   getVeiculosReais('2026-04-28')  → snapshot do dia 28/abr
// =============================================================================

// Cache em memória, separado por data. Hoje tem TTL curto (vale 25s); dias
// passados são imutáveis então cacheamos por muito mais tempo.
const _cache = new Map()  // key: data ('hoje' ou 'YYYY-MM-DD')
const TTL_HOJE = 25 * 1000
const TTL_PASSADO = 10 * 60 * 1000

function chaveCache(data) {
  return data || 'hoje'
}

async function buscarDados(data) {
  const key = chaveCache(data)
  const ttl = data ? TTL_PASSADO : TTL_HOJE
  const cacheado = _cache.get(key)
  const agora = Date.now()
  if (cacheado && (agora - cacheado.em) < ttl) return cacheado.dados

  const url = data ? `/api/dados?data=${data}` : '/api/dados'
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`/api/dados retornou ${r.status}`)
  const dados = await r.json()
  if (!dados.ok) throw new Error(dados.erro || 'erro desconhecido')

  _cache.set(key, { dados, em: agora })
  return dados
}

// === API pública ==========================================================

export async function getVeiculosReais(data) {
  const d = await buscarDados(data)
  return d.frota
}

export async function getResumoReal(data) {
  const d = await buscarDados(data)
  return d.resumo
}

export async function getStatusColeta() {
  const d = await buscarDados()  // só faz sentido pra "hoje"
  return d.coleta
}

// Indica se a resposta veio do snapshot histórico (dia passado)
export async function isModoHistorico(data) {
  const d = await buscarDados(data)
  return d.modo === 'historico'
}

// Resumo da semana — placeholder enquanto não temos histórico de 7 dias.
// Quando historico_dia tiver pelo menos 7 dias, isso vai virar uma consulta real.
export async function getResumoSemanaReais(frotaFiltro = 'Todas', data) {
  const dados = await buscarDados(data)

  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
  const perdaHoje = dados.resumo.perdaTotalHoje

  const dias = labels.map((dia, i) => {
    const peso = i === 6 ? 0 : i === 5 ? 0.4 : 1.0
    return { dia, valor: Math.round(perdaHoje * peso) }
  })

  const veiculos = frotaFiltro === 'Todas'
    ? dados.frota
    : dados.frota.filter(v => v.frota === frotaFiltro)

  return {
    dias,
    perdaSemana: dias.reduce((s, d) => s + d.valor, 0),
    mediaPorVeiculo: veiculos.length ? Math.round(perdaHoje / veiculos.length) : 0,
    kmTotalSemana: veiculos.reduce((s, v) => {
      const km = parseInt(String(v.km).replace(/\D/g, '')) || 0
      return s + km * 5
    }, 0),
    totalViagens: Math.round(veiculos.length * 5 * 2.5),
    veiculos,
  }
}

// Limpa o cache (útil quando o usuário aperta "atualizar agora")
export function limparCacheReal() {
  _cache.clear()
}
