const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
const initialTags = ['upfrog-text-demo', 'hvac-tune-ups', 'text-demo-tuneup', 'uf-tuneup-demo-pending', 'customer replied', 'upfrog', 'sent-video']
const clone = value => JSON.parse(JSON.stringify(value))
function fixture(options = {}) {
  const routes = new Map(), calls = [], output = [], tags = new Set(initialTags)
  const app = { use() {}, get(p, handler) { routes.set('GET ' + p, handler) }, post(p, handler) { routes.set('POST ' + p, handler) }, listen() { throw Error('Tests cannot bind a public server') } }
  const express = () => app; express.json = () => () => {}
  const summary = Object.fromEntries(['industry','ownership','owner_profiles','owner_hobbies','owner_family','pain_points','tech_stack','recent_news','reviews_negative','reviews_positive','reviews_trend','online_pricing','market_population','market_competition','company_struggles','marketing_current','marketing_agencies'].map(key => [key, 'Not verified']))
  summary.industry = 'HVAC services. Source: https://example.com/about'
  summary.email_1 = 'Should never escape the output whitelist'
  const researchContent = [{type:'text', text:'Official business source confirms HVAC services.', citations:[{type:'web_search_result_location',url:'https://example.com/about',title:'Official About'}]}]
  const state = { aiCalls:0, crmCalls:0 }
  const box = {
    require(name) { assert.equal(name, 'express'); return express }, module:{exports:{}},
    process:{env:{ANTHROPIC_API_KEY:'synthetic-ai-key',GHL_API_KEY:'synthetic-crm-key',GHL_LOCATION_ID:'synthetic-location'},uptime:()=>1},
    URL, Response, AbortSignal, setTimeout:(fn)=>setImmediate(fn),
    console:{log:(...a)=>output.push(a.join(' ')),error:(...a)=>output.push(a.join(' '))},
    fetch:async (url, init) => {
      const body=init.body?JSON.parse(init.body):null
      calls.push({url,method:init.method,body,headers:init.headers})
      if (url === 'https://api.anthropic.com/v1/messages') {
        state.aiCalls++
        if (options.ai) return options.ai(state.aiCalls,body,summary,researchContent)
        if (body.tools) return Response.json({stop_reason:'end_turn',content:researchContent})
        return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({...summary,...options.summary})}]})
      }
      assert.ok(url.startsWith('https://services.leadconnectorhq.com/contacts/synthetic-contact/'), 'No real or unrelated contact may be addressed')
      state.crmCalls++
      if (url.endsWith('/notes/')) {
        assert.equal(init.method,'POST')
        assert.deepEqual(Object.keys(body),['body'])
        if(options.noteFails) return Response.json({error:'rejected'},{status:422})
        // Emulate an independent workflow adding a tag between the note and tag.
        tags.add('concurrent-workflow-tag')
        return Response.json({note:{id:'synthetic-note'}})
      }
      assert.equal(url,'https://services.leadconnectorhq.com/contacts/synthetic-contact/tags')
      assert.equal(init.method,'POST')
      assert.deepEqual(body,{tags:['oiptyy-researched']})
      if(options.tagFails) return Response.json({error:'denied'},{status:403})
      body.tags.forEach(tag=>tags.add(tag))
      return Response.json({tags:[...tags]})
    },
  }
  vm.runInNewContext(source,box,{filename:'server.js'})
  return { api:box.module.exports,routes,calls,output,tags,state,summary,box }
}
function response() {return {code:200,data:null,status(n){this.code=n;return this},json(d){this.data=clone(d);return this}}}
async function webhook(f) {
  const res=response()
  await f.routes.get('POST /webhook')({body:{contact_id:'synthetic-contact',company_name:'Synthetic HVAC LLC',email:'fixture@example.com',phone:'+12025550148'}},res)
  assert.equal(res.data.status,'received')
  for(let i=0;i<100&&!f.output.some(x=>/^\[(done|error)\]/.test(x));i++) await new Promise(setImmediate)
  assert.ok(f.output.some(x=>/^\[(done|error)\]/.test(x)), 'Background handler completes within test')
  return res
}

test('both research passes use Fable 5.1, citations and research-only output',async()=>{
  const f=fixture(),result=await f.api.runResearch('Synthetic HVAC LLC','synthetic-ai-key')
  assert.equal(f.calls.length,2)
  for(const call of f.calls){assert.equal(call.body.model,'claude-fable-5-1');assert.equal(call.body.output_config.effort,'high');assert.equal(call.headers['anthropic-version'],'2023-06-01');assert.equal(call.body.thinking,undefined);assert.equal(call.body.tool_choice,undefined)}
  assert.equal(f.calls[0].body.tools[0].type,'web_search_20250305')
  assert.equal(f.calls[0].body.tools[0].max_uses,10)
  assert.match(f.calls[0].body.system,/current web search/)
  assert.match(f.calls[1].body.system,/Not verified/)
  assert.ok(f.calls[1].body.messages[0].content.includes('https://example.com/about'))
  assert.equal(result.email_1,undefined)
  assert.equal(result.research_model,'claude-fable-5-1')
  assert.equal(result.sources[0].url,'https://example.com/about')
  const note=f.api.buildNote('Synthetic HVAC LLC',result)
  assert.match(note,/SOURCES CONSULTED/);assert.match(note,/Model: claude-fable-5-1/)
  assert.doesNotMatch(note,/EMAIL 1|EMAIL 2|EMAIL 3|PRE-CALL CONFIRMATION|24HR REMINDER|Should never escape/)
})

test('webhook preserves all previous tags plus concurrently added workflow tags',async()=>{
  const f=fixture();await webhook(f)
  initialTags.forEach(tag=>assert.ok(f.tags.has(tag),tag))
  assert.ok(f.tags.has('concurrent-workflow-tag'))
  assert.ok(f.tags.has('oiptyy-researched'))
  assert.equal(f.state.crmCalls,2)
  assert.ok(f.output.some(s=>s.startsWith('[done]')))
  assert.ok(f.calls.every(c=>c.method==='POST'),'No PUT replacement, deletion, workflow enrollment or booking')
  assert.ok(!f.calls.some(c=>/appointments|opportunities|workflow/.test(c.url)))
})

test('note write failure stops the tag and never logs success',async()=>{
  const f=fixture({noteFails:true});await webhook(f)
  assert.equal(f.state.crmCalls,1);assert.deepEqual([...f.tags],initialTags)
  assert.ok(f.output.some(s=>s.startsWith('[error]')));assert.ok(!f.output.some(s=>s.startsWith('[done]')))
})

test('tag write failure is reported, not treated as research saved',async()=>{
  const f=fixture({tagFails:true});await webhook(f)
  assert.ok(f.output.some(s=>s.includes('HTTP 403')))
  assert.ok(!f.output.some(s=>s.startsWith('[done]')))
  assert.ok(!f.tags.has('oiptyy-researched'));initialTags.forEach(t=>assert.ok(f.tags.has(t)))
})

test('model access or retention error is not retried on another model',async()=>{
  const f=fixture({ai:()=>Response.json({error:{message:'synthetic-private-body'}},{status:400})});await webhook(f)
  assert.equal(f.state.aiCalls,1);assert.equal(f.state.crmCalls,0)
  assert.ok(f.output.some(s=>s.includes('data-retention')))
  assert.ok(!f.output.join('\n').includes('synthetic-private-body'))
  assert.ok(!f.output.join('\n').includes('synthetic-ai-key'))
})

test('paused web search retains immutable original history and tool definitions',async()=>{
  const prefix=[{type:'thinking',thinking:'not exposed',signature:'synthetic-signature'},{type:'text',text:'Continuing research.'}]
  const f=fixture({ai:(n,body,summary,content)=>Response.json(n===1?{stop_reason:'pause_turn',content:prefix}:body.tools?{stop_reason:'end_turn',content}:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(summary)}]})})
  await f.api.runResearch('Synthetic HVAC LLC','synthetic-key')
  assert.equal(f.calls.length,3)
  assert.deepEqual(f.calls[1].body.messages[0],f.calls[0].body.messages[0])
  assert.deepEqual(f.calls[1].body.messages[1],{role:'assistant',content:prefix})
  assert.deepEqual(f.calls[1].body.tools,f.calls[0].body.tools)
  assert.equal(f.calls[1].body.system,f.calls[0].body.system)
  assert.ok(!f.calls[2].body.messages[0].content.includes('synthetic-signature'))
})

for(const stop_reason of ['refusal','max_tokens','tool_use'])test(`${stop_reason} never produces a completed CRM report`,async()=>{
  const f=fixture({ai:()=>Response.json({stop_reason,content:[{type:'text',text:'Partial answer'}]})});await webhook(f)
  assert.equal(f.state.crmCalls,0);assert.ok(!f.output.some(s=>s.startsWith('[done]')))
})

test('pause continuation is bounded',async()=>{
  const f=fixture({ai:()=>Response.json({stop_reason:'pause_turn',content:[{type:'text',text:'Searching'}]})})
  await assert.rejects(()=>f.api.runResearch('Synthetic HVAC LLC','synthetic-key'),/continuation limit/)
  assert.equal(f.state.aiCalls,3)
})

test('web-search errors in a 200 response do not get hidden',async()=>{
  const f=fixture({ai:()=>Response.json({stop_reason:'end_turn',content:[{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'max_uses_exceeded'}}]})})
  await assert.rejects(()=>f.api.runResearch('Synthetic HVAC LLC','synthetic-key'),/Web search failed/)
  assert.equal(f.state.aiCalls,1)
})

test('research without actual web-source evidence is not synthesized or written',async()=>{
  const f=fixture({ai:()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'Unsupported claims https://made-up.example'}]})});await webhook(f)
  assert.equal(f.state.aiCalls,1);assert.equal(f.state.crmCalls,0)
})

test('unknowns allowed but missing fields rejected',async()=>{
  const f=fixture({summary:{industry:42}})
  await assert.rejects(()=>f.api.runResearch('Synthetic HVAC LLC','synthetic-key'),/missing industry/)
})

test('manual research returns no email examples and never writes CRM records',async()=>{
  const f=fixture(),r=response()
  await f.routes.get('POST /research')({body:{research_company:'Synthetic HVAC LLC'}},r)
  assert.equal(r.code,200);assert.equal(r.data.result.email_1,undefined);assert.equal(f.state.crmCalls,0)
})

test('health exposes configuration flags, not credentials',()=>{
  const f=fixture(),r=response();f.routes.get('GET /health')({},r)
  assert.equal(r.data.research_model,'claude-fable-5-1');assert.equal(r.data.example_emails,false);assert.equal(r.data.tag_mode,'additive')
  assert.ok(!JSON.stringify(r.data).includes('synthetic-ai-key'))
})

test('invalid webhook contact IDs and placeholder companies cause no research',async()=>{
  const f=fixture(),r=response();await f.routes.get('POST /webhook')({body:{contact_id:'../contacts/other',company_name:'Synthetic HVAC LLC'}},r)
  assert.equal(r.code,400);assert.equal(f.calls.length,0)
  assert.equal(f.api.validateResearchInput('test',{}).valid,false)
})
