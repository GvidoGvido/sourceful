import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, ArrowRight, ShieldAlert, Lock, Sun, Moon, FolderOpen, Info, X, Quote, Network, BookOpenCheck, CircleCheck, Box, PanelsTopLeft, ScanSearch, Save, Sparkles, Trash2, Atom, SlidersHorizontal, ChevronDown, MousePointer2, Download, Tags, Pause, Play } from 'lucide-react';
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
  const calibratedDirectness = source.credibilityPath?.directness ?? profile?.directness;
  const labels: Record<string, string> = {
    authority: profile?.sourceType ? `Observed source class: ${profile.sourceType.replaceAll('_', ' ')}${profile.authorNamed ? '; author is named.' : '; author attribution is not confirmed.'}` : 'Source class and author attribution are being assessed from the returned research record.',
    evidenceQuality: profile?.evidenceType ? `Returned evidence type: ${profile.evidenceType.replaceAll('_', ' ')}. The source excerpt is judged for directness to this claim.` : 'Evidence type is inferred from the returned source excerpt.',
    independence: 'Independent paths are counted only when the research graph does not identify them as repeated or derivative traces.',
    recency: source.publishedAt ? `Returned publication date: ${source.publishedAt}. Its relevance depends on the claim’s time sensitivity.` : 'No publication date was returned; the system cannot treat recency as a strong signal.',
    transparency: profile ? `${profile.authorNamed ? 'Named author' : 'Author not confirmed'} · ${profile.methodologyVisible ? 'methodology visible' : 'methodology not visible'} · ${profile.correctionsVisible ? 'corrections policy visible' : 'corrections policy not visible'} · ${profile.citedReferenceCount ?? 0} cited references.` : 'Authorship, methodology, corrections, and cited references are being assessed when present.',
    corroboration: `${source.citations ?? 0} linked citations were returned for this trace. Agreement from a single origin remains a single evidentiary path.`,
    citationNetwork: profile ? `${profile.citedReferenceCount ?? 0} cited references were visible in the returned source profile.` : `${source.citations ?? 0} linked citations were returned with this source.`,
    semanticDepth: typeof calibratedDirectness === 'number' ? `Calibrated extract directness: ${calibratedDirectness}/100. The initial extractor observation is capped against exact claim terms recovered from the returned passage.` : 'Directness is estimated from the relationship between the retrieved extract and this claim.'
  };
  return labels[key] || 'This signal is calculated from the returned source record and its position in the active evidence graph.';
}

type SavedArtifact = { id: string; title: string; createdAt: string; query: string; model: string; result: VerificationResult; summary?: string };
const artifactStorageKey = 'sourceful-research-library-v1';
const savedText = (...values: unknown[]) => values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() || '';

// URLs and claim wording are evidence attributes, not unique graph keys. One source can
// legitimately inform two branches, so the interactive graph always receives its own IDs.
function identifyGraph(result: VerificationResult): VerificationResult {
  const usedBranchIds = new Set<string>();
  const usedSourceIds = new Set<string>();
  const legacyResult = result as VerificationResult & Record<string, unknown>;
  const savedBranches = Array.isArray(legacyResult.branches) ? legacyResult.branches : [];
  return {
    ...result,
    coreConcept: savedText(legacyResult.coreConcept, legacyResult.query, legacyResult.title) || 'Untitled research question',
    branches: savedBranches.map((branch, branchIndex) => {
      const legacyBranch = branch as Branch & Record<string, unknown>;
      const savedSources = Array.isArray(legacyBranch.sources) ? legacyBranch.sources : [];
      // Earlier locally saved research may predate the current branch-card schema. Preserve
      // the best available wording instead of rendering an empty card on the board.
      const claim = savedText(
        legacyBranch.claim,
        legacyBranch.subClaim,
        legacyBranch.statement,
        legacyBranch.proposition,
        legacyBranch.title,
        legacyBranch.biasAnalysis,
        (savedSources[0] as Source | undefined)?.citedText
      ) || 'Unlabelled saved claim';
      let branchId = branch.graphId || `branch-${branchIndex}`;
      if (usedBranchIds.has(branchId)) branchId = `branch-${branchIndex}-${usedBranchIds.size}`;
      usedBranchIds.add(branchId);
      return {
        ...branch,
        claim,
        graphId: branchId,
        sources: savedSources.map((source, sourceIndex) => {
          let sourceId = source.graphId || `${branchId}:source-${sourceIndex}`;
          if (usedSourceIds.has(sourceId)) sourceId = `${branchId}:source-${sourceIndex}-${usedSourceIds.size}`;
          usedSourceIds.add(sourceId);
          return { ...source, graphId: sourceId };
        })
      };
    })
  };
}

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
  return <motion.div initial={{ opacity: 0, backdropFilter: 'blur(0px)' }} animate={{ opacity: 1, backdropFilter: 'blur(20px)' }} exit={{ opacity: 0, backdropFilter: 'blur(0px)' }} className="api-key-vault-modal" onMouseDown={onClose}>
    <motion.aside initial={{ opacity: 0, y: 22, scale: .97, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 18, scale: .97, filter: 'blur(8px)' }} transition={{ type: 'spring', stiffness: 245, damping: 24 }} role="dialog" aria-modal="true" aria-label="Personal API vault" onMouseDown={(event) => event.stopPropagation()} className={cn('api-key-vault', isDarkMode ? 'dossier-dark' : 'dossier-light')}><div className="dossier-topline"><span><Lock size={14}/> Personal API vault</span><button onClick={onClose} title="Close key vault"><X size={17}/></button></div><p>Sourceful sends this key only to its server for your request. It is never written to the server, logs, saved graphs, or CSV export.</p>{apiKey ? <div className="vault-active"><CircleCheck size={15}/><span>Key unlocked for this tab</span><button type="button" onClick={onDisconnect}>Disconnect</button></div> : stored ? <div className="vault-unlock"><label>Vault passphrase<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" placeholder="Unlock this browser vault" /></label><button type="button" onClick={unlock} disabled={busy}>{busy ? 'Unlocking…' : 'Unlock key'}</button><button type="button" className="vault-forget" onClick={forget}>Forget saved key</button></div> : <div className="vault-connect"><label>OpenAI API key<input type="password" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} autoComplete="off" spellCheck={false} placeholder="sk-…" /></label><label className="vault-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Remember on this device with encryption</label>{remember && <label>Vault passphrase <small>12+ characters; never stored</small><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" placeholder="Create a vault passphrase" /></label>}<button type="button" onClick={useForTab} disabled={busy}>{busy ? 'Protecting…' : remember ? 'Encrypt & connect' : 'Connect for this tab'}</button></div>}<small className="vault-footnote">A saved key remains encrypted at rest. It must be unlocked after a refresh; a malicious browser extension or XSS can still access an unlocked key, so use a restricted project key and keep your browser trusted.</small>{message && <div className="vault-message">{message}</div>}</motion.aside>
  </motion.div>;
}

function ArtifactLibrary({ artifacts, isDarkMode, onRestore, onRename, onDelete, onClose }: { artifacts: SavedArtifact[]; isDarkMode: boolean; onRestore: (artifact: SavedArtifact) => void; onRename: (id: string, title: string) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const beginRename = (artifact: SavedArtifact) => { setEditingId(artifact.id); setTitleDraft(artifact.title); };
  const saveRename = () => {
    if (!editingId) return;
    const nextTitle = titleDraft.trim();
    if (nextTitle) onRename(editingId, nextTitle.slice(0, 120));
    setEditingId(null); setTitleDraft('');
  };
  const cancelRename = () => { setEditingId(null); setTitleDraft(''); };
  return <motion.aside initial={{ x: 18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 18, opacity: 0 }} className={cn('artifact-library', isDarkMode ? 'dossier-dark' : 'dossier-light')}><div className="dossier-topline"><span><FolderOpen size={14}/> Research library</span><button onClick={onClose}><X size={17}/></button></div>{artifacts.length ? <div className="artifact-list">{artifacts.map((artifact) => { const editing = editingId === artifact.id; return <article key={artifact.id}><div><span>{new Date(artifact.createdAt).toLocaleDateString()}</span>{editing ? <input className="artifact-title-input" aria-label="Research item name" autoFocus value={titleDraft} maxLength={120} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveRename(); if (event.key === 'Escape') cancelRename(); }} /> : <h3>{artifact.title}</h3>}<p>{artifact.result.branches.length} claim branches · {artifact.result.researchRoute?.replaceAll('_', ' ') || 'research'}</p></div><footer>{editing ? <div className="artifact-rename-actions"><button onClick={cancelRename}>Cancel</button><button onClick={saveRename} disabled={!titleDraft.trim()}>Save name</button></div> : <><button onClick={() => onRestore(artifact)}>Open</button><button onClick={() => beginRename(artifact)} title="Rename saved research">Rename</button><button onClick={() => onDelete(artifact.id)} title="Delete saved artifact"><Trash2 size={13}/></button></>}</footer></article>; })}</div> : <div className="empty-library"><Atom size={24}/><p>Your saved knowledge graphs will live here.</p></div>}</motion.aside>;
}

function AboutPanel({ isDarkMode, onClose }: { isDarkMode: boolean; onClose: () => void }) {
  return <motion.aside initial={{ y: -18, opacity: 0, scale: .97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -18, opacity: 0, scale: .97 }} className={cn('about-panel', isDarkMode ? 'dossier-dark' : 'dossier-light')}>
    <div className="dossier-topline"><span><Info size={14}/> The Sourceful method</span><button onClick={onClose}><X size={17}/></button></div>
    <h2>Evidence, not an oracle.</h2>
    <p>Sourceful separates discovery from claim evaluation. It exposes the evidence path, discounts repeated provenance, and keeps credible counterevidence visible.</p>
    <div className="about-grid"><div><b>01</b><span>Routes each question to public-claim, historical, scripture, mathematical, or document research.</span></div><div><b>02</b><span>Compounds source quality, exact claim relevance, directness, and independence—without counting repeated paths twice.</span></div><div><b>03</b><span>Shows support and refutation separately, then marks a claim corroborated, contested, provisional, refuted, or insufficient.</span></div></div>
    <section className="about-read-guide" aria-label="How to read a Sourceful graph"><h3>How to read the graph</h3><ol><li><b>Core orb</b><span>Your question and its current assessment confidence. It is a research-state signal, never a truth probability.</span></li><li><b>Branch orb</b><span>A testable sub-claim. Its +/− values keep supporting and refuting evidence separate; distance reflects evidentiary proximity, not popularity.</span></li><li><b>Source orb</b><span>One source trace. Green supports, rose/red challenges, gold adds context, and blue remains unresolved. Hover for the recovered extract; select the orb for its dossier.</span></li><li><b>Gold route</b><span>The currently selected node and its path back to your question. The dossier explains source quality, relevance, calibrated directness, and independence.</span></li></ol></section>
    <p className="about-note">The Guided demo is simulated; its illustration is decorative, never evidence. Live research requires your OpenAI key.</p>
  </motion.aside>;
}

function ExploreGuide({ viewMode, onClose, onDisable }: { viewMode: '3d' | '2d'; onClose: () => void; onDisable: () => void }) {
  const instruction = viewMode === '3d' ? 'Drag the field to orbit. Hover a sphere for its evidence extract.' : 'Drag to explore the board. Use the zoom controls at bottom-right to change scale.';
  return <motion.div initial={{ opacity:0, y:14, filter:'blur(7px)' }} animate={{ opacity:1, y:0, filter:'blur(0px)' }} exit={{ opacity:0, y:14, filter:'blur(7px)' }} className="explore-guide"><button onClick={onClose} title="Dismiss guide"><X size={13}/></button><div><MousePointer2 size={14}/><span>HOW TO EXPLORE</span></div><p>{instruction}</p><small>Select any source to open its dossier. Weak traces can be dissolved when their evidence fails.</small><button className="guide-disable" onClick={onDisable}>Don’t show this guide again</button></motion.div>;
}

function WindborneNodes() {
  const nodes = useMemo(() => Array.from({ length: 78 }, (_, index) => ({
    id: index, left: (index * 37.7) % 100, top: (index * 61.9) % 100, size: index % 11 === 0 ? 7 : index % 5 === 0 ? 4 : 2,
    driftX: 5 + (index % 9) * 2.2, driftY: -(8 + (index % 7) * 1.45), duration: 27 + (index % 12) * 3.4, delay: -(index % 10) * 2.1, accent: index % 13 === 0
  })), []);
  return <div className="windborne-nodes" aria-hidden="true">{nodes.map((node) => <motion.i key={node.id} className={node.accent ? 'accent' : ''} style={{ left: `${node.left}%`, top: `${node.top}%`, width: node.size, height: node.size }} animate={{ x: [0, node.driftX * .24, node.driftX, node.driftX * .74, 0], y: [0, node.driftY * .3, node.driftY, node.driftY * .76, 0], opacity: [.08, .32, .22, .36, .08], scale: [1, .94, 1.05, .98, 1] }} transition={{ duration: node.duration, delay: node.delay, repeat: Infinity, ease: 'easeInOut' }} />)}</div>;
}

const researchMapPaths = ['M20 192H132V78H246V138H374V48H510V112H648V70H794V156H938','M20 192H92V228H214V176H326V218H472V156H606V204H754V128H914','M132 78H188V28H306V92H440V36H570V88H704V34H862','M246 138H304V178H438V108H554V154H684V98H812V144','M374 48V12H486V72H620V22H734V62H900','M510 112V238H650V186H784V236H930'];
const researchMapNodes = [[20,192],[132,78],[132,228],[246,138],[374,48],[374,218],[510,112],[510,238],[648,70],[648,204],[794,156],[862,34],[938,192]];

function ResearchBuildLoader({ isDarkMode, stage, onCancel }: { isDarkMode: boolean; stage: string; onCancel: () => void }) {
  return <div className="research-build-loader">
    <svg className="research-build-map" viewBox="0 0 960 260" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="research-trace" x1="0" x2="1"><stop stopColor={isDarkMode ? '#5da9ff' : '#2e70ed'} stopOpacity=".1"/><stop offset=".5" stopColor={isDarkMode ? '#9ce5ff' : '#316ee8'} stopOpacity=".72"/><stop offset="1" stopColor={isDarkMode ? '#e5bd67' : '#bd8623'} stopOpacity=".2"/></linearGradient>
        <filter id="research-glow"><feGaussianBlur stdDeviation="1.25" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      {researchMapPaths.map((path, index) => <motion.path key={path} d={path} fill="none" stroke="url(#research-trace)" strokeWidth={index % 3 === 0 ? 1.35 : .9} strokeLinecap="square" strokeLinejoin="miter" filter="url(#research-glow)" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: [0, 1, 1], opacity: [0, .42, .16] }} transition={{ duration: 1.8, delay: index * .16, repeat: Infinity, repeatDelay: 4.2, ease: 'easeInOut' }}/>) }
      {researchMapNodes.map(([cx, cy], index) => <motion.circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index === 0 ? 3.5 : index % 3 === 0 ? 2.5 : 1.7} fill={index === 0 ? '#f0c868' : '#70b5ff'} initial={{ opacity: 0, scale: .25 }} animate={{ opacity: [0, .55, .24, .55], scale: [.25, 1, 1.18, 1] }} transition={{ duration: 1.65, delay: .25 + index * .13, repeat: Infinity, repeatDelay: 4.2, ease: 'easeInOut' }}/>) }
    </svg>
    <div className="research-build-copy"><motion.div className="research-build-beacon" animate={{ scale: [1, 1.12, 1], opacity: [.5, .8, .5] }} transition={{ duration: 1.8, repeat: Infinity }}><Sparkles size={16}/></motion.div><span>LIVE EVIDENCE MAP</span><strong>{stage}</strong><small>Tracing independent leads, contradictions, and provenance.</small><button onClick={onCancel} className="pause-research">Stop &amp; keep completed graph</button></div>
  </div>;
}

function InteractionToast({ message }: { message: string }) {
  return <div className="interaction-toast-anchor" role="status" aria-live="polite"><motion.div initial={{ opacity: 0, y: 10, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 7, scale: .96 }} className="interaction-toast"><CircleCheck size={15}/><span>{message}</span></motion.div></div>;
}

type MenuOption = { value: string; label: string };
function GlassMenu({ label, title, value, options, onChange }: { label: string; title: string; value: string; options: MenuOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false); const selected = options.find((option) => option.value === value) || options[0];
  return <label className="glass-menu" title={title}><span>{label}</span><button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><b>{selected.label}</b><ChevronDown size={13} className={open ? 'rotated' : ''}/></button><AnimatePresence>{open && <motion.div role="listbox" initial={{ opacity: 0, y: -5, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: .97 }} className="glass-menu-options">{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value} className={option.value === value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}</motion.div>}</AnimatePresence></label>;
}

function SourceVisualCarousel({ source }: { source: Source }) {
  // Never borrow another node's imagery: visuals are selected-page metadata, except an explicitly labelled guided-demo illustration.
  const orderedVisuals = useMemo(() => [...new Set([source.imageUrl, ...(source.imageUrls || [])].filter((value): value is string => Boolean(value)))].slice(0, 4), [source.imageUrl, source.imageUrls]);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => { setActiveIndex(0); }, [source.graphId, source.imageUrl]);
  useEffect(() => {
    if (orderedVisuals.length < 2) return;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % orderedVisuals.length), 4200);
    return () => window.clearInterval(timer);
  }, [orderedVisuals.length]);
  if (!orderedVisuals.length) return null;
  return <div className="dossier-visual-carousel" aria-label={orderedVisuals.length > 1 ? 'Source visual carousel' : 'Source visual'}>
    <AnimatePresence mode="wait"><motion.img key={orderedVisuals[activeIndex]} initial={{ opacity: 0, scale: 1.04, filter: 'blur(5px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: .98, filter: 'blur(5px)' }} transition={{ duration: .58, ease: 'easeOut' }} src={orderedVisuals[activeIndex]} alt={source.isDemoVisual ? 'Guided-demo decorative illustration' : 'Visual metadata from an active evidence source'} /></AnimatePresence>
    {orderedVisuals.length > 1 && <div className="dossier-visual-dots" aria-hidden="true">{orderedVisuals.map((_, index) => <i key={index} className={index === activeIndex ? 'active' : ''}/>)}</div>}
  </div>;
}

function SourceDossier({ source, isDarkMode, onClose, onDisintegrate }: { source: Source; isDarkMode: boolean; onClose: () => void; onDisintegrate: (source: Source) => void }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const fallback = { authority: 72, evidenceQuality: 78, independence: 74, recency: 68, transparency: 76, corroboration: 70, citationNetwork: 66, semanticDepth: 81 };
  const metrics = { ...fallback, ...source.metrics, ...(source.credibilityPath ? { semanticDepth: source.credibilityPath.directness } : {}) };
  const profile = source.evidenceProfile;
  const hasThumbnail = Boolean(source.imageUrl && !thumbnailFailed);
  const sourceHost = (() => {
    try { return new URL(source.url).hostname.replace(/^www\./, ''); } catch { return 'Open original source'; }
  })();
  const visualStatus = source.isDemoVisual ? 'Guided-demo illustration · not source evidence' : hasThumbnail ? 'Source visual metadata available' : source.imageUrl ? 'Source visual unavailable in this browser' : source.contentInspected ? 'No source visual metadata exposed' : 'Source visual metadata not inspected';
  return <motion.aside initial={{ x: -18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -18, opacity: 0 }} className={cn('source-dossier', isDarkMode ? 'dossier-dark' : 'dossier-light')}>
    <div className="dossier-topline"><span><BookOpenCheck size={14}/> Evidence dossier</span><button onClick={onClose}><X size={17}/></button></div>
    <div className={cn('dossier-source', hasThumbnail && 'has-thumbnail')}>
      {hasThumbnail ? <a className="dossier-thumbnail" href={source.url} target="_blank" rel="noreferrer" title="Open the original source"><img src={source.imageUrl} alt="" onError={() => setThumbnailFailed(true)} /><span>{source.isDemoVisual ? 'Guided illustration' : 'Open source'}</span></a> : <div className="dossier-orb"/>}
      <p>SELECTED SOURCE</p><h2>{source.title}</h2><div className="dossier-byline">{source.author || 'Author attribution being assessed'} · {source.publishedAt || 'Date not indexed'}</div><span className="provider-trace">{source.provider === 'gemini_google' ? 'GOOGLE-GROUNDED LEAD' : 'OPENAI WEB DISCOVERY'}</span>
      <div className="dossier-links"><a href={source.url} target="_blank" rel="noreferrer" title="Visit the original source">{sourceHost}<ArrowRight size={12}/></a>{source.author && <span>By {source.author}</span>}<span className="visual-fetch-status">{visualStatus}</span></div>
    </div>
    <blockquote><Quote size={16}/><p>{source.snippet}</p></blockquote>
    <SourceVisualCarousel source={source}/>
    {source.credibilityPath && <section className="credibility-path-panel"><div><span><Network size={13}/> Credibility path</span><b>{source.credibilityPath.compoundedContribution}% contribution</b></div><p>{source.credibilityPath.provenanceGroup}. The score is a bounded evidence contribution to this claim—not a probability that the claim is true.</p><dl><div><dt>Source quality</dt><dd>{source.credibilityPath.sourceQuality}/100</dd></div><div><dt>Claim relevance</dt><dd>{source.credibilityPath.claimRelevance}/100</dd></div><div><dt>Directness</dt><dd>{source.credibilityPath.directness}/100</dd></div><div><dt>Independence</dt><dd>{source.credibilityPath.independence}/100</dd></div></dl></section>}
    {profile && <div className="evidence-profile"><div><span>Evidence class</span><b>{profile.evidenceType.replaceAll('_', ' ')}</b></div><div><span>Claim relation</span><b className={profile.stance}>{profile.stance}</b></div><div><span>Source class</span><b>{profile.sourceType.replaceAll('_', ' ')}</b></div><p>Scored from extracted evidence attributes; not a publisher reputation label.</p></div>}
    <details className="source-trace-details"><summary>Source trace & observed signals <ChevronDown size={13}/></summary><dl><div><dt>Original link</dt><dd><a href={source.url} target="_blank" rel="noreferrer">{sourceHost}<ArrowRight size={11}/></a></dd></div><div><dt>Claim terms recovered</dt><dd>{source.claimMatches?.length ? source.claimMatches.join(' · ') : source.contentInspected ? 'No multi-term page extract recovered' : 'Not fetched yet'}</dd></div><div><dt>Returned citations</dt><dd>{source.citations ?? 'Not indexed'}</dd></div><div><dt>Observed active links</dt><dd>{typeof source.observedReferenceCount === 'number' ? `${source.observedReferenceCount} linked traces` : 'Not fetched yet'}</dd></div><div><dt>Observed reference paths</dt><dd>{source.citationFingerprints?.length ? `${source.citationFingerprints.length} external reference fingerprints` : source.contentInspected ? 'No qualifying shared-reference path observed' : 'Not fetched yet'}</dd></div><div><dt>Directness</dt><dd>{typeof source.credibilityPath?.directness === 'number' ? `${source.credibilityPath.directness}/100 · calibrated against recovered claim terms` : typeof profile?.directness === 'number' ? `${profile.directness}/100 · extractor observation` : 'Being assessed'}</dd></div><div><dt>Provider</dt><dd>{source.provider === 'gemini_google' ? 'Google-grounded lead' : 'OpenAI web discovery'}</dd></div></dl></details>
    <div className="dossier-section-title"><Network size={14}/> Verification lattice <span>LIVE TRACE</span></div>
    <div className="dossier-metrics">{Object.entries(metrics).map(([key, value], index) => <motion.div key={key} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .08 }} className="metric-row"><div className="metric-header"><span className="metric-label">{metricNames[key]}<button type="button" className="metric-help" aria-label={`Explain ${metricNames[key]}`} aria-expanded={openMetric === key} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpenMetric((current) => current === key ? null : key); }}><Info size={11}/><span role="tooltip">{metricExplanations[key]}</span></button></span><b>{value}<small>/100</small></b></div><div className="metric-track"><motion.i initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ delay: .35 + index * .08, duration: .7 }} /></div><em><CircleCheck size={12}/> {value > 74 ? 'corroborated' : value > 55 ? 'contextual review' : 'needs inquiry'}</em><details className="metric-details"><summary>Why this signal <ChevronDown size={11}/></summary><p>{metricTrace(key, source, profile)}</p></details></motion.div>)}</div>
    <div className="dossier-footer"><span>{source.citations ?? '—'} downstream citations indexed</span><a href={source.url} target="_blank" rel="noreferrer">Read original <ArrowRight size={14}/></a></div>
    {(source.isDodgy || (source.credibilityScore ?? 100) < 50) && <button className="disintegrate-button" onClick={() => onDisintegrate(source)}><Atom size={14}/> Disintegrate weak trace</button>}
  </motion.aside>;
}

function ClaimDossier({ claim, isDarkMode, onClose, onDisintegrate, onExpand, canExpand }: { claim: Branch; isDarkMode: boolean; onClose: () => void; onDisintegrate: (claim: Branch) => void; onExpand: (claim: Branch) => void; canExpand: boolean }) {
  const balance = claim.evidenceBalance;
  return <motion.aside initial={{ x: -18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -18, opacity: 0 }} className={cn('source-dossier', isDarkMode ? 'dossier-dark' : 'dossier-light')}><button className="dossier-close" onClick={onClose} title="Close claim controls"><X size={17}/></button><div className="dossier-kicker"><Network size={14}/><span>CONFIDENCE CARD</span></div><h2>{claim.claim}</h2><div className="dossier-score"><span>Assessment confidence</span><b>{balance?.assessmentConfidence ?? claim.confidenceScore}%</b></div>{balance && <section className="claim-evidence-balance"><div><span>Supporting paths</span><b className="supports">{balance.support}</b></div><div><span>Refuting paths</span><b className="refutes">{balance.refutation}</b></div><div><span>Independent paths</span><b>{balance.independentPaths}</b></div><p>Support and refutation are compounded separately. Repeated material in a shared provenance path is discounted before aggregation.</p></section>}<div className="evidence-profile"><div><span>Evidence sources</span><b>{claim.sources.length} linked traces</b></div><div><span>Bias analysis</span><b className="context">contextual review</b></div><p>{claim.biasAnalysis}</p></div><p className="dossier-note">An expansion pass searches for missing independent support, refutation, or context for this precise claim. It deduplicates known URLs and has a visible graph budget.</p><button className="expand-claim-button" disabled={!canExpand} onClick={() => onExpand(claim)} title={canExpand ? 'Run one bounded evidence-expansion pass for this claim' : 'This graph has reached its research pass or source budget'}><Network size={14}/> Trace this claim deeper</button><button className="disintegrate-button" onClick={() => onDisintegrate(claim)}><Atom size={14}/> Disintegrate confidence card</button></motion.aside>;
}

function ResearchBriefPanel({ summary, artifact, isDarkMode, onClose }: { summary: string; artifact: VerificationResult | null; isDarkMode: boolean; onClose: () => void }) {
  const canonicalUrl = (value: string) => { try { const url = new URL(value); url.hash = ''; url.search = ''; url.pathname = url.pathname.replace(/\/+$/, '') || '/'; return url.href; } catch { return value; } };
  const sources = artifact?.branches.flatMap((branch) => branch.sources) || [];
  const sourceByUrl = new Map(sources.map((source) => [canonicalUrl(source.url), source]));
  const sourceTracesByUrl = new Map<string, Source[]>();
  sources.forEach((source) => {
    const key = canonicalUrl(source.url);
    sourceTracesByUrl.set(key, [...(sourceTracesByUrl.get(key) || []), source]);
  });
  const graphLedger = [...sourceTracesByUrl.entries()].map(([url, traces]) => {
    const credibilityScores = traces.map((trace) => trace.credibilityScore).filter((score): score is number => typeof score === 'number');
    const pathScores = traces.map((trace) => trace.credibilityPath?.compoundedContribution).filter((score): score is number => typeof score === 'number');
    return {
      url,
      title: traces[0]?.title || url,
      credibility: credibilityScores.length ? Math.round(credibilityScores.reduce((total, score) => total + score, 0) / credibilityScores.length) : null,
      contribution: pathScores.length ? Math.round(pathScores.reduce((total, score) => total + score, 0) / pathScores.length) : null,
      branches: traces.length
    };
  }).sort((left, right) => (right.credibility ?? -1) - (left.credibility ?? -1));
  const graphLedgerGroups = [
    { id: 'high', label: 'High credibility · 80–100', entries: graphLedger.filter((entry) => (entry.credibility ?? -1) >= 80) },
    { id: 'established', label: 'Established · 60–79', entries: graphLedger.filter((entry) => (entry.credibility ?? -1) >= 60 && (entry.credibility ?? -1) < 80) },
    { id: 'scrutiny', label: 'Needs scrutiny · 0–59', entries: graphLedger.filter((entry) => entry.credibility !== null && entry.credibility < 60) },
    { id: 'unrated', label: 'Score unavailable', entries: graphLedger.filter((entry) => entry.credibility === null) }
  ].filter((group) => group.entries.length);
  const interceptedLinks = (artifact?.evidenceRelations || []).filter((relation) => relation.kind === 'references').map((relation) => {
    const from = sourceByUrl.get(canonicalUrl(relation.fromUrl)); const to = sourceByUrl.get(canonicalUrl(relation.toUrl));
    const scores = [from?.credibilityScore, to?.credibilityScore].filter((score): score is number => typeof score === 'number');
    return { ...relation, fromTitle: from?.title || relation.fromUrl, toTitle: to?.title || relation.toUrl, averageConfidence: scores.length ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : null };
  });
  const sharedReferencePaths = (artifact?.evidenceRelations || []).filter((relation) => relation.kind === 'shared_citation');
  const discoveryConnectors = artifact?.researchMetadata?.discoveryConnectors || [];
  return (
    <motion.div initial={{ opacity: 0, backdropFilter: 'blur(0px)' }} animate={{ opacity: 1, backdropFilter: 'blur(18px)' }} exit={{ opacity: 0, backdropFilter: 'blur(0px)' }} transition={{ duration: .22 }} className="research-brief-modal" onMouseDown={onClose}>
      <motion.aside initial={{ y: 24, opacity: 0, scale: .98, filter: 'blur(7px)' }} animate={{ y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ y: 24, opacity: 0, scale: .98, filter: 'blur(7px)' }} transition={{ type: 'spring', stiffness: 230, damping: 24 }} role="dialog" aria-modal="true" aria-label="Research briefing" onMouseDown={(event) => event.stopPropagation()} className={cn('research-brief-panel', isDarkMode ? 'dossier-dark' : 'dossier-light')}>
        <div className="dossier-topline"><span><Sparkles size={14}/> Research briefing</span><button onClick={onClose} title="Close briefing"><X size={17}/></button></div>
        <p>{summary}</p>
        {(discoveryConnectors.length || sharedReferencePaths.length) ? <section className="brief-link-ledger"><div><Network size={13}/><span>Research provenance</span><small>{sharedReferencePaths.length} shared-reference path{sharedReferencePaths.length === 1 ? '' : 's'}</small></div>{discoveryConnectors.length ? <p>Route-aware metadata leads consulted: {discoveryConnectors.join(' · ')}. These are discovery aids, not evidence by themselves.</p> : null}{sharedReferencePaths.length ? <p>{sharedReferencePaths.length} active-source connection{sharedReferencePaths.length === 1 ? '' : 's'} share an observed external reference. Treat this as possible common provenance, not independent corroboration.</p> : null}</section> : null}
        <section className="brief-link-ledger brief-source-ledger">
          <div><Network size={13}/><span>Graph source ledger</span><small>{graphLedger.length} unique source link{graphLedger.length === 1 ? '' : 's'}</small></div>
          <p>Every source URL currently involved in the graph, grouped by its displayed credibility score. A credibility score evaluates the trace, not whether its claim is true.</p>
          {graphLedgerGroups.map((group) => <section className="brief-credibility-group" key={group.id}><h3>{group.label}<small>{group.entries.length} link{group.entries.length === 1 ? '' : 's'}</small></h3><ol>{group.entries.map((entry) => <li key={entry.url}><a href={entry.url} target="_blank" rel="noreferrer">{entry.title}</a><b>{entry.credibility === null ? 'credibility unavailable' : `credibility ${entry.credibility}%`}{entry.contribution === null ? '' : ` · average path contribution ${entry.contribution}%`}{entry.branches > 1 ? ` · appears in ${entry.branches} branches` : ''}</b></li>)}</ol></section>)}
        </section>
        <section className="brief-link-ledger">
          <div><Network size={13}/><span>Intercepted source links</span><small>{interceptedLinks.length} observed</small></div>
          {interceptedLinks.length ? <ol>{interceptedLinks.map((link, index) => <li key={`${link.fromUrl}-${link.toUrl}-${index}`}><a href={link.fromUrl} target="_blank" rel="noreferrer">{link.fromTitle}</a><span>→</span><a href={link.toUrl} target="_blank" rel="noreferrer">{link.toTitle}</a><b>{link.averageConfidence === null ? 'source confidence unavailable' : `average source confidence ${link.averageConfidence}%`}</b></li>)}</ol> : <p>No direct page-to-page links between active traces were intercepted in this pass.</p>}
        </section>
      </motion.aside>
    </motion.div>
  );
}

function ResultsToolbar({ isDarkMode, viewMode, labelMode, driftPaused, summarising, expanding, canExpand, onViewMode, onLabelMode, onDriftToggle, onSummary, onExpand, onSave, onExport, onLibrary, onInfo, onTheme, onNewSearch }: { isDarkMode: boolean; viewMode: '3d' | '2d'; labelMode: 'hover' | 'all'; driftPaused: boolean; summarising: boolean; expanding: boolean; canExpand: boolean; onViewMode: (mode: '3d' | '2d') => void; onLabelMode: () => void; onDriftToggle: () => void; onSummary: () => void; onExpand: () => void; onSave: () => void; onExport: () => void; onLibrary: () => void; onInfo: () => void; onTheme: () => void; onNewSearch: () => void }) {
  return <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="result-toolbar"><div className={`result-brand text-xl font-serif tracking-[0.22em] uppercase ${isDarkMode ? 'text-amber-50' : 'text-slate-900'}`}>Sourceful</div><div className="result-actions"><div className={`result-mode-cluster flex items-center rounded-full border p-1 backdrop-blur-md ${isDarkMode ? 'bg-slate-900/75 border-white/10' : 'bg-white/80 border-slate-200'}`}><button aria-label="3D discovery view" onClick={() => onViewMode('3d')} className={`view-mode-button ${viewMode === '3d' ? 'selected' : ''}`}><Box size={13}/><span>Discovery</span></button><button aria-label="2D board view" onClick={() => onViewMode('2d')} className={`view-mode-button ${viewMode === '2d' ? 'selected' : ''}`}><PanelsTopLeft size={13}/><span>Board</span></button>{viewMode === '3d' && <><button aria-label="Toggle graph labels" onClick={onLabelMode} className={`view-mode-button ${labelMode === 'all' ? 'selected' : ''}`} title={labelMode === 'all' ? 'Labels are visible for every node' : 'Labels appear only on hover'}><Tags size={13}/><span>Labels: {labelMode === 'all' ? 'All' : 'Hover'}</span></button><button aria-label={driftPaused ? 'Resume ambient graph drift' : 'Pause ambient graph drift'} onClick={onDriftToggle} className={`view-mode-button ${driftPaused ? 'selected' : ''}`} title={driftPaused ? 'Resume ambient graph drift' : 'Pause ambient graph drift; pan, orbit, and zoom remain available'}>{driftPaused ? <Play size={13}/> : <Pause size={13}/>}<span>Drift: {driftPaused ? 'Off' : 'On'}</span></button></>}<button aria-label="Generate research briefing" onClick={onSummary} className="view-mode-button" title="Generate a careful research briefing"><Sparkles size={13}/><span>{summarising ? 'Writing' : 'Brief'}</span></button><button aria-label="Extend the evidence graph" onClick={onExpand} disabled={!canExpand || expanding} className="view-mode-button" title={canExpand ? 'Run one bounded, deduplicated pass for missing support, refutation, and context' : 'This graph has reached its visible research budget'}><Network size={13}/><span>{expanding ? 'Tracing' : 'Extend'}</span></button><button aria-label="Save graph to browser" onClick={onSave} className="view-mode-button" title="Save this knowledge graph to your browser"><Save size={13}/><span>Save</span></button><button aria-label="Export evidence as CSV" onClick={onExport} className="view-mode-button" title="Export claims and sources as CSV"><Download size={13}/><span>CSV</span></button></div><div className="result-utility"><button aria-label="Saved research library" onClick={onLibrary} title="Saved research library"><FolderOpen size={16}/></button><button aria-label="How Sourceful evaluates evidence" onClick={onInfo} title="How Sourceful evaluates evidence"><Info size={16}/></button><button aria-label="Toggle theme" onClick={onTheme} title="Toggle theme">{isDarkMode ? <Sun size={16}/> : <Moon size={16}/>}</button></div><button aria-label="Start new search" onClick={onNewSearch} className={`result-new-search text-sm transition-colors px-4 py-2 rounded-full backdrop-blur-md border ${isDarkMode ? 'text-white/70 hover:text-white bg-slate-900/70 hover:bg-slate-900 border-white/10' : 'text-slate-600 hover:text-slate-900 bg-white/80 hover:bg-white border-slate-200'}`}><span>New Search</span><Search size={15}/></button></div></motion.div>;
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
  const [graphDriftPaused, setGraphDriftPaused] = useState(false);
  const [googleCrosscheck, setGoogleCrosscheck] = useState(false);
  const [researchMode, setResearchMode] = useState('auto');
  const [artifacts, setArtifacts] = useState<SavedArtifact[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [summarising, setSummarising] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [disintegratingSourceId, setDisintegratingSourceId] = useState<string | null>(null);
  const [disintegratingClaimId, setDisintegratingClaimId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [keyVaultOpen, setKeyVaultOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [guideVisible, setGuideVisible] = useState(true);
  const [guideEnabled, setGuideEnabled] = useState(true);
  const [researchStage, setResearchStage] = useState('Preparing research protocol');
  const [interactionNotice, setInteractionNotice] = useState('');
  const requestControllerRef = useRef<AbortController | null>(null);
  const interactionNoticeTimerRef = useRef<number | null>(null);
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
    try {
      const stored = JSON.parse(localStorage.getItem(artifactStorageKey) || '[]');
      const repaired = Array.isArray(stored) ? stored.filter((artifact): artifact is SavedArtifact => Boolean(artifact?.result)).map((artifact) => ({ ...artifact, result: identifyGraph(artifact.result) })) : [];
      setArtifacts(repaired);
      // Keep the migrated representation so a repaired saved board stays repaired next time.
      if (Array.isArray(stored)) localStorage.setItem(artifactStorageKey, JSON.stringify(repaired));
    } catch { setArtifacts([]); }
    setGuideEnabled(localStorage.getItem('sourceful-explore-guide') !== 'off');
  }, []);

  useEffect(() => {
    if (appState !== 'loading') return;
    const stages = ['Mapping the claim graph', 'Discovering independent evidence', 'Testing source provenance', 'Resolving contradictions', 'Forming a conservative conclusion'];
    let index = 0; setResearchStage(stages[0]);
    const timer = window.setInterval(() => { index = Math.min(index + 1, stages.length - 1); setResearchStage(stages[index]); }, 1800);
    return () => window.clearInterval(timer);
  }, [appState]);

  useEffect(() => () => { if (interactionNoticeTimerRef.current) window.clearTimeout(interactionNoticeTimerRef.current); }, []);

  const hapticTick = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(8);
  };
  const announceInteraction = (message: string) => {
    setInteractionNotice(message);
    if (interactionNoticeTimerRef.current) window.clearTimeout(interactionNoticeTimerRef.current);
    interactionNoticeTimerRef.current = window.setTimeout(() => setInteractionNotice(''), 2600);
  };

  const persistArtifacts = (next: SavedArtifact[]) => { setArtifacts(next); localStorage.setItem(artifactStorageKey, JSON.stringify(next)); };
  const saveArtifact = () => {
    if (!result) return;
    const artifact: SavedArtifact = { id: crypto.randomUUID(), title: result.coreConcept.slice(0, 90), createdAt: new Date().toISOString(), query, model, result, summary: summary || undefined };
    persistArtifacts([artifact, ...artifacts].slice(0, 40));
    announceInteraction('Knowledge graph saved to your library');
  };
  const exportEvidenceCsv = () => {
    if (!result) return;
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""').replace(/[\r\n]+/g, ' ')}"`;
    const header = ['core_concept', 'overall_assessment_confidence', 'claim', 'claim_assessment_confidence', 'claim_verdict', 'compounded_support', 'compounded_refutation', 'independent_paths', 'claim_bias_analysis', 'source_title', 'source_url', 'source_snippet', 'cited_text', 'credibility_score', 'path_contribution', 'path_source_quality', 'path_claim_relevance', 'path_directness', 'path_independence', 'path_provenance_group', 'is_dodgy', 'author', 'published_at', 'source_type', 'evidence_type', 'stance', 'citations', 'observed_active_links', 'authority', 'evidence_quality', 'independence', 'recency', 'transparency', 'corroboration', 'citation_network', 'semantic_depth'];
    const rows = result.branches.flatMap((branch) => branch.sources.map((source) => [result.coreConcept, result.confidenceScore, branch.claim, branch.evidenceBalance?.assessmentConfidence ?? branch.confidenceScore, branch.verdict, branch.evidenceBalance?.support, branch.evidenceBalance?.refutation, branch.evidenceBalance?.independentPaths, branch.biasAnalysis, source.title, source.url, source.snippet, source.citedText, source.credibilityScore, source.credibilityPath?.compoundedContribution, source.credibilityPath?.sourceQuality, source.credibilityPath?.claimRelevance, source.credibilityPath?.directness, source.credibilityPath?.independence, source.credibilityPath?.provenanceGroup, source.isDodgy, source.author, source.publishedAt, source.evidenceProfile?.sourceType, source.evidenceProfile?.evidenceType, source.evidenceProfile?.stance, source.citations, source.observedReferenceCount, source.metrics?.authority, source.metrics?.evidenceQuality, source.metrics?.independence, source.metrics?.recency, source.metrics?.transparency, source.metrics?.corroboration, source.metrics?.citationNetwork, source.metrics?.semanticDepth]));
    const csv = [header, ...rows].map((row) => row.map(quote).join(',')).join('\n');
    const file = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(file); const anchor = document.createElement('a');
    anchor.href = href; anchor.download = `sourceful-evidence-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(href), 0);
    announceInteraction('Evidence CSV prepared for download');
  };
  const closeViewportPanels = () => { setSelectedSource(null); setSelectedClaim(null); setLibraryOpen(false); setInfoOpen(false); setKeyVaultOpen(false); setSummary(''); setGuideVisible(false); };
  const restoreArtifact = (artifact: SavedArtifact) => { setResult(identifyGraph(artifact.result)); setQuery(artifact.query); setModel(artifact.model); setSelectedSource(null); setSelectedClaim(null); setInfoOpen(false); setKeyVaultOpen(false); setSummary(artifact.summary || ''); setAppState('results'); setLibraryOpen(false); };
  const selectSource = (source: Source) => { closeViewportPanels(); setSelectedSource(source); };
  const selectClaim = (claim: Branch) => { closeViewportPanels(); setSelectedClaim(claim); };
  const openLibrary = () => { closeViewportPanels(); setLibraryOpen(true); };
  const openInfo = () => { closeViewportPanels(); setInfoOpen(true); };
  const openKeyVault = () => { closeViewportPanels(); setKeyVaultOpen(true); };
  const disintegrateSource = (source: Source) => {
    if (!result || disintegratingSourceId || disintegratingClaimId || !source.graphId) return;
    setDisintegratingSourceId(source.graphId);
    setSelectedSource(null);
  };
  const disintegrateClaim = (claim: Branch) => {
    if (!result || disintegratingSourceId || disintegratingClaimId || !claim.graphId) return;
    setDisintegratingClaimId(claim.graphId);
    setSelectedClaim(null);
  };
  const completeSourceDisintegration = () => {
    if (disintegratingSourceId) { const sourceId = disintegratingSourceId; setResult((current) => current ? { ...current, branches: current.branches.map((branch) => ({ ...branch, sources: branch.sources.filter((candidate) => candidate.graphId !== sourceId) })) } : current); setDisintegratingSourceId(null); return; }
    if (disintegratingClaimId) { const claimId = disintegratingClaimId; setResult((current) => current ? { ...current, branches: current.branches.filter((branch) => branch.graphId !== claimId) } : current); setDisintegratingClaimId(null); }
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

  const expandInvestigation = async (claim?: Branch) => {
    if (!result || expanding) return;
    if (result.isDemo) { setError('The Guided demo is simulated. Start a live investigation before extending a graph.'); return; }
    if (!apiKey) { setError('Connect your OpenAI API key to run an additional evidence pass.'); openKeyVault(); return; }
    const completed = result.researchMetadata?.completedPasses || 1;
    const maxPasses = result.researchMetadata?.maxPasses || 4;
    const sourceCount = result.branches.reduce((total, branch) => total + branch.sources.length, 0);
    const nodeBudget = result.researchMetadata?.nodeBudget || 60;
    if (completed >= maxPasses || sourceCount >= nodeBudget) { setError('This graph has reached its visible research budget. Save it, review the sources, or start a more focused follow-up question.'); return; }
    closeViewportPanels();
    setError(''); setExpanding(true); setAppState('loading'); requestControllerRef.current = new AbortController();
    try {
      const response = await fetch('/api/expand', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ artifact:result, model, focusClaim:claim?.claim || '', apiKey }), signal:requestControllerRef.current.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to extend this evidence graph.');
      setResult(identifyGraph(data)); setGuideVisible(true); setAppState('results');
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err.message || 'Unable to extend this evidence graph.');
      setAppState('results');
    } finally { setExpanding(false); requestControllerRef.current = null; }
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
      setResult(identifyGraph(data));
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
    <div className="min-h-screen sourceful-shell bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-sans overflow-hidden relative selection:bg-amber-500/30 transition-colors duration-500" onPointerDownCapture={(event) => { if ((event.target as HTMLElement).closest('button:not(:disabled), [role="option"]')) hapticTick(); }}>
      <WindborneNodes />
      {result && (appState === 'results' || appState === 'loading') && (viewMode === '3d' ? <DiscoveryUniverse data={result} isDarkMode={isDarkMode} labelMode={labelMode} driftPaused={graphDriftPaused} onSourceSelect={selectSource} onClaimSelect={selectClaim} selectedSourceId={selectedSource?.graphId} selectedClaimId={selectedClaim?.graphId} disintegratingSourceId={disintegratingSourceId} disintegratingClaimId={disintegratingClaimId} onDisintegrationComplete={completeSourceDisintegration} /> : <NodeGraph data={result} isDarkMode={isDarkMode} onSourceSelect={selectSource} onClaimSelect={selectClaim} selectedSourceId={selectedSource?.graphId} selectedClaimId={selectedClaim?.graphId} disintegratingSourceId={disintegratingSourceId} disintegratingClaimId={disintegratingClaimId} onDisintegrationComplete={completeSourceDisintegration} />)}
      {createPortal(<div className="sourceful-viewport-ui">
        {appState !== 'results' && <div className="utility-controls flex items-center gap-4">
          <button onClick={openLibrary} className={`p-2 transition-colors ${isDarkMode ? 'text-white/50 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`} title="Saved research library"><FolderOpen size={20} /></button>
          <button onClick={openInfo} className={`p-2 transition-colors ${isDarkMode ? 'text-white/50 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`} title="How Sourceful evaluates evidence"><Info size={20} /></button>
          <button onClick={() => setIsDarkMode(!isDarkMode)} className={`p-2 transition-colors ${isDarkMode ? 'text-white/50 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`} title="Toggle theme">{isDarkMode ? <Sun size={20} /> : <Moon size={20} />}</button>
        </div>}
        {appState === 'results' && <ResultsToolbar isDarkMode={isDarkMode} viewMode={viewMode} labelMode={labelMode} driftPaused={graphDriftPaused} summarising={summarising} expanding={expanding} canExpand={Boolean(result && !result.isDemo && (result.researchMetadata?.completedPasses || 1) < (result.researchMetadata?.maxPasses || 4) && result.branches.reduce((total, branch) => total + branch.sources.length, 0) < (result.researchMetadata?.nodeBudget || 60))} onViewMode={setViewMode} onLabelMode={() => setLabelMode((mode) => mode === 'hover' ? 'all' : 'hover')} onDriftToggle={() => setGraphDriftPaused((paused) => !paused)} onSummary={generateSummary} onExpand={() => void expandInvestigation()} onSave={saveArtifact} onExport={exportEvidenceCsv} onLibrary={openLibrary} onInfo={openInfo} onTheme={() => setIsDarkMode(!isDarkMode)} onNewSearch={resetSearch}/>}
        <AnimatePresence>{selectedSource && <SourceDossier source={selectedSource} isDarkMode={isDarkMode} onClose={() => setSelectedSource(null)} onDisintegrate={disintegrateSource} />}{selectedClaim && <ClaimDossier claim={selectedClaim} isDarkMode={isDarkMode} onClose={() => setSelectedClaim(null)} onDisintegrate={disintegrateClaim} onExpand={(claim) => void expandInvestigation(claim)} canExpand={Boolean(result && !result.isDemo && (result.researchMetadata?.completedPasses || 1) < (result.researchMetadata?.maxPasses || 4) && result.branches.reduce((total, branch) => total + branch.sources.length, 0) < (result.researchMetadata?.nodeBudget || 60))} />}{libraryOpen && <ArtifactLibrary artifacts={artifacts} isDarkMode={isDarkMode} onRestore={restoreArtifact} onRename={(id, title) => persistArtifacts(artifacts.map((artifact) => artifact.id === id ? { ...artifact, title } : artifact))} onDelete={(id) => persistArtifacts(artifacts.filter((artifact) => artifact.id !== id))} onClose={() => setLibraryOpen(false)} />}{infoOpen && <AboutPanel isDarkMode={isDarkMode} onClose={() => setInfoOpen(false)} />}{keyVaultOpen && <ApiKeyVault isDarkMode={isDarkMode} apiKey={apiKey} onUse={setApiKey} onDisconnect={() => setApiKey('')} onClose={() => setKeyVaultOpen(false)} />}{summary && <ResearchBriefPanel summary={summary} artifact={result} isDarkMode={isDarkMode} onClose={() => setSummary('')} />}{result && appState === 'results' && !summary && !selectedSource && !selectedClaim && !libraryOpen && !infoOpen && !keyVaultOpen && guideVisible && guideEnabled && <ExploreGuide viewMode={viewMode} onClose={() => setGuideVisible(false)} onDisable={() => { localStorage.setItem('sourceful-explore-guide', 'off'); setGuideEnabled(false); setGuideVisible(false); }} />}{interactionNotice && <InteractionToast message={interactionNotice}/>}</AnimatePresence>
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
                <button type="button" onClick={() => fileInputRef.current?.click()} className="upload-control" title="Attach a PDF, Word document, text file, data sheet, or image as an untrusted research lead"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.2 15c.7-1.2 1-2.5.7-3.9-.6-2-2.4-3.5-4.4-3.5h-1.2c-.7-3-3.2-5.2-6.2-5.6-3-.3-5.9 1.3-7.3 4-1.2 2.5-1 6.5.5 8.8m8.7-1.6V21"/><path d="M16 16l-4-4-4 4"/></svg> Attach</button>
                <button type="button" onClick={() => void handleSubmit(undefined, true, demoPrompt)} className="demo-control" title="Run a simulated multi-claim Sourceful investigation without API keys"><Atom size={14}/> Guided demo</button>
                <button type="button" onClick={() => setConfigOpen(!configOpen)} className={`config-control ${configOpen ? 'active' : ''}`} title="Configure the AI profile, research route, and Google cross-check"><SlidersHorizontal size={14}/> Configure</button>
                <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.md,.csv,.json,.pdf,.docx,.rtf,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/rtf,image/png,image/jpeg,image/webp" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
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
