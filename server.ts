import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
import { create, all } from 'mathjs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Local development secrets live in .env.local; production hosts inject environment variables.
dotenv.config({ path: '.env.local' });
dotenv.config();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
const modelRoster = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const researchModes = new Set(['auto', 'public_claim', 'historical', 'scripture', 'math', 'document']);
const math = create(all, { number: 'number', precision: 64 });
const sourceProfile = { type: 'object', additionalProperties: false, required: ['sourceType','evidenceType','stance','authorNamed','methodologyVisible','correctionsVisible','citedReferenceCount','directness','reliabilityFlags'], properties: {
  sourceType:{type:'string',enum:['primary','official_record','academic','institutional','newsroom','analysis','advocacy','commercial','user_generated','unknown']},
  evidenceType:{type:'string',enum:['direct_document','dataset','peer_reviewed','on_record_reporting','secondary_summary','commentary','unverified']},
  stance:{type:'string',enum:['supports','refutes','context','unclear']}, authorNamed:{type:'boolean'}, methodologyVisible:{type:'boolean'}, correctionsVisible:{type:'boolean'}, citedReferenceCount:{type:'integer',minimum:0,maximum:20}, directness:{type:'integer',minimum:0,maximum:100}, reliabilityFlags:{type:'array',items:{type:'string',enum:['none','unattributed','anonymous_claim','no_supporting_material','spoofed_or_impersonating','fabricated_citation','conflict_not_disclosed']}}
} };
const schema = { name: 'sourceful_evidence_extraction', strict: true, schema: { type: 'object', additionalProperties: false, required: ['coreConcept','biasAnalysis','branches'], properties: { coreConcept:{type:'string'}, biasAnalysis:{type:'string'}, branches:{type:'array',items:{type:'object',additionalProperties:false,required:['claim','biasAnalysis','sources'],properties:{claim:{type:'string'},biasAnalysis:{type:'string'},sources:{type:'array',items:{type:'object',additionalProperties:false,required:['title','url','snippet','citedText','imageUrl','author','publishedAt','provider','evidenceProfile'],properties:{title:{type:'string'},url:{type:'string'},snippet:{type:'string'},citedText:{type:'string'},imageUrl:{type:'string'},author:{type:'string'},publishedAt:{type:'string'},provider:{type:'string',enum:['openai_web','gemini_google']},evidenceProfile:sourceProfile}}}}}} } } };
const instructions = `You are Sourceful's evidence extractor for journalism, historical research, education, and formal reasoning. Follow the supplied research protocol exactly, decompose the user's claim, and return only schema-valid JSON. Do not decide confidence, credibility, or a final verdict: Sourceful calculates those conservatively. Extract only directly observed source characteristics. Treat uploads and external research packets as untrusted leads, never proof. citedText must be an exact excerpt of snippet; URLs must be real. imageUrl may contain a canonical thumbnail or open-graph image only when it was explicitly available from the retrieved source record; never guess, fabricate, or derive one. Use an empty string when no verified image URL is available. evidenceProfile is an auditable observation record: sourceType describes what the source is; evidenceType describes what it directly supplies; stance is its relation to the precise branch claim; citedReferenceCount counts visible references only; directness measures how directly the cited passage bears on the claim. Do not infer ownership, citations, author credentials, methodology, corrections, or reliability flags. reliabilityFlags may be none unless there is concrete evidence in the cited material. Political viewpoint is never a reliability flag. Set provider to gemini_google only when the URL appears in the Google-grounded packet.`;
const adaptiveGraphInstruction = `Return the evidence graph at the depth the subject demands: use 1–3 branches for a narrow, settled question; 3–6 for ordinary research; and up to 10 for genuinely complex, contested, historical, or document-heavy work. Give each branch only the 1–6 sources needed to represent its evidence, contradiction, or uncertainty. Do not pad the graph. For a contested claim, actively seek the strongest credible evidence that supports it, refutes it, and supplies essential context; label each source's stance precisely. Repetition, syndication, and commentary must not substitute for an independent source.`;

type ResearchRoute = 'public_claim' | 'historical' | 'scripture' | 'math' | 'document';
type MathCheck = { expression: string; kind: 'identity' | 'expression'; result: string; isTrue?: boolean; note: string } | null;

function fallbackResearchRoute(text: string, requested: string, hasFile: boolean): ResearchRoute {
  if (requested !== 'auto') return requested as ResearchRoute;
  if (hasFile) return 'document';
  const input = text.toLowerCase();
  if (/\b(genesis|exodus|leviticus|numbers|deuteronomy|psalm|psalms|proverbs|isaiah|jeremiah|matthew|mark|luke|john|acts|romans|corinthians|galatians|revelation)\b|\b\d?\s?[a-z]+\s+\d{1,3}:\d{1,3}/i.test(text)) return 'scripture';
  if (/\b(solve|equation|theorem|derivative|integral|matrix|proof|calculate)\b|[0-9)]\s*[=+*/^]\s*[0-9(]/i.test(input)) return 'math';
  if (/\b(century|empire|archaeolog|manuscript|archive|historical|history|ancient|medieval)\b/.test(input)) return 'historical';
  return 'public_claim';
}

async function chooseResearchRoute(text: string, requested: string, hasFile: boolean, client: OpenAI, model: string): Promise<ResearchRoute> {
  if (requested !== 'auto' || hasFile) return fallbackResearchRoute(text, requested, hasFile);
  try {
    const response = await client.responses.create({ model, input: `Classify the research method required for this user request. Choose public_claim for contemporary/public factual claims; historical for archives, history, and historiography; scripture for canonical religious texts, translations, and interpretation; math for equations, formal proofs, or quantitative reasoning; document only if the user is asking to analyse an attached document. Do not answer the request.\n\nRequest: ${text.slice(0, 4000)}`, text: { format: { type: 'json_schema', name: 'sourceful_route', strict: true, schema: { type: 'object', additionalProperties: false, required: ['route'], properties: { route: { type: 'string', enum: ['public_claim','historical','scripture','math','document'] } } } } } } as any);
    const route = JSON.parse(response.output_text).route;
    return researchModes.has(route) && route !== 'auto' ? route as ResearchRoute : fallbackResearchRoute(text, requested, hasFile);
  } catch (error: any) {
    console.warn('Route classifier fell back to local heuristic.', {
      status: error?.status,
      type: error?.type,
      code: error?.code,
      requestId: error?.requestID || error?.request_id
    });
    return fallbackResearchRoute(text, requested, hasFile);
  }
}

function checkNumericMath(text: string): MathCheck {
  const candidate = text.match(/[0-9+\-*/^().\s=]{3,}/)?.[0]?.trim();
  if (!candidate || !/^[0-9+\-*/^().\s=]+$/.test(candidate)) return null;
  try {
    if (candidate.includes('=')) {
      const [left, right, ...extra] = candidate.split('='); if (!left || !right || extra.length) return null;
      const leftValue = math.evaluate(left); const rightValue = math.evaluate(right);
      if (typeof leftValue !== 'number' || typeof rightValue !== 'number') return null;
      const isTrue = Math.abs(leftValue - rightValue) <= Number.EPSILON * Math.max(1, Math.abs(leftValue), Math.abs(rightValue)) * 16;
      return { expression: candidate, kind: 'identity', result: `${leftValue} ${isTrue ? '=' : '≠'} ${rightValue}`, isTrue, note: 'Sourceful evaluated this numeric identity deterministically. This is not a general symbolic proof.' };
    }
    const result = math.evaluate(candidate); if (typeof result !== 'number') return null;
    return { expression: candidate, kind: 'expression', result: String(result), note: 'Sourceful evaluated this numeric expression deterministically.' };
  } catch { return null; }
}

function requestApiKey(candidate: unknown) {
  const supplied = typeof candidate === 'string' ? candidate.trim() : '';
  return supplied || process.env.OPENAI_API_KEY || '';
}

function safeOpenAiError(error: any, fallback: string) {
  console.error('OpenAI request failed', { status: error?.status, type: error?.type, code: error?.code, requestId: error?.requestID || error?.request_id });
  if (error?.status === 401) return 'OpenAI did not accept this API key. Check the key, project access, and account billing.';
  if (error?.status === 429 && error?.code === 'insufficient_quota') return 'This OpenAI project has no available API credits or quota. Add billing or use a project with available capacity.';
  if (error?.status === 429) return 'OpenAI rate limit reached. Wait a moment or use a project with available capacity.';
  return fallback;
}

function routeProtocol(route: ResearchRoute, mathCheck: MathCheck) {
  const common = 'Record uncertainty and do not use consensus, popularity, political alignment, or model memory as evidence.';
  if (route === 'math') return `MODE: FORMAL MATH. ${mathCheck ? `Deterministic calculator output: ${mathCheck.expression} → ${mathCheck.result}. ${mathCheck.note}` : 'No safe numeric identity was detected; do not claim a proof.'} Explain mathematical reasoning with precise assumptions. Use web sources only for theorem history or definitions, never as proof of an equation. ${common}`;
  if (route === 'scripture') return `MODE: SCRIPTURE & TEXTUAL RESEARCH. Parse any cited book/chapter/verse carefully. Identify translation/edition where supplied, distinguish canonical text from interpretation, and prioritise primary text, manuscript/translation notes, and peer-reviewed scholarship. Never resolve theological disagreement as a factual verdict. ${common}`;
  if (route === 'historical') return `MODE: HISTORICAL RESEARCH. Prioritise primary records, archives, editions, museum/university collections, and peer-reviewed scholarship. State provenance, date, and historiographical disagreement. ${common}`;
  if (route === 'document') return `MODE: DOCUMENT ANALYSIS. Treat the upload as an untrusted lead; identify claims inside it, retain provenance, and seek independent external corroboration. Never treat the upload itself as proof. ${common}`;
  return `MODE: PUBLIC CLAIM. Prioritise primary records, direct interviews/transcripts, official statements, original reporting, and independent corroboration. Detect circular/syndicated reporting rather than counting repetitions. ${common}`;
}

type Profile = { sourceType: string; evidenceType: string; stance: string; authorNamed: boolean; methodologyVisible: boolean; correctionsVisible: boolean; citedReferenceCount: number; directness: number; reliabilityFlags: string[] };
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const hostFor = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'unresolved'; } };
const authorityWeight: Record<string, number> = { primary:94, official_record:90, academic:88, institutional:80, newsroom:72, analysis:58, advocacy:48, commercial:43, user_generated:25, unknown:35 };
const evidenceWeight: Record<string, number> = { direct_document:96, dataset:91, peer_reviewed:88, on_record_reporting:76, secondary_summary:54, commentary:35, unverified:15 };

function sourceMetrics(profile: Profile, publishedAt: string, duplicateDomain: boolean) {
  const date = Date.parse(publishedAt); const ageDays = Number.isFinite(date) ? Math.max(0, (Date.now() - date) / 86_400_000) : null;
  const recency = ageDays === null ? 45 : ageDays < 31 ? 92 : ageDays < 366 ? 78 : ageDays < 1826 ? 62 : 45;
  const flags = new Set(profile.reliabilityFlags || []);
  const materialRisk = flags.has('spoofed_or_impersonating') || flags.has('fabricated_citation');
  const evidenceQuality = clamp(evidenceWeight[profile.evidenceType] ?? 20);
  const transparency = clamp((profile.authorNamed ? 35 : 5) + (profile.methodologyVisible ? 35 : 0) + (profile.correctionsVisible ? 15 : 0) + Math.min(15, profile.citedReferenceCount * 3));
  return {
    metrics: { authority: clamp(authorityWeight[profile.sourceType] ?? 35), evidenceQuality, independence: duplicateDomain ? 30 : 70, recency, transparency, corroboration: 0, citationNetwork: clamp(profile.citedReferenceCount * 12), semanticDepth: clamp(profile.directness) },
    credibilityScore: clamp((authorityWeight[profile.sourceType] ?? 35) * .24 + evidenceQuality * .31 + transparency * .16 + recency * .08 + profile.directness * .21 - (materialRisk ? 45 : 0)),
    isDodgy: materialRisk,
    verificationStatus: 'checking' as const
  };
}

function evaluateResult(raw: any, route: ResearchRoute, mathCheck: MathCheck) {
  const allSources = raw.branches.flatMap((branch: any) => branch.sources);
  const domains = new Map<string, number>(); allSources.forEach((source: any) => domains.set(hostFor(source.url), (domains.get(hostFor(source.url)) || 0) + 1));
  const branches = raw.branches.map((branch: any) => {
    const enriched = branch.sources.map((source: any) => ({ ...source, citations: source.evidenceProfile.citedReferenceCount, semanticDepth: source.evidenceProfile.directness, ...sourceMetrics(source.evidenceProfile, source.publishedAt, (domains.get(hostFor(source.url)) || 0) > 1) }));
    const support = enriched.filter((s: any) => s.evidenceProfile.stance === 'supports'); const refute = enriched.filter((s: any) => s.evidenceProfile.stance === 'refutes');
    const isHighEvidence = (source: any) => source.credibilityScore >= 64 && source.metrics.evidenceQuality >= 60 && !source.isDodgy;
    const independentSupport = new Set(support.filter(isHighEvidence).map((s: any) => hostFor(s.url))).size; const independentRefute = new Set(refute.filter(isHighEvidence).map((s: any) => hostFor(s.url))).size;
    const primarySupport = support.filter((s: any) => ['primary','official_record','academic'].includes(s.evidenceProfile.sourceType) && s.metrics.evidenceQuality >= 76).length;
    const contradiction = independentSupport > 0 && independentRefute > 0;
    const formal = route === 'math' && mathCheck?.kind === 'identity';
    const status = formal ? (mathCheck?.isTrue ? 'formally_checked' : 'formally_refuted') : contradiction ? 'contested' : primarySupport >= 1 && independentSupport >= 3 ? 'corroborated' : independentSupport >= 2 ? 'provisionally_supported' : 'insufficient_evidence';
    const confidenceScore = formal ? 100 : status === 'corroborated' ? clamp(65 + primarySupport * 6 + independentSupport * 4) : status === 'provisionally_supported' ? clamp(45 + independentSupport * 8) : status === 'contested' ? clamp(42 + Math.min(16, Math.abs(independentSupport - independentRefute) * 4)) : clamp(15 + independentSupport * 10);
    const reasons = formal ? [`Numeric identity evaluated locally: ${mathCheck?.result}.`, mathCheck?.note || ''] : [primarySupport ? `${primarySupport} high-evidence primary, official, or academic source${primarySupport === 1 ? '' : 's'} found.` : 'No high-evidence primary, official, or academic source found.', `${independentSupport} independent high-evidence supporting domain${independentSupport === 1 ? '' : 's'} found.`, independentRefute ? `${independentRefute} independent high-evidence contradicting domain${independentRefute === 1 ? '' : 's'} found.` : 'No independent high-evidence contradiction extracted.'];
    enriched.forEach((s: any) => { s.metrics.corroboration = clamp((s.evidenceProfile.stance === 'supports' ? independentSupport : s.evidenceProfile.stance === 'refutes' ? independentRefute : 0) * 25); s.verificationStatus = status === 'corroborated' ? 'verified' : status === 'contested' ? 'contested' : 'checking'; });
    return { claim: branch.claim, confidenceScore, biasAnalysis: branch.biasAnalysis, verdict: status, decisionReasons: reasons, sources: enriched };
  });
  const confident = branches.filter((branch: any) => branch.verdict === 'corroborated').length;
  return { coreConcept: raw.coreConcept, confidenceScore: clamp(branches.reduce((total: number, branch: any) => total + branch.confidenceScore, 0) / Math.max(1, branches.length)), biasAnalysis: raw.biasAnalysis, researchRoute: route, evidenceStandard: route === 'math' && mathCheck ? 'Formal route: numeric identities are evaluated locally; symbolic proofs remain explicitly limited.' : `Conservative evidence gate: ${confident}/${branches.length} branch claims meet the corroboration threshold.`, branches };
}

function isPrivateAddress(address: string) {
  const candidate = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(candidate) === 4) {
    const [first, second] = candidate.split('.').map(Number);
    return first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  }
  return candidate === '::1' || candidate.startsWith('fc') || candidate.startsWith('fd') || candidate.startsWith('fe80:');
}

async function safePublicUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) return null;
  try {
    if (isIP(parsed.hostname)) return isPrivateAddress(parsed.hostname) ? null : parsed;
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    return addresses.length && addresses.every((entry) => !isPrivateAddress(entry.address)) ? parsed : null;
  } catch { return null; }
}

function openGraphImage(html: string, baseUrl: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = /(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if ((key === 'og:image' || key === 'twitter:image' || key === 'twitter:image:src') && content) {
      try { return new URL(content, baseUrl).href; } catch { return ''; }
    }
  }
  return '';
}

async function fetchSourceThumbnail(sourceUrl: string) {
  let current = await safePublicUrl(sourceUrl);
  for (let redirects = 0; current && redirects < 3; redirects++) {
    try {
      const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(4_000), headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Sourceful evidence thumbnail resolver/1.0' } });
      if (response.status >= 300 && response.status < 400) { current = await safePublicUrl(new URL(response.headers.get('location') || '', current).href); continue; }
      const length = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || length > 750_000) return '';
      const candidate = openGraphImage((await response.text()).slice(0, 750_000), current.href);
      return candidate && await safePublicUrl(candidate) ? candidate : '';
    } catch { return ''; }
  }
  return '';
}

async function enrichThumbnails(artifact: any) {
  const sources = artifact.branches.flatMap((branch: any) => branch.sources).filter((source: any) => !source.imageUrl).slice(0, 12);
  await Promise.all(sources.map(async (source: any) => { source.imageUrl = await fetchSourceThumbnail(source.url); }));
  return artifact;
}

const demoMetrics = (authority: number, evidenceQuality: number, independence: number, recency: number, transparency: number, corroboration: number, citationNetwork: number, semanticDepth: number) => ({ authority, evidenceQuality, independence, recency, transparency, corroboration, citationNetwork, semanticDepth });
function demoSource(title: string, url: string, snippet: string, credibilityScore: number, profile: Profile, metrics: any, isDodgy = false) {
  return { title, url, snippet, citedText: snippet.slice(0, Math.min(snippet.length, 92)), imageUrl: '', credibilityScore, isDodgy, author: '', publishedAt: '', citations: profile.citedReferenceCount, semanticDepth: profile.directness, verificationStatus: isDodgy ? 'checking' : 'verified', provider: 'openai_web', evidenceProfile: profile, metrics };
}
function demoInvestigation(query: string) {
  const official = { sourceType:'official_record', evidenceType:'direct_document', stance:'supports', authorNamed:true, methodologyVisible:true, correctionsVisible:true, citedReferenceCount:4, directness:94, reliabilityFlags:['none'] } as Profile;
  const institutional = { sourceType:'institutional', evidenceType:'on_record_reporting', stance:'supports', authorNamed:true, methodologyVisible:true, correctionsVisible:false, citedReferenceCount:3, directness:84, reliabilityFlags:['none'] } as Profile;
  const weak = { sourceType:'user_generated', evidenceType:'unverified', stance:'supports', authorNamed:false, methodologyVisible:false, correctionsVisible:false, citedReferenceCount:0, directness:18, reliabilityFlags:['no_supporting_material','anonymous_claim'] } as Profile;
  return { isDemo:true, coreConcept:'Guided demonstration: how Sourceful separates corroborated evidence from weak claims', confidenceScore:78, researchRoute:'historical' as const, biasAnalysis:'This is a simulated research artifact. Its source metrics and citations demonstrate the interface; they are not a live investigation or an endorsement of any external source.', evidenceStandard:'Guided demo: use it to explore the graph, dossier, briefing, library, and weak-node disintegration before connecting live APIs.', branches:[
    { claim:'A historical event can be supported by distinct primary and institutional records.', confidenceScore:91, verdict:'corroborated', biasAnalysis:'The evidence path prioritises primary records over repetition.', decisionReasons:['One official record and two independent institutional references are represented.','The sources have distinct provenance roles.'], sources:[
      demoSource('NASA Apollo 11 Mission Overview','https://www.nasa.gov/mission/apollo-11/', 'Official mission records document the Apollo 11 mission and its lunar landing.',94,official,demoMetrics(94,96,86,70,90,92,72,94)),
      demoSource('National Archives: Apollo 11','https://www.archives.gov/research/alic/reference/space-timeline.html','Archival materials preserve contemporary records of the Apollo program.',88,institutional,demoMetrics(87,84,82,62,81,88,60,82)),
      demoSource('Smithsonian National Air and Space Museum','https://airandspace.si.edu/collection-objects/command-module-apollo-11','A museum collection record identifies the Apollo 11 command module and its provenance.',86,institutional,demoMetrics(86,80,84,64,79,86,58,80))
    ]},
    { claim:'Independent corroboration is stronger than several claims copied from one weak origin.', confidenceScore:63, verdict:'provisionally_supported', biasAnalysis:'Sourceful groups evidence by provenance, not raw source count.', decisionReasons:['Multiple independent evidence roles are represented.','No inference should be made solely from the number of nodes.'], sources:[
      demoSource('Primary-record methodology note','https://www.archives.gov/research','Archival provenance helps distinguish an original record from a later repetition.',82,institutional,demoMetrics(83,79,76,60,77,72,55,82)),
      demoSource('Documentation provenance guide','https://www.loc.gov/research-centers/','Research collections describe the importance of source provenance and context.',80,institutional,demoMetrics(81,76,78,59,76,70,52,78))
    ]},
    { claim:'An anonymous viral assertion alone is sufficient to overturn documented evidence.', confidenceScore:19, verdict:'insufficient_evidence', biasAnalysis:'Unsupported assertions should be kept visible as leads, not treated as evidence.', decisionReasons:['No attributable source, method, or supporting material is present.','This trace is intentionally eligible for disintegration.'], sources:[
      demoSource('Anonymous reposted claim (simulated weak trace)','https://example.invalid/unverified-claim','An unattributed assertion offers no source material or method that can be checked.',24,weak,demoMetrics(18,14,24,20,5,0,0,18),true)
    ]}
  ], query };
}

async function getGeminiResearch(query: string) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Google-grounded cross-check is enabled, but GEMINI_API_KEY is not set.');
  const prompt = `Act as an evidence scout for Sourceful. Use Google Search to find diverse, high-quality primary and independent reporting relevant to this query. Return a concise plain-text research packet: source title, URL, factual excerpt or finding, publisher, date when known, and why it is useful. Include uncertainty and conflicts. Do not give a final verdict. Query: ${query}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }) });
  if (!response.ok) throw new Error(`Google-grounded cross-check failed (${response.status}).`);
  const data: any = await response.json(); const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((part: any) => part.text || '').join('\n') || '';
  const citations = (candidate?.groundingMetadata?.groundingChunks || []).map((chunk: any) => chunk.web?.uri ? `- ${chunk.web.title || 'Google Search result'}: ${chunk.web.uri}` : '').filter(Boolean).join('\n');
  if (!text && !citations) throw new Error('Google-grounded cross-check returned no usable evidence.');
  return `${text}\n\nGoogle-grounded citation trail (use only as leads; verify independently):\n${citations}`.slice(0, 24000);
}

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now(); const client = req.ip || req.socket.remoteAddress || 'unknown'; const key = `${req.path}:${client}`;
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) { rateBuckets.set(key, { count: 1, resetAt: now + windowMs }); return next(); }
    if (current.count >= maxRequests) { res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000)); return res.status(429).json({ error: 'Research request limit reached. Please wait a few minutes before trying again.' }); }
    current.count += 1; return next();
  };
}

function applySecurityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return next();
}

async function startServer() {
  const app = express(); const PORT = Number(process.env.PORT || 3000);
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(applySecurityHeaders);
  app.use(express.json({ limit: '1mb' }));
  app.post('/api/summarize', rateLimit(16, 10 * 60_000), async (req, res) => {
    const artifact = req.body?.artifact; const model = String(req.body?.model || 'gpt-5.6-terra');
    if (!artifact?.coreConcept || !Array.isArray(artifact?.branches)) return res.status(400).json({ error: 'A saved Sourceful artifact is required.' });
    if (!modelRoster.has(model)) return res.status(400).json({ error: 'Unsupported Sourceful model.' });
    if (artifact?.isDemo) return res.json({ summary: 'Guided demo briefing\n\nSourceful has separated a corroborated historical evidence path from a merely repeated assertion. Inspect each dossier to see why source roles, directness, and provenance matter. The final weak trace is intentionally low-credibility: use Disintegrate weak trace to remove it from the active graph, then save the resulting research artifact to the local library.' });
    const apiKey = requestApiKey(req.body?.apiKey);
    if (!apiKey) return res.status(401).json({ error: 'Connect an OpenAI API key in Sourceful’s API vault, or configure OPENAI_API_KEY on the server.' });
    try {
      const client = new OpenAI({ apiKey });
      const response = await client.responses.create({ model, input: `Write a concise, careful research briefing from this Sourceful artifact. Preserve uncertainty, never add facts, identify contested or insufficient claims, and distinguish formal mathematical checks from source corroboration. Use short headings and plain text, no markdown tables.\n\n${JSON.stringify(artifact).slice(0, 80000)}` });
      return res.json({ summary: response.output_text });
    } catch (error: any) { return res.status(502).json({ error: safeOpenAiError(error, 'Summary service unavailable.') }); }
  });
  app.post('/api/verify', rateLimit(12, 10 * 60_000), upload.single('file'), async (req, res) => {
    const text = String(req.body?.text || '').trim(); const model = String(req.body?.model || 'gpt-5.6-terra'); const requestedMode = String(req.body?.researchMode || 'auto'); const useDemo = String(req.body?.demo || '') === 'true'; const useGoogleCrosscheck = String(req.body?.googleCrosscheck || '') === 'true'; const file = req.file;
    if (!text && !file) return res.status(400).json({ error: 'Text or file is required.' });
    if (!modelRoster.has(model)) return res.status(400).json({ error: 'Unsupported Sourceful model.' });
    if (!researchModes.has(requestedMode)) return res.status(400).json({ error: 'Unsupported research mode.' });
    if (useDemo) return res.json(demoInvestigation(text));
    const apiKey = requestApiKey(req.body?.apiKey);
    if (!apiKey) return res.status(401).json({ error: 'Connect an OpenAI API key in Sourceful’s API vault, or configure OPENAI_API_KEY on the server.' });
    try {
      const client = new OpenAI({ apiKey });
      const route = await chooseResearchRoute(text, requestedMode, Boolean(file), client, model); const mathCheck = route === 'math' ? checkNumericMath(text) : null;
      const googleResearch = useGoogleCrosscheck ? await getGeminiResearch(text || `Assess the attached file: ${file?.originalname || 'uploaded research lead'}`) : '';
      const content: any[] = [{ type: 'input_text', text: `${text}\n\n--- Sourceful research protocol ---\n${routeProtocol(route, mathCheck)}\n\n--- Adaptive evidence-graph scope ---\n${adaptiveGraphInstruction}${file?.mimetype.startsWith('text/') ? `\n\nAttached research lead (${file.originalname}):\n${file.buffer.toString('utf8').slice(0, 18000)}` : ''}${googleResearch ? `\n\n--- Google-grounded cross-check packet ---\n${googleResearch}` : ''}` }];
      if (file?.mimetype.startsWith('image/')) content.push({ type: 'input_image', image_url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` });
      const response = await client.responses.create({ model, instructions, input: [{ role: 'user', content }], tools: [{ type: 'web_search' as any }], text: { format: { type: 'json_schema', ...schema } } } as any);
      return res.json(await enrichThumbnails(evaluateResult(JSON.parse(response.output_text), route, mathCheck)));
    } catch (error: any) { return res.status(502).json({ error: safeOpenAiError(error, 'Verification service unavailable.') }); }
  });
  if (process.env.NODE_ENV !== 'production') { const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
  else { const distPath = path.join(process.cwd(), 'dist'); app.use(express.static(distPath)); app.get('*', (_req,res) => res.sendFile(path.join(distPath, 'index.html'))); }
  app.listen(PORT, '0.0.0.0', () => console.log(`Sourceful on http://localhost:${PORT}`));
}
startServer();
