import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, ArrowRight, ShieldAlert, Lock, Sun, Moon, FolderOpen, Info, X, Quote, Network, BookOpenCheck, CircleCheck, Box, PanelsTopLeft, ScanSearch, Save, Sparkles, Trash2, Atom, SlidersHorizontal, ChevronDown, MousePointer2, Download, Tags } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppState, Branch, VerificationResult, Source } from './types';
import { NodeGraph } from './components/NodeGraph';
import { DiscoveryUniverse } from './components/DiscoveryUniverse';
import { cn } from './lib/utils';
import { forgetRememberedApiKey, hasRememberedApiKey, rememberApiKey, unlockRememberedApiKey } from './lib/keyVault';

const metricNames: Record<string, string> = {
  authority: 'Author & publisher authority', evidenceQuality: 'Evidence quality', independence: 'Independence from interests',
  recency: 'Temporal fitness', transparency: 'Methods & corrections', corroboration: 'Independent corroboration',
  citationNetwork: 'Citation-network strength', semanticDepth: 'Semantic depth'
};

const metricExplanations: Record<string, string> = {
  authority: 'Observable accountability: source class, named author, and publisher signals. This is not an agreement or political-alignment score.',
  evidenceQuality: 'The kind of material the source directly supplies, from primary records and data through analysis and commentary.',
  independence: 'Whether this trace appears to be a distinct reporting or evidence path. Repeated copies do not become independent corroboration.',
  recency: 'How well the publication date fits a time-sensitive question. Older archival material is not automatically penalised.',
  transparency: 'Visible authorship, methods, corrections, and cited references that let a reader inspect how a conclusion was reached.',
  corroboration: 'Independent traces that directly support or challenge this specific claim. This is graph context, not a popularity count.',
  citationNetwork: 'The number and visibility of cited references in the source material—not an estimate of web-wide incoming citations.',
  semanticDepth: 'How directly the retrieved extract addresses the claim. It measures evidential relevance, not writing complexity.'
};

function metricTrace(key: string, source: Source, profile?: Source['evidenceProfile']) {
  const labels: Record<string, string> = {
    authority: profile?.sourceType ? `Observed source class: ${profile.sourceType.replaceAll('_', ' ')}${profile.authorNamed ? '; author is named.' : '; author attribution is not confirmed.'}` : 'Source class and author attribution are being assessed from the returned research record.',
    evidenceQuality: profile?.evidenceType ? `Returned evidence type: ${profile.evidenceType.replaceAll('_', ' ')}. The source excerpt is judged for directness to this claim.` : 'Evidence type is inferred from the returned source excerpt.',
    independence: 'Independent paths are counted only when the research graph does not identify them as repeated or derivative traces.',
    recency: source.publishedAt ? `Returned publication date: ${source.publishedAt}. Its relevance depends on the claim’s time sensitivity.` : 'No publication date was returned; the system cannot treat recency as a strong signal.',
    transparency: profile ? `${profile.authorNamed ? 'Named author' : 'Author not confirmed'} · ${profile.methodologyVisible ? 'methodology visible' : 'methodology not visible'} · ${profile.correctionsVisible ? 'corrections policy visible' : 'corrections policy not visible'} · ${profile.citedReferenceCount ?? 0} cited references.` : 'Authorship, methodology, corrections, and cited references are being assessed when present.',
    corroboration: `${source.citations ?? 0} linked citations were returned for this trace. Agreement from a single origin remains a single evidentiary path.`,
    citationNetwork: profile ? `${profile.citedReferenceCount ?? 0} cited references were visible in the returned source profile.` : `${source.citations ?? 0} linked citations were returned with this source.`,
    semanticDepth: typeof profile?.directness === 'number' ? `Extract directness: ${profile.directness}/100. The claim and quote are compared for evidential relevance.` : 'Directness is estimated from the relationship between the retrieved extract and this claim.'
  };
  return labels[key] || 'This signal is calculated from the returned source record and its position in the active evidence graph.';
}

type SavedArtifact = { id: string; title: string; createdAt: string; query: string; model: string; result: VerificationResult; summary?: string };
const artifactStorageKey = 'sourceful-research-library-v1';

function ApiKeyVault({ isDarkMode, apiKey, onUse, onDisconnect, onClose }: { isDarkMode: boolean; apiKey: string; onUse: (key: string) => void; onDisconnect: () => void; onClose: () => void }) {
  const [stored, setStored] = useState(() => hasRememberedApiKey());
  const [keyInput, setKeyInput] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const useForTab = async () => {
    const key = keyInput.trim();
    if (!key) return setMessage('Enter an OpenAI API key first.');
    setBusy(true); setMessage('');
    try { if (remember) await rememberApiKey(key, passphrase); onUse(key); setStored(remember || stored); setKeyInput(''); setPassphrase(''); setMessage(remember ? 'Encrypted key saved on this device and unlocked for this tab.' : 'Key unlocked for this tab only.'); } catch (error: any) { setMessage(error.message || 'Unable to prepare the key vault.'); } finally { setBusy(false); }
  };
  const unlock = async () => {
    if (!passphrase) return setMessage('Enter the vault passphrase.');
    setBusy(true); setMessage('');
    try { const key = await unlockRememberedApiKey(passphrase); onUse(key); setPassphrase(''); setMessage('Encrypted key unlocked for this tab.'); } catch (error: any) { setMessage(error.message || 'Unable to unlock the key vault.'); } finally { setBusy(false); }
  };
  const forget = () => { forgetRememberedApiKey(); setStored(false); setPassphrase(''); onDisconnect(); setMessage('Saved key removed from this browser.'); };
  return <motion.aside initial={{ opacity: 0, y: -10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: .98 }} className={cn('api-key-vault', isDarkMode ? 'dossier-dark' : 'dossier-light')}><div className="dossier-topline"><span><Lock size={14}/> Personal API vault</span><button onClick={onClose} title="Close key vault"><X size={17}/></button></div><p>Sourceful sends this key only to its server for your request. It is never written to the server, logs, saved graphs, or CSV export.</p>{apiKey ? <div className="vault-active"><CircleCheck size={15}/><span>Key unlocked for this tab</span><button type="button" onClick={onDisconnect}>Disconnect</button></div> : stored ? <div className="vault-unlock"><label>Vault passphrase<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" placeholder="Unlock this browser vault" /></label><button type="button" onClick={unlock} disabled={busy}>{busy ? 'Unlocking…' : 'Unlock key'}</button><button type="button" className="vault-forget" onClick={forget}>Forget saved key</button></div> : <div className="vault-connect"><label>OpenAI API key<input type="password" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} autoComplete="off" spellCheck={false} placeholder="sk-…" /></label><label className="vault-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Remember on this device with encryption</label>{remember && <label>Vault passphrase <small>12+ characters; never stored</small><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" placeholder="Create a vault passphrase" /></label>}<button type="button" onClick={useForTab} disabled={busy}>{busy ? 'Protecting…' : remember ? 'Encrypt & connect' : 'Connect for this tab'}</button></div>}<small className="vault-footnote">A saved key remains encrypted at rest. It must be unlocked after a refresh; a malicious browser extension or XSS can still access an unlocked key, so use a restricted project key and keep your browser trusted.</small>{message && <div className="vault-message">{message}</div>}</motion.aside>;
}

function ArtifactLibrary({ artifacts, isDarkMode, onRestore, onDelete, onClose }: { artifacts: SavedArtifact[]; isDarkMode: boolean; onRestore: (artifact: SavedArtifact) => void; onDelete: (id: string) => void; onClose: () => void }) {
  return <motion.aside initial={{ x: 18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 18, opacity: 0 }} className={cn('artifact-library', isDarkMode ? 'dossier-dark' : 'dossier-light')}><div className="dossier-topline"><span><FolderOpen size={14}/> Research library</span><button onClick={onClose}><X size={17}/></button></div>{artifacts.length ? <div className="artifact-list">{artifacts.map((artifact) => <article key={artifact.id}><div><span>{new Date(artifact.createdAt).toLocaleDateString()}</span><h3>{artifact.title}</h3><p>{artifact.result.branches.length} claim branches · {artifact.result.researchRoute?.replaceAll('_', ' ') || 'research'}</p></div><footer><button onClick={() => onRestore(artifact)}>Open</button><button onClick={() => onDelete(artifact.id)} title="Delete saved artifact"><Trash2 size={13}/></button></footer></article>)}</div> : <div className="empty-library"><Atom size={24}/><p>Your saved knowledge graphs will live here.</p></div>}</motion.aside>;
}

function AboutPanel({ isDarkMode, onClose }: { isDarkMode: boolean; onClose: () => void }) {
  return <motion.aside initial={{ y: -18, opacity: 0, scale: .97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -18, opacity: 0, scale: .97 }} className={cn('about-panel', isDarkMode ? 'dossier-dark' : 'dossier-light')}><div className="dossier-topline"><span><Info size={14}/> The Sourceful method</span><button onClick={onClose}><X size={17}/></button></div><h2>Evidence, not an oracle.</h2><p>Sourceful separates source discovery from claim evaluation. It shows how a result was reached—and when the evidence is simply not enough.</p><div className="about-grid"><div><b>01</b><span>Routes each question to public-claim, historical, scripture, mathematical, or document research.</span></div><div><b>02</b><span>Scores observable evidence attributes and preserves source provenance.</span></div><div><b>03</b><span>Marks claims corroborated, contested, provisional, or insufficient rather than forcing certainty.</span></div></div><p className="about-note">Hover graph nodes for an extract. Select a source sphere for its evidence dossier. The Guided demo is simulated; live research requires your OpenAI key.</p></motion.aside>;
}

function ExploreGuide({ viewMode, onClose, onDisable }: { viewMode: '3d' | '2d'; onClose: () => void; onDisable: () => void }) {
  const instruction = viewMode === '3d' ? 'Drag the field to orbit. Hover a sphere for its evidence extract.' : 'Drag to explore the board. Use the zoom controls at bottom-right to change scale.';
  return <motion.div initial={{ opacity:0, y:14, filter:'blur(7px)' }} animate={{ opacity:1, y:0, filter:'blur(0px)' }} exit={{ opacity:0, y:14, filter:'blur(7px)' }} className="explore-guide"><button onClick={onClose} title="Dismiss guide"><X size={13}/></button><div><MousePointer2 size={14}/><span>HOW TO EXPLORE</span></div><p>{instruction}</p><small>Select any source to open its dossier. Weak traces can be dissolved when their evidence fails.</small><button className="guide-disable" onClick={onDisable}>Don’t show this guide again</button></motion.div>;
}

function WindborneNodes() {
  const nodes = useMemo(() => Array.from({ length: 78 }, (_, index) => ({
    id: index, left: (index * 37.7) % 100, top: (index * 61.9) % 100, size: index % 11 === 0 ? 7 : index % 5 === 0 ? 4 : 2,
    driftX: 26 + (index % 9) * 11, driftY: -18 + (index % 7) * 9, duration: 12 + (index % 12) * 2.1, delay: -(index % 10) * 1.3, accent: index % 13 === 0
  })), []);
  return <div className="windborne-nodes" aria-hidden="true">{nodes.map((node) => <motion.i key={node.id} className={node.accent ? 'accent' : ''} style={{ left: `${node.left}%`, top: `${node.top}%`, width: node.size, height: node.size }} animate={{ x: [0, node.driftX, node.driftX * .38, -node.driftX * .22, 0], y: [0, node.driftY, node.driftY * 1.6, node.driftY * .35, 0], opacity: [.18, .9, .42, .72, .18], scale: [1, 1.35, .72, 1.1, 1] }} transition={{ duration: node.duration, delay: node.delay, repeat: Infinity, ease: 'easeInOut' }} />)}</div>;
}

const researchMapPaths = ['M50 152 C108 145 132 120 182 95 S270 70 328 48','M50 152 C114 160 143 190 194 202 S278 221 352 228','M50 152 C105 132 116 75 150 48 S216 38 260 28','M182 95 C195 123 212 142 244 157 S306 166 356 140','M194 202 C221 183 254 182 278 196 S319 214 366 202','M150 48 C155 73 176 83 202 81 S238 70 270 64','M244 157 C253 132 282 112 305 101 S342 84 370 68','M278 196 C291 172 324 165 348 166 S381 177 396 190','M328 48 C347 62 364 77 389 82'];
const researchMapNodes = [[50,152],[182,95],[194,202],[150,48],[244,157],[278,196],[328,48],[352,228],[370,68],[396,190]];

function ResearchBuildLoader({ isDarkMode, stage, onCancel }: { isDarkMode: boolean; stage: string; onCancel: () => void }) {
  return <div className="research-build-loader"><svg className="research-build-map" viewBox="0 0 440 260" aria-hidden="true"><defs><linearGradient id="research-trace" x1="0" x2="1"><stop stopColor={isDarkMode ? '#5da9ff' : '#2e70ed'} stopOpacity=".16"/><stop offset=".5" stopColor={isDarkMode ? '#9ce5ff' : '#316ee8'} stopOpacity=".96"/><stop offset="1" stopColor={isDarkMode ? '#e5bd67' : '#bd8623'} stopOpacity=".4"/></linearGradient><filter id="research-glow"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>{researchMapPaths.map((path, index) => <motion.path key={path} d={path} fill="none" stroke="url(#research-trace)" strokeWidth={index % 3 === 0 ? 1.8 : 1.15} strokeLinecap="round" filter="url(#research-glow)" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: [0, 1, 1], opacity: [0, .92, .45] }} transition={{ duration: 1.25, delay: index * .18, repeat: Infinity, repeatDelay: 2.8, ease: 'easeInOut' }}/>) }{researchMapNodes.map(([cx, cy], index) => <motion.circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index === 0 ? 5 : index % 3 === 0 ? 3.4 : 2.25} fill={index === 0 ? '#f0c868' : '#70b5ff'} initial={{ opacity: 0, scale: .25 }} animate={{ opacity: [0, 1, .55, 1], scale: [.25, 1, 1.42, 1] }} transition={{ duration: 1.35, delay: .3 + index * .17, repeat: Infinity, repeatDelay: 2.8, ease: 'easeInOut' }}/>)}</svg><div className="research-build-copy"><motion.div className="research-build-beacon" animate={{ scale: [1, 1.22, 1], opacity: [.62, 1, .62] }} transition={{ duration: 1.5, repeat: Infinity }}><Sparkles size={16}/></motion.div><span>LIVE EVIDENCE MAP</span><strong>{stage}</strong><small>Tracing independent leads, contradictions, and provenance.</small><button onClick={onCancel} className="pause-research">Stop &amp; keep completed graph</button></div></div>;
}

type MenuOption = { value: string; label: string };
function GlassMenu({ label, title, value, options, onChange }: { label: string; title: string; value: string; options: MenuOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false); const selected = options.find((option) => option.value === value) || options[0];
  return <label className="glass-menu" title={title}><span>{label}</span><button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><b>{selected.label}</b><ChevronDown size={13} className={open ? 'rotated' : ''}/></button><AnimatePresence>{open && <motion.div role="listbox" initial={{ opacity: 0, y: -5, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: .97 }} className="glass-menu-options">{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value} className={option.value === value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}</motion.div>}</AnimatePresence></label>;
}

function SourceDossier({ source, isDarkMode, onClose, onDisintegrate }: { source: Source; isDarkMode: boolean; onClose: () => void; onDisintegrate: (source: Source) => void }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const fallback = { authority: 72, evidenceQuality: 78, independence: 74, recency: 68, transparency: 76, corroboration: 70, citationNetwork: 66, semanticDepth: 81 };
  const metrics = source.metrics || fallback;
  const profile = source.evidenceProfile;
  const hasThumbnail = Boolean(source.imageUrl && !thumbnailFailed);
  const sourceHost = (() => {
    try { return new URL(source.url).hostname.replace(/^www\./, ''); } catch { return 'Open original source'; }
  })();
  return <motion.aside initial={{ x: -18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -18, opacity: 0 }} className={cn('source-dossier', isDarkMode ? 'dossier-dark' : 'dossier-light')}>
    <div className="dossier-topline"><span><BookOpenCheck size={14}/> Evidence dossier</span><button onClick={onClose}><X size={17}/></button></div>
    <div className={cn('dossier-source', hasThumbnail && 'has-thumbnail')}>
      {hasThumbnail ? <a className="dossier-thumbnail" href={source.url} target="_blank" rel="noreferrer" title="Open the original source"><img src={source.imageUrl} alt="" onError={() => setThumbnailFailed(true)} /><span>Open source</span></a> : <div className="dossier-orb"/>}
      <p>SELECTED SOURCE</p><h2>{source.title}</h2><div className="dossier-byline">{source.author || 'Author attribution being assessed'} · {source.publishedAt || 'Date not indexed'}</div><span className="provider-trace">{source.provider === 'gemini_google' ? 'GOOGLE-GROUNDED LEAD' : 'OPENAI WEB DISCOVERY'}</span>
      <div className="dossier-links"><a href={source.url} target="_blank" rel="noreferrer" title="Visit the original source">{sourceHost}<ArrowRight size={12}/></a>{source.author && <span>By {source.author}</span>}</div>
    </div>
    <blockquote><Quote size={16}/><p>{source.snippet}</p></blockquote>
    {profile && <div className="evidence-profile"><div><span>Evidence class</span><b>{profile.evidenceType.replaceAll('_', ' ')}</b></div><div><span>Claim relation</span><b className={profile.stance}>{profile.stance}</b></div><div><span>Source class</span><b>{profile.sourceType.replaceAll('_', ' ')}</b></div><p>Scored from extracted evidence attributes; not a publisher reputation label.</p></div>}
    <details className="source-trace-details"><summary>Source trace & observed signals <ChevronDown size={13}/></summary><dl><div><dt>Original link</dt><dd><a href={source.url} target="_blank" rel="noreferrer">{sourceHost}<ArrowRight size={11}/></a></dd></div><div><dt>Returned citations</dt><dd>{source.citations ?? 'Not indexed'}</dd></div><div><dt>Directness</dt><dd>{typeof profile?.directness === 'number' ? `${profile.directness}/100` : 'Being assessed'}</dd></div><div><dt>Provider</dt><dd>{source.provider === 'gemini_google' ? 'Google-grounded lead' : 'OpenAI web discovery'}</dd></div></dl></details>
    <div className="dossier-section-title"><Network size={14}/> Verification lattice <span>LIVE TRACE</span></div>
    <div className="dossier-metrics">{Object.entries(metrics).map(([key, value], index) => <motion.div key={key} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .08 }} className="metric-row"><div className="metric-header"><span className="metric-label">{metricNames[key]}<button type="button" className="metric-help" aria-label={`Explain ${metricNames[key]}`}><Info size={11}/><span role="tooltip">{metricExplanations[key]}</span></button></span><b>{value}<small>/100</small></b></div><div className="metric-track"><motion.i initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ delay: .35 + index * .08, duration: .7 }} /></div><em><CircleCheck size={12}/> {value > 74 ? 'corroborated' : value > 55 ? 'contextual review' : 'needs inquiry'}</em><details className="metric-details"><summary>Why this signal <ChevronDown size={11}/></summary><p>{metricTrace(key, source, profile)}</p></details></motion.div>)}</div>
    <div className="dossier-footer"><span>{source.citations ?? '—'} downstream citations indexed</span><a href={source.url} target="_blank" rel="noreferrer">Read original <ArrowRight size={14}/></a></div>
    {(source.isDodgy || (source.credibilityScore ?? 100) < 50) && <button className="disintegrate-button" onClick={() => onDisintegrate(source)}><Atom size={14}/> Disintegrate weak trace</button>}
  </motion.aside>;
}

function ClaimDossier({ claim, isDarkMode, onClose, onDisintegrate }: { claim: Branch; isDarkMode: boolean; onClose: () => void; onDisintegrate: (claim: Branch) => void }) {
  return <motion.aside initial={{ x: -18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -18, opacity: 0 }} className={cn('source-dossier', isDarkMode ? 'dossier-dark' : 'dossier-light')}><button className="dossier-close" onClick={onClose} title="Close claim controls"><X size={17}/></button><div className="dossier-kicker"><Network size={14}/><span>CONFIDENCE CARD</span></div><h2>{claim.claim}</h2><div className="dossier-score"><span>Claim confidence</span><b>{claim.confidenceScore}%</b></div><div className="evidence-profile"><div><span>Evidence sources</span><b>{claim.sources.length} linked traces</b></div><div><span>Bias analysis</span><b className="context">contextual review</b></div><p>{claim.biasAnalysis}</p></div><p className="dossier-note">Removing this card removes its linked source traces from the active graph. The saved research artefact remains unchanged.</p><button className="disintegrate-button" onClick={() => onDisintegrate(claim)}><Atom size={14}/> Disintegrate confidence card</button></motion.aside>;
}

function ResearchBriefPanel({ summary, isDarkMode, onClose }: { summary: string; isDarkMode: boolean; onClose: () => void }) {
  return <motion.div initial={{ opacity: 0, backdropFilter: 'blur(0px)' }} animate={{ opacity: 1, backdropFilter: 'blur(18px)' }} exit={{ opacity: 0, backdropFilter: 'blur(0px)' }} transition={{ duration: .22 }} className="research-brief-modal" onMouseDown={onClose}><motion.aside initial={{ y: 24, opacity: 0, scale: .98, filter: 'blur(7px)' }} animate={{ y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ y: 24, opacity: 0, scale: .98, filter: 'blur(7px)' }} transition={{ type: 'spring', stiffness: 230, damping: 24 }} role="dialog" aria-modal="true" aria-label="Research briefing" onMouseDown={(event) => event.stopPropagation()} className={cn('research-brief-panel', isDarkMode ? 'dossier-dark' : 'dossier-light')}><div className="dossier-topline"><span><Sparkles size={14}/> Research briefing</span><button onClick={onClose} title="Close briefing"><X size={17}/></button></div><p>{summary}</p></motion.aside></motion.div>;
}

function ResultsToolbar({ isDarkMode, viewMode, labelMode, summarising, onViewMode, onLabelMode, onSummary, onSave, onExport, onLibrary, onInfo, onTheme, onNewSearch }: { isDarkMode: boolean; viewMode: '3d' | '2d'; labelMode: 'hover' | 'all'; summarising: boolean; onViewMode: (mode: '3d' | '2d') => void; onLabelMode: () => void; onSummary: () => void; onSave: () => void; onExport: () => void; onLibrary: () => void; onInfo: () => void; onTheme: () => void; onNewSearch: () => void }) {
  return <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="result-toolbar"><div className={`result-brand text-xl font-serif tracking-[0.22em] uppercase ${isDarkMode ? 'text-amber-50' : 'text-slate-900'}`}>Sourceful</div><div className="result-actions"><div className={`result-mode-cluster flex items-center rounded-full border p-1 backdrop-blur-md ${isDarkMode ? 'bg-slate-900/75 border-white/10' : 'bg-white/80 border-slate-200'}`}><button aria-label="3D discovery view" onClick={() => onViewMode('3d')} className={`view-mode-button ${viewMode === '3d' ? 'selected' : ''}`}><Box size={13}/><span>Discovery</span></button><button aria-label="2D board view" onClick={() => onViewMode('2d')} className={`view-mode-button ${viewMode === '2d' ? 'selected' : ''}`}><PanelsTopLeft size={13}/><span>Board</span></button>{viewMode === '3d' && <button aria-label="Toggle graph labels" onClick={onLabelMode} className={`view-mode-button ${labelMode === 'all' ? 'selected' : ''}`} title={labelMode === 'all' ? 'Labels are visible for every node' : 'Labels appear only on hover'}><Tags size={13}/><span>Labels: {labelMode === 'all' ? 'All' : 'Hover'}</span></button>}<button aria-label="Generate research briefing" onClick={onSummary} className="view-mode-button" title="Generate a careful research briefing"><Sparkles size={13}/><span>{summarising ? 'Writing' : 'Brief'}</span></button><button aria-label="Save graph to browser" onClick={onSave} className="view-mode-button" title="Save this knowledge graph to your browser"><Save size={13}/><span>Save</span></button><button aria-label="Export evidence as CSV" onClick={onExport} className="view-mode-button" title="Export claims and sources as CSV"><Download size={13}/><span>CSV</span></button></div><div className="result-utility"><button aria-label="Saved research library" onClick={onLibrary} title="Saved research library"><FolderOpen size={16}/></button><button aria-label="How Sourceful evaluates evidence" onClick={onInfo} title="How Sourceful evaluates evidence"><Info size={16}/></button><button aria-label="Toggle theme" onClick={onTheme} title="Toggle theme">{isDarkMode ? <Sun size={16}/> : <Moon size={16}/>}</button></div><button aria-label="Start new search" onClick={onNewSearch} className={`result-new-search text-sm transition-colors px-4 py-2 rounded-full backdrop-blur-md border ${isDarkMode ? 'text-white/70 hover:text-white bg-slate-900/70 hover:bg-slate-900 border-white/10' : 'text-slate-600 hover:text-slate-900 bg-white/80 hover:bg-white border-slate-200'}`}><span>New Search</span><Search size={15}/></button></div></motion.div>;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [model, setModel] = useState('gpt-5.6-terra');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<Branch | null>(null);
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const [labelMode, setLabelMode] = useState<'hover' | 'all'>('hover');
  const [googleCrosscheck, setGoogleCrosscheck] = useState(false);
  const [researchMode, setResearchMode] = useState('auto');
  const [artifacts, setArtifacts] = useState<SavedArtifact[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [summarising, setSummarising] = useState(false);
  const [disintegratingSourceUrl, setDisintegratingSourceUrl] = useState<string | null>(null);
  const [disintegratingClaim, setDisintegratingClaim] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [keyVaultOpen, setKeyVaultOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [guideVisible, setGuideVisible] = useState(true);
  const [guideEnabled, setGuideEnabled] = useState(true);
  const [researchStage, setResearchStage] = useState('Preparing research protocol');
  const requestControllerRef = useRef<AbortController | null>(null);
  const [searchPanelKey, setSearchPanelKey] = useState(0);
  const demoPrompt = 'Explore a guided evidence graph: how can independent records corroborate a historical claim?';

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    try { setArtifacts(JSON.parse(localStorage.getItem(artifactStorageKey) || '[]')); } catch { setArtifacts([]); }
    setGuideEnabled(localStorage.getItem('sourceful-explore-guide') !== 'off');
  }, []);

  useEffect(() => {
    if (appState !== 'loading') return;
    const stages = ['Mapping the claim graph', 'Discovering independent evidence', 'Testing source provenance', 'Resolving contradictions', 'Forming a conservative conclusion'];
    let index = 0; setResearchStage(stages[0]);
    const timer = window.setInterval(() => { index = Math.min(index + 1, stages.length - 1); setResearchStage(stages[index]); }, 1800);
    return () => window.clearInterval(timer);
  }, [appState]);

  const persistArtifacts = (next: SavedArtifact[]) => { setArtifacts(next); localStorage.setItem(artifactStorageKey, JSON.stringify(next)); };
  const saveArtifact = () => {
    if (!result) return;
    const artifact: SavedArtifact = { id: crypto.randomUUID(), title: result.coreConcept.slice(0, 90), createdAt: new Date().toISOString(), query, model, result, summary: summary || undefined };
    persistArtifacts([artifact, ...artifacts].slice(0, 40));
  };
  const exportEvidenceCsv = () => {
    if (!result) return;
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""').replace(/[\r\n]+/g, ' ')}"`;
    const header = ['core_concept', 'overall_confidence', 'claim', 'claim_confidence', 'claim_bias_analysis', 'source_title', 'source_url', 'source_snippet', 'cited_text', 'credibility_score', 'is_dodgy', 'author', 'published_at', 'source_type', 'evidence_type', 'stance', 'citations', 'authority', 'evidence_quality', 'independence', 'recency', 'transparency', 'corroboration', 'citation_network', 'semantic_depth'];
    const rows = result.branches.flatMap((branch) => branch.sources.map((source) => [result.coreConcept, result.confidenceScore, branch.claim, branch.confidenceScore, branch.biasAnalysis, source.title, source.url, source.snippet, source.citedText, source.credibilityScore, source.isDodgy, source.author, source.publishedAt, source.evidenceProfile?.sourceType, source.evidenceProfile?.evidenceType, source.evidenceProfile?.stance, source.citations, source.metrics?.authority, source.metrics?.evidenceQuality, source.metrics?.independence, source.metrics?.recency, source.metrics?.transparency, source.metrics?.corroboration, source.metrics?.citationNetwork, source.metrics?.semanticDepth]));
    const csv = [header, ...rows].map((row) => row.map(quote).join(',')).join('\n');
    const file = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(file); const anchor = document.createElement('a');
    anchor.href = href; anchor.download = `sourceful-evidence-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(href), 0);
  };
  const closeViewportPanels = () => { setSelectedSource(null); setSelectedClaim(null); setLibraryOpen(false); setInfoOpen(false); setKeyVaultOpen(false); setSummary(''); setGuideVisible(false); };
  const restoreArtifact = (artifact: SavedArtifact) => { setResult(artifact.result); setQuery(artifact.query); setModel(artifact.model); setSelectedSource(null); setSelectedClaim(null); setInfoOpen(false); setKeyVaultOpen(false); setSummary(artifact.summary || ''); setAppState('results'); setLibraryOpen(false); };
  const selectSource = (source: Source) => { closeViewportPanels(); setSelectedSource(source); };
  const selectClaim = (claim: Branch) => { closeViewportPanels(); setSelectedClaim(claim); };
  const openLibrary = () => { closeViewportPanels(); setLibraryOpen(true); };
  const openInfo = () => { closeViewportPanels(); setInfoOpen(true); };
  const openKeyVault = () => { closeViewportPanels(); setKeyVaultOpen(true); };
  const disintegrateSource = (source: Source) => {
    if (!result || disintegratingSourceUrl || disintegratingClaim) return;
    setDisintegratingSourceUrl(source.url);
    setSelectedSource(null);
  };
  const disintegrateClaim = (claim: Branch) => {
    if (!result || disintegratingSourceUrl || disintegratingClaim) return;
    setDisintegratingClaim(claim.claim);
    setSelectedClaim(null);
  };
  const completeSourceDisintegration = () => {
    if (disintegratingSourceUrl) { const sourceUrl = disintegratingSourceUrl; setResult((current) => current ? { ...current, branches: current.branches.map((branch) => ({ ...branch, sources: branch.sources.filter((candidate) => candidate.url !== sourceUrl) })) } : current); setDisintegratingSourceUrl(null); return; }
    if (disintegratingClaim) { const claimText = disintegratingClaim; setResult((current) => current ? { ...current, branches: current.branches.filter((branch) => branch.claim !== claimText) } : current); setDisintegratingClaim(null); }
  };
  const generateSummary = async () => {
    if (!result || summarising) return;
    closeViewportPanels();
    setSummarising(true); setError('');
    try {
      const response = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifact: result, model, ...(apiKey ? { apiKey } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to generate briefing.');
      setSummary(data.summary);
    } catch (err: any) { setError(err.message || 'Unable to generate briefing.'); } finally { setSummarising(false); }
  };

  const handleSubmit = async (e?: React.FormEvent, useDemo = false, queryOverride?: string) => {
    e?.preventDefault();
    const requestText = queryOverride ?? query;
    if (!requestText.trim() && !selectedFile) return;

    setError('');

    try {
      const formData = new FormData();
      if (requestText.trim()) formData.append('text', requestText);
      formData.append('model', model);
      formData.append('demo', String(useDemo));
      formData.append('googleCrosscheck', String(googleCrosscheck));
      formData.append('researchMode', researchMode);
      if (apiKey) formData.append('apiKey', apiKey);
      if (selectedFile) formData.append('file', selectedFile);
      setAppState('loading');
      requestControllerRef.current = new AbortController();

      const response = await fetch('/api/verify', {
        method: 'POST',
        body: formData,
        signal: requestControllerRef.current.signal,
      });

      if (!response.ok) {
        let errorMsg = 'Failed to verify claims';
        try {
          // Try to parse the server error
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errData = await response.json();
            if (errData.error) errorMsg = errData.error;
          } else {
            const text = await response.text();
            console.error('Server returned non-JSON error:', text.substring(0, 200));
            if (response.status === 413) {
              errorMsg = 'File is too large.';
            } else {
              errorMsg = `Server error (${response.status}). Check console for details.`;
            }
          }
        } catch (e) {
          console.error('Failed to parse error response:', e);
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      setResult(data);
      if (useDemo) setQuery(requestText);
      setSelectedSource(null); setSelectedClaim(null); setLibraryOpen(false); setInfoOpen(false); setKeyVaultOpen(false);
      setSummary('');
      setGuideVisible(true);
      setAppState('results');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err.message || 'An error occurred');
      setAppState('idle');
    } finally { requestControllerRef.current = null; }
  };

  const cancelResearch = () => {
    requestControllerRef.current?.abort();
    setError('Research paused. The most recently completed graph has been kept.');
    setAppState(result ? 'results' : 'idle');
  };
  const resetSearch = () => { setAppState('idle'); setResult(null); setQuery(''); setSelectedFile(null); setSelectedSource(null); setSelectedClaim(null); setSummary(''); setLibraryOpen(false); setInfoOpen(false); setKeyVaultOpen(false); setConfigOpen(false); setGuideVisible(true); setSearchPanelKey((value) => value + 1); };

  const isCenter = appState === 'idle' || appState === 'encrypting' || appState === 'loading';

  return (
    <div className="min-h-screen sourceful-shell bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-sans overflow-hidden relative selection:bg-amber-500/30 transition-colors duration-500">
      <WindborneNodes />
      {result && (appState === 'results' || appState === 'loading') && (viewMode === '3d' ? <DiscoveryUniverse data={result} isDarkMode={isDarkMode} labelMode={labelMode} onSourceSelect={selectSource} onClaimSelect={selectClaim} disintegratingSourceUrl={disintegratingSourceUrl} disintegratingClaim={disintegratingClaim} onDisintegrationComplete={completeSourceDisintegration} /> : <NodeGraph data={result} isDarkMode={isDarkMode} onSourceSelect={selectSource} onClaimSelect={selectClaim} disintegratingSourceUrl={disintegratingSourceUrl} disintegratingClaim={disintegratingClaim} onDisintegrationComplete={completeSourceDisintegration} />)}
      {createPortal(<div className="sourceful-viewport-ui">
        {appState !== 'results' && <div className="utility-controls flex items-center gap-4">
          <button onClick={openLibrary} className={`p-2 transition-colors ${isDarkMode ? 'text-white/50 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`} title="Saved research library"><FolderOpen size={20} /></button>
          <button onClick={openInfo} className={`p-2 transition-colors ${isDarkMode ? 'text-white/50 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`} title="How Sourceful evaluates evidence"><Info size={20} /></button>
          <button onClick={() => setIsDarkMode(!isDarkMode)} className={`p-2 transition-colors ${isDarkMode ? 'text-white/50 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`} title="Toggle theme">{isDarkMode ? <Sun size={20} /> : <Moon size={20} />}</button>
        </div>}
        {appState === 'results' && <ResultsToolbar isDarkMode={isDarkMode} viewMode={viewMode} labelMode={labelMode} summarising={summarising} onViewMode={setViewMode} onLabelMode={() => setLabelMode((mode) => mode === 'hover' ? 'all' : 'hover')} onSummary={generateSummary} onSave={saveArtifact} onExport={exportEvidenceCsv} onLibrary={openLibrary} onInfo={openInfo} onTheme={() => setIsDarkMode(!isDarkMode)} onNewSearch={resetSearch}/>}
        <AnimatePresence>{selectedSource && <SourceDossier source={selectedSource} isDarkMode={isDarkMode} onClose={() => setSelectedSource(null)} onDisintegrate={disintegrateSource} />}{selectedClaim && <ClaimDossier claim={selectedClaim} isDarkMode={isDarkMode} onClose={() => setSelectedClaim(null)} onDisintegrate={disintegrateClaim} />}{libraryOpen && <ArtifactLibrary artifacts={artifacts} isDarkMode={isDarkMode} onRestore={restoreArtifact} onDelete={(id) => persistArtifacts(artifacts.filter((artifact) => artifact.id !== id))} onClose={() => setLibraryOpen(false)} />}{infoOpen && <AboutPanel isDarkMode={isDarkMode} onClose={() => setInfoOpen(false)} />}{keyVaultOpen && <ApiKeyVault isDarkMode={isDarkMode} apiKey={apiKey} onUse={setApiKey} onDisconnect={() => setApiKey('')} onClose={() => setKeyVaultOpen(false)} />}{summary && <ResearchBriefPanel summary={summary} isDarkMode={isDarkMode} onClose={() => setSummary('')} />}{result && appState === 'results' && !summary && !selectedSource && !selectedClaim && !libraryOpen && !infoOpen && !keyVaultOpen && guideVisible && guideEnabled && <ExploreGuide viewMode={viewMode} onClose={() => setGuideVisible(false)} onDisable={() => { localStorage.setItem('sourceful-explore-guide', 'off'); setGuideEnabled(false); setGuideVisible(false); }} />}</AnimatePresence>
      </div>, document.body)}

      {/* Main Content Area */}
      <main className="relative z-10 w-full h-screen flex flex-col items-center justify-center p-6 pointer-events-none">

        {/* Center input */}
        {appState !== 'results' && <motion.div
          key={searchPanelKey}
          layout
          initial={false}
          animate={{
            width: isCenter ? '100%' : 320,
            maxWidth: isCenter ? '62rem' : 320,
            minHeight: isCenter ? (appState === 'loading' ? 318 : configOpen ? 236 : 154) : 100,
            y: isCenter ? 0 : -350, // Move out of the way to top in results
            borderRadius: isCenter ? 32 : 24,
          }}
          transition={{ type: 'spring', damping: 25, stiffness: 120 }}
          className={cn(
            "relative flex flex-col items-center justify-center shadow-2xl transition-all duration-500 pointer-events-auto",
            appState === 'idle' && configOpen ? "overflow-visible" : "overflow-hidden",
            appState === 'encrypting' ? "shadow-[0_0_40px_rgba(74,222,128,0.3)]" : "",
            appState === 'loading' ? "research-loading-panel shadow-[0_0_40px_rgba(59,130,246,0.3)]" : ""
          )}
          style={{
            transformStyle: 'preserve-3d',
            perspective: '1000px'
          }}
        >
          {/* Animated Glow Wrapper */}
          <div className="absolute inset-0 z-0 pointer-events-none rounded-[inherit] overflow-hidden">
            <div className={cn(
              "absolute top-1/2 left-1/2 w-[250%] aspect-square animate-spin-border pointer-events-none transition-all duration-1000 blur-xl opacity-40",
              appState === 'encrypting' ? "bg-[conic-gradient(from_0deg,transparent_0%,rgba(74,222,128,0.5)_20%,transparent_50%)]" :
              "bg-[conic-gradient(from_0deg,transparent_0%,rgba(148,163,184,0.4)_20%,transparent_50%)]"
            )} />
          </div>

          {/* Inner glass layer (covers the glow except the 1px border) */}
          <div className={cn(
            "absolute inset-[1px] backdrop-blur-xl rounded-[inherit] z-0 pointer-events-none transition-colors duration-500",
            appState === 'encrypting' ? (isDarkMode ? "bg-green-950/40" : "bg-green-50/80") :
            appState === 'loading' ? (isDarkMode ? "bg-blue-950/40" : "bg-blue-50/80") :
            (isDarkMode ? "bg-slate-900/40" : "bg-white/60")
          )} />

          {/* Actual Content Wrapper */}
          <div className={cn(
            "relative z-10 w-full h-full flex flex-col items-center justify-center rounded-[inherit]"
          )}>
            {appState === 'idle' && (
            <form onSubmit={handleSubmit} className="sourceful-composer">
              <div className="composer-prompt"><Search className={`${isDarkMode ? 'text-amber-100/55' : 'text-slate-400'} shrink-0`} size={26} /><input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask a question, paste a claim, or trace a source..." className={`${isDarkMode ? 'text-white placeholder:text-white/28' : 'text-slate-900 placeholder:text-slate-400'}`} />{(query || selectedFile) && <motion.button initial={{ opacity: 0, scale: .75 }} animate={{ opacity: 1, scale: 1 }} type="submit" className="composer-submit" title="Begin a Sourceful investigation" aria-label="Begin investigation"><ArrowRight size={22}/></motion.button>}</div>
              <div className="composer-controls">
                <span className="composer-label">INTELLIGENT PATH</span><span className="auto-route-copy">{researchMode === 'auto' ? 'Sourceful chooses the method for this question' : `Manual: ${researchMode.replaceAll('_', ' ')}`}</span>
                <span className="control-spacer"/>
                {selectedFile && <span className="selected-file">{selectedFile.name}</span>}
                <button type="button" onClick={() => fileInputRef.current?.click()} className="upload-control" title="Attach a text document or image as an untrusted research lead"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.2 15c.7-1.2 1-2.5.7-3.9-.6-2-2.4-3.5-4.4-3.5h-1.2c-.7-3-3.2-5.2-6.2-5.6-3-.3-5.9 1.3-7.3 4-1.2 2.5-1 6.5.5 8.8m8.7-1.6V21"/><path d="M16 16l-4-4-4 4"/></svg> Attach</button>
                <button type="button" onClick={() => void handleSubmit(undefined, true, demoPrompt)} className="demo-control" title="Run a simulated multi-claim Sourceful investigation without API keys"><Atom size={14}/> Guided demo</button>
                <button type="button" onClick={() => setConfigOpen(!configOpen)} className={`config-control ${configOpen ? 'active' : ''}`} title="Configure the AI profile, research route, and Google cross-check"><SlidersHorizontal size={14}/> Configure</button>
                <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.md,.csv,.json,image/png,image/jpeg,image/webp" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
              </div>
              <AnimatePresence>{configOpen && <motion.div initial={{ opacity: 0, height: 0, y: -6 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0, y: -6 }} className="composer-config-panel"><GlassMenu label="AI profile" title="Choose depth, balance, or speed for this investigation" value={model} onChange={setModel} options={[{value:'gpt-5.6-sol',label:'Sol · depth-first'},{value:'gpt-5.6-terra',label:'Terra · balanced'},{value:'gpt-5.6-luna',label:'Luna · fast'}]}/><GlassMenu label="Research path" title="Auto uses Sourceful's route classifier; choose manually only when you need a specific method" value={researchMode} onChange={setResearchMode} options={[{value:'auto',label:'Auto — recommended'},{value:'public_claim',label:'Public claim'},{value:'historical',label:'History'},{value:'scripture',label:'Scripture'},{value:'math',label:'Maths'},{value:'document',label:'Document'}]}/><button type="button" onClick={() => setGoogleCrosscheck(!googleCrosscheck)} title="Ask Gemini Google Search for an additional, separately labelled source-discovery pass. OpenAI still adjudicates the graph." className={`crosscheck-toggle ${googleCrosscheck ? 'active' : ''}`}><ScanSearch size={14}/><span>Google cross-check {googleCrosscheck ? 'on' : 'off'}</span></button><button type="button" onClick={openKeyVault} className={`vault-trigger ${apiKey ? 'active' : ''}`} title="Use your own OpenAI API key. Keys can be encrypted on this browser with a passphrase."><Lock size={13}/><span>{apiKey ? 'Key unlocked' : hasRememberedApiKey() ? 'Unlock API key' : 'Connect API key'}</span></button></motion.div>}</AnimatePresence>
            </form>
          )}

          {appState === 'encrypting' && (
            <div className="flex flex-col items-center justify-center space-y-4">
              <Lock className={`${isDarkMode ? 'text-green-400' : 'text-green-600'} animate-pulse`} size={32} />
              <span className={`text-sm font-medium tracking-widest uppercase ${isDarkMode ? 'text-green-400/80' : 'text-green-600/80'}`}>Encrypting File Safely</span>
            </div>
          )}

          {appState === 'loading' && <ResearchBuildLoader isDarkMode={isDarkMode} stage={researchStage} onCancel={cancelResearch}/>}

          </div>
        </motion.div>}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-24 bg-red-500/10 border border-red-500/20 text-red-400 px-6 py-3 rounded-xl backdrop-blur-md"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

      </main>

    </div>
  );
}
