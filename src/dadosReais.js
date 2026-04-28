// =============================================================================
// dadosReais.js — Consome dados reais do FrotaIQ via /api/dados (Supabase)
// =============================================================================
// Substitui o dadosBeta.js quando os dados reais estão disponíveis.
// Mantém a MESMA interface pública: getVeiculos(), getResumoSemana(),
// pra que App.jsx possa simplesmente trocar o import.
//
// Como ativa/desativa:
//   - Em produção: o App.jsx tenta /api/dados; se responder OK, usa real.
//   - Se /api/dados der erro, App.jsx pode cair no fallback do dadosBeta.
// =============================================================================

// Cache simples em memória (evita martelar /api/dados a cada render)
let _cache = { dados: null, em: 0 }
const CACHE_TTL = 25 * 1000  // 25s — frontend faz polling a cada 30s

async function buscarDados() {
  const agora = Date.now()
  if (_cache.dados && (agora - _cache.em) < CACHE_TTL) {
    return _cache.dados
  }

  const r = await fetch('/api/dados', { cache: 'no-store' })
  if (!r.ok) throw new Error(`/api/dados retornou ${r.status}`)
  const dados = await r.json()
  if (!dados.ok) throw new Error(dados.erro || 'erro desconhecido')

  _cache = { dados, em: agora }
  return dados
}

// === API pública (mesma forma que dadosBeta.js) ===========================

export async function getVeiculosReais() {
  const dados = await buscarDados()
  return dados.frota
}

export async function getResumoReal() {
  const dados = await buscarDados()
  return dados.resumo
}

export async function getStatusColeta() {
  const dados = await buscarDados()
  return dados.coleta
}

// Resumo da semana — TODO: implementar consulta histórica no Supabase
// Por enquanto, retorna placeholder vazio até termos pelo menos 7 dias de dados.
export async function getResumoSemanaReais(frotaFiltro = 'Todas') {
  const dados = await buscarDados()

  // Por enquanto repete o dia atual nos 5 dias úteis (placeholder)
  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
  const perdaHoje = dados.resumo.perdaTotalHoje

  const dias = labels.map((dia, i) => {
    // Dom = 0, Sáb = 0.4× normal — apenas estimativa enquanto não temos hist
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

// Indica se o modo "real" está ativo
// (usa quando /api/dados respondeu OK ao menos 1x)
export function isRealAtivo() {
  return _cache.dados !== null
}

// Limpa o cache (útil quando o usuário aperta "atualizar agora")
export function limparCacheReal() {
  _cache = { dados: null, em: 0 }
}
