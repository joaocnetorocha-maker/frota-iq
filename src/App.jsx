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

export default function App() {
  const [tela, setTela] = useState('painel')
  const [frotaFiltro, setFrotaFiltro] = useState('Todas')
  const [selecionado, setSelecionado] = useState(0)
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
  // dataConsulta: '' = hoje (tempo real, polling 30s), 'YYYY-MM-DD' = histórico estático
  const [dataConsulta, setDataConsulta] = useState('')

  // Atualiza data/hora a cada minuto (independente do polling de dados)
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

  // === Plano de Ação ===
  // Score 0–100 por motorista derivado do tempo em marcha lenta.
  // Quanto mais minutos parados com motor ligado, menor o score.
  const planoAcao = useMemo(() => {
    // Score composto: pondera marcha lenta + excesso de velocidade + desvio de rota.
    // MESMA fórmula do dadosBeta.js — manter sincronizado!
    const calcScore = (v) =>
      Math.max(0, Math.min(100, Math.round(
        95 - (v.paradoMin || 0) * 0.55 - (v.excessoVelMin || 0) * 0.9 - (v.kmDesvio || 0) * 0.4
      )))

    const iniciaisDe = (nome) =>
      nome.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase()

    // Identifica qual é a dor predominante do motorista (a que mais derrubou o score).
    // Retorna 'marchaLenta' | 'velocidade' | 'desvio'.
    const dorPrincipal = (v) => {
      const dorML = (v.paradoMin || 0) * 0.55
      const dorVel = (v.excessoVelMin || 0) * 0.9
      const dorDesvio = (v.kmDesvio || 0) * 0.4
      if (dorVel >= dorML && dorVel >= dorDesvio && dorVel > 5) return 'velocidade'
      if (dorDesvio >= dorML && dorDesvio > 4) return 'desvio'
      return 'marchaLenta'
    }

    // Retorna lista resumida das dimensões com problema, pra mostrar no "oQue"
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

      // VERDE — score 80+
      if (v.score >= 80) {
        return {
          nivel: 'ok',
          dor,
          oQue: `Excelente desempenho esta semana. ${v.parado === '0 min' ? 'Sem marcha lenta registrada' : `Marcha lenta baixa (${v.parado})`}, ${v.excessoVelMin === 0 ? 'sem excesso de velocidade' : `pico de ${v.velMax} km/h`}, ${v.kmDesvio === 0 ? 'rotas seguidas à risca' : `${v.kmDesvio} km de desvio (dentro do aceitável)`}.`,
          acao: `Manter o padrão. ${primNome} é referência de boa condução — vale reconhecer.`,
          exemplo: `Ex: "${primNome}, parabéns pelos números dessa semana. Você tá entre os melhores da frota. Continua assim!"`,
        }
      }

      // === MARCHA LENTA é a dor principal ===
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

      // === VELOCIDADE é a dor principal ===
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

      // === DESVIO DE ROTA é a dor principal ===
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

    // Lookup por placa pra buscar o plano de ação de qualquer veículo selecionado
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
  const v = veiculos[selecionado]
  const perdaTotal = visiveis.reduce((s, v) => s + v.perdaHoje, 0)
  const alertas = visiveis.filter(v => v.status !== 'verde').length
  const criticos = visiveis.filter(v => v.status === 'vermelho').length
  const amarelos = visiveis.filter(v => v.status === 'amarelo').length
  const ranking = [...visiveis].sort((a, b) => b.perdaSemana - a.perdaSemana).slice(0, 5)
  const maxPerda = ranking[0]?.perdaSemana || 1
  const projecaoMensal = Math.round(perdaTotal * 30)
  const economiaPotencial = Math.round(projecaoMensal * 0.6)

  const calcPerda = (min) => {
    const horas = min / 60
    return Math.round(horas * config.consumoParado * config.precoDiesel * 100) / 100
  }

  const salvarConfig = () => {
    setConfig({
      ...configTemp,
      precoDiesel: typeof configTemp.precoDiesel === 'number' ? configTemp.precoDiesel : parseInt(String(configTemp.precoDiesel).replace(/\D/g,'')) / 100,
consumoParado: typeof configTemp.consumoParado === 'number' ? configTemp.consumoParado : parseInt(String(configTemp.consumoParado).replace(/\D/g,'')) / 10,
    })
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }

  const formataDiesel = (val) => {
    const nums = String(Math.round(val * 100)).padStart(3,'0')
    const inteiro = nums.slice(0,-2).replace(/^0+/,'') || '0'
    return `${inteiro},${nums.slice(-2)}`
  }

  const formataConsumo = (val) => {
    const nums = String(Math.round(val * 10)).padStart(2,'0')
    const inteiro = nums.slice(0,-1).replace(/^0+/,'') || '0'
    return `${inteiro},${nums.slice(-1)}`
  }

  const frotas = ['Todas', ...new Set(veiculos.map(v => v.frota))]

  const dataHoraTxt = agora.toLocaleString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).replace(',', ' —')

  return (
    <div className="app">
      {(() => {
        // Banner de status da conexão com /api/dados
        let bg = '#E8F7EE', bd = '#1D9E75', cor = '#0E5F46', txt = ''
        if (erro) {
          bg = '#FDECEC'; bd = '#D14343'; cor = '#7A1F1F'
          txt = `ERRO AO CARREGAR DADOS — ${erro}`
        } else if (carregando) {
          bg = '#EEE'; bd = '#999'; cor = '#444'
          txt = 'CONECTANDO AO SERVIDOR...'
        } else if (dataConsulta) {
          // Modo histórico — fundo azul-acinzentado pra diferenciar
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
      <div className="topo">
        <div className="logo">frota<span>IQ</span></div>
        <nav className="nav">
          <button className={`nav-btn ${tela === 'painel' ? 'ativo' : ''}`} onClick={() => setTela('painel')}>Painel</button>
          <button className={`nav-btn ${tela === 'relatorio' ? 'ativo' : ''}`} onClick={() => setTela('relatorio')}>Relatório</button>
          <button className={`nav-btn ${tela === 'config' ? 'ativo' : ''}`} onClick={() => setTela('config')}>Configurações</button>
        </nav>
        <div className="data-hora">{dataHoraTxt}</div>
      </div>

      {(tela === 'painel' || tela === 'relatorio') && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 0 18px',
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
              color: dataConsulta ? '#1F3A5C' : '#1a1a1a',
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
            Filtrar por veículo:
          </span>
          <select
            value={frotaFiltro}
            onChange={(e) => setFrotaFiltro(e.target.value)}
            style={{
              padding: '8px 32px 8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: '#1a1a1a',
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
            {tela === 'relatorio' ? 'Relatório de' : 'Mostrando'} {visiveis.length} {visiveis.length === 1 ? 'veículo' : 'veículos'}
          </span>
        </div>
      )}

      {tela === 'painel' && (
        <>
          {/* 3 KPIs principais — o que importa pro gestor saber em 5 segundos */}
          <div className="resumo-grid" style={{gridTemplateColumns:'repeat(3, 1fr)', marginBottom:'1.25rem'}}>
            <div className="metrica">
              <div className="metrica-label">Perda estimada hoje</div>
              <div className="metrica-valor alerta">R$ {perdaTotal.toLocaleString('pt-BR')}</div>
              <div className="metrica-sub">projeção mês: R$ {projecaoMensal.toLocaleString('pt-BR')}</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">Em rota agora</div>
              <div className="metrica-valor">{visiveis.filter(v => v.ignicao).length}<span style={{fontSize:18, color:'#888', fontWeight:400}}> / {visiveis.length}</span></div>
              <div className="metrica-sub">{alertas} {alertas === 1 ? 'alerta' : 'alertas'} ativo{alertas !== 1 ? 's' : ''}</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">Score médio da frota</div>
              <div className="metrica-valor" style={{color: planoAcao.scoreMedio >= 80 ? '#1D9E75' : planoAcao.scoreMedio >= 60 ? '#E8B923' : '#D85A30'}}>{planoAcao.scoreMedio}</div>
              <div className="metrica-sub">{planoAcao.dentroMeta} de {planoAcao.total} na meta</div>
            </div>
          </div>

          {/* Prioridade da semana — só aparece se tem alguém pra acompanhar */}
          {planoAcao.prioridades[0] && (() => {
            const p = planoAcao.prioridades[0]
            const corBadge = p.score < 40 ? '#D85A30' : p.score < 60 ? '#E8B923' : '#1D9E75'
            return (
              <div className="card-box" style={{
                border: `2px solid ${corBadge}`,
                marginBottom: '1.25rem',
                padding: '18px 22px',
              }}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, flexWrap:'wrap'}}>
                  <span style={{
                    background: corBadge + '22',
                    color: corBadge,
                    fontSize: 11,
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>Prioridade da semana</span>
                  <span style={{fontSize:13, color:'#666'}}>Maior oportunidade de economia</span>
                </div>

                <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:14}}>
                  <div style={{
                    width: 46, height: 46, borderRadius: '50%',
                    background: corBadge + '22',
                    color: corBadge,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 600, fontSize: 15,
                    flexShrink: 0,
                  }}>{p.iniciais}</div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:16, fontWeight:600}}>{p.motorista}</div>
                    <div style={{fontSize:12, color:'#666', marginTop:2}}>
                      Placa {p.placa}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:28, fontWeight:600, lineHeight:1, color:corBadge}}>{p.score}</div>
                    <div style={{fontSize:10, color:'#888', marginTop:2}}>de 100</div>
                  </div>
                </div>

                <div style={{fontSize:13, lineHeight:1.55, color:'#444', marginBottom:14}}>
                  <strong style={{color:'#1a1a1a'}}>Ação sugerida:</strong> {p.acao}
                </div>

                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                  <button
                    onClick={() => alert(`Conversa com ${p.motorista} marcada como feita!`)}
                    style={{
                      flex:'1 1 180px', padding:'10px 14px', fontSize:13, fontWeight:500,
                      background:'#1a1a1a', color:'#fff', border:'none', borderRadius:8,
                      cursor:'pointer',
                    }}
                  >
                    Marcar como conversado
                  </button>
                  <button
                    onClick={() => {
                      const msg = `Olá ${p.motorista.split(' ')[0]}, notei que essa semana o tempo de marcha lenta tá acima da média. Bora alinhar amanhã? Em horários de espera e descarga, sempre desligar o motor reduz nosso custo de combustível bastante. Valeu!`
                      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                    }}
                    style={{
                      flex:'1 1 180px', padding:'10px 14px', fontSize:13, fontWeight:500,
                      background:'#fff', color:'#1a1a1a', border:'1px solid #ddd', borderRadius:8,
                      cursor:'pointer',
                    }}
                  >
                    Mandar WhatsApp
                  </button>
                </div>
              </div>
            )
          })()}

          {planoAcao.prioridades.length === 0 && planoAcao.total > 0 && (
            <div className="card-box" style={{marginBottom:'1.25rem', borderLeft:'4px solid #1D9E75', padding:'14px 18px'}}>
              <div style={{fontSize:14, fontWeight:600, color:'#0F6E56'}}>
                Frota toda dentro da meta nesta semana.
              </div>
              <div style={{fontSize:12, color:'#666', marginTop:4}}>
                Nenhum motorista exige conversa imediata. Continue acompanhando os indicadores.
              </div>
            </div>
          )}

          {/* Status da frota — cards de veículos, ordenados por score (pior primeiro) */}
          <div className="secao-titulo">Status da frota</div>
          <div className="legenda">
            <span className="leg-item"><span className="dot verde"></span>Normal</span>
            <span className="leg-item"><span className="dot amarelo"></span>Atenção</span>
            <span className="leg-item"><span className="dot vermelho"></span>Crítico</span>
          </div>
          <div className="frota-grid">
            {[...visiveis].sort((a, b) => {
              const sa = planoAcao.ranking.find(r => r.placa === a.placa)?.score ?? 95
              const sb = planoAcao.ranking.find(r => r.placa === b.placa)?.score ?? 95
              return sa - sb
            }).map((ve) => {
              const idx = veiculos.indexOf(ve)
              const score = planoAcao.ranking.find(r => r.placa === ve.placa)?.score ?? 95
              const corScore = score >= 80 ? '#1D9E75' : score >= 60 ? '#E8B923' : '#D85A30'
              return (
                <div
                  key={ve.placa}
                  className={`card-veiculo ${ve.status} ${idx === selecionado ? 'selecionado' : ''}`}
                  onClick={() => setSelecionado(idx)}
                  style={{position: 'relative'}}
                >
                  {/* Score no canto superior direito */}
                  <div style={{
                    position: 'absolute', top: 10, right: 12,
                    fontSize: 16, fontWeight: 700, color: corScore,
                    lineHeight: 1,
                  }}>
                    {score}
                    <span style={{fontSize: 9, color: '#999', fontWeight: 400, marginLeft: 2}}>/100</span>
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
                      Parado: <strong style={{color: '#1a1a1a'}}>{ve.parado}</strong> · Perda hoje: <strong style={{color: '#D85A30'}}>R$ {calcPerda(ve.paradoMin).toFixed(0)}</strong>
                    </div>
                  )}
                  {((ve.excessoVelMin || 0) > 0 || (ve.kmDesvio || 0) > 4) && (
                    <div style={{
                      fontSize: 11, color: '#888', marginTop: 4,
                    }}>
                      {(ve.excessoVelMin || 0) > 0 && (
                        <span>Pico <strong style={{color: '#D85A30'}}>{ve.velMax} km/h</strong></span>
                      )}
                      {(ve.excessoVelMin || 0) > 0 && (ve.kmDesvio || 0) > 4 && ' · '}
                      {(ve.kmDesvio || 0) > 4 && (
                        <span><strong style={{color: '#D85A30'}}>{ve.kmDesvio} km</strong> fora da rota</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Detalhe do veículo selecionado — só aparece se há um veículo selecionado e ele está no filtro */}
          {visiveis.includes(v) && (
            <>
              <div className="detalhe-painel">
                <div className="det-topo">
                  <div><div className="det-titulo">{v.placa}</div><div className="det-sub">Motorista: {v.motorista}</div></div>
                  <span className={`badge ${v.status}`}>{v.statusTxt}</span>
                </div>
                <div className="det-grid">
                  <div className="det-item"><div className="det-label">Velocidade atual</div><div className="det-valor">{v.vel}</div></div>
                  <div className="det-item"><div className="det-label">Ignição</div><div className={`det-valor ${v.ignicao ? 'alerta' : ''}`}>{v.ignicao ? 'Ligada' : 'Desligada'}</div></div>
                  <div className="det-item"><div className="det-label">Tempo parado ligado</div><div className="det-valor alerta">{v.parado}</div></div>
                  <div className="det-item"><div className="det-label">Perda estimada</div><div className="det-valor alerta">R$ {calcPerda(v.paradoMin).toFixed(2)}</div></div>
                  <div className="det-item">
                    <div className="det-label">Pico do dia</div>
                    <div className={`det-valor ${(v.velMax || 0) > (v.limiteVel || 90) ? 'alerta' : ''}`}>
                      {v.velMax || 0} km/h
                    </div>
                  </div>
                  <div className="det-item">
                    <div className="det-label">Excesso de velocidade</div>
                    <div className={`det-valor ${(v.excessoVelMin || 0) > 0 ? 'alerta' : ''}`}>
                      {v.excessoVelMin > 0 ? `${v.excessoVelMin} min acima de ${v.limiteVel} km/h` : 'sem excesso'}
                    </div>
                  </div>
                  <div className="det-item">
                    <div className="det-label">Desvio da rota</div>
                    <div className={`det-valor ${(v.kmDesvio || 0) > 8 ? 'alerta' : ''}`}>
                      {v.kmDesvio > 0 ? `${v.kmDesvio} km fora` : 'rota seguida'}
                    </div>
                  </div>
                </div>
                {v.alertaTipo && (
                  <div className={`alerta-box ${v.alertaTipo}`}>
                    <div className="alerta-icone">⚠</div>
                    <div><div className="alerta-titulo">{v.alertaTitulo}</div><div className="alerta-desc">{v.alertaDesc}</div></div>
                  </div>
                )}

                {/* Plano de ação específico desse motorista — sempre aparece, com tom variando pelo score */}
                {planoAcao.porPlaca[v.placa] && (() => {
                  const p = planoAcao.porPlaca[v.placa]
                  const cor = p.score >= 80 ? '#1D9E75' : p.score >= 60 ? '#E8B923' : p.score >= 40 ? '#E89923' : '#D85A30'
                  const fundo = p.score >= 80 ? '#F0F8F4' : p.score >= 60 ? '#FFFAEB' : p.score >= 40 ? '#FFF4E5' : '#FDEBE3'
                  const titulo = p.nivel === 'critico' ? 'Ação imediata necessária'
                              : p.nivel === 'atencao' ? 'Atenção — acompanhar'
                              : p.nivel === 'observar' ? 'Observação — leve aumento'
                              : 'Reconhecimento — bom desempenho'
                  return (
                    <div style={{
                      background: fundo,
                      borderLeft: `4px solid ${cor}`,
                      borderRadius: 6,
                      padding: '14px 18px',
                      marginTop: 14,
                    }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        marginBottom: 10, flexWrap: 'wrap', gap: 8,
                      }}>
                        <div style={{fontSize: 13, fontWeight: 700, color: cor, textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                          Plano de ação · {titulo}
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                          <span style={{fontSize: 11, color: '#888'}}>Score</span>
                          <span style={{fontSize: 18, fontWeight: 700, color: cor}}>{p.score}</span>
                          <span style={{fontSize: 10, color: '#999'}}>/100</span>
                        </div>
                      </div>

                      <div style={{marginBottom: 10}}>
                        <div style={{fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4}}>
                          O que aconteceu
                        </div>
                        <div style={{fontSize: 13, lineHeight: 1.5, color: '#1a1a1a'}}>{p.oQue}</div>
                      </div>

                      <div style={{marginBottom: 10}}>
                        <div style={{fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4}}>
                          Ação sugerida
                        </div>
                        <div style={{fontSize: 13, lineHeight: 1.5, color: '#1a1a1a'}}>{p.acao}</div>
                      </div>

                      <div style={{
                        background: '#fff',
                        borderRadius: 6,
                        padding: '10px 12px',
                        marginBottom: 12,
                        borderLeft: `2px solid ${cor}`,
                      }}>
                        <div style={{fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4}}>
                          Exemplo de conversa
                        </div>
                        <div style={{fontSize: 12, lineHeight: 1.55, color: '#444', fontStyle: 'italic'}}>
                          {p.exemplo}
                        </div>
                      </div>

                      {p.nivel !== 'ok' ? (
                        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                          <button
                            onClick={() => alert(`Conversa com ${v.motorista} marcada como feita!`)}
                            style={{
                              flex: '1 1 160px', padding: '9px 12px', fontSize: 12, fontWeight: 500,
                              background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            Marcar como conversado
                          </button>
                          <button
                            onClick={() => {
                              const primNome = v.motorista.split(' ')[0]
                              const msg = p.nivel === 'critico'
                                ? `Olá ${primNome}, precisamos conversar sobre o consumo essa semana. Vi que o motor ficou ligado ${v.parado} parado. Bora alinhar amanhã pra reduzir? Cada hora de marcha lenta custa caro. Valeu!`
                                : p.nivel === 'atencao'
                                  ? `Olá ${primNome}, notei um aumento no tempo de marcha lenta essa semana (${v.parado}). Tá tudo ok aí? Algum problema operacional? Bora alinhar pra voltar pro padrão. Valeu!`
                                  : `Oi ${primNome}, só um lembrete rápido: tenta desligar o motor sempre que parar mais de 5min, beleza? Tá indo bem, é só pra manter o consumo baixo. Valeu!`
                              window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                            }}
                            style={{
                              flex: '1 1 160px', padding: '9px 12px', fontSize: 12, fontWeight: 500,
                              background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            Mandar WhatsApp
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            const primNome = v.motorista.split(' ')[0]
                            const msg = `Oi ${primNome}, parabéns pela semana! Você tá entre os melhores da frota em consumo. Continua assim, tá fazendo a diferença. Valeu!`
                            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                          }}
                          style={{
                            width: '100%', padding: '9px 12px', fontSize: 12, fontWeight: 500,
                            background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          Mandar elogio no WhatsApp
                        </button>
                      )}
                    </div>
                  )
                })()}

                <div className="mapa-placeholder">Mapa da rota · {v.rota}</div>
              </div>

              {v.viagens && v.viagens.length > 0 && (
                <>
                  <div className="secao-titulo" style={{marginBottom:'10px'}}>
                    Viagens do dia — {v.viagens.length}{' '}
                    {v.viagens.length === 1 ? 'viagem' : 'viagens'}
                    {' · '}
                    {v.viagens.reduce((s, vg) => s + (vg.distanciaKm || 0), 0)} km
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24}}>
                    {v.viagens.map((vg, i) => {
                      const fmtDur = (m) => {
                        const h = Math.floor(m / 60), mm = m % 60
                        return h > 0 ? `${h}h ${mm}min` : `${mm} min`
                      }
                      const limpa = vg.excessos.length === 0 && vg.freadas === 0 && vg.aceleracoes === 0
                      const corBorda = limpa ? '#1D9E75' : vg.excessos.length > 0 ? '#E55B3C' : '#D9A21B'
                      return (
                        <div key={i} style={{
                          padding: '14px 16px',
                          background: '#fff',
                          border: `1px solid ${corBorda}33`,
                          borderLeft: `4px solid ${corBorda}`,
                          borderRadius: 8,
                        }}>
                          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6}}>
                            <div style={{fontSize: 14, fontWeight: 600, color: '#222'}}>
                              Viagem {i + 1} · {vg.inicio.hora} → {vg.fim.hora}
                            </div>
                            {vg.emAndamento && (
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: '3px 8px',
                                background: '#1D9E7522', color: '#1D9E75', borderRadius: 12,
                              }}>EM ANDAMENTO</span>
                            )}
                          </div>
                          <div style={{fontSize: 13, color: '#333', marginBottom: 4}}>
                            {vg.inicio.local} → {vg.fim.local}
                          </div>
                          <div style={{fontSize: 12, color: '#666', marginBottom: 8}}>
                            {vg.distanciaKm} km · {fmtDur(vg.duracaoMin)} ·
                            {' '}vel. média {vg.velMedia} km/h · pico {vg.velMax} km/h
                          </div>
                          <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12}}>
                            {vg.excessos.length > 0 && (
                              <span style={{color: '#E55B3C'}}>
                                ⚠ {vg.excessos.length} excesso{vg.excessos.length > 1 ? 's' : ''} (pico {Math.max(...vg.excessos.map(e => e.velPico))} km/h)
                              </span>
                            )}
                            {vg.paradas.length > 0 && (
                              <span style={{color: '#D9A21B'}}>
                                ⏸ {vg.paradas.length} parada{vg.paradas.length > 1 ? 's' : ''} ({vg.paradas.reduce((s, p) => s + p.duracaoMin, 0)} min)
                              </span>
                            )}
                            {vg.freadas > 0 && (
                              <span style={{color: '#E55B3C'}}>🔻 {vg.freadas} frenagem{vg.freadas > 1 ? 's' : ''}</span>
                            )}
                            {vg.aceleracoes > 0 && (
                              <span style={{color: '#E55B3C'}}>🔺 {vg.aceleracoes} aceleração{vg.aceleracoes > 1 ? 'ões' : ''}</span>
                            )}
                            {limpa && (
                              <span style={{color: '#1D9E75'}}>✓ Sem ocorrências</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {(() => {
                const totalImpacto = v.diario.reduce((s, d) => s + (Number(d.custo) || 0), 0)
                return (
                  <div className="secao-titulo" style={{marginBottom:'10px'}}>
                    Ocorrências do dia — {v.placa}
                    {totalImpacto > 0 && (
                      <span style={{marginLeft:8, fontSize:13, color:'#E55B3C', fontWeight:700}}>
                        · prejuízo R$ {totalImpacto.toFixed(2).replace('.',',')}
                      </span>
                    )}
                  </div>
                )
              })()}
              <div style={{display:'flex', flexDirection:'column', gap:10, marginBottom:24}}>
                {v.diario.map((d, i) => (
                  <div key={i} style={{
                    background:'#fff',
                    border:`1px solid ${d.cor}33`,
                    borderLeft:`4px solid ${d.cor}`,
                    borderRadius:8,
                    padding:'12px 14px',
                  }}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:14, fontWeight:600, color:'#222', marginBottom:2}}>
                          {d.ev}
                        </div>
                        {d.det && (
                          <div style={{fontSize:12, color:'#666'}}>{d.det}</div>
                        )}
                      </div>
                      {Number(d.custo) > 0 && (
                        <div style={{
                          fontSize:16, fontWeight:700, color:d.cor,
                          whiteSpace:'nowrap',
                        }}>
                          R$ {Number(d.custo).toFixed(2).replace('.',',')}
                        </div>
                      )}
                    </div>
                    {d.local && d.local !== '—' && (
                      <div style={{
                        marginTop:6, fontSize:12, color:'#888',
                        display:'flex', alignItems:'center', gap:4,
                      }}>
                        📍 {d.local}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tela === 'relatorio' && (
        <>
          <div className="secao-titulo" style={{marginBottom:'1rem'}}>Resumo semanal da frota</div>
          <div className="resumo-grid" style={{marginBottom:'1.5rem'}}>
            <div className="metrica">
              <div className="metrica-label">Total de viagens</div>
              <div className="metrica-valor">{resumoSemana ? resumoSemana.totalViagens : '—'}</div>
              <div className="metrica-sub">{resumoSemana ? 'esta semana' : 'aguardando ONIXSAT'}</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">KM total rodado</div>
              <div className="metrica-valor">{resumoSemana ? `${resumoSemana.kmTotalSemana.toLocaleString('pt-BR')} km` : '—'}</div>
              <div className="metrica-sub">{resumoSemana ? 'esta semana' : 'aguardando ONIXSAT'}</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">Perda total semana</div>
              <div className="metrica-valor alerta">R$ {resumoSemana ? resumoSemana.perdaSemana.toLocaleString('pt-BR') : '0'}</div>
              <div className="metrica-sub">em marcha lenta</div>
            </div>
            <div className="metrica">
              <div className="metrica-label">Média por veículo</div>
              <div className="metrica-valor alerta">R$ {resumoSemana ? resumoSemana.mediaPorVeiculo.toLocaleString('pt-BR') : '0'}</div>
              <div className="metrica-sub">por semana</div>
            </div>
          </div>

          <div className="card-box" style={{marginBottom:'1.5rem'}}>
            <div className="secao-titulo">Desempenho por dia — esta semana</div>
            <div className="grafico-semana">
              {(resumoSemana ? resumoSemana.dias : semana.map(d => ({dia: d, valor: 0}))).map((d, i) => {
                const max = resumoSemana ? Math.max(...resumoSemana.dias.map(x => x.valor), 1) : 1
                const altura = resumoSemana ? Math.max(4, Math.round((d.valor / max) * 100)) : 4
                const isHoje = i === ((new Date().getDay() + 6) % 7) // converte Dom=0 → Seg=0
                return (
                  <div key={d.dia} className="grafico-col">
                    <div className="grafico-barra-wrap" style={{height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center'}}>
                      <div
                        className="grafico-barra"
                        style={{
                          height: `${altura}px`,
                          width: '70%',
                          background: d.valor === 0 ? '#f0f0f0' : (isHoje ? '#1D9E75' : '#D85A30'),
                          borderRadius: '4px 4px 0 0',
                          transition: 'height .3s ease',
                        }}
                      ></div>
                    </div>
                    <div className="grafico-label" style={{fontWeight: isHoje ? 600 : 400}}>{d.dia}</div>
                    <div className="grafico-valor">R$ {d.valor.toLocaleString('pt-BR')}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card-box">
            <div className="secao-titulo">
              {frotaFiltro === 'Todas'
                ? 'Relatório por veículo — semana'
                : `Relatório do veículo — ${frotaFiltro}`}
            </div>
            {visiveis.length === 0 ? (
              <div className="vazio">Nenhum veículo corresponde ao filtro</div>
            ) : (
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cavalo</th>
                    <th>Carreta</th>
                    <th>Motorista</th>
                    <th>KM rodado</th>
                    <th>Tempo parado</th>
                    <th>Perda estimada</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map(ve => (
                    <tr key={ve.placa}>
                      <td className="td-placa">{ve.placa}</td>
                      <td>{ve.carreta}</td>
                      <td>{ve.motorista}</td>
                      <td>{ve.km}</td>
                      <td>{ve.parado}</td>
                      <td className="td-perda">R$ {calcPerda(ve.paradoMin).toFixed(2)}</td>
                      <td><span className={`badge ${ve.status}`}>{ve.statusTxt}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tela === 'config' && (
        <>
          <div className="secao-titulo" style={{marginBottom:'1rem'}}>Configurações da operação</div>
          <div className="dois-col">
            <div className="card-box">
              <div className="secao-titulo">Parâmetros de cálculo</div>
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
              <div className="secao-titulo">Prévia do cálculo</div>
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
        </>
      )}
    </div>
  )
}

