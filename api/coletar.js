// =============================================================================
// /api/coletar.js — Coletor ONIXSAT (Vercel Serverless Function)
// =============================================================================
// Esse endpoint é chamado a cada 1-2 minutos por um cron externo (cron-job.org).
// Ele:
//   1. Lê o último mId que coletamos (do Supabase)
//   2. Faz POST na ONIXSAT pedindo mensagens novas (RequestMensagemCB)
//   3. Descompacta o ZIP da resposta
//   4. Faz parse do XML, extrai cada <MensagemCB>
//   5. Insere no Supabase (mensagens_cb)
//   6. Atualiza o último mId no estado
//
// Segurança: requer header `Authorization: Bearer <CRON_SECRET>` pra evitar
// que qualquer pessoa fique chamando o endpoint e estourando nossa quota.
//
// Env vars necessárias na Vercel:
//   ONIX_LOGIN, ONIX_SENHA              — credenciais do webservice
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  — acesso admin ao banco
//   CRON_SECRET                         — senha do gatilho
// =============================================================================

import https from 'https'
import AdmZip from 'adm-zip'
import { createClient } from '@supabase/supabase-js'

const ONIX_HOSTNAME = 'webservice.newrastreamentoonline.com.br'

// ---- helpers de parse XML simples ----------------------------------------
function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return m ? m[1].trim() : null
}
function getTagBool(xml, tag) {
  const v = getTag(xml, tag)
  return v === '1' || v === 'true'
}
function getTagInt(xml, tag) {
  const v = getTag(xml, tag)
  if (v === null || v === '') return null
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}
function getTagFloat(xml, tag) {
  const v = getTag(xml, tag)
  if (v === null || v === '') return null
  // ONIX usa vírgula nos decimais ("-23,5425")
  const n = parseFloat(v.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

// ---- chamada HTTP pra ONIXSAT --------------------------------------------
function chamarOnix(xmlBody) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ONIX_HOSTNAME,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(xmlBody)
      },
      timeout: 25000
    }
    const req = https.request(options, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(xmlBody)
    req.end()
  })
}

// ---- descompacta ZIP, retorna XML como string ----------------------------
function descompactar(buffer) {
  if (buffer.length < 4) return null
  const eZip = buffer[0] === 0x50 && buffer[1] === 0x4b
  if (!eZip) {
    // texto puro — provavelmente erro
    return buffer.toString('utf-8')
  }
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  if (entries.length === 0) return null
  return entries[0].getData().toString('utf-8')
}

// ---- handler -------------------------------------------------------------
export default async function handler(req, res) {
  // 1. Autenticação simples
  const auth = req.headers.authorization || ''
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ erro: 'unauthorized' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  try {
    // 2. Lê último mId
    const { data: estado, error: errEstado } = await supabase
      .from('coleta_estado')
      .select('*')
      .eq('id', 1)
      .single()

    if (errEstado) throw new Error('Erro ao ler coleta_estado: ' + errEstado.message)

    const mIdInicial = estado?.ultimo_mid_cb || 1

    // 3. Chama ONIXSAT
    const xmlBody = `<RequestMensagemCB><login>${process.env.ONIX_LOGIN}</login><senha>${process.env.ONIX_SENHA}</senha><mId>${mIdInicial}</mId></RequestMensagemCB>`
    const { status, buffer } = await chamarOnix(xmlBody)

    if (status !== 200) {
      throw new Error(`ONIX respondeu HTTP ${status}`)
    }

    // 4. Descompacta + parse
    const xml = descompactar(buffer)
    if (!xml) {
      // resposta vazia, sem novas mensagens — atualiza só o timestamp
      await supabase.from('coleta_estado').update({
        ultima_coleta_em: new Date().toISOString(),
        ultima_coleta_status: 'sem_novidades',
        ultima_coleta_qtd_msg: 0,
        ultima_coleta_erro: null,
      }).eq('id', 1)
      return res.status(200).json({ ok: true, msgs: 0, info: 'sem mensagens novas' })
    }

    // 5. Extrai cada <MensagemCB>...</MensagemCB>
    const mensagensCru = xml.match(/<MensagemCB>[\s\S]*?<\/MensagemCB>/g) || []

    if (mensagensCru.length === 0) {
      await supabase.from('coleta_estado').update({
        ultima_coleta_em: new Date().toISOString(),
        ultima_coleta_status: 'sem_novidades',
        ultima_coleta_qtd_msg: 0,
        ultima_coleta_erro: null,
      }).eq('id', 1)
      return res.status(200).json({ ok: true, msgs: 0, info: 'XML sem MensagemCB' })
    }

    // 6. Mapeia pra linhas do banco
    const linhas = mensagensCru.map(m => ({
      m_id:    getTagInt(m, 'mId'),
      vei_id:  getTagInt(m, 'veiID'),
      dt:      getTag(m, 'dt'),
      lat:     getTagFloat(m, 'lat'),
      lon:     getTagFloat(m, 'lon'),
      mun:     getTag(m, 'mun'),
      uf:      getTag(m, 'uf'),
      rod:     getTag(m, 'rod'),
      rua:     getTag(m, 'rua'),
      vel:     getTagFloat(m, 'vel'),
      evt4:    getTagInt(m, 'evt4'),
      evt34:   getTagBool(m, 'evt34'),
      evt35:   getTagBool(m, 'evt35'),
      evt54:   getTagBool(m, 'evt54'),
      evt67:   getTagBool(m, 'evt67'),
      evt16:   getTagBool(m, 'evt16'),
      evt17:   getTagBool(m, 'evt17'),
      rpm:     getTagInt(m, 'rpm'),
      odm:     getTagInt(m, 'odm'),
      mot:     getTag(m, 'mot'),
      mot_id:  getTagInt(m, 'motID'),
      alrt_telem: getTag(m, 'alrtTelem'),
      raw_xml: m,
    })).filter(l => l.m_id !== null && l.vei_id !== null && l.dt !== null)

    // 7. Insere em lote (upsert no m_id pra evitar duplicar)
    const { error: errInsert } = await supabase
      .from('mensagens_cb')
      .upsert(linhas, { onConflict: 'm_id', ignoreDuplicates: true })

    if (errInsert) throw new Error('Erro ao inserir mensagens: ' + errInsert.message)

    // 8. Pega o maior m_id pra atualizar o estado
    const maxMId = linhas.reduce((max, l) => l.m_id > max ? l.m_id : max, mIdInicial)

    await supabase.from('coleta_estado').update({
      ultimo_mid_cb: maxMId,
      ultima_coleta_em: new Date().toISOString(),
      ultima_coleta_status: 'ok',
      ultima_coleta_qtd_msg: linhas.length,
      ultima_coleta_erro: null,
      total_msgs_coletadas: (estado?.total_msgs_coletadas || 0) + linhas.length,
    }).eq('id', 1)

    return res.status(200).json({
      ok: true,
      msgs: linhas.length,
      mIdAnterior: mIdInicial,
      mIdNovo: maxMId,
    })

  } catch (err) {
    console.error('Erro no coletor:', err)
    await supabase.from('coleta_estado').update({
      ultima_coleta_em: new Date().toISOString(),
      ultima_coleta_status: 'erro',
      ultima_coleta_erro: err.message,
    }).eq('id', 1).then(() => {}, () => {})
    return res.status(500).json({ erro: err.message })
  }
}
