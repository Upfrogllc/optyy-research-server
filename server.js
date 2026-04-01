const express = require('express')
const app = express()

app.use(express.json())

// Allow requests from your Netlify frontend
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

app.post('/research', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

  const { research_company } = req.body
  if (!research_company) return res.status(400).json({ error: 'research_company is required' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{
          role: 'user',
          content: `Research the company "${research_company}". Search for: (1) owner/CEO name and background, (2) customer reviews across multiple years, (3) their website pricing page, (4) the local market they serve. Return ONLY this JSON with no markdown or extra text:
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
      return res.status(500).json({ error: `Anthropic ${response.status}`, detail: err })
    }

    const data = await response.json()
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    const match = text.match(/\{[\s\S]*\}/)

    if (!match) return res.status(500).json({ error: 'No JSON in response', raw: text.slice(0, 500) })

    const result = JSON.parse(match[0])
    res.json({ result })

  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Health check
app.get('/', (req, res) => res.json({ status: 'OPTYy Research Server running' }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
