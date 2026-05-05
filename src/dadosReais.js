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

// Resumo agregado.
// - Se `data` foi passada (dia específico) OU se o usuário filtrou por um veículo específico,
//   retorna o resumo DAQUELE DIA (modoDia: true) com totais reais — sem extrapolação semanal.
// - Caso contrário (hoje + frota inteira), retorna o placeholder "semana" baseado no dia atual.
//   Quando historico_dia tiver pelo menos 7 dias, esse ramo vira consulta real à semana.
export async function getResumoSemanaReais(frotaFiltro = 'Todas', data) {
  const dados = await buscarDados(data)

  const veiculosFiltrados = frotaFiltro === 'Todas'
    ? dados.frota
    : dados.frota.filter(v => v.frota === frotaFiltro || v.placa === frotaFiltro)

  // === MODO DIA: usuário filtrou por dia específico OU por veículo específico ===
  // Mostra apenas os números reais daquele dia (sem extrapolar pra semana).
  const filtroPorDia = !!data
  const filtroPorVeiculo = frotaFiltro !== 'Todas'

  if (filtroPorDia || filtroPorVeiculo) {
    const perdaDia = veiculosFiltrados.reduce((s, v) => s + (v.perdaHoje || 0), 0)
    const kmTotalDia = veiculosFiltrados.reduce((s, v) => {
      const km = parseInt(String(v.km).replace(/\D/g, '')) || 0
      return s + km
    }, 0)
    const totalViagens = veiculosFiltrados.reduce(
      (s, v) => s + (Array.isArray(v.viagens) ? v.viagens.length : 0),
      0
    )

    return {
      modoDia: true,
      data: data || null,
      perdaSemana: Math.round(perdaDia),       // mantém o nome p/ retrocompat na UI
      perdaDia: Math.round(perdaDia),
      kmTotalSemana: kmTotalDia,               // mantém o nome p/ retrocompat na UI
      kmTotalDia,
      totalViagens,
      mediaPorVeiculo: veiculosFiltrados.length
        ? Math.round(perdaDia / veiculosFiltrados.length)
        : 0,
      // Sem barras semanais nesse modo — UI vai esconder o gráfico
      dias: [],
      veiculos: veiculosFiltrados,
    }
  }

  // === MODO SEMANA (fallback enquanto não há histórico de 7 dias) ===
  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
  const perdaHoje = dados.resumo.perdaTotalHoje
  const dias = labels.map((dia, i) => {
    const peso = i === 6 ? 0 : i === 5 ? 0.4 : 1.0
    return { dia, valor: Math.round(perdaHoje * peso) }
  })

  return {
    modoDia: false,
    dias,
    perdaSemana: dias.reduce((s, d) => s + d.valor, 0),
    mediaPorVeiculo: veiculosFiltrados.length ? Math.round(perdaHoje / veiculosFiltrados.length) : 0,
    kmTotalSemana: veiculosFiltrados.reduce((s, v) => {
      const km = parseInt(String(v.km).replace(/\D/g, '')) || 0
      return s + km * 5
    }, 0),
    totalViagens: Math.round(veiculosFiltrados.length * 5 * 2.5),
    veiculos: veiculosFiltrados,
  }
}

// Limpa o cache (útil quando o usuário aperta "atualizar agora")
export function limparCacheReal() {
  _cache.clear()
}
