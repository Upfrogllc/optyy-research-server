const express = require('express')
const app = express()

app.use(express.json())

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// ── In-memory activity log (last 100 events) ─────────────────────────────────
const activityLog = []
function logActivity(entry) {
  activityLog.unshift({ ...entry, timestamp: new Date().toISOString() })
  if (activityLog.length > 100) activityLog.pop()
  console.log(`[${entry.status}] ${entry.company} — ${entry.message || ''}`)
}

// ── Shared: run AI research ───────────────────────────────────────────────────
async function runResearch(companyName, anthropicKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': anthropicKey,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      messages: [{
        role: 'user',
        content: `Research the company "${companyName}". Search for: (1) owner/CEO name and background, (2) customer reviews across multiple years, (3) their website pricing page, (4) the local market they serve. Return ONLY this JSON with no markdown or extra text:
{
  "industry": "what they do and estimated size",
  "ownership": "privately held or public, owner name if found",
  "owner_profiles": "owner background and location if found",
  "owner_hobbies": "owner interests or hobbies if found online",
  "owner_family": "spouse or children if publicly mentioned",
  "pain_points": "3 operational challenges this business likely faces",
  "tech_stack": "software tools they likely use",
  "recent_news": "any notable news in past 12 months",
  "reviews_negative": "common complaints from reviews if found",
  "reviews_positive": "common praise from reviews if found",
  "reviews_trend": "is review sentiment improving or declining over time? Compare older vs newer reviews. State: Improving / Declining / Stable and explain why.",
  "online_pricing": "does the company show transparent pricing on their website? Yes or No, and describe what is visible.",
  "market_population": "estimate households or businesses in the geographic market they serve. Include city/region and population.",
  "market_competition": "how competitive is their local market? Name 2-3 direct local competitors if found. Is market saturated, growing, or underserved?",
  "company_struggles": "real problems this business appears to face based on all research",
  "email_angle": "personalized 2-3 sentence OPTYy cold email opener referencing owner by first name and a specific struggle"
}`
      }]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic ${response.status}: ${err}`)
  }

  const data = await response.json()
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON in response')
  return JSON.parse(match[0])
}

// ── Shared: build note body ───────────────────────────────────────────────────
function buildNote(companyName, d) {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPTYy AI PROSPECT INTELLIGENCE
Researched: ${now}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏢 COMPANY: ${companyName}

─────────────────────────────────
📊 INDUSTRY & SIZE
${d.industry || 'N/A'}

─────────────────────────────────
🔐 OWNERSHIP
${d.ownership || 'N/A'}

─────────────────────────────────
👤 OWNER BACKGROUND
${d.owner_profiles || 'N/A'}

─────────────────────────────────
🎯 OWNER INTERESTS & HOBBIES
${d.owner_hobbies || 'N/A'}

─────────────────────────────────
👨‍👩‍👧 FAMILY (PUBLIC INFO ONLY)
${d.owner_family || 'N/A'}

─────────────────────────────────
⚠️ PAIN POINTS
${d.pain_points || 'N/A'}

─────────────────────────────────
🛠️ TECH STACK
${d.tech_stack || 'N/A'}

─────────────────────────────────
📰 RECENT NEWS
${d.recent_news || 'N/A'}

─────────────────────────────────
👎 NEGATIVE REVIEWS
${d.reviews_negative || 'N/A'}

─────────────────────────────────
👍 POSITIVE REVIEWS
${d.reviews_positive || 'N/A'}

─────────────────────────────────
📈 REVIEW TREND
${d.reviews_trend || 'N/A'}

─────────────────────────────────
💰 ONLINE PRICING
${d.online_pricing || 'N/A'}

─────────────────────────────────
🏘️ MARKET POPULATION
${d.market_population || 'N/A'}

─────────────────────────────────
⚔️ MARKET COMPETITION
${d.market_competition || 'N/A'}

─────────────────────────────────
🚨 COMPANY STRUGGLES
${d.company_struggles || 'N/A'}

─────────────────────────────────
✉️ EMAIL ANGLE
${d.email_angle || 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by OPTYy Prospect Research
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}

// ── GHL helpers ───────────────────────────────────────────────────────────────
async function ghlRequest(method, path, payload, ghlKey) {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ghlKey}`,
      'Version': '2021-07-28',
    },
    body: payload ? JSON.stringify(payload) : undefined
  })
  return res
}

// ── GET /activity — returns the live activity log ────────────────────────────
app.get('/activity', (req, res) => {
  res.json({ events: activityLog })
})

// ── POST /research — manual research from OPTYy app ──────────────────────────
app.post('/research', async (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

  const { research_company } = req.body
  if (!research_company) return res.status(400).json({ error: 'research_company is required' })

  try {
    const result = await runResearch(research_company, anthropicKey)
    res.json({ result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /webhook — GHL fires this when a contact is created ─────────────────
app.post('/webhook', async (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const ghlKey       = process.env.GHL_API_KEY
  const locationId   = process.env.GHL_LOCATION_ID

  if (!anthropicKey || !ghlKey || !locationId) {
    return res.status(500).json({ error: 'Missing environment variables' })
  }

  // Extract contact info from GHL webhook payload
  const payload     = req.body
  const contactId   = payload.contact_id || payload.id || payload.contactId
  const companyName = payload.company_name || payload.companyName || `${payload.first_name || ''} ${payload.last_name || ''}`.trim() || 'Unknown'
  const email       = payload.email || payload.contact?.email || ''
  const phone       = payload.phone || payload.contact?.phone || ''
  const fullName    = `${payload.first_name || ''} ${payload.last_name || ''}`.trim()

  if (!contactId) {
    return res.status(400).json({ error: 'No contact_id in webhook payload' })
  }

  // Log receipt immediately
  logActivity({ status: 'received', company: companyName, contactId, email, phone, message: 'Webhook received — starting research' })

  // Respond to GHL immediately so it does not time out
  res.json({ status: 'received', contactId, companyName })

  // Run research async in background
  ;(async () => {
    try {
      logActivity({ status: 'researching', company: companyName, contactId, email, phone, message: 'AI research in progress...' })

      const data = await runResearch(companyName, anthropicKey)

      // Write research note to GHL contact
      await ghlRequest('POST', `/contacts/${contactId}/notes/`, {
        body: buildNote(companyName, data)
      }, ghlKey)

      // Add enriched tag to contact
      await ghlRequest('PUT', `/contacts/${contactId}/`, {
        tags: ['oiptyy-researched']
      }, ghlKey)

      logActivity({
        status: 'done',
        company: companyName,
        contactId,
        email,
        phone,
        owner: data.ownership || '',
        industry: data.industry || '',
        message: 'Research complete — notes and tag written to GHL'
      })

    } catch (e) {
      logActivity({ status: 'error', company: companyName, contactId, email, phone, message: e.message })
      console.error(`[webhook error] ${companyName}:`, e.message)
    }
  })()
})

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'OPTYy Research Server running', events: activityLog.length }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
