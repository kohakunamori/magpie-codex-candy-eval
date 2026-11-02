const DEFAULT_BASE = 'http://127.0.0.1:3425/v1';

export function apiBase(input = process.env.MAGPIE_BASE_URL || DEFAULT_BASE, allowRemote = false) {
  const url = new URL(input);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !allowRemote) throw new Error('Remote gateways require explicit --allow-remote (credentials might leave this machine)');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid gateway protocol');
  return url.toString().replace(/\/$/, '').replace(/\/v1$/, '') + '/v1';
}

export function extractText(json) {
  if (typeof json?.output_text === 'string') return json.output_text;
  const choices = json?.choices;
  if (Array.isArray(choices) && choices.length) {
    const c = choices[0]?.message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(x => x.text || '').join('');
  }
  if (Array.isArray(json?.output)) return json.output.flatMap(item => (item.content || []).map(c => c.text || '')).join('');
  return '';
}

export function contextMessages(fixture, mode = 'codex') {
  if (mode === 'simple') return [];
  const messages = [];
  if (fixture?.base_instructions) messages.push({role:'developer', content:fixture.base_instructions});
  for (const m of fixture?.messages || []) {
    if (!['user', 'assistant', 'developer', 'system'].includes(m.role)) continue;
    const text = (m.content || []).map(x => x.text || '').filter(Boolean).join('\n');
    if (text) messages.push({role:m.role, content:text});
  }
  return messages;
}

export async function askGateway(opts, prompt, instructions = '', transport = globalThis.fetch) {
  const base = apiBase(opts.base, !!opts.allowRemote);
  const headers = {'Content-Type':'application/json','Authorization':'Bearer ' + (opts.apiKey || process.env.MAGPIE_API_KEY || 'magpie')};
  if (opts.account) headers['X-Magpie-Account'] = encodeURIComponent(opts.account);
  const fixtureMessages = contextMessages(opts.fixture, opts.context || 'codex');
  const messages = [...fixtureMessages];
  if (instructions) messages.push({role:'system',content:instructions});
  messages.push({role:'user',content:prompt});
  const payload = {model:opts.model, messages, stream:false};
  if (opts.effort && opts.effort !== 'none') payload.reasoning_effort = opts.effort;
  const timeout = Math.min(Math.max(1000, opts.timeout || 180000),600000);
  let last;
  for (let attempt=1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await transport(base + '/chat/completions', {method:'POST',headers,body:JSON.stringify(payload),signal:controller.signal});
      const raw = await res.text();
      let body;
      try {body = JSON.parse(raw);} catch {body = {error:{message:raw.slice(0,400)}};}
      if (!res.ok) {
        const e = new Error('Gateway HTTP ' + res.status + ': ' + String(body.error?.message || body.message || raw).slice(0,300));
        e.status = res.status;
        throw e;
      }
      const reply = extractText(body);
      if (!reply) throw new Error('Gateway returned no text');
      return {text:reply, usage:body.usage || null, attempts:attempt, provider:res.headers?.get?.('X-Magpie-Provider') || '',servedModel:res.headers?.get?.('X-Magpie-Model') || ''};
    } catch(e) {
      last=e;
      if ([400,401,403,404,409,429].includes(e.status) || attempt === 3) throw e;
      await new Promise(resolve => setTimeout(resolve, 200 * attempt));
    } finally {clearTimeout(timer);}
  }
  throw last;
}
