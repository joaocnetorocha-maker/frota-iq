// =============================================================================
// /api/sincronizar-veiculos.js — Atualiza tabela `veiculos` do Supabase
// =============================================================================
// Chama RequestVeiculo na ONIXSAT, faz upsert no Supabase.
// Como usar:
//   1. Manualmente uma vez após o setup inicial (pra povoar a tabela)
//   2. Depois cron-job.org pode chamar 1x por dia pra refletir cadastros novos
//
// Mesmo header de auth que /api/coletar:
//   Authorization: Bearer <CRON_SECRET>
// =============================================================================

import https from 'https'
import AdmZip from 'adm-zip'
import { createClient } from '@supabase/supabase-js'

const ONIX_HOSTNAME = 'webservice.newrastreamentoonline.com.br'

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return m ? m[1].trim() : null
}
function getTagInt(xml, tag) {
  const v = getTag(xml, tag)
  if (v === null || v === '') return null
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

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

function descompactar(buffer) {
  if (buffer.length < 4) return null
  const eZip = buffer[0] === 0x50 && buffer[1] === 0x4b
  if (!eZip) return buffer.toString('utf-8')
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  if (entries.length === 0) return null
  return entries[0].getData().toString('utf-8')
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ erro: 'unauthorized' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  try {
    const xmlBody = `<RequestVeiculo><login>${process.env.ONIX_LOGIN}</login><senha>${process.env.ONIX_SENHA}</senha></RequestVeiculo>`
    const { status, buffer } = await chamarOnix(xmlBody)
    if (status !== 200) throw new Error(`ONIX HTTP ${status}`)

    const xml = descompactar(buffer)
    if (!xml) throw new Error('resposta vazia ou inválida')

    const veiculosCru = xml.match(/<Veiculo>[\s\S]*?<\/Veiculo>/g) || []
    if (veiculosCru.length === 0) throw new Error('nenhum <Veiculo> na resposta')

    const linhas = veiculosCru.map(v => ({
      vei_id:    getTagInt(v, 'veiID'),
      placa:     getTag(v, 'placa'),
      motorista: getTag(v, 'mot'),
      chassi:    getTag(v, 'chassi'),
      ident:     getTag(v, 'ident'),
      eqp:       getTagInt(v, 'eqp'),
      ult_manut: getTag(v, 'uManut'),
      atualizado_em: new Date().toISOString(),
    })).filter(l => l.vei_id !== null)

    const { error: errUpsert } = await supabase
      .from('veiculos')
      .upsert(linhas, { onConflict: 'vei_id' })

    if (errUpsert) throw new Error('erro upsert: ' + errUpsert.message)

    return res.status(200).json({
      ok: true,
      sincronizados: linhas.length,
      placas: linhas.map(l => l.placa).filter(Boolean),
    })
  } catch (err) {
    console.error('Erro em /api/sincronizar-veiculos:', err)
    return res.status(500).json({ erro: err.message })
  }
}
