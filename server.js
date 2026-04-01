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
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': anthropicKey,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 5000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      messages: [{
        role: 'user',
        content: `Research the company "${companyName}"${context.domain ? ` (website: ${context.domain})` : ''}${context.phone ? ` (phone: ${context.phone})` : ''}${context.city ? ` (location: ${context.city})` : ''}. Use the website domain or phone number to identify the exact right company if the name is common. Search for: (1) owner/CEO name and background, (2) customer reviews across multiple years, (3) their website pricing and marketing presence, (4) the local market they serve, (5) any current or past marketing activity — paid ads, PPC, LSA, Meta ads, marketing agencies. Return ONLY this JSON with no markdown or extra text:
{
  "industry": "what they do, their trade/service type, and estimated annual revenue",
  "ownership": "privately held or public, owner full name if found and source",
  "owner_profiles": "owner background: city, education, how long in business, career history",
  "owner_hobbies": "owner personal interests found online: sports, hobbies, church, charity, teams",
  "owner_family": "spouse name, children if publicly mentioned — public info only",
  "pain_points": "3 specific operational challenges this contractor likely faces right now",
  "tech_stack": "software tools they use: CRM, scheduling, marketing, communication",
  "recent_news": "notable news, awards, expansions, or problems in past 12 months",
  "reviews_negative": "most common complaints from Google, Yelp, BBB. Include 1-2 quoted snippets.",
  "reviews_positive": "most common praise themes from reviews",
  "reviews_trend": "is sentiment improving or declining? Compare old vs new reviews. State: Improving / Declining / Stable and why.",
  "online_pricing": "do they show transparent pricing on their website? Yes or No. Describe exactly what pricing info is visible if any.",
  "market_population": "estimated households in their service area. Include city/region name and household count.",
  "market_competition": "how competitive is their local market? Name 2-3 direct competitors. Is market saturated, growing, or underserved?",
  "company_struggles": "the real operational and growth problems this business faces based on all research",
  "marketing_current": "are they currently running paid ads? Search for Meta/Facebook ads, Google PPC, LSA (Local Service Ads), or any other paid marketing. State Yes or No for each channel found active.",
  "marketing_agencies": "any marketing firms, agencies, or consultants they currently use or have used in the past. Include company names if found.",
  "email_1_subject": "A subject line for Email 1 that is curiosity-driven, personal, and makes the owner want to open it immediately. Reference something specific you found — their struggle, market, or a competitor. No generic phrases like 'grow your business'.",
  "email_1": "Write a full pre-call confirmation email FROM Upfrog TO the owner. This owner just scheduled a discovery/strategy call. The email should: (1) Open by referencing something specific you found about their business or market — make it clear we did our homework. (2) Build excitement about what Upfrog does: Upfrog is a demand generation program that uses online price transparency and paid social media ads to capture customers at every stage of the buying process — specifically for HVAC replacement, roofing, garage doors, water treatment, and generators. (3) Connect Upfrog directly to 1-2 specific struggles or gaps you found in their research — low online pricing visibility, declining reviews, heavy competition, etc. (4) Confirm the discovery/strategy call and build anticipation — tell them what they will walk away with from the call. (5) Close warmly and personally using the owner first name. Tone: confident, direct, human — like a trusted advisor, not a salesperson. 3-4 short paragraphs. No fluff.",
  "email_2_subject": "A subject line for Email 2 that is warm, honest, and positions this as helpful advice — not a rejection.",
  "email_2": "Write a full email FROM Upfrog TO the owner that kindly and professionally lets them know Upfrog is built for contractors doing over $3M in annual revenue or those ready to invest at least $6,000/month in demand generation. The email should: (1) Thank them genuinely for their time and interest. (2) Be honest that Upfrog may not be the right fit right now based on where they are — do NOT make them feel bad or small. (3) Reference 1 specific positive thing you found about their business to show genuine respect. (4) Briefly explain what Upfrog is and the investment level so they understand the standard. (5) Leave the door open — if they grow or are ready to invest at that level, Upfrog would love to reconnect. (6) Offer 1 genuinely helpful tip or resource relevant to their current situation — a free tool, strategy, or advice based on what you found. Tone: warm, generous, zero pressure. This email should make them like Upfrog even more after reading it.",
  "email_3_subject": "A subject line for a follow-up email sent 24 hours before the scheduled call — creates urgency and excitement.",
  "email_3": "Write a short 24-hour reminder email that: (1) Reminds them of the upcoming discovery call tomorrow. (2) Teases 2-3 specific things Upfrog will show them on the call based on what you found about their business and market. (3) Includes a one-liner that makes them feel like this call was made for their exact situation. (4) Keeps it under 150 words. High energy, punchy, confident."
}

IMPORTANT: You MUST return ONLY the JSON object above. No introduction, no explanation, no markdown, no code blocks. Start your response with { and end with }.`
      }]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic ${response.status}: ${err}`)
  }

  const data = await response.json()

  // Collect all text from the response (web search results + any text blocks)
  const allText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')

  // Try to find JSON directly first
  const stripped = allText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const start = stripped.indexOf('{')
  const end   = stripped.lastIndexOf('}')

  if (start !== -1 && end !== -1) {
    const jsonStr = stripped.slice(start, end + 1)
    try { return JSON.parse(jsonStr) } catch {}
  }

  // No valid JSON found — do a second pass asking Claude to write ONLY the JSON
  // using the search results already gathered as context
  const contextText = allText.slice(0, 8000) // cap context size

  const pass2 = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': anthropicKey,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Based on this research about "${companyName}":\n\n${contextText}\n\nNow write ONLY a JSON object with these exact keys. Start with { and end with }. No other text:\n{\n  "industry": "",\n  "ownership": "",\n  "owner_profiles": "",\n  "owner_hobbies": "",\n  "owner_family": "",\n  "pain_points": "",\n  "tech_stack": "",\n  "recent_news": "",\n  "reviews_negative": "",\n  "reviews_positive": "",\n  "reviews_trend": "",\n  "online_pricing": "",\n  "market_population": "",\n  "market_competition": "",\n  "company_struggles": "",\n  "marketing_current": "",\n  "marketing_agencies": "",\n  "email_1_subject": "",\n  "email_1": "",\n  "email_2_subject": "",\n  "email_2": "",\n  "email_3_subject": "",\n  "email_3": ""\n}`
      }]
    })
  })

  const p2data = await pass2.json()
  const p2text = (p2data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const p2stripped = p2text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const p2start = p2stripped.indexOf('{')
  const p2end   = p2stripped.lastIndexOf('}')
  if (p2start === -1 || p2end === -1) throw new Error('No JSON after second pass: ' + p2text.slice(0, 200))

  const p2json = p2stripped.slice(p2start, p2end + 1)
  try { return JSON.parse(p2json) }
  catch {
    const fixed = p2json.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
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

      const domain = email ? email.split('@')[1] : null
      const city   = payload.city || payload.contact?.city || ''
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
