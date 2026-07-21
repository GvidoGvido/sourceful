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

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });
const modelRoster = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const researchModes = new Set(['auto', 'public_claim', 'historical', 'scripture', 'math', 'document']);
const math = create(all, { number: 'number', precision: 64 });
const sourceProfile = { type: 'object', additionalProperties: false, required: ['sourceType','evidenceType','stance','authorNamed','methodologyVisible','correctionsVisible','citedReferenceCount','directness','reliabilityFlags'], properties: {
  sourceType:{type:'string',enum:['primary','official_record','academic','institutional','newsroom','analysis','advocacy','commercial','user_generated','unknown']},
  evidenceType:{type:'string',enum:['direct_document','dataset','peer_reviewed','on_record_reporting','secondary_summary','commentary','unverified']},
  stance:{type:'string',enum:['supports','refutes','context','unclear']}, authorNamed:{type:'boolean'}, methodologyVisible:{type:'boolean'}, correctionsVisible:{type:'boolean'}, citedReferenceCount:{type:'integer',minimum:0,maximum:20}, directness:{type:'integer',minimum:0,maximum:100}, reliabilityFlags:{type:'array',items:{type:'string',enum:['none','unattributed','anonymous_claim','no_supporting_material','spoofed_or_impersonating','fabricated_citation','conflict_not_disclosed']}}
} };
const sourceRecord = { type:'object', additionalProperties:false, required:['title','url','snippet','citedText','imageUrl','author','publishedAt','provider','evidenceProfile'], properties:{title:{type:'string'},url:{type:'string'},snippet:{type:'string'},citedText:{type:'string'},imageUrl:{type:'string'},author:{type:'string'},publishedAt:{type:'string'},provider:{type:'string',enum:['openai_web','gemini_google']},evidenceProfile:sourceProfile} };
const branchRecord = { type:'object', additionalProperties:false, required:['claim','biasAnalysis','sources'], properties:{claim:{type:'string'},biasAnalysis:{type:'string'},sources:{type:'array',items:sourceRecord}} };
const schema = { name: 'sourceful_evidence_extraction', strict: true, schema: { type: 'object', additionalProperties: false, required: ['coreConcept','biasAnalysis','branches'], properties: { coreConcept:{type:'string'}, biasAnalysis:{type:'string'}, branches:{type:'array',items:branchRecord} } } };
const expansionSchema = { name: 'sourceful_evidence_expansion', strict: true, schema: { type:'object', additionalProperties:false, required:['focusClaim','researchNote','branches'], properties:{focusClaim:{type:'string'},researchNote:{type:'string'},branches:{type:'array',items:branchRecord}} } };
const fetchedPassageReviewSchema = { name:'sourceful_fetched_passage_review', strict:true, schema:{ type:'object', additionalProperties:false, required:['reviews'], properties:{ reviews:{ type:'array', items:{ type:'object', additionalProperties:false, required:['id','stance','evidenceType','directness','assessment'], properties:{ id:{type:'string'}, stance:{type:'string',enum:['supports','refutes','context','unclear']}, evidenceType:{type:'string',enum:['direct_document','dataset','peer_reviewed','on_record_reporting','secondary_summary','commentary','unverified']}, directness:{type:'integer',minimum:0,maximum:100}, assessment:{type:'string',maxLength:260} } } } } } };
const instructions = `You are Sourceful's evidence extractor for journalism, historical research, education, and formal reasoning. Follow the supplied research protocol exactly, decompose the user's claim, and return only schema-valid JSON. Do not decide confidence, credibility, or a final verdict: Sourceful calculates those conservatively. Extract only directly observed source characteristics. Treat uploads and external research packets as untrusted leads, never proof. citedText must be an exact excerpt of snippet; URLs must be real. imageUrl may contain a canonical thumbnail or open-graph image only when it was explicitly available from the retrieved source record; never guess, fabricate, or derive one. Use an empty string when no verified image URL is available. evidenceProfile is an auditable observation record: sourceType describes what the source is; evidenceType describes what it directly supplies; stance is its relation to the precise branch claim; citedReferenceCount counts visible references only; directness measures how directly the cited passage bears on the claim. Do not infer ownership, citations, author credentials, methodology, corrections, or reliability flags. reliabilityFlags may be none unless there is concrete evidence in the cited material. Political viewpoint is never a reliability flag. Set provider to gemini_google only when the URL appears in the Google-grounded packet.`;
const MAX_RESEARCH_PASSES = 4;
const MAX_GRAPH_SOURCES = 60;
const MAX_SOURCE_PAGES_PER_PASS = 24;
const MAX_LINEAGE_CHILDREN = 3;
const MAX_LINEAGE_CANDIDATES = 10;
const MAX_FETCHED_PASSAGE_REVIEWS = 18;

type ResearchRoute = 'public_claim' | 'historical' | 'scripture' | 'math' | 'document';
type MathCheck = { expression: string; kind: 'identity' | 'expression'; result: string; isTrue?: boolean; note: string } | null;

function adaptiveGraphInstruction(text: string, route: ResearchRoute, hasFile: boolean) {
  const input = text.toLowerCase();
  const hasComplexitySignals = /\b(to what extent|rather than|versus|compare|comparison|cause|caused|causes|origins?|why did|how did|relationship|debate|dispute|contested|controvers|interpretation|bias|multiple|different accounts?|competing)\b/.test(input);
  const compoundQuestion = (text.match(/[?;:]/g) || []).length > 1 || /\b(and|or)\b/.test(input) && text.trim().split(/\s+/).length > 18;
  const complex = hasFile || route === 'historical' || route === 'scripture' || route === 'document' || hasComplexitySignals || compoundQuestion;
  const narrow = route === 'math' || (!complex && text.trim().split(/\s+/).length <= 14 && /^(who|when|where|what|which|is|was|did|does|can)\b/i.test(text.trim()));
  const target = route === 'math'
    ? 'For a numeric or formal maths request, create one formal-check branch and add only genuinely useful definition, assumption, or history branches; do not inflate a solvable equation into a web-research graph.'
    : narrow
      ? 'This is a narrow, likely-settled request. Return 2–4 genuinely distinct branches, with 1–3 source traces per branch only where they add distinct evidence.'
      : complex
        ? 'This is a complex, contested, interpretive, historical, scripture, or document-led request. Aim for 6–10 materially distinct branches when evidence supports that scope, with an uneven 1–5 source traces per branch.'
        : 'This is an ordinary public claim. Aim for 4–6 materially distinct branches, with an uneven 1–5 source traces per branch.';
  return `Build a structured evidence dossier, not a minimal answer. First search broadly to map the question; then run separate targeted searches for primary or authoritative material, independent corroboration, and the strongest credible counterevidence. Use multiple web searches when the subject is not trivially settled. ${target} A branch may have one source only when research found no credible second path; say why in its biasAnalysis rather than padding the graph. Never default to a symmetrical grid such as three branches with three sources each: graph size and branch depth must follow the actual evidence. A well-supported primary-event branch may need several independent traces; a weak, disputed, or narrow branch may correctly contain one. Do not make branches for trivia, synonyms, or repeated reporting. For every contested claim, seek the strongest credible support, refutation, and essential context; label each source's stance precisely. Repetition, syndication, and commentary must not substitute for an independent source.`;
}

const supportedUploadExtensions = new Set(['.txt', '.md', '.csv', '.json', '.pdf', '.docx', '.rtf', '.png', '.jpg', '.jpeg', '.webp']);
const textUploadExtensions = new Set(['.txt', '.md', '.csv', '.json']);
function uploadExtension(file: Express.Multer.File) { return path.extname(file.originalname || '').toLowerCase(); }
function isSupportedUpload(file: Express.Multer.File) { return supportedUploadExtensions.has(uploadExtension(file)); }
function isTextUpload(file: Express.Multer.File) { return textUploadExtensions.has(uploadExtension(file)) || file.mimetype.startsWith('text/'); }
function uploadDataUrl(file: Express.Multer.File) { return `data:${file.mimetype || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`; }

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
    // Support strength is intentionally separate from confidence. It is a visual routing signal:
    // the directness and quality of evidence that supports this branch, moderated by counterevidence.
    const evidenceSignal = (items: any[]) => items.length ? items.reduce((total, source) => total + source.evidenceProfile.directness * .54 + source.metrics.evidenceQuality * .28 + source.credibilityScore * .18, 0) / items.length : 0;
    const supportSignal = evidenceSignal(support); const refuteSignal = evidenceSignal(refute);
    const supportStrength = formal ? (mathCheck?.isTrue ? 100 : 0) : clamp(supportSignal * .74 + Math.min(16, independentSupport * 5) + Math.min(8, primarySupport * 4) - refuteSignal * .24);
    const reasons = formal ? [`Numeric identity evaluated locally: ${mathCheck?.result}.`, mathCheck?.note || ''] : [primarySupport ? `${primarySupport} high-evidence primary, official, or academic source${primarySupport === 1 ? '' : 's'} found.` : 'No high-evidence primary, official, or academic source found.', `${independentSupport} independent high-evidence supporting domain${independentSupport === 1 ? '' : 's'} found.`, independentRefute ? `${independentRefute} independent high-evidence contradicting domain${independentRefute === 1 ? '' : 's'} found.` : 'No independent high-evidence contradiction extracted.'];
    enriched.forEach((s: any) => { s.metrics.corroboration = clamp((s.evidenceProfile.stance === 'supports' ? independentSupport : s.evidenceProfile.stance === 'refutes' ? independentRefute : 0) * 25); s.verificationStatus = status === 'corroborated' ? 'verified' : status === 'contested' ? 'contested' : 'checking'; });
    return { claim: branch.claim, confidenceScore, supportStrength, biasAnalysis: branch.biasAnalysis, verdict: status, decisionReasons: reasons, sources: enriched };
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

type DiscoveryPacket = { packet: string; connectors: string[] };

function connectorQuery(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 360);
}

function scalarText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.map(scalarText).filter(Boolean) : [];
}

function connectorUrl(base: string, parameters: Record<string, string>) {
  const url = new URL(base);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.href;
}

/**
 * These metadata endpoints are deliberately fixed, bounded public connectors. User text is only
 * ever passed as a URL-encoded query. Results are discovery leads for the web-search model, not
 * evidence or automatically emitted sources.
 */
async function fetchTrustedJson(url: string) {
  let current = await safePublicUrl(url);
  for (let redirects = 0; current && redirects < 3; redirects++) {
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3_600),
        headers: { accept: 'application/json', 'user-agent': 'Sourceful route discovery/1.0' }
      });
      if (response.status >= 300 && response.status < 400) { current = await safePublicUrl(new URL(response.headers.get('location') || '', current).href); continue; }
      const length = Number(response.headers.get('content-length') || 0);
      if (!response.ok || length > 1_100_000 || !response.headers.get('content-type')?.includes('json')) return null;
      const body = await response.text();
      return body.length <= 1_100_000 ? JSON.parse(body) : null;
    } catch { return null; }
  }
  return null;
}

function scholarlyLead(title: unknown, url: unknown, authors: unknown, date: unknown, venue: unknown) {
  const cleanTitle = scalarText(title); const cleanUrl = scalarText(url);
  if (!cleanTitle || !cleanUrl || !/^https?:\/\//.test(cleanUrl)) return '';
  const details = [scalarText(authors), scalarText(date), scalarText(venue)].filter(Boolean).join(' · ');
  return `- ${cleanTitle}${details ? ` (${details})` : ''}\n  ${cleanUrl}`;
}

function shouldConsultScienceIndex(query: string) {
  return /\b(study|studies|science|scientific|clinical|health|medical|medicine|disease|vaccine|biology|chemistry|physics|climate|emission|psychology|trial|meta-analysis)\b/i.test(query);
}

function shouldConsultDataCatalog(query: string) {
  return /\b(dataset|data set|statistics?|census|economic|economy|population|employment|crime|budget|official figures?|indicator|rate|survey)\b/i.test(query);
}

async function routeSpecificDiscovery(query: string, route: ResearchRoute): Promise<DiscoveryPacket> {
  const lookupQuery = connectorQuery(query);
  if (!lookupQuery || route === 'math') return { packet: '', connectors: [] };
  const jobs: { name: string; run: () => Promise<string[]> }[] = [
    {
      name: 'OpenAlex scholarly index',
      run: async () => {
        const data: any = await fetchTrustedJson(connectorUrl('https://api.openalex.org/works', { search: lookupQuery, 'per-page': '5', select: 'id,doi,title,publication_year,authorships,primary_location' }));
        return (data?.results || []).map((work: any) => scholarlyLead(work.title, work.doi || work.primary_location?.landing_page_url || work.id, (Array.isArray(work.authorships) ? work.authorships : []).slice(0, 3).map((entry: any) => entry.author?.display_name).filter(Boolean).join(', '), work.publication_year ? String(work.publication_year) : '', work.primary_location?.source?.display_name || '')).filter(Boolean);
      }
    },
    {
      name: 'Crossref works index',
      run: async () => {
        const data: any = await fetchTrustedJson(connectorUrl('https://api.crossref.org/works', { 'query.bibliographic': lookupQuery, rows: '5', select: 'DOI,title,URL,published-print,published-online,author,container-title,type' }));
        return (data?.message?.items || []).map((work: any) => {
          const dateParts = work['published-print']?.['date-parts']?.[0] || work['published-online']?.['date-parts']?.[0] || [];
          const authors = (work.author || []).slice(0, 3).map((author: any) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean).join(', ');
          return scholarlyLead(textList(work.title)[0], work.URL || (work.DOI ? `https://doi.org/${work.DOI}` : ''), authors, dateParts.join('-'), textList(work['container-title'])[0] || work.type);
        }).filter(Boolean);
      }
    }
  ];
  if (route === 'historical' || route === 'scripture' || route === 'document') jobs.push({
    name: 'Library of Congress collections',
    run: async () => {
      const data: any = await fetchTrustedJson(connectorUrl('https://www.loc.gov/search/', { q: lookupQuery, fo: 'json', c: '5' }));
      return (data?.results || []).map((record: any) => scholarlyLead(record.title, record.id || record.url, textList(record.contributor).slice(0, 2).join(', '), record.date || '', textList(record.original_format)[0] || 'Library of Congress record')).filter(Boolean);
    }
  });
  if (shouldConsultScienceIndex(lookupQuery)) jobs.push({
    name: 'Europe PMC research index',
    run: async () => {
      const data: any = await fetchTrustedJson(connectorUrl('https://www.ebi.ac.uk/europepmc/webservices/rest/search', { query: lookupQuery, format: 'json', pageSize: '5', resultType: 'core' }));
      return (data?.resultList?.result || []).map((record: any) => scholarlyLead(record.title, record.doi ? `https://doi.org/${record.doi}` : record.pmid ? `https://europepmc.org/article/MED/${record.pmid}` : '', record.authorString, record.pubYear, record.journalTitle)).filter(Boolean);
    }
  });
  if (shouldConsultDataCatalog(lookupQuery)) jobs.push({
    name: 'Data.gov official dataset catalog',
    run: async () => {
      const data: any = await fetchTrustedJson(connectorUrl('https://catalog.data.gov/api/3/action/package_search', { q: lookupQuery, rows: '5' }));
      return (data?.result?.results || []).map((record: any) => scholarlyLead(record.title, record.url || record.resources?.[0]?.url, record.organization?.title || record.author, record.metadata_created?.slice(0, 10), 'official dataset catalog')).filter(Boolean);
    }
  });
  const settled = await Promise.all(jobs.map(async (job) => ({ name: job.name, leads: await job.run().catch(() => []) })));
  const usable = settled.filter((result) => result.leads.length);
  if (!usable.length) return { packet: '', connectors: [] };
  return {
    connectors: usable.map((result) => result.name),
    packet: `Route-specific discovery metadata (untrusted leads; open the original record and verify it with web search before using it as evidence):\n${usable.map((result) => `\n${result.name}\n${result.leads.join('\n')}`).join('\n').slice(0, 17_000)}`
  };
}

function openGraphImages(html: string, baseUrl: string) {
  const images = new Set<string>();
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = /(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if ((key === 'og:image' || key === 'twitter:image' || key === 'twitter:image:src') && content) {
      try { images.add(new URL(content, baseUrl).href); } catch { /* Ignore malformed metadata. */ }
    }
  }
  return [...images].slice(0, 4);
}

function decodedVisibleText(html: string) {
  const description = /<meta\b[^>]*(?:name|property)\s*=\s*["']?(?:description|og:description)["']?[^>]*content\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] || '';
  const withoutNonContent = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const visible = withoutNonContent.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
  return `${description} ${visible}`.replace(/\s+/g, ' ').trim().slice(0, 42_000);
}

const claimStopWords = new Set(['about','after','against','also','among','because','been','being','between','could','does','from','have','into','more','most','only','other','over','said','some','such','than','that','their','there','these','they','this','those','through','under','very','was','were','what','when','which','while','with','would','your']);
function claimTerms(claim: string) {
  return [...new Set((claim.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || []).filter((term) => !claimStopWords.has(term)))].slice(0, 18);
}
function alignClaimExtract(pageText: string, claim: string) {
  const terms = claimTerms(claim); if (!pageText || terms.length < 1) return null;
  const sentences = pageText.match(/[^.!?]{50,620}[.!?]+/g) || [];
  let best = ''; let bestTerms: string[] = []; let bestScore = 0;
  for (const sentence of sentences.slice(0, 180)) {
    const lowered = sentence.toLowerCase(); const matches = terms.filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lowered));
    const score = matches.reduce((total, term) => total + Math.min(1.9, term.length / 5), 0) + (matches.length >= 3 ? 1.4 : 0);
    if (matches.length >= 2 && score > bestScore) { best = sentence.trim(); bestTerms = matches; bestScore = score; }
  }
  if (!best || bestTerms.length < 2) return null;
  const focus = bestTerms.sort((left, right) => right.length - left.length)[0];
  const words = best.match(/\S+/g) || []; const focusIndex = Math.max(0, words.findIndex((word) => word.toLowerCase().replace(/[^a-z0-9'-]/g, '').includes(focus)));
  const citedText = words.slice(Math.max(0, focusIndex - 2), Math.min(words.length, focusIndex + 5)).join(' ');
  return { snippet: best.slice(0, 620), citedText: citedText || focus, matches: bestTerms.slice(0, 6) };
}

function canonicalSourceUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.href;
  } catch { return ''; }
}

function observedPublicLinks(html: string, baseUrl: string) {
  const links = new Set<string>();
  const tags = html.match(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi) || [];
  for (const tag of tags) {
    const match = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
    const rawHref = match?.[1] || match?.[2] || match?.[3] || '';
    if (!rawHref || rawHref.startsWith('#') || /^(?:mailto:|tel:|javascript:|data:)/i.test(rawHref)) continue;
    try {
      const target = canonicalSourceUrl(new URL(rawHref, baseUrl).href);
      if (target) links.add(target);
    } catch { /* Ignore malformed outbound links. */ }
  }
  return [...links].slice(0, 180);
}

function observedActiveLinks(html: string, baseUrl: string, activeSources: Map<string, string>) {
  return observedPublicLinks(html, baseUrl).map((target) => activeSources.get(target)).filter((target): target is string => Boolean(target));
}

const ignoredReferenceHosts = new Set(['facebook.com','twitter.com','x.com','instagram.com','linkedin.com','youtube.com','tiktok.com','pinterest.com','google.com','googleusercontent.com','doubleclick.net','googletagmanager.com']);

type ObservedReference = { url: string; label: string; reason: string; priority: number };

function decodeHtmlFragment(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}

function observedReferenceCandidates(html: string, baseUrl: string) {
  const originHost = hostFor(baseUrl); const candidates = new Map<string, ObservedReference>();
  const anchors = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]{0,1200}?)<\/a>/gi;
  for (let match = anchors.exec(html); match; match = anchors.exec(html)) {
    const rawHref = match[1] || match[2] || match[3] || '';
    if (!rawHref || rawHref.startsWith('#') || /^(?:mailto:|tel:|javascript:|data:)/i.test(rawHref)) continue;
    let url = '';
    try { url = canonicalSourceUrl(new URL(rawHref, baseUrl).href); } catch { continue; }
    if (!url) continue;
    const host = hostFor(url); if (host === originHost || ignoredReferenceHosts.has(host)) continue;
    const label = decodeHtmlFragment(match[4] || '').slice(0, 180);
    const nearby = decodeHtmlFragment(html.slice(Math.max(0, match.index - 240), Math.min(html.length, match.index + match[0].length + 180)));
    const signal = `${label} ${nearby}`.toLowerCase();
    if (/\b(privacy|cookie|terms|subscribe|sign in|log in|advertis|donate|shop)\b/.test(signal)) continue;
    const referenceSignal = /\b(source|reference|citation|bibliograph|footnote|note|report|study|paper|journal|document|archive|dataset|evidence|doi|full text|original)\b/.test(signal);
    const priority = (referenceSignal ? 5 : 0) + (/(?:doi\.org|arxiv\.org|\.gov\b|\.edu\b)/.test(host) ? 3 : 0) + (label.length > 8 ? 1 : 0);
    if (!referenceSignal && priority < 3) continue;
    const existing = candidates.get(url);
    if (!existing || priority > existing.priority) candidates.set(url, { url, label: label || host, reason: referenceSignal ? 'reference-labelled outbound link' : 'institutional or scholarly outbound link', priority });
  }
  return [...candidates.values()].sort((left, right) => right.priority - left.priority || left.url.localeCompare(right.url)).slice(0, MAX_LINEAGE_CANDIDATES);
}

function metaValue(html: string, names: string[]) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = /(?:name|property)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase() || '';
    if (!names.includes(name)) continue;
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (content) return decodeHtmlFragment(content).slice(0, 320);
  }
  return '';
}

function pageTitle(html: string, fallbackUrl: string) {
  return metaValue(html, ['og:title','twitter:title']) || decodeHtmlFragment(/<title\b[^>]*>([\s\S]{0,500}?)<\/title>/i.exec(html)?.[1] || '') || hostFor(fallbackUrl);
}

function lineageSourceType(url: string): Profile['sourceType'] {
  const host = hostFor(url);
  if (host.endsWith('.gov') || host.endsWith('.gov.uk') || host.endsWith('.europa.eu')) return 'official_record';
  if (host.endsWith('.edu') || host === 'doi.org' || host.endsWith('.doi.org') || host === 'arxiv.org') return 'academic';
  if (/archive|museum|library|archives/.test(host)) return 'institutional';
  return 'unknown';
}

async function fetchObservedLineage(parentUrl: string, claim: string, knownUrls: Set<string>, availableSlots: number) {
  if (availableSlots < 1) return [];
  let current = await safePublicUrl(parentUrl);
  let references: ObservedReference[] = [];
  for (let redirects = 0; current && redirects < 3; redirects++) {
    try {
      const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(4_000), headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Sourceful bounded provenance tracer/1.0' } });
      if (response.status >= 300 && response.status < 400) { current = await safePublicUrl(new URL(response.headers.get('location') || '', current).href); continue; }
      const length = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || length > 750_000) return [];
      references = observedReferenceCandidates((await response.text()).slice(0, 750_000), current.href).filter((reference) => !knownUrls.has(canonicalSourceUrl(reference.url)));
      break;
    } catch { return []; }
  }
  const fetched = await Promise.all(references.map(async (reference) => {
    let target = await safePublicUrl(reference.url);
    for (let redirects = 0; target && redirects < 3; redirects++) {
      try {
        const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(4_000), headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Sourceful bounded provenance tracer/1.0' } });
        if (response.status >= 300 && response.status < 400) { target = await safePublicUrl(new URL(response.headers.get('location') || '', target).href); continue; }
        const length = Number(response.headers.get('content-length') || 0);
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || length > 750_000) return null;
        const html = (await response.text()).slice(0, 750_000); const pageText = decodedVisibleText(html); const aligned = alignClaimExtract(pageText, claim);
        // A lineage node is only shown when the fetched page itself contains a meaningful recovered claim passage.
        if (!aligned) return null;
        const profile: Profile = { sourceType:lineageSourceType(target.href), evidenceType:'secondary_summary', stance:'context', authorNamed:Boolean(metaValue(html, ['author','article:author'])), methodologyVisible:false, correctionsVisible:false, citedReferenceCount:0, directness:clamp(22 + aligned.matches.length * 14), reliabilityFlags:['none'] };
        const visuals = (await Promise.all(openGraphImages(html, target.href).map(async (candidate) => (await safePublicUrl(candidate))?.href || ''))).filter(Boolean);
        return { title:pageTitle(html, target.href), url:target.href, snippet:aligned.snippet, citedText:aligned.citedText, imageUrl:visuals[0] || '', imageUrls:visuals.slice(0, 4), author:metaValue(html, ['author','article:author']), publishedAt:metaValue(html, ['article:published_time','date','datepublished']).slice(0, 30), citations:0, semanticDepth:profile.directness, claimMatches:aligned.matches, contentInspected:true, provider:'sourceful_lineage' as const, isLineageLead:true, lineageNote:`Observed ${reference.reason} from ${hostFor(parentUrl)}. This is a provenance lead and is excluded from claim scoring.`, evidenceProfile:profile, ...sourceMetrics(profile, '', false) };
      } catch { return null; }
    }
    return null;
  }));
  return fetched.filter(Boolean).slice(0, Math.min(MAX_LINEAGE_CHILDREN, availableSlots));
}

function referenceFingerprint(value: string, baseUrl: string) {
  try {
    const target = new URL(value); const origin = new URL(baseUrl);
    const host = target.hostname.replace(/^www\./, '').toLowerCase();
    if (!host || host === origin.hostname.replace(/^www\./, '').toLowerCase() || ignoredReferenceHosts.has(host)) return '';
    const cleanPath = decodeURIComponent(target.pathname).replace(/\/+$/, '').slice(0, 170);
    if (!cleanPath || cleanPath === '/') return '';
    if (host === 'doi.org' || host.endsWith('.doi.org')) return `doi:${cleanPath.replace(/^\//, '').toLowerCase()}`;
    return `url:${host}${cleanPath.toLowerCase()}`;
  } catch { return ''; }
}

function observedCitationFingerprints(html: string, baseUrl: string) {
  return [...new Set(observedPublicLinks(html, baseUrl).map((value) => referenceFingerprint(value, baseUrl)).filter(Boolean))].slice(0, 40);
}

type SourceSnapshot = { imageUrls: string[]; pageText: string; outboundActiveUrls: string[]; referenceFingerprints: string[]; inspected: boolean };

async function fetchSourceSnapshot(sourceUrl: string, activeSources: Map<string, string>): Promise<SourceSnapshot> {
  let current = await safePublicUrl(sourceUrl);
  for (let redirects = 0; current && redirects < 3; redirects++) {
    try {
      const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(4_000), headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Sourceful evidence thumbnail resolver/1.0' } });
      if (response.status >= 300 && response.status < 400) { current = await safePublicUrl(new URL(response.headers.get('location') || '', current).href); continue; }
      const length = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || length > 750_000) return { imageUrls:[], pageText:'', outboundActiveUrls:[], referenceFingerprints:[], inspected:true };
      const html = (await response.text()).slice(0, 750_000);
      const imageUrls = (await Promise.all(openGraphImages(html, current.href).map(async (candidate) => (await safePublicUrl(candidate))?.href || ''))).filter(Boolean);
      return { imageUrls, pageText: decodedVisibleText(html), outboundActiveUrls: observedActiveLinks(html, current.href, activeSources), referenceFingerprints: observedCitationFingerprints(html, current.href), inspected:true };
    } catch { return { imageUrls:[], pageText:'', outboundActiveUrls:[], referenceFingerprints:[], inspected:true }; }
  }
  return { imageUrls:[], pageText:'', outboundActiveUrls:[], referenceFingerprints:[], inspected:true };
}

function provenanceClusters(artifact: any) {
  const groups = new Map<string, string[]>();
  artifact.branches.flatMap((branch: any) => branch.sources).forEach((source: any) => {
    const host = hostFor(source.url);
    if (host === 'unresolved') return;
    groups.set(host, [...(groups.get(host) || []), source.url]);
  });
  return [...groups.entries()].filter(([, urls]) => urls.length > 1).map(([host, urls]) => ({ id:`publisher:${host}`, label:`Shared publisher path · ${host}`, sourceUrls:[...new Set(urls)], basis:'publisher' as const }));
}

function citationProvenanceClusters(artifact: any) {
  const groups = new Map<string, string[]>();
  artifact.branches.flatMap((branch: any) => branch.sources).forEach((source: any) => {
    for (const fingerprint of source.citationFingerprints || []) groups.set(fingerprint, [...(groups.get(fingerprint) || []), source.url]);
  });
  return [...groups.entries()]
    .map(([fingerprint, urls]) => [fingerprint, [...new Set(urls)]] as const)
    .filter(([, urls]) => urls.length > 1)
    .slice(0, 18)
    .map(([fingerprint, urls]) => ({ id:`citation:${fingerprint}`, label:`Shared cited reference · ${fingerprint.replace(/^(?:doi:|url:)/, '').slice(0, 92)}`, sourceUrls:urls, basis:'cited_reference' as const }));
}

function provenanceComponents(sources: any[], clusters: any[]) {
  const parent = new Map<string, string>();
  const find = (value: string): string => { const current = parent.get(value) || value; if (current === value) return current; const root = find(current); parent.set(value, root); return root; };
  const join = (left: string, right: string) => { const a = find(left); const b = find(right); if (a !== b) parent.set(b, a); };
  sources.forEach((source) => { const key = canonicalSourceUrl(source.url); if (key) parent.set(key, key); });
  clusters.forEach((cluster) => {
    const keys = (cluster.sourceUrls || []).map(canonicalSourceUrl).filter(Boolean);
    keys.slice(1).forEach((key: string) => join(keys[0], key));
  });
  const members = new Map<string, string[]>();
  [...parent.keys()].forEach((key) => { const root = find(key); members.set(root, [...(members.get(root) || []), key]); });
  const groupName = new Map<string, string>();
  [...members.entries()].forEach(([root, urls], index) => groupName.set(root, urls.length > 1 ? `Shared provenance path ${index + 1} · ${urls.length} traces` : `Independent path ${index + 1}`));
  return new Map([...parent.keys()].map((key) => [key, groupName.get(find(key)) || 'Independent path']));
}

function claimRelevance(source: any, claim: string) {
  const terms = claimTerms(claim); if (!terms.length) return 40;
  const inspectedTerms = (source.claimMatches || []).map((term: string) => term.toLowerCase());
  const text = `${source.citedText || ''} ${source.snippet || ''}`.toLowerCase();
  const matched = new Set([...inspectedTerms, ...terms.filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))]);
  return clamp(18 + (Math.min(terms.length, matched.size) / terms.length) * 82);
}

// The extractor's first-pass directness observation is useful, but it must not be
// shown as a free-standing score. Once a page has been inspected, cap it by the
// actual overlap between the active claim and the recovered passage. This keeps a
// polished but tangential source from looking "direct" merely because it was
// initially described that way by the model.
function calibratedDirectness(source: any, relevance: number) {
  const observed = clamp(source.evidenceProfile?.directness ?? source.metrics?.semanticDepth ?? 40);
  const recoveredTerms = new Set((source.claimMatches || []).map((term: string) => String(term).toLowerCase())).size;
  const inspectionAllowance = source.contentInspected ? (recoveredTerms >= 2 ? 12 : 4) : 7;
  return clamp(Math.min(observed, relevance + inspectionAllowance));
}

function compoundedEvidenceScore(artifact: any, clusters: any[]) {
  const allSources = artifact.branches.flatMap((branch: any) => branch.sources);
  const componentByUrl = provenanceComponents(allSources, clusters);
  const combineSamePath = (values: number[]) => {
    const ordered = [...values].sort((a, b) => b - a);
    return clamp((ordered[0] || 0) + ordered.slice(1).reduce((total, value) => total + value * .18, 0));
  };
  const combineIndependentPaths = (values: number[]) => clamp(100 * (1 - values.reduce((remaining, value) => remaining * (1 - Math.min(.92, value / 100) * .82), 1)));
  for (const branch of artifact.branches) {
    if (branch.verdict === 'formally_checked' || branch.verdict === 'formally_refuted') continue;
    const groups = new Map<string, { support:number[]; refute:number[]; context:number[]; primarySupport:boolean }>();
    for (const source of branch.sources) {
      const metrics = source.metrics || {};
      const sourceQuality = clamp(source.credibilityScore ?? ((metrics.authority || 35) * .34 + (metrics.evidenceQuality || 20) * .38 + (metrics.transparency || 20) * .18 + (metrics.citationNetwork || 0) * .10));
      const relevance = claimRelevance(source, branch.claim);
      const directness = calibratedDirectness(source, relevance);
      const independence = clamp(metrics.independence ?? 45);
      // A geometric mean keeps a single weak link visible: strong credentials cannot compensate for an irrelevant or derivative passage.
      const contribution = clamp(Math.pow((sourceQuality / 100) * (relevance / 100) * (directness / 100) * (independence / 100), .25) * 100);
      const sourceKey = canonicalSourceUrl(source.url); const provenanceGroup = componentByUrl.get(sourceKey) || 'Independent path';
      source.credibilityPath = { sourceQuality, claimRelevance: relevance, directness, independence, compoundedContribution: contribution, provenanceGroup };
      // Keep the presentation metric in sync with the calibrated evidence path;
      // retain evidenceProfile.directness as the raw extractor observation for audit.
      source.metrics = { ...metrics, semanticDepth: directness };
      const bucket = groups.get(provenanceGroup) || { support:[], refute:[], context:[], primarySupport:false };
      const stance = source.evidenceProfile?.stance || 'unclear';
      if (stance === 'supports') { bucket.support.push(contribution); if (['primary','official_record','academic'].includes(source.evidenceProfile?.sourceType)) bucket.primarySupport = true; }
      else if (stance === 'refutes') bucket.refute.push(contribution);
      else if (stance === 'context') bucket.context.push(contribution);
      groups.set(provenanceGroup, bucket);
    }
    const supportPaths = [...groups.values()].map((group) => combineSamePath(group.support)).filter(Boolean);
    const refutePaths = [...groups.values()].map((group) => combineSamePath(group.refute)).filter(Boolean);
    const contextPaths = [...groups.values()].map((group) => combineSamePath(group.context)).filter(Boolean);
    const support = combineIndependentPaths(supportPaths);
    const refutation = combineIndependentPaths(refutePaths);
    const contextualCoverage = combineIndependentPaths(contextPaths);
    const independentPaths = [...groups.values()].filter((group) => group.support.length || group.refute.length).length;
    const primarySupportPaths = [...groups.values()].filter((group) => group.primarySupport).length;
    const contradictory = support >= 42 && refutation >= 42;
    const assessmentConfidence = clamp(Math.max(support, refutation) * .74 + contextualCoverage * .10 + Math.min(14, independentPaths * 4));
    const nextVerdict = refutation >= 64 && refutation - support >= 14 ? 'refuted' : contradictory ? 'contested' : support >= 68 && primarySupportPaths >= 1 && supportPaths.length >= 2 ? 'corroborated' : support >= 44 ? 'provisionally_supported' : 'insufficient_evidence';
    branch.supportStrength = support;
    branch.confidenceScore = assessmentConfidence;
    branch.verdict = nextVerdict;
    branch.evidenceBalance = { support, refutation, contextualCoverage, netSupport: clamp(50 + (support - refutation) * .5), independentPaths, assessmentConfidence };
    branch.decisionReasons = [
      `Compounded supporting path strength: ${support}/100 across ${supportPaths.length} provenance-separated path${supportPaths.length === 1 ? '' : 's'}.`,
      `Compounded refuting path strength: ${refutation}/100 across ${refutePaths.length} provenance-separated path${refutePaths.length === 1 ? '' : 's'}.`,
      'Repeated sources within one publisher or observed shared-reference path are discounted before branch aggregation.'
    ];
    branch.sources.forEach((source: any) => { source.verificationStatus = nextVerdict === 'corroborated' ? 'verified' : nextVerdict === 'contested' || nextVerdict === 'refuted' ? 'contested' : 'checking'; });
  }
  const assessable = artifact.branches.filter((branch: any) => branch.verdict !== 'formally_checked' && branch.verdict !== 'formally_refuted');
  if (assessable.length) artifact.confidenceScore = clamp(assessable.reduce((total: number, branch: any) => total + (branch.evidenceBalance?.assessmentConfidence ?? branch.confidenceScore), 0) / assessable.length);
  const pathNotice = 'Compounded path model: source quality, exact claim relevance, directness, and independence are combined per trace; repeated provenance is discounted before support and refutation are aggregated.';
  if (!String(artifact.evidenceStandard || '').includes('Compounded path model:')) artifact.evidenceStandard = `${artifact.evidenceStandard ? `${artifact.evidenceStandard} ` : ''}${pathNotice}`;
  return artifact;
}

async function enrichEvidenceTopology(artifact: any, discoveryConnectors: string[] = []) {
  const sources = artifact.branches.flatMap((branch: any) => branch.sources.map((source: any) => ({ source, claim:branch.claim }))) as { source:any; claim:string }[];
  const activeSources = new Map<string, string>();
  sources.forEach(({ source }) => { const key = canonicalSourceUrl(source.url); if (key) activeSources.set(key, source.url); });
  const pending = sources.filter(({ source }) => !source.contentInspected).slice(0, MAX_SOURCE_PAGES_PER_PASS);
  const snapshots = await Promise.all(pending.map(async ({ source, claim }) => ({ source, claim, snapshot: await fetchSourceSnapshot(source.url, activeSources) })));
  const relations = new Map<string, any>();
  for (const relation of artifact.evidenceRelations || []) relations.set(`${canonicalSourceUrl(relation.fromUrl)}>${canonicalSourceUrl(relation.toUrl)}:${relation.kind}`, relation);
  for (const { source, claim, snapshot } of snapshots) {
    source.contentInspected = snapshot.inspected;
    source.imageUrls = [...new Set([source.imageUrl, ...(source.imageUrls || []), ...snapshot.imageUrls].filter(Boolean))].slice(0, 4);
    if (!source.imageUrl && source.imageUrls.length) source.imageUrl = source.imageUrls[0];
    const aligned = alignClaimExtract(snapshot.pageText, claim);
    if (aligned) { source.snippet = aligned.snippet; source.citedText = aligned.citedText; source.claimMatches = aligned.matches; }
    source.observedReferenceCount = snapshot.outboundActiveUrls.length;
    source.citationFingerprints = snapshot.referenceFingerprints;
    for (const targetUrl of snapshot.outboundActiveUrls) {
      if (canonicalSourceUrl(source.url) === canonicalSourceUrl(targetUrl)) continue;
      const key = `${canonicalSourceUrl(source.url)}>${canonicalSourceUrl(targetUrl)}:references`;
      relations.set(key, { fromUrl:source.url, toUrl:targetUrl, kind:'references', strength:82, note:'Sourceful fetched this public page and observed a direct link to another active trace. A direct link is not automatically treated as a scholarly citation.' });
    }
  }
  const publisherClusters = provenanceClusters(artifact);
  const citationClusters = citationProvenanceClusters(artifact);
  const clusters = [...publisherClusters, ...citationClusters];
  for (const cluster of publisherClusters) {
    for (let index = 1; index < cluster.sourceUrls.length; index++) {
      const fromUrl = cluster.sourceUrls[index - 1]; const toUrl = cluster.sourceUrls[index];
      const key = `${canonicalSourceUrl(fromUrl)}>${canonicalSourceUrl(toUrl)}:shared_publisher`;
      relations.set(key, { fromUrl, toUrl, kind:'shared_publisher', strength:34, note:`These traces share the publisher domain ${hostFor(fromUrl)}. This is a provenance cluster, not independent corroboration.` });
    }
  }
  for (const cluster of citationClusters) {
    for (let index = 1; index < cluster.sourceUrls.length; index++) {
      const fromUrl = cluster.sourceUrls[index - 1]; const toUrl = cluster.sourceUrls[index];
      const key = `${canonicalSourceUrl(fromUrl)}>${canonicalSourceUrl(toUrl)}:shared_citation`;
      relations.set(key, { fromUrl, toUrl, kind:'shared_citation', strength:41, note:'These traces visibly link to the same external reference. It may reveal a common provenance path and should not be counted as independent corroboration.' });
    }
  }
  compoundedEvidenceScore(artifact, clusters);
  artifact.evidenceRelations = [...relations.values()];
  artifact.provenanceClusters = clusters;
  artifact.researchMetadata = {
    completedPasses: Number(artifact.researchMetadata?.completedPasses || 1),
    maxPasses: MAX_RESEARCH_PASSES,
    nodeBudget: MAX_GRAPH_SOURCES,
    sourcePagesInspected: sources.filter(({ source }) => source.contentInspected).length,
    observedRelations: artifact.evidenceRelations.length,
    discoveryConnectors: [...new Set([...(artifact.researchMetadata?.discoveryConnectors || []), ...discoveryConnectors])],
    sharedCitationClusters: citationClusters.length
  };
  return artifact;
}

type RecoveredPassageInput = { id:string; claim:string; title:string; url:string; excerpt:string; citedText:string; currentStance:string; currentEvidenceType:string };
type FetchedPassageReview = { id:string; stance:'supports'|'refutes'|'context'|'unclear'; evidenceType:'direct_document'|'dataset'|'peer_reviewed'|'on_record_reporting'|'secondary_summary'|'commentary'|'unverified'; directness:number; assessment:string };

async function assessRecoveredPassages(entries: RecoveredPassageInput[], client: OpenAI, model: string): Promise<Map<string, FetchedPassageReview>> {
  if (!entries.length) return new Map<string, FetchedPassageReview>();
  const prompt = `You are Sourceful's bounded fetched-passage reviewer. You have NO web access in this step. Assess only the recovered excerpt supplied for each source against its precise branch claim. Do not use the title, URL, reputation, or outside knowledge as evidence. Do not infer author credentials, methods, citations, or truth beyond the excerpt.

For every input id, return exactly one review:
- stance: supports, refutes, context, or unclear only in relation to the exact claim;
- evidenceType: what this excerpt itself appears to supply;
- directness: 0–100 for how directly this excerpt bears on that claim; and
- assessment: one short cautious explanation anchored to the excerpt.

If an excerpt is vague, tangential, or merely mentions the topic, use context or unclear and keep directness low. Do not treat an outgoing link, source title, or model-memory fact as corroboration.

${JSON.stringify(entries)}`;
  const response = await client.responses.create({ model, input:prompt, reasoning:{ effort:'low' }, text:{ verbosity:'low', format:{ type:'json_schema', ...fetchedPassageReviewSchema } } } as any);
  let parsed: any;
  try { parsed = JSON.parse(response.output_text); } catch { return new Map<string, FetchedPassageReview>(); }
  const permitted = new Set(entries.map((entry) => entry.id));
  const reviews = Array.isArray(parsed?.reviews) ? parsed.reviews : [];
  const accepted: Array<[string, FetchedPassageReview]> = reviews.filter((review: any) => permitted.has(String(review?.id || ''))).map((review: any) => [String(review.id), { id:String(review.id), stance:review.stance, evidenceType:review.evidenceType, directness:clamp(Number(review.directness)), assessment:String(review.assessment || '').slice(0, 260) } satisfies FetchedPassageReview]);
  return new Map<string, FetchedPassageReview>(accepted);
}

// This is a second, bounded evidence pass. The model sees only recovered source-page passages,
// never an unrestricted page crawl, and it is permitted to revise only relation, evidence type,
// and directness for the claim actually attached to that trace.
async function reviewFetchedSourcePassages(artifact: any, client: OpenAI, model: string) {
  const candidates = artifact.branches.flatMap((branch: any, branchIndex: number) => (branch.sources || []).map((source: any, sourceIndex: number) => ({ branch, source, id:`${branchIndex}:${sourceIndex}` })))
    .filter(({ source }: any) => source.contentInspected && !source.fetchedPassageReviewed && Array.isArray(source.claimMatches) && source.claimMatches.length >= 2 && String(source.snippet || '').trim().length >= 80)
    .slice(0, MAX_FETCHED_PASSAGE_REVIEWS);
  if (!candidates.length) return artifact;
  const inputs: RecoveredPassageInput[] = candidates.map(({ branch, source, id }: any) => ({ id, claim:String(branch.claim || '').slice(0, 800), title:String(source.title || '').slice(0, 260), url:String(source.url || '').slice(0, 1000), excerpt:String(source.snippet || '').slice(0, 900), citedText:String(source.citedText || '').slice(0, 300), currentStance:String(source.evidenceProfile?.stance || 'unclear'), currentEvidenceType:String(source.evidenceProfile?.evidenceType || 'secondary_summary') }));
  try {
    const reviews = await assessRecoveredPassages(inputs, client, model);
    if (!reviews.size) return artifact;
    const directSources = artifact.branches.flatMap((branch: any) => branch.sources || []);
    const domains = new Map<string, number>(); directSources.forEach((source: any) => domains.set(hostFor(source.url), (domains.get(hostFor(source.url)) || 0) + 1));
    let reviewed = 0;
    for (const candidate of candidates) {
      const review = reviews.get(candidate.id); if (!review) continue;
      const previousProfile: Profile = candidate.source.evidenceProfile || { sourceType:'unknown', evidenceType:'secondary_summary', stance:'unclear', authorNamed:false, methodologyVisible:false, correctionsVisible:false, citedReferenceCount:0, directness:0, reliabilityFlags:['none'] };
      const profile: Profile = { ...previousProfile, stance:review.stance, evidenceType:review.evidenceType, directness:clamp(review.directness) };
      const recalculated = sourceMetrics(profile, candidate.source.publishedAt || '', (domains.get(hostFor(candidate.source.url)) || 0) > 1);
      candidate.source.evidenceProfile = profile;
      candidate.source.semanticDepth = profile.directness;
      candidate.source.metrics = { ...candidate.source.metrics, ...recalculated.metrics, corroboration:candidate.source.metrics?.corroboration ?? 0 };
      candidate.source.credibilityScore = recalculated.credibilityScore;
      candidate.source.isDodgy = recalculated.isDodgy;
      candidate.source.fetchedPassageReviewed = true;
      candidate.source.fetchedPassageAssessment = review.assessment;
      reviewed += 1;
    }
    if (reviewed) {
      compoundedEvidenceScore(artifact, artifact.provenanceClusters || []);
      artifact.researchMetadata = { ...(artifact.researchMetadata || {}), fetchedPassagesReviewed: Number(artifact.researchMetadata?.fetchedPassagesReviewed || 0) + reviewed };
      artifact.evidenceStandard = `${artifact.evidenceStandard || 'Conservative evidence gate.'} ${reviewed} recovered source-page passage${reviewed === 1 ? '' : 's'} received a bounded, claim-specific second review.`;
    }
  } catch (error: any) {
    // A secondary review is an enhancement, never a reason to discard the primary graph.
    console.warn('Fetched passage review unavailable.', { status:error?.status, code:error?.code, requestId:error?.requestID || error?.request_id });
  }
  return artifact;
}

async function reviewLineagePassages(sources: any[], claim: string, client: OpenAI, model: string) {
  const candidates = sources.filter((source) => Array.isArray(source.claimMatches) && source.claimMatches.length >= 2 && String(source.snippet || '').trim().length >= 80).slice(0, MAX_LINEAGE_CHILDREN);
  const inputs: RecoveredPassageInput[] = candidates.map((source, index) => ({ id:`lineage:${index}`, claim:claim.slice(0, 800), title:String(source.title || '').slice(0, 260), url:String(source.url || '').slice(0, 1000), excerpt:String(source.snippet || '').slice(0, 900), citedText:String(source.citedText || '').slice(0, 300), currentStance:'context', currentEvidenceType:String(source.evidenceProfile?.evidenceType || 'secondary_summary') }));
  try {
    const reviews = await assessRecoveredPassages(inputs, client, model);
    candidates.forEach((source, index) => {
      const review = reviews.get(`lineage:${index}`); if (!review) return;
      const profile: Profile = { ...(source.evidenceProfile || {}), stance:review.stance, evidenceType:review.evidenceType, directness:clamp(review.directness) };
      const recalculated = sourceMetrics(profile, source.publishedAt || '', false);
      source.evidenceProfile = profile;
      source.semanticDepth = profile.directness;
      source.metrics = recalculated.metrics;
      source.credibilityScore = recalculated.credibilityScore;
      source.isDodgy = recalculated.isDodgy;
      source.fetchedPassageReviewed = true;
      source.fetchedPassageAssessment = review.assessment;
    });
  } catch (error: any) {
    console.warn('Lineage passage review unavailable.', { status:error?.status, code:error?.code, requestId:error?.requestID || error?.request_id });
  }
  return sources;
}

function normalizedClaim(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sourceCount(artifact: any) {
  const countTree = (sources: any[]): number => sources.reduce((total, source) => total + 1 + (Array.isArray(source?.lineageSources) ? countTree(source.lineageSources) : 0), 0);
  return Array.isArray(artifact?.branches) ? artifact.branches.reduce((total: number, branch: any) => total + (Array.isArray(branch?.sources) ? countTree(branch.sources) : 0), 0) : 0;
}

function sourceUrlsInArtifact(artifact: any) {
  const urls = new Set<string>();
  const visit = (sources: any[]) => sources.forEach((source) => { const key = canonicalSourceUrl(source?.url || ''); if (key) urls.add(key); if (Array.isArray(source?.lineageSources)) visit(source.lineageSources); });
  if (Array.isArray(artifact?.branches)) artifact.branches.forEach((branch: any) => visit(Array.isArray(branch?.sources) ? branch.sources : []));
  return urls;
}

function mergeExpansionArtifact(artifact: any, expansion: any) {
  const allowedNewSources = Math.max(0, MAX_GRAPH_SOURCES - sourceCount(artifact));
  const seenSourceUrls = sourceUrlsInArtifact(artifact);
  const nextBranches: any[] = artifact.branches.map((branch: any) => ({ ...branch, sources:[...branch.sources] }));
  const branchByClaim = new Map<string, any>(nextBranches.map((branch: any) => [normalizedClaim(branch.claim), branch]));
  let added = 0;

  for (const proposed of expansion.branches || []) {
    if (!proposed?.claim || !Array.isArray(proposed.sources) || added >= allowedNewSources) continue;
    const key = normalizedClaim(proposed.claim);
    const target = branchByClaim.get(key) || { claim:proposed.claim, biasAnalysis:proposed.biasAnalysis || 'This line of inquiry was introduced in a later evidence pass.', sources:[] };
    const accepted = proposed.sources.filter((source: any) => {
      const urlKey = canonicalSourceUrl(source?.url || '');
      if (!urlKey || seenSourceUrls.has(urlKey) || added >= allowedNewSources) return false;
      seenSourceUrls.add(urlKey); added += 1; return true;
    });
    if (!accepted.length) continue;
    target.sources.push(...accepted);
    if (!branchByClaim.has(key)) { nextBranches.push(target); branchByClaim.set(key, target); }
  }

  return {
    ...artifact,
    branches: nextBranches,
    researchMetadata: {
      ...(artifact.researchMetadata || {}),
      completedPasses: Number(artifact.researchMetadata?.completedPasses || 1) + 1,
      maxPasses: MAX_RESEARCH_PASSES,
      nodeBudget: MAX_GRAPH_SOURCES
    },
    evidenceStandard: `${artifact.evidenceStandard || 'Conservative evidence gate.'} Expansion pass added ${added} unique source trace${added === 1 ? '' : 's'} after deduplication; observed page links and shared publisher paths remain explicitly labelled rather than treated as proof.`
  };
}

const demoMetrics = (authority: number, evidenceQuality: number, independence: number, recency: number, transparency: number, corroboration: number, citationNetwork: number, semanticDepth: number) => ({ authority, evidenceQuality, independence, recency, transparency, corroboration, citationNetwork, semanticDepth });
function demoSource(title: string, url: string, snippet: string, credibilityScore: number, profile: Profile, metrics: any, isDodgy = false, imageUrl = '') {
  return { title, url, snippet, citedText: snippet.slice(0, Math.min(snippet.length, 92)), imageUrl, isDemoVisual: Boolean(imageUrl), credibilityScore, isDodgy, author: '', publishedAt: '', citations: profile.citedReferenceCount, semanticDepth: profile.directness, verificationStatus: isDodgy ? 'checking' : 'verified', provider: 'openai_web', evidenceProfile: profile, metrics };
}
function demoInvestigation(query: string) {
  const official = { sourceType:'official_record', evidenceType:'direct_document', stance:'supports', authorNamed:true, methodologyVisible:true, correctionsVisible:true, citedReferenceCount:4, directness:94, reliabilityFlags:['none'] } as Profile;
  const institutional = { sourceType:'institutional', evidenceType:'on_record_reporting', stance:'supports', authorNamed:true, methodologyVisible:true, correctionsVisible:false, citedReferenceCount:3, directness:84, reliabilityFlags:['none'] } as Profile;
  const weak = { sourceType:'user_generated', evidenceType:'unverified', stance:'supports', authorNamed:false, methodologyVisible:false, correctionsVisible:false, citedReferenceCount:0, directness:18, reliabilityFlags:['no_supporting_material','anonymous_claim'] } as Profile;
  return { isDemo:true, coreConcept:'Guided demonstration: how Sourceful separates corroborated evidence from weak claims', confidenceScore:78, researchRoute:'historical' as const, biasAnalysis:'This is a simulated research artifact. Its source metrics and citations demonstrate the interface; they are not a live investigation or an endorsement of any external source.', evidenceStandard:'Guided demo: use it to explore the graph, dossier, briefing, library, and weak-node disintegration before connecting live APIs.', branches:[
    { claim:'A historical event can be supported by distinct primary and institutional records.', confidenceScore:91, verdict:'corroborated', biasAnalysis:'The evidence path prioritises primary records over repetition.', decisionReasons:['One official record and two independent institutional references are represented.','The sources have distinct provenance roles.'], sources:[
      demoSource('NASA Apollo 11 Mission Overview','https://www.nasa.gov/mission/apollo-11/', 'Official mission records document the Apollo 11 mission and its lunar landing.',94,official,demoMetrics(94,96,86,70,90,92,72,94),false,'/assets/guided-demo-research-desk.jpg'),
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
    if (file && !isSupportedUpload(file)) return res.status(415).json({ error: 'Unsupported attachment. Use PDF, DOCX, RTF, TXT, Markdown, CSV, JSON, PNG, JPEG, or WebP (up to 8 MB).' });
    if (useDemo) return res.json(compoundedEvidenceScore(demoInvestigation(text), []));
    const apiKey = requestApiKey(req.body?.apiKey);
    if (!apiKey) return res.status(401).json({ error: 'Connect an OpenAI API key in Sourceful’s API vault, or configure OPENAI_API_KEY on the server.' });
    try {
      const client = new OpenAI({ apiKey });
      const route = await chooseResearchRoute(text, requestedMode, Boolean(file), client, model); const mathCheck = route === 'math' ? checkNumericMath(text) : null;
      const googleResearch = useGoogleCrosscheck ? await getGeminiResearch(text || `Assess the attached file: ${file?.originalname || 'uploaded research lead'}`) : '';
      const routeDiscovery = await routeSpecificDiscovery(text || `Assess the attached file: ${file?.originalname || 'uploaded research lead'}`, route);
      const textAttachment = file && isTextUpload(file) ? `\n\nAttached research lead (${file.originalname}; supplied by the user, not proof):\n${file.buffer.toString('utf8').slice(0, 18000)}` : '';
      const content: any[] = [{ type: 'input_text', text: `${text}\n\n--- Sourceful research protocol ---\n${routeProtocol(route, mathCheck)}\n\n--- Adaptive evidence-graph scope ---\n${adaptiveGraphInstruction(text, route, Boolean(file))}${textAttachment}${routeDiscovery.packet ? `\n\n--- Route-specific discovery packet ---\n${routeDiscovery.packet}` : ''}${googleResearch ? `\n\n--- Google-grounded cross-check packet ---\n${googleResearch}` : ''}` }];
      if (file?.mimetype.startsWith('image/')) content.push({ type: 'input_image', image_url: uploadDataUrl(file) });
      if (file && !isTextUpload(file) && !file.mimetype.startsWith('image/')) content.push({ type: 'input_file', filename: file.originalname, file_data: uploadDataUrl(file), detail: 'auto' });
      const response = await client.responses.create({ model, instructions, input: [{ role: 'user', content }], tools: [{ type: 'web_search' as any }], text: { format: { type: 'json_schema', ...schema } } } as any);
      const topology = await enrichEvidenceTopology(evaluateResult(JSON.parse(response.output_text), route, mathCheck), routeDiscovery.connectors);
      return res.json(await reviewFetchedSourcePassages(topology, client, model));
    } catch (error: any) { return res.status(502).json({ error: safeOpenAiError(error, 'Verification service unavailable.') }); }
  });
  app.post('/api/expand', rateLimit(6, 10 * 60_000), async (req, res) => {
    const artifact = req.body?.artifact;
    const model = String(req.body?.model || 'gpt-5.6-terra');
    const focusClaim = String(req.body?.focusClaim || '').trim();
    if (!artifact?.coreConcept || !Array.isArray(artifact?.branches)) return res.status(400).json({ error: 'A current Sourceful research graph is required.' });
    if (!modelRoster.has(model)) return res.status(400).json({ error: 'Unsupported Sourceful model.' });
    if (artifact.isDemo) return res.status(400).json({ error: 'The guided demonstration is simulated. Start a live investigation before extending a graph.' });
    const completedPasses = Number(artifact.researchMetadata?.completedPasses || 1);
    if (completedPasses >= MAX_RESEARCH_PASSES) return res.status(400).json({ error: `This graph has reached its bounded ${MAX_RESEARCH_PASSES}-pass research limit. Save it, review its sources, or start a more focused follow-up question.` });
    if (sourceCount(artifact) >= MAX_GRAPH_SOURCES) return res.status(400).json({ error: `This graph has reached its ${MAX_GRAPH_SOURCES}-source budget. Narrow the next question rather than adding untraceable volume.` });
    const apiKey = requestApiKey(req.body?.apiKey);
    if (!apiKey) return res.status(401).json({ error: 'Connect an OpenAI API key in Sourceful’s API vault, or configure OPENAI_API_KEY on the server.' });
    try {
      const client = new OpenAI({ apiKey });
      const route = researchModes.has(artifact.researchRoute) ? artifact.researchRoute as ResearchRoute : 'public_claim';
      const graphSnapshot = { coreConcept:artifact.coreConcept, biasAnalysis:artifact.biasAnalysis, researchRoute:route, branches:artifact.branches.map((branch: any) => ({ claim:branch.claim, biasAnalysis:branch.biasAnalysis, sources:branch.sources.map((source: any) => ({ title:source.title, url:source.url, snippet:source.snippet, stance:source.evidenceProfile?.stance, sourceType:source.evidenceProfile?.sourceType, evidenceType:source.evidenceProfile?.evidenceType })) })) };
      const currentGraph = JSON.stringify(graphSnapshot).slice(0, 90_000);
      const routeDiscovery = await routeSpecificDiscovery(focusClaim || artifact.coreConcept, route);
      const expansionPrompt = `You are carrying out exactly one additional, bounded Sourceful evidence pass. The current graph is a lead map, not ground truth. Focus on unresolved, contested, or weakly corroborated portions${focusClaim ? `, especially: ${focusClaim}` : ''}. Use web search to find only missing, independent, high-value material. Seek the strongest credible support, refutation, and essential context where appropriate. Do not repeat URLs already in the graph; do not create links or citations you did not observe; do not add branches just to make the graph larger. Return at most 4 focused branch additions and at most 5 sources per branch. A branch may match an existing claim exactly to add evidence to it, or introduce a materially distinct sub-claim. Every source needs a real URL and an exact cited snippet.\n\n${routeProtocol(route, null)}${routeDiscovery.packet ? `\n\n--- Route-specific discovery packet ---\n${routeDiscovery.packet}` : ''}\n\n--- Current graph ---\n${currentGraph}`;
      const response = await client.responses.create({ model, instructions, input: expansionPrompt, tools: [{ type: 'web_search' as any }], text: { format: { type: 'json_schema', ...expansionSchema } } } as any);
      const expansion = JSON.parse(response.output_text);
      const merged = mergeExpansionArtifact(artifact, expansion);
      const evaluated: any = evaluateResult(merged, route, null);
      evaluated.researchMetadata = merged.researchMetadata;
      evaluated.evidenceRelations = artifact.evidenceRelations || [];
      evaluated.evidenceStandard = merged.evidenceStandard;
      const topology = await enrichEvidenceTopology(evaluated, routeDiscovery.connectors);
      return res.json(await reviewFetchedSourcePassages(topology, client, model));
    } catch (error: any) { return res.status(502).json({ error: safeOpenAiError(error, 'Evidence expansion service unavailable.') }); }
  });
  app.post('/api/lineage', rateLimit(8, 10 * 60_000), async (req, res) => {
    const artifact = req.body?.artifact; const sourceId = String(req.body?.sourceId || ''); const claim = String(req.body?.claim || '').trim(); const model = String(req.body?.model || 'gpt-5.6-terra');
    if (!artifact?.coreConcept || !Array.isArray(artifact?.branches) || !sourceId || !claim) return res.status(400).json({ error: 'A selected source and claim from the active research graph are required.' });
    if (!modelRoster.has(model)) return res.status(400).json({ error: 'Unsupported Sourceful model.' });
    if (artifact.isDemo) return res.status(400).json({ error: 'The guided demonstration is simulated. Trace lineage from a live research source instead.' });
    // The BYOK gate keeps this public endpoint from becoming an unauthenticated web crawler;
    // the key also funds the bounded excerpt review when lineage pages are recovered.
    const apiKey = requestApiKey(req.body?.apiKey);
    if (!apiKey) return res.status(401).json({ error: 'Connect an OpenAI API key to trace a source lineage.' });
    const parent = artifact.branches.flatMap((branch: any) => branch.sources || []).find((source: any) => source.graphId === sourceId);
    if (!parent?.url) return res.status(404).json({ error: 'This source is no longer part of the active graph.' });
    if (Array.isArray(parent.lineageSources) && parent.lineageSources.length) return res.json({ parentSourceId:sourceId, lineageSources:parent.lineageSources, reused:true });
    const availableSlots = Math.min(MAX_LINEAGE_CHILDREN, Math.max(0, MAX_GRAPH_SOURCES - sourceCount(artifact)));
    if (!availableSlots) return res.status(400).json({ error: `This graph has reached its ${MAX_GRAPH_SOURCES}-source budget.` });
    try {
      const lineageSources = await fetchObservedLineage(parent.url, claim, sourceUrlsInArtifact(artifact), availableSlots);
      if (lineageSources.length) await reviewLineagePassages(lineageSources, claim, new OpenAI({ apiKey }), model);
      return res.json({ parentSourceId:sourceId, lineageSources, note: lineageSources.length ? 'Lineage leads are fetched public outbound references. They remain separate from claim support and refutation until independently evaluated.' : 'No safely fetchable, claim-relevant outgoing references were available from this source page.' });
    } catch { return res.status(502).json({ error: 'Source-lineage fetch unavailable.' }); }
  });
  if (process.env.NODE_ENV !== 'production') { const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
  else { const distPath = path.join(process.cwd(), 'dist'); app.use(express.static(distPath)); app.get('*', (_req,res) => res.sendFile(path.join(distPath, 'index.html'))); }
  app.listen(PORT, '0.0.0.0', () => console.log(`Sourceful on http://localhost:${PORT}`));
}
startServer();
