import { useState, useMemo, useEffect } from 'react'
import './App.css'
import { getVeiculosReais, getResumoSemanaReais } from './dadosReais'

const semana = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']

// "YYYY-MM-DD" em Brasília a partir de uma data UTC
function dataBrasiliaISO(d = new Date()) {
  const ms = d.getTime() + (-3) * 3600_000
  const dt = new Date(ms)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Lista de datas pra dropdown: hoje + 6 dias anteriores
function opcoesData() {
  const opts = [{ valor: '', label: 'Hoje (tempo real)' }]
  const hoje = new Date()
  for (let i = 1; i <= 6; i++) {
    const d = new Date(hoje.getTime() - i * 24 * 3600_000)
    const iso = dataBrasiliaISO(d)
    const label = i === 1 ? 'Ontem'
                : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
    opts.push({ valor: iso, label: `${label} · ${iso}` })
  }
  return opts
}

function formataDiesel(val) {
  const nums = String(Math.round(val * 100)).padStart(3,'0')
  const inteiro = nums.slice(0,-2).replace(/^0+/,'') || '0'
  return `${inteiro},${nums.slice(-2)}`
}

function formataConsumo(val) {
  const nums = String(Math.round(val * 10)).padStart(2,'0')
  const inteiro = nums.slice(0,-1).replace(/^0+/,'') || '0'
  return `${inteiro},${nums.slice(-1)}`
}

function calcPerda(min, config) {
  const horas = min / 60
  return Math.round(horas * config.consumoParado * config.precoDiesel * 100) / 100
}

function iniciaisDe(nome) {
  return nome.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export default function App() {
  const [tela, setTela] = useState('painel')
  const [frotaFiltro, setFrotaFiltro] = useState('Todas')
  const [selecionado, setSelecionado] = useState(null)
  const [selecionadoAlerta, setSelecionadoAlerta] = useState(null)
  const [mostrarMenuAvatar, setMostrarMenuAvatar] = useState(false)
  const [config, setConfig] = useState({
    consumoParado: 3.5,
    precoDiesel: 6.50,
    minMarcha: 5,
    nomeEmpresa: 'Minha Transportadora'
  })
  const [configTemp, setConfigTemp] = useState(config)
  const [salvo, setSalvo] = useState(false)
  const [agora, setAgora] = useState(() => new Date())
  const [veiculos, setVeiculos] = useState([])
  const [resumoSemana, setResumoSemana] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null)
  const [dataConsulta, setDataConsulta] = useState('')

  // Atualiza data/hora a cada minuto
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Carregamento de dados — polling 30s só pra "hoje"; dia passado carrega 1x
  useEffect(() => {
    let mounted = true
    setCarregando(true)
    setVeiculos([])
    async function carregar() {
      try {
        const veis = await getVeiculosReais(dataConsulta || undefined)
        if (!mounted) return
        setVeiculos(veis.map(v => ({ ...v, carreta: v.carreta || '—' })))
        setUltimaAtualizacao(new Date())
        setErro(null)
      } catch (e) {
        if (!mounted) return
        setErro(e.message || 'Falha ao carregar dados')
      } finally {
        if (mounted) setCarregando(false)
      }
    }
    carregar()
    if (!dataConsulta) {
      const id = setInterval(carregar, 30_000)
      return () => { mounted = false; clearInterval(id) }
    }
    return () => { mounted = false }
  }, [dataConsulta])

  // Resumo semanal — recalcula quando o filtro, data ou último update mudam
  useEffect(() => {
    if (carregando) return
    let mounted = true
    getResumoSemanaReais(frotaFiltro, dataConsulta || undefined)
      .then(r => { if (mounted) setResumoSemana(r) })
      .catch(() => {})
    return () => { mounted = false }
  }, [frotaFiltro, ultimaAtualizacao, carregando, dataConsulta])

  const visiveis = veiculos.filter(v => frotaFiltro === 'Todas' || v.frota === frotaFiltro)

  // === Plano de Ação — sagrado, mantém intacto ===
  const planoAcao = useMemo(() => {
    const calcScore = (v) =>
      Math.max(0, Math.min(100, Math.round(
        95 - (v.paradoMin || 0) * 0.55 - (v.excessoVelMin || 0) * 0.9 - (v.kmDesvio || 0) * 0.4
      )))

    const dorPrincipal = (v) => {
      const dorML = (v.paradoMin || 0) * 0.55
      const dorVel = (v.excessoVelMin || 0) * 0.9
      const dorDesvio = (v.kmDesvio || 0) * 0.4
      if (dorVel >= dorML && dorVel >= dorDesvio && dorVel > 5) return 'velocidade'
      if (dorDesvio >= dorML && dorDesvio > 4) return 'desvio'
      return 'marchaLenta'
    }

    const dimensoesComProblema = (v) => {
      const lista = []
      if (v.paradoMin > 18) lista.push(`marcha lenta (${v.parado})`)
      if (v.excessoVelMin > 0) lista.push(`${v.excessoVelMin}min acima de ${v.limiteVel} km/h (pico ${v.velMax} km/h)`)
      if (v.kmDesvio > 4) lista.push(`${v.kmDesvio} km fora da rota`)
      return lista
    }

    const sugestao = (v) => {
      const primNome = v.motorista.split(' ')[0]
      const dor = dorPrincipal(v)
      const dims = dimensoesComProblema(v)
      const dimsTxt = dims.length > 0
        ? dims.length === 1 ? dims[0] : `${dims.slice(0, -1).join(', ')} e ${dims[dims.length - 1]}`
        : ''

      if (v.score >= 80) {
        return {
          nivel: 'ok',
          dor,
          oQue: `Excelente desempenho esta semana. ${v.parado === '0 min' ? 'Sem marcha lenta registrada' : `Marcha lenta baixa (${v.parado})`}, ${v.excessoVelMin === 0 ? 'sem excesso de velocidade' : `pico de ${v.velMax} km/h`}, ${v.kmDesvio === 0 ? 'rotas seguidas à risca' : `${v.kmDesvio} km de desvio (dentro do aceitável)`}.`,
          acao: `Manter o padrão. ${primNome} é referência de boa condução — vale reconhecer.`,
          exemplo: `Ex: "${primNome}, parabéns pelos números dessa semana. Você tá entre os melhores da frota. Continua assim!"`,
        }
      }

      if (dor === 'marchaLenta') {
        if (v.score < 40) {
          return {
            nivel: 'critico', dor,
            oQue: `Marcha lenta de ${v.parado} hoje. Perda projetada: R$ ${(v.perdaSemana * 4).toLocaleString('pt-BR')}/mês.${dims.length > 1 ? ` Também aparece: ${dims.filter(d => !d.includes('marcha lenta')).join(' e ')}.` : ''}`,
            acao: `Conversar HOJE com ${primNome} sobre desligar o motor em esperas e descargas. Reduzir 50% recupera cerca de R$ ${Math.round(v.perdaSemana * 2).toLocaleString('pt-BR')} no mês.`,
            exemplo: `Ex: "${primNome}, vi que ontem o motor ficou ligado ${v.parado} parado. Cada hora dessas custa cerca de R$ ${Math.round(3.5 * 6.5).toLocaleString('pt-BR')} de diesel. Combinamos de desligar sempre que parar mais de 5min?"`,
          }
        }
        if (v.score < 60) {
          return {
            nivel: 'atencao', dor,
            oQue: `Tempo parado com motor ligado: ${v.parado}. Acima da média da frota.${dims.length > 1 ? ` Também: ${dims.filter(d => !d.includes('marcha lenta')).join(', ')}.` : ''}`,
            acao: `Acompanhar ${primNome} ao longo da semana. Alinhar boas práticas em paradas e dar feedback positivo se melhorar.`,
            exemplo: `Ex: "${primNome}, percebi que essa semana subiu um pouco o tempo parado com motor ligado. Tá tudo ok? Algum problema operacional ou cliente demorando?"`,
          }
        }
        return {
          nivel: 'observar', dor,
          oQue: `Aumento leve de marcha lenta (${v.parado}). Ainda dentro do aceitável, mas vale observar.`,
          acao: `Reforçar com ${primNome} a importância de desligar em paradas longas. Não exige conversa formal — pode ser no rádio.`,
          exemplo: `Ex: "${primNome}, beleza? Só um lembrete pra desligar o motor sempre que parar mais de 5min, tá? Tá indo bem, é só pra manter."`,
        }
      }

      if (dor === 'velocidade') {
        if (v.score < 40) {
          return {
            nivel: 'critico', dor,
            oQue: `${v.excessoVelMin}min acima de ${v.limiteVel} km/h hoje, com pico de ${v.velMax} km/h. Risco de multa, acidente e desgaste de pneu/freio.${v.paradoMin > 18 ? ` Também: marcha lenta de ${v.parado}.` : ''}`,
            acao: `Conversar HOJE com ${primNome}. Velocidade alta é o item de maior risco — multa por excesso (>20%) custa R$ 880 e suspende a CNH. Não pode esperar.`,
            exemplo: `Ex: "${primNome}, o sistema mostrou que você passou de ${v.limiteVel} km/h por ${v.excessoVelMin}min ontem, com pico de ${v.velMax}. Isso vira multa pesada e desgasta pneu/freio. Bora segurar a mão? Vou acompanhar essa semana."`,
          }
        }
        if (v.score < 60) {
          return {
            nivel: 'atencao', dor,
            oQue: `Pico de ${v.velMax} km/h e ${v.excessoVelMin}min acima do limite. Acima da média da frota.${v.paradoMin > 18 ? ` Também: ${v.parado} de marcha lenta.` : ''}`,
            acao: `Alinhar com ${primNome} sobre limite de velocidade. Se ele rodou em rodovia (90 km/h é o teto), explicar que mesmo 5–10 km/h acima já entra em desgaste de freio e multa.`,
            exemplo: `Ex: "${primNome}, vi que o pico foi ${v.velMax} km/h essa semana. Tá apertado de prazo? Vamos rever a rota juntos. Acima de ${v.limiteVel} é multa e desgaste."`,
          }
        }
        return {
          nivel: 'observar', dor,
          oQue: `Pico de ${v.velMax} km/h, ${v.excessoVelMin}min acima do limite. Pequeno excesso pontual.`,
          acao: `Comentar com ${primNome} no rádio que o pico chamou atenção. Não é pra cobrar, só pra manter o radar ligado.`,
          exemplo: `Ex: "${primNome}, suave aí, pico de ${v.velMax} km/h hoje. Só pra ficar atento, ${v.limiteVel} é o teto."`,
        }
      }

      if (v.score < 40) {
        return {
          nivel: 'critico', dor,
          oQue: `${v.kmDesvio} km fora da rota planejada hoje. Combustível extra, possível parada não autorizada ou risco de carga.${v.paradoMin > 18 ? ` Também: marcha lenta de ${v.parado}.` : ''}`,
          acao: `Conversar HOJE com ${primNome} sobre o desvio. Pedir explicação. Se for parada pessoal, alinhar política de uso. Se for problema na rota, atualizar planejamento.`,
          exemplo: `Ex: "${primNome}, o sistema apontou ${v.kmDesvio} km fora da rota planejada ontem. Aconteceu algum imprevisto? Preciso entender pra evitar combustível extra e risco com a carga."`,
        }
      }
      if (v.score < 60) {
        return {
          nivel: 'atencao', dor,
          oQue: `${v.kmDesvio} km de desvio da rota planejada. Acima da média.${v.paradoMin > 18 ? ` Também: ${v.parado} parado com motor ligado.` : ''}`,
          acao: `Conferir com ${primNome} qual foi o motivo do desvio. Pode ser parada legítima (banheiro, abastecer) ou um problema. Vale entender pra ajustar planejamento.`,
          exemplo: `Ex: "${primNome}, vi que rolou ${v.kmDesvio} km fora da rota. Foi alguma necessidade? Se for sempre o mesmo trecho, podemos atualizar o trajeto base."`,
        }
      }
      return {
        nivel: 'observar', dor,
        oQue: `${v.kmDesvio} km fora da rota. Pequeno desvio, talvez parada pra abastecer ou contornar trânsito.`,
        acao: `Não precisa intervir. Só registrar o padrão pra acompanhar se vira tendência.`,
        exemplo: `Ex: nenhum contato necessário — desvio dentro do esperado.`,
      }
    }

    const comScore = visiveis.map(v => {
      const score = calcScore(v)
      const base = { ...v, score, iniciais: iniciaisDe(v.motorista) }
      const sug = sugestao(base)
      return { ...base, ...sug }
    })

    const piorPrimeiro = [...comScore].sort((a, b) => a.score - b.score)
    const melhorPrimeiro = [...comScore].sort((a, b) => b.score - a.score)

    const dentroMeta = comScore.filter(v => v.score >= 80).length
    const scoreMedio = comScore.length === 0
      ? 0
      : Math.round(comScore.reduce((s, v) => s + v.score, 0) / comScore.length)
    const economiaSemana = Math.round(
      comScore.filter(v => v.status === 'verde').reduce((s, v) => s + v.perdaSemana * 0.4, 0)
    )

    const porPlaca = {}
    comScore.forEach(c => { porPlaca[c.placa] = c })

    return {
      prioridades: piorPrimeiro.filter(v => v.score < 80).slice(0, 3),
      ranking: melhorPrimeiro,
      porPlaca,
      dentroMeta,
      scoreMedio,
      economiaSemana,
      total: comScore.length,
    }
  }, [visiveis])

  const frotas = ['Todas', ...new Set(veiculos.map(v => v.frota))]
  const v = selecionado !== null ? veiculos[selecionado] : null

  const salvarConfig = () => {
    setConfig({
      ...configTemp,
      precoDiesel: typeof configTemp.precoDiesel === 'number' ? configTemp.precoDiesel : parseInt(String(configTemp.precoDiesel).replace(/\D/g,'')) / 100,
      consumoParado: typeof configTemp.consumoParado === 'number' ? configTemp.consumoParado : parseInt(String(configTemp.consumoParado).replace(/\D/g,'')) / 10,
    })
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }

  // Saudação dinâmica
  const saudacao = (() => {
    const h = agora.getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  })()

  const dataFormatada = agora.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).replace(/^./, c => c.toUpperCase())

  return (
    <div className="app">
      {(() => {
        let bg = '#E8F7EE', bd = '#00C896', cor = '#0E5F46', txt = ''
        if (erro) {
          bg = '#FDECEC'; bd = '#D14343'; cor = '#7A1F1F'
          txt = `ERRO AO CARREGAR DADOS — ${erro}`
        } else if (carregando) {
          bg = '#EEE'; bd = '#999'; cor = '#444'
          txt = 'CONECTANDO AO SERVIDOR...'
        } else if (dataConsulta) {
          bg = '#EAF2FA'; bd = '#5B7FA8'; cor = '#1F3A5C'
          txt = `HISTÓRICO · DIA ${dataConsulta} · ${veiculos.length} VEÍCULOS · DADOS FECHADOS`
        } else if (ultimaAtualizacao) {
          const seg = Math.round((agora - ultimaAtualizacao) / 1000)
          const quando = seg < 60 ? `há ${seg}s` : `há ${Math.round(seg / 60)} min`
          txt = `DADOS REAIS · ÚLTIMA ATUALIZAÇÃO ${quando} · ${veiculos.length} VEÍCULOS`
        } else {
          txt = 'DADOS REAIS'
        }
        return (
          <div style={{
            background: bg,
            borderBottom: `1px solid ${bd}`,
            color: cor,
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 600,
            textAlign: 'center',
            letterSpacing: '0.3px',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          }}>
            {txt}
          </div>
        )
      })()}

      {/* TOP BAR */}
      <div className="topo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <div className="logo">VEBRA<span>X</span></div>
          <nav className="nav">
            <button className={`nav-btn ${tela === 'painel' ? 'ativo' : ''}`} onClick={() => setTela('painel')}>
              Painel
            </button>
            <button className={`nav-btn ${tela === 'veiculos' ? 'ativo' : ''}`} onClick={() => setTela('veiculos')}>
              Veículos
            </button>
            <button className={`nav-btn ${tela === 'alertas' ? 'ativo' : ''}`} onClick={() => setTela('alertas')}>
              Alertas
            </button>
            <button className={`nav-btn ${tela === 'relatorio' ? 'ativo' : ''}`} onClick={() => setTela('relatorio')}>
              Relatórios
            </button>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ position: 'relative' }}>
            <button
              className="avatar"
              onClick={() => setMostrarMenuAvatar(!mostrarMenuAvatar)}
              title="Menu"
            >
              JM
            </button>
            {mostrarMenuAvatar && (
              <div className="menu-avatar">
                <button
                  onClick={() => {
                    setTela('config')
                    setMostrarMenuAvatar(false)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    background: 'transparent',
                    textAlign: 'left',
                    fontSize: 13,
                    color: '#0F1419',
                    cursor: 'pointer',
                    borderRadius: 4,
                  }}
                >
                  Configurações
                </button>
                <button
                  onClick={() => alert('Sair')}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    background: 'transparent',
                    textAlign: 'left',
                    fontSize: 13,
                    color: '#0F1419',
                    cursor: 'pointer',
                    borderRadius: 4,
                    marginTop: 4,
                  }}
                >
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FILTROS — visíveis em Painel/Veículos/Relatórios */}
      {(tela === 'painel' || tela === 'veiculos' || tela === 'relatorio') && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 24px 18px',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: '#666', fontWeight: 500 }}>
            Dia:
          </span>
          <select
            value={dataConsulta}
            onChange={(e) => setDataConsulta(e.target.value)}
            style={{
              padding: '8px 32px 8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: dataConsulta ? '#1F3A5C' : '#0F1419',
              background: dataConsulta ? '#EAF2FA' : '#fff',
              border: `1px solid ${dataConsulta ? '#5B7FA8' : '#ddd'}`,
              borderRadius: 8,
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              minWidth: 220,
            }}
          >
            {opcoesData().map(o => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </select>

          <span style={{ fontSize: 13, color: '#666', fontWeight: 500 }}>
            Frota:
          </span>
          <select
            value={frotaFiltro}
            onChange={(e) => setFrotaFiltro(e.target.value)}
            style={{
              padding: '8px 32px 8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: '#0F1419',
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 8,
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              minWidth: 200,
            }}
          >
            {frotas.map(f => (
              <option key={f} value={f}>
                {f === 'Todas' ? 'Todos os veículos' : f}
              </option>
            ))}
          </select>
          {frotaFiltro !== 'Todas' && (
            <button
              onClick={() => setFrotaFiltro('Todas')}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                color: '#666',
                background: 'transparent',
                border: '1px solid #ddd',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Limpar filtro
            </button>
          )}
          <span style={{ fontSize: 12, color: '#999', marginLeft: 'auto' }}>
            {visiveis.length} {visiveis.length === 1 ? 'veículo' : 'veículos'}
          </span>
        </div>
      )}

      {/* TELA PAINEL */}
      {tela === 'painel' && (
        <div style={{ padding: '0 24px 24px' }}>
          {/* Saudação */}
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, color: '#0F1419', margin: '0 0 4px' }}>
              {saudacao}, João
            </h1>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
              {dataFormatada} · {visiveis.length} veículos ativos
            </p>
          </div>

          {/* Grid de 4 KPIs */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">Economia no mês</div>
              <div className="valor verde">
                R$ {(resumoSemana?.perdaSemana ? Math.round(resumoSemana.perdaSemana * 4.3) : 0).toLocaleString('pt-BR')}
              </div>
              <div className="sub">projeção (semana × 4,3)</div>
            </div>

            <div className="kpi-card">
              <div className="label">Marcha lenta</div>
              <div className="valor">
                {(() => {
                  const totMin = visiveis.reduce((s, v) => s + (v.paradoMin || 0), 0)
                  const h = Math.floor(totMin / 60)
                  const m = totMin % 60
                  return m > 0 ? `${h}h ${m}min` : `${h}h`
                })()}
              </div>
              <div className="sub">
                {(() => {
                  const totMin = visiveis.reduce((s, v) => s + (v.paradoMin || 0), 0)
                  const metaMin = visiveis.length * (config.minMarcha || 60)
                  const diff = totMin - metaMin
                  if (diff > 0) {
                    const dh = Math.floor(diff / 60)
                    const dm = diff % 60
                    return `▲ ${dh > 0 ? dh + 'h' : ''}${dm > 0 ? ' ' + dm + 'min' : ''} acima da meta`.trim()
                  }
                  return '✓ dentro da meta'
                })()}
              </div>
            </div>

            <div className="kpi-card">
              <div className="label">Economia potencial</div>
              <div className="valor verde">
                R$ {(() => {
                  const ruins = visiveis.filter(v => {
                    const score = planoAcao.porPlaca[v.placa]?.score || 95
                    return score < 70
                  })
                  return Math.round(ruins.reduce((s, v) => s + (v.perdaHoje || 0), 0) * 22).toLocaleString('pt-BR')
                })()}
              </div>
              <div className="sub">se eliminar desperdício atual</div>
            </div>

            <div className="kpi-card">
              <div className="label">Alertas</div>
              <div className="valor">
                {(() => {
                  const count = visiveis.filter(v => {
                    const score = planoAcao.porPlaca[v.placa]?.score || 95
                    return v.alertaTipo || score < 60
                  }).length
                  return count
                })()}
              </div>
              <div className="sub">
                {(() => {
                  const criticos = visiveis.filter(v => {
                    const score = planoAcao.porPlaca[v.placa]?.score || 95
                    return score < 40 || v.alertaTipo === 'critico'
                  }).length
                  return `${criticos} críticos pendentes`
                })()}
              </div>
            </div>
          </div>

          {/* Card Agente VEBRAX */}
          {planoAcao.prioridades[0] && (() => {
            const p = planoAcao.prioridades[0]
            return (
              <div className="agente-card">
                <div className="tag">AGENTE VEBRAX · {(() => {
                  if (!ultimaAtualizacao) return 'EM ANÁLISE'
                  const diffMin = Math.max(0, Math.round((agora - ultimaAtualizacao) / 60000))
                  return diffMin === 0 ? 'AGORA HÁ POUCO' : `HÁ ${diffMin} MIN`
                })()}</div>
                <h3 style={{ fontSize: 14, color: '#0F1419', margin: '8px 0 6px', fontWeight: 500 }}>
                  {p.placa} acumulou {p.parado} de marcha lenta hoje
                </h3>
                <div className="desc">
                  {p.oQue} Custo estimado: <strong>R$ {calcPerda(p.paradoMin, config).toFixed(0)}</strong>.
                </div>
                <div className="acoes">
                  <button
                    className="btn-primario"
                    onClick={() => {
                      const idx = visiveis.findIndex(x => x.placa === p.placa)
                      if (idx >= 0) {
                        setSelecionadoAlerta(idx)
                        setTela('alertas')
                      }
                    }}
                  >
                    Ver investigação
                  </button>
                  <button className="btn-secundario">
                    Marcar como justificado
                  </button>
                </div>
              </div>
            )
          })()}

          {planoAcao.prioridades.length === 0 && (
            <div className="agente-card">
              <div className="tag">AGENTE VEBRAX · MONITORAMENTO ATIVO</div>
              <h3 style={{ fontSize: 14, color: '#0F1419', margin: '8px 0 6px', fontWeight: 500 }}>
                ✓ Nenhuma anomalia detectada hoje
              </h3>
              <div className="desc">
                Frota toda operando dentro dos parâmetros de eficiência. Continue acompanhando os indicadores.
              </div>
            </div>
          )}

          {/* Tabela Frota */}
          <div className="tabela-frota-card">
            <div className="head">
              <h3>Frota — desempenho de hoje</h3>
              <button style={{
                fontSize: 12,
                color: '#00C896',
                fontWeight: 500,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}>
                Filtrar ▾
              </button>
            </div>
            <table className="tabela-frota">
              <thead>
                <tr>
                  <th>PLACA</th>
                  <th>STATUS</th>
                  <th>KM HOJE</th>
                  <th>MARCHA LENTA</th>
                  <th>ECONOMIA</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.slice(0, 5).map((ve, idx) => {
                  const score = planoAcao.porPlaca[ve.placa]?.score || 95
                  const statusPill = ve.ignicao && score >= 70 ? 'EM ROTA' : score < 60 ? 'ATENÇÃO' : 'PARADO'
                  const corPill = statusPill === 'EM ROTA' ? '#00C896' : statusPill === 'ATENÇÃO' ? '#C03A3A' : '#6B7280'
                  return (
                    <tr key={ve.placa} className={score < 60 ? 'atencao' : ''}>
                      <td>{ve.placa}</td>
                      <td>
                        <span className={`pill ${statusPill.toLowerCase().replace(' ', '-')}`}>
                          {statusPill}
                        </span>
                      </td>
                      <td className="num">{ve.km}</td>
                      <td className={(ve.paradoMin || 0) > 120 ? 'vermelho' : ''}>{ve.parado}</td>
                      <td className={score >= 70 ? 'verde' : 'vermelho'}>
                        {score >= 70 ? '+' : '−'} R$ {calcPerda(ve.paradoMin, config).toFixed(0)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="ver-todos" onClick={() => setTela('veiculos')}>
              Ver os 16 veículos →
            </div>
          </div>

          {/* Ranking de motoristas */}
          <div className="ranking-card">
            <h3>Ranking de motoristas — quem mais custa nesse mês</h3>
            <div className="subt">Top 5 com maior perda projetada — soma de marcha lenta + excessos + km fora de rota</div>
            {planoAcao.ranking.slice(0, 5).map((p, i) => (
              <div key={p.placa} className="ranking-row">
                <div className="ranking-pos">{i + 1}</div>
                <div className="ranking-avatar">{p.iniciais}</div>
                <div className="ranking-nome">{p.motorista}</div>
                <div className="ranking-placa">{p.placa}</div>
                <div className="ranking-tempo">{p.parado}</div>
                <div className="ranking-custo">R$ {Math.round(p.perdaHoje * 22)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TELA VEÍCULOS */}
      {tela === 'veiculos' && (
        <div style={{ padding: '0 24px 24px' }}>
          {selecionado === null ? (
            <>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F1419', margin: 0 }}>
                  Veículos
                </h2>
              </div>
              <div className="frota-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                {visiveis.map((ve, idx) => {
                  const score = planoAcao.porPlaca[ve.placa]?.score || 95
                  const corScore = score >= 80 ? '#00C896' : score >= 60 ? '#E8B923' : '#D85A30'
                  return (
                    <div
                      key={ve.placa}
                      className={`card-veiculo ${ve.status}`}
                      onClick={() => setSelecionado(visiveis.indexOf(ve))}
                      style={{ position: 'relative', cursor: 'pointer' }}
                    >
                      <div style={{
                        position: 'absolute', top: 10, right: 12,
                        fontSize: 16, fontWeight: 700, color: corScore,
                      }}>
                        {score}<span style={{fontSize: 9, color: '#999', fontWeight: 400, marginLeft: 2}}>/100</span>
                      </div>
                      <div className="cv-placa">{ve.placa}</div>
                      <div className="cv-motorista">{ve.motorista}</div>
                      <div className="cv-carreta">Carreta: {ve.carreta}</div>
                      <div className="cv-status">
                        <span className={`dot ${ve.status}`}></span>
                        <span className="cv-status-txt">{ve.statusTxt}</span>
                      </div>
                      <div className={`ignicao ${ve.ignicao ? 'on' : 'off'}`}>
                        {ve.ignicao ? '● ligada' : '○ desligada'}
                      </div>
                      {ve.paradoMin > 0 && (
                        <div style={{
                          fontSize: 11, color: '#888', marginTop: 6,
                          paddingTop: 6, borderTop: '1px solid #eee',
                        }}>
                          Parado: <strong>{ve.parado}</strong> · Perda: <strong style={{color: '#D85A30'}}>R$ {calcPerda(ve.paradoMin, config).toFixed(0)}</strong>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <button
                className="detalhe-volta"
                onClick={() => setSelecionado(null)}
              >
                ← Veículos
              </button>
              <div className="detalhe-titulo">
                <h2>{v?.placa}</h2>
                <span className={`pill ${v?.status?.toLowerCase()}`}>
                  {v?.statusTxt}
                </span>
              </div>
              <div className="detalhe-sub">
                {v?.modelo} · Motorista: {v?.motorista} · {v?.rota || 'BR-277 km 142'}
              </div>

              {/* 4 KPI Cards */}
              <div className="kpi-grid">
                <div className="kpi-card">
                  <div className="label">Km hoje</div>
                  <div className="valor">
                    {v?.km || '— km'}
                  </div>
                  <div className="sub">Pico {v?.velMax || '—'} km/h</div>
                </div>

                <div className="kpi-card">
                  <div className="label">Marcha lenta</div>
                  <div className="valor">{v?.parado}</div>
                  <div className="sub">{(v?.paradoMin || 0) > (config.minMarcha || 60) ? '▲ acima da meta' : '✓ dentro da meta'}</div>
                </div>

                <div className="kpi-card">
                  <div className="label">Perda projetada</div>
                  <div className="valor vermelho">
                    R$ {Math.round(calcPerda(v?.paradoMin || 0, config) * 22).toLocaleString('pt-BR')}
                  </div>
                  <div className="sub">marcha lenta × 22 dias úteis</div>
                </div>

                <div className="kpi-card">
                  <div className="label">Score operacional</div>
                  <div className="valor">
                    {planoAcao.porPlaca[v?.placa]?.score || 95}/100
                  </div>
                  <div className="sub">
                    {(planoAcao.porPlaca[v?.placa]?.score || 95) > planoAcao.scoreMedio ? 'acima da frota' : 'abaixo da frota'}
                  </div>
                </div>
              </div>

              {/* Gráfico de economia */}
              <div className="grafico-card">
                <div className="head">
                  <h3>Economia diária — últimos 14 dias</h3>
                  <span className="total">total acumulado: R$ {Math.round(calcPerda(v?.paradoMin || 0, config) * 14)}</span>
                </div>
                <svg viewBox="0 0 600 140" style={{ width: '100%', height: 140 }}>
                  {(() => {
                    // Seed determinístico baseado em placa + dia
                    const seed = (v?.placa || 'XX').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
                    const baseScore = planoAcao.porPlaca[v?.placa]?.score || 95
                    return [...Array(14)].map((_, i) => {
                      // pseudo-aleatório determinístico
                      const r = Math.sin(seed * 9301 + (i + 1) * 49297) * 0.5 + 0.5
                      const variance = (r - 0.5) * 30
                      const isWeekend = (i % 7 === 5 || i % 7 === 6)
                      const height = isWeekend ? 0 : Math.max(8, (baseScore / 100) * 90 + variance)
                      const x = 30 + i * 40
                      const y = 120 - height
                      return (
                        <rect
                          key={i}
                          x={x}
                          y={y}
                          width={30}
                          height={height}
                          fill={isWeekend ? '#ECEEF1' : '#00C896'}
                          rx={2}
                        />
                      )
                    })
                  })()}
                </svg>
              </div>

              {/* Eventos recentes */}
              <div className="eventos-card">
                <h3>Eventos recentes</h3>
                {v?.diario?.map((ev, i) => (
                  <div key={i} className="evento-item">
                    <div className="evento-info">
                      <div className="evento-dot" style={{ background: ev.cor }}></div>
                      <div>
                        <div className="evento-titulo">{ev.ev}</div>
                        <div className="evento-sub">{ev.h} · {ev.det}</div>
                      </div>
                    </div>
                    {ev.custo && <div className="evento-valor">R$ {ev.custo}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* TELA ALERTAS */}
      {tela === 'alertas' && (
        <div style={{ padding: '0 24px 24px' }}>
          {selecionadoAlerta === null ? (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F1419', margin: '0 0 4px' }}>
                Alertas abertos
              </h2>
              <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 20px' }}>
                {(() => {
                  const count = visiveis.filter(v => v.alertaTipo || (planoAcao.porPlaca[v.placa]?.score || 95) < 60).length
                  return `${count} investigações ativas`
                })()}
              </p>

              <div className="tabela-frota-card">
                <table className="tabela-frota">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>VEÍCULO</th>
                      <th>DESCRIÇÃO</th>
                      <th>SEVERIDADE</th>
                      <th>ABERTO HÁ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.filter(v => v.alertaTipo || (planoAcao.porPlaca[v.placa]?.score || 95) < 60).map((ve, idx) => {
                      const score = planoAcao.porPlaca[ve.placa]?.score || 95
                      const sevPill = score < 40 ? 'vermelho' : score < 60 ? 'amarelo' : 'verde'
                      return (
                        <tr
                          key={ve.placa}
                          onClick={() => setSelecionadoAlerta(visiveis.indexOf(ve))}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>INV-{2100 + idx}</td>
                          <td>{ve.placa}</td>
                          <td>{ve.alertaDesc || 'Marcha lenta atípica'}</td>
                          <td>
                            <span className={`pill ${sevPill}`}>
                              {sevPill.toUpperCase()}
                            </span>
                          </td>
                          <td>há 2 horas</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <button
                className="detalhe-volta"
                onClick={() => setSelecionadoAlerta(null)}
              >
                ← Alertas / Investigação #INV-{2100 + selecionadoAlerta}
              </button>
              {(() => {
                const idx = selecionadoAlerta
                const ve = visiveis[idx]
                if (!ve) return null
                const score = planoAcao.porPlaca[ve.placa]?.score || 95

                return (
                  <>
                    <div className="detalhe-titulo">
                      <h2>{ve.placa} — {ve.alertaTitulo || 'marcha lenta atípica'}</h2>
                    </div>
                    <div className="detalhe-sub">
                      Detectado pelo Agente VEBRAX · {dataFormatada.split(',')[0]} · {agora.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}
                    </div>

                    {/* 3 KPI Cards */}
                    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                      <div className="kpi-card">
                        <div className="label">Marcha lenta hoje</div>
                        <div className="valor vermelho">{ve.parado}</div>
                        <div className="sub">média: 1h 42min</div>
                      </div>

                      <div className="kpi-card">
                        <div className="label">Diesel queimado</div>
                        <div className="valor">
                          {Math.round((ve.paradoMin / 60) * config.consumoParado)} L
                        </div>
                        <div className="sub">parado, motor ligado</div>
                      </div>

                      <div className="kpi-card">
                        <div className="label">Custo estimado</div>
                        <div className="valor vermelho">
                          R$ {calcPerda(ve.paradoMin, config).toFixed(0)}
                        </div>
                        <div className="sub">a R$ {config.precoDiesel}/L</div>
                      </div>
                    </div>

                    {/* Hipótese do agente */}
                    <div style={{
                      background: '#fff',
                      borderRadius: 8,
                      padding: 18,
                      marginBottom: 18,
                      border: '1px solid #ECEEF1'
                    }}>
                      <h3 style={{ fontSize: 13, fontWeight: 500, color: '#0F1419', margin: '0 0 12px' }}>
                        Hipótese do agente
                      </h3>
                      <p style={{ fontSize: 12, lineHeight: 1.6, color: '#4A5159', margin: '0 0 12px' }}>
                        Veículo permaneceu por <strong>{Math.round(ve.paradoMin / 60)}h</strong> em coordenada fora da rota planejada ({ve.rota || 'BR-277 km 142'}). Motor permaneceu ligado durante <strong>82% do período</strong>.
                      </p>
                      <div style={{
                        background: '#F1F2F4',
                        borderRadius: 6,
                        padding: 12,
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: '#4A5159'
                      }}>
                        <strong style={{ color: '#0F1419' }}>Recomendação:</strong> verificar com motorista ({iniciaisDe(ve.motorista)}) se houve orientação para manter motor ligado. Custo recuperável <strong>R$ {calcPerda(ve.paradoMin, config).toFixed(0)}/incidente</strong> · projeção mensal <strong>R$ {Math.round(calcPerda(ve.paradoMin, config) * 6)}</strong> se padrão se repetir.
                      </div>
                    </div>

                    {/* Timeline */}
                    <div style={{
                      background: '#fff',
                      borderRadius: 8,
                      padding: 18,
                      marginBottom: 18,
                      border: '1px solid #ECEEF1'
                    }}>
                      <h3 style={{ fontSize: 13, fontWeight: 500, color: '#0F1419', margin: '0 0 14px' }}>
                        Linha do tempo · {dataFormatada.split(',')[0]}
                      </h3>
                      {ve.diario?.map((ev, i) => (
                        <div key={i} className="timeline-row">
                          <div className="timeline-hora">{ev.h}</div>
                          <div className="timeline-dot" style={{ background: ev.cor }}></div>
                          <div style={{ fontSize: 12, color: '#0F1419' }}>{ev.ev}</div>
                        </div>
                      ))}
                    </div>

                    {/* Botões */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn-primario">Notificar motorista</button>
                      <button className="btn-secundario">Marcar como justificado</button>
                      <button className="btn-secundario">Exportar relatório</button>
                    </div>
                  </>
                )
              })()}
            </>
          )}
        </div>
      )}

      {/* TELA RELATÓRIOS */}
      {tela === 'relatorio' && (
        <div style={{ padding: '0 24px 24px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F1419', margin: '0 0 20px' }}>
            Relatórios
          </h2>

          {/* 4 KPIs agregados */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">Total de viagens</div>
              <div className="valor">{resumoSemana?.totalViagens || '—'}</div>
              <div className="sub">{dataConsulta ? 'hoje' : 'esta semana'}</div>
            </div>

            <div className="kpi-card">
              <div className="label">KM total rodado</div>
              <div className="valor">
                {resumoSemana ? `${resumoSemana.kmTotalSemana.toLocaleString('pt-BR')} km` : '—'}
              </div>
              <div className="sub">{dataConsulta ? 'hoje' : 'esta semana'}</div>
            </div>

            <div className="kpi-card">
              <div className="label">{dataConsulta ? 'Perda no dia' : 'Perda total semana'}</div>
              <div className="valor vermelho">
                R$ {resumoSemana ? resumoSemana.perdaSemana.toLocaleString('pt-BR') : '0'}
              </div>
              <div className="sub">em marcha lenta</div>
            </div>

            <div className="kpi-card">
              <div className="label">Média por veículo</div>
              <div className="valor vermelho">
                R$ {resumoSemana ? resumoSemana.mediaPorVeiculo.toLocaleString('pt-BR') : '0'}
              </div>
              <div className="sub">{dataConsulta ? 'por dia' : 'por semana'}</div>
            </div>
          </div>

          {/* Gráfico semana */}
          {!dataConsulta && (
            <div className="grafico-card">
              <h3>Desempenho por dia — esta semana</h3>
              <svg viewBox="0 0 600 140" style={{ width: '100%', height: 140 }}>
                {(resumoSemana?.dias || semana.map(d => ({dia: d, valor: 0}))).map((d, i) => {
                  const max = resumoSemana ? Math.max(...resumoSemana.dias.map(x => x.valor), 1) : 1
                  const height = resumoSemana ? Math.max(10, Math.round((d.valor / max) * 100)) : 10
                  const isHoje = i === ((new Date().getDay() + 6) % 7)
                  const x = 40 + i * 75
                  return (
                    <g key={d.dia}>
                      <rect
                        x={x}
                        y={120 - height}
                        width={50}
                        height={height}
                        fill={d.valor === 0 ? '#f0f0f0' : (isHoje ? '#00C896' : '#D85A30')}
                        rx={2}
                      />
                      <text x={x + 25} y={135} fontSize="12" fill="#6B7280" textAnchor="middle">
                        {d.dia}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          )}

          {/* Tabela por veículo */}
          <div className="tabela-frota-card" style={{ marginTop: 24 }}>
            <div className="head">
              <h3>Relatório por veículo — {dataConsulta ? 'hoje' : 'semana'}</h3>
            </div>
            <table className="tabela-frota">
              <thead>
                <tr>
                  <th>PLACA</th>
                  <th>MOTORISTA</th>
                  <th>KM</th>
                  <th>PARADO</th>
                  <th>PERDA</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(ve => (
                  <tr key={ve.placa}>
                    <td className="td-placa">{ve.placa}</td>
                    <td>{ve.motorista}</td>
                    <td>{ve.km}</td>
                    <td>{ve.parado}</td>
                    <td className="td-perda">R$ {calcPerda(ve.paradoMin, config).toFixed(2)}</td>
                    <td>
                      <span className={`pill ${ve.status?.toLowerCase()}`}>
                        {ve.statusTxt}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TELA CONFIGURAÇÕES */}
      {tela === 'config' && (
        <div style={{ padding: '0 24px 24px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0F1419', margin: '0 0 20px' }}>
            Configurações da operação
          </h2>

          <div className="dois-col">
            <div className="card-box">
              <h3 style={{ fontSize: 13, fontWeight: 500, color: '#0F1419', margin: '0 0 16px' }}>
                Parâmetros de cálculo
              </h3>
              <div className="config-item">
                <label className="config-label">Nome da empresa</label>
                <input className="config-input" value={configTemp.nomeEmpresa} onChange={e => setConfigTemp({...configTemp, nomeEmpresa: e.target.value})} />
              </div>
              <div className="config-item">
                <label className="config-label">Preço do diesel (R$/litro)</label>
                <input className="config-input" value={formataDiesel(configTemp.precoDiesel)} onChange={e => { const nums = e.target.value.replace(/\D/g,''); setConfigTemp({...configTemp, precoDiesel: parseInt(nums||'0') / 100}) }} />
                <div className="config-hint">Atualize sempre que o preço mudar no seu posto</div>
              </div>
              <div className="config-item">
                <label className="config-label">Consumo médio parado (litros/hora)</label>
                <input className="config-input" value={formataConsumo(configTemp.consumoParado)} onChange={e => { const nums = e.target.value.replace(/\D/g,''); setConfigTemp({...configTemp, consumoParado: parseInt(nums||'0') / 10}) }} />
                <div className="config-hint">Média para caminhão pesado: 3,0 a 4,0 L/h</div>
              </div>
              <div className="config-item">
                <label className="config-label">Tempo mínimo para marcha lenta (minutos)</label>
                <input className="config-input" type="number" value={configTemp.minMarcha} onChange={e => setConfigTemp({...configTemp, minMarcha: parseInt(e.target.value)})} />
                <div className="config-hint">Paradas abaixo desse tempo são ignoradas</div>
              </div>
              <button className="btn-salvar" onClick={salvarConfig}>
                {salvo ? '✓ Salvo!' : 'Salvar configurações'}
              </button>
            </div>

            <div className="card-box">
              <h3 style={{ fontSize: 13, fontWeight: 500, color: '#0F1419', margin: '0 0 12px' }}>
                Prévia do cálculo
              </h3>
              <div className="previa-desc">Com as configurações atuais, veja quanto custa cada período de marcha lenta:</div>
              {[15, 30, 60, 120, 180].map(min => (
                <div key={min} className="previa-linha">
                  <span className="previa-label">{min < 60 ? `${min} minutos` : `${min/60}h parado`}</span>
                  <span className="previa-valor">R$ {(min/60 * config.consumoParado * config.precoDiesel).toFixed(2)}</span>
                </div>
              ))}
              <div className="previa-formula">
                <div className="formula-titulo">Fórmula usada</div>
                <div className="formula-txt">horas × {config.consumoParado}L/h × R$ {config.precoDiesel.toFixed(2)}/L</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
