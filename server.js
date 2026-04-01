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
async function runResearch(companyName, anthropicKey, context = {}) {
  const contextHints = [
    context.domain ? `website domain: ${context.domain}` : '',
    context.phone  ? `phone: ${context.phone}` : '',
    context.city   ? `city: ${context.city}` : '',
  ].filter(Boolean).join(', ')

  // ── Step 1: Web search pass — gather raw intelligence ───────────────────
  const searchRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': anthropicKey },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      system: `You are a B2B intelligence researcher specializing in home service contractors. Search thoroughly and report everything you find in detail. Use real data — actual names, actual review quotes, actual facts. Never give up on a search; try multiple angles. Report all findings in plain prose.`,
      messages: [{
        role: 'user',
        content: `Research this contractor: "${companyName}"${contextHints ? ` (${contextHints})` : ''}

Run these searches in order:
1. "${companyName}" owner OR founder OR president — find the owner name
2. "${companyName}" reviews Google Yelp BBB — find customer feedback
3. "${companyName}" website — check for pricing transparency and services
4. [owner name] background hobbies LinkedIn Facebook — find personal details
5. "${companyName}" Facebook ads OR Google ads OR marketing agency

Report everything you found from all searches in detail. Include direct quotes from reviews. Be specific about locations, names, dates, and numbers.`
      }]
    })
  })

  if (!searchRes.ok) throw new Error(`Search API error ${searchRes.status}: ${await searchRes.text()}`)
  const searchData = await searchRes.json()
  const notes = (searchData.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')

  // ── Step 2: JSON + email writing pass — no web search, just synthesize ──
  const jsonRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': anthropicKey },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 5000,
      system: `You are a sales intelligence writer. You receive research notes and convert them into detailed, specific, actionable JSON. You write compelling personalized emails. You NEVER say "Unable to verify" or leave fields empty — if specific data is missing, make smart inferences based on contractor type, size, and region. Every field must have substantive content.`,
      messages: [{
        role: 'user',
        content: `Research notes for "${companyName}":

${notes}

Convert these notes into a JSON object. Use every piece of real data found. For missing details, make confident intelligent inferences based on the business type and market. NEVER write "Unable to verify" — always provide useful, specific content.

Return ONLY valid JSON starting with { and ending with }. No markdown, no explanation, no preamble:
{
  "industry": "trade type, services, estimated annual revenue, employee count",
  "ownership": "privately held, owner full name, years in business",
  "owner_profiles": "owner background, city, how long they have run this business",
  "owner_hobbies": "personal interests and hobbies found or inferred from context",
  "owner_family": "spouse or children if publicly mentioned, otherwise omit personal speculation",
  "pain_points": "3 very specific pain points for THIS contractor based on their size, market, and reviews",
  "tech_stack": "specific tools they use or likely use based on their size and trade",
  "recent_news": "specific news, awards, BBB status, expansions in past 12 months",
  "reviews_negative": "actual complaint themes with real quoted snippets if found",
  "reviews_positive": "actual praise themes with specific examples",
  "reviews_trend": "Improving / Declining / Stable — with evidence and dates",
  "online_pricing": "Yes or No — describe exactly what pricing is or is not shown",
  "market_population": "city/region name, estimated households, service radius",
  "market_competition": "2-3 named local competitors, market saturation assessment",
  "company_struggles": "real specific problems this business faces right now",
  "marketing_current": "Meta Ads: Yes/No, Google PPC: Yes/No, LSA: Yes/No — based on what was found",
  "marketing_agencies": "agency names found, or inferred based on ad presence",
  "email_1_subject": "specific curiosity-driven subject line referencing something real found in research",
  "email_1": "3-4 paragraph pre-call confirmation email. Open with a specific insight about their business. Explain Upfrog (demand generation via price transparency + paid social for HVAC/roofing/garage doors/water treatment/generators). Connect to their specific struggles. Confirm call and build anticipation. Sign off personally by owner first name. No fluff.",
  "email_2_subject": "warm subject line for the not-a-fit email",
  "email_2": "full email: thank them, honestly explain Upfrog requires $3M+ revenue or $6k/month investment, compliment something specific about their business, leave door open, offer one genuinely helpful free tip for their situation",
  "email_3_subject": "urgent fun subject for 24hr reminder",
  "email_3": "under 150 words: tomorrow reminder, tease 2-3 specific things from their research you will cover on the call, one punchy line about why this call was made for them"
}`
      }]
    })
  })

  if (!jsonRes.ok) throw new Error(`JSON API error ${jsonRes.status}: ${await jsonRes.text()}`)
  const jsonData = await jsonRes.json()
  const raw = (jsonData.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const s = clean.indexOf('{')
  const e = clean.lastIndexOf('}')
  if (s === -1 || e === -1) throw new Error('No JSON in response: ' + clean.slice(0, 300))

  try { return JSON.parse(clean.slice(s, e + 1)) }
  catch {
    const fixed = clean.slice(s, e + 1).replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
    return JSON.parse(fixed)
  }
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

  const { research_company, email, phone } = req.body
  if (!research_company) return res.status(400).json({ error: 'research_company is required' })

  // Extract domain from email for better company identification
  const domain = email ? email.split('@')[1] : null
  const context = { domain, phone }

  try {
    const result = await runResearch(research_company, anthropicKey, context)
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

      const data = await runResearch(companyName, anthropicKey, { domain, phone, city })

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
