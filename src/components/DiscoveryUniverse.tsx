import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { Branch, VerificationResult, Source } from '../types';

type Props = { data: VerificationResult; isDarkMode: boolean; labelMode: 'hover' | 'all'; onSourceSelect: (source: Source) => void; onClaimSelect?: (claim: Branch) => void; selectedSourceId?: string; selectedClaimId?: string; disintegratingSourceId?: string | null; disintegratingClaimId?: string | null; onDisintegrationComplete?: () => void };

function Preview({ label, detail, preview, citedText, imageUrl, visible, focused, onPreviewEnter, onPreviewLeave, onPreviewSelect }: { label: string; detail: string; preview?: string; citedText?: string; imageUrl?: string; visible: boolean; focused: boolean; onPreviewEnter?: () => void; onPreviewLeave?: () => void; onPreviewSelect?: () => void }) {
  if (!visible) return null;
  const excerpt = preview || detail;
  const parts = citedText && excerpt.includes(citedText) ? excerpt.split(citedText) : [excerpt];
  return <div className={`universe-label visible ${focused ? 'focused' : 'passive'}`}><span>{label}</span><strong>{detail}</strong>{focused && preview && <div className="cosmic-preview" onPointerEnter={onPreviewEnter} onPointerLeave={onPreviewLeave} onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onPreviewSelect?.(); }}>{imageUrl && <div className="cosmic-preview-visual"><img src={imageUrl} alt="" /></div>}<div className="cosmic-preview-copy">{parts.map((part, index) => <React.Fragment key={index}><i>{part}</i>{citedText && index < parts.length - 1 && <b>{citedText}</b>}</React.Fragment>)}</div></div>}</div>;
}

function Pulse({ start, end, color, delay = 0, active = false }: { start: [number,number,number]; end: [number,number,number]; color: string; delay?: number; active?: boolean }) {
  const ref = useRef<THREE.Mesh>(null); useFrame((state) => { const t = ((state.clock.elapsedTime * (active ? .65 : .34) + delay) % 1 + 1) % 1; const eased = t * t * (3 - 2 * t); if (ref.current) ref.current.position.set(THREE.MathUtils.lerp(start[0], end[0], eased), THREE.MathUtils.lerp(start[1], end[1], eased), THREE.MathUtils.lerp(start[2], end[2], eased)); });
  return <mesh ref={ref}><sphereGeometry args={[active ? .078 : .052, 14, 14]}/><meshBasicMaterial color={active ? '#ffe29a' : color}/><pointLight color={active ? '#ffe29a' : color} intensity={active ? 5.2 : 1.9} distance={active ? 2.3 : 1.2}/></mesh>;
}

function PlasmaSurface({ color, hovered }: { color: string; hovered: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uHot: { value: new THREE.Color('#fff1bb') }, uHover: { value: 0 } }), [color]);
  useFrame((state) => { if (!material.current) return; material.current.uniforms.uTime.value = state.clock.elapsedTime; material.current.uniforms.uHover.value = THREE.MathUtils.lerp(material.current.uniforms.uHover.value, hovered ? 1 : 0, .08); });
  return <shaderMaterial ref={material} uniforms={uniforms} vertexShader={`varying vec3 vNormal; varying vec3 vPosition; void main(){ vNormal=normalize(normalMatrix*normal); vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`} fragmentShader={`uniform float uTime; uniform float uHover; uniform vec3 uColor; uniform vec3 uHot; varying vec3 vNormal; varying vec3 vPosition; float cloud(vec3 p){ float a=sin(p.x*1.08+p.y*.52+uTime*.52); float b=sin(p.y*.86-p.z*.68-uTime*.39); float c=sin(p.z*.76+p.x*.57+uTime*.29); return (a+b+c)/6.0+.5; } void main(){ vec3 p=normalize(vPosition); float field=smoothstep(.13,.87,cloud(p)); vec3 viewDir=normalize(cameraPosition-vPosition); float rim=pow(1.0-max(dot(normalize(vNormal),viewDir),0.0),2.2); vec3 body=mix(uColor*.36,uColor*.96,.30+field*.28); body+=mix(uColor,uHot,.30)*(.10+field*.16); body+=uColor*rim*(.22+uHover*.20); gl_FragColor=vec4(body,.96); }`} transparent depthWrite={false} blending={THREE.NormalBlending}/>;
}

function EnergyAura({ color, size, hovered, selected = false }: { color: string; size: number; hovered: boolean; selected?: boolean }) {
  const texture = useMemo(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192; const context = canvas.getContext('2d')!; const gradient = context.createRadialGradient(96,96,0,96,96,96); gradient.addColorStop(0, 'rgba(255,255,255,.86)'); gradient.addColorStop(.10, 'rgba(255,255,255,.54)'); gradient.addColorStop(.28, 'rgba(255,255,255,.20)'); gradient.addColorStop(.58, 'rgba(255,255,255,.055)'); gradient.addColorStop(1, 'rgba(255,255,255,0)'); context.fillStyle = gradient; context.fillRect(0,0,192,192); const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; return map; }, []);
  const group = useRef<THREE.Group>(null); const core = useRef<THREE.Sprite>(null); useFrame((state) => { if (!group.current) return; const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.12 + size) * .025 + (hovered ? .025 : 0) + (selected ? .05 : 0); group.current.scale.setScalar(pulse); if (core.current) { const corePulse = 1 + Math.sin(state.clock.elapsedTime * 1.8 + size * 3) * .045 + (hovered ? .035 : 0) + (selected ? .075 : 0); core.current.scale.set(size * 2.28 * corePulse, size * 2.28 * corePulse, 1); } });
  return <group ref={group}><sprite raycast={() => undefined} scale={[size * (selected ? 8.8 : 7.1), size * (selected ? 8.8 : 7.1), 1]}><spriteMaterial map={texture} color={selected ? '#f8d47c' : color} transparent opacity={selected ? .72 : hovered ? .48 : .28} depthWrite={false} blending={THREE.AdditiveBlending}/></sprite><sprite raycast={() => undefined} scale={[size * (selected ? 5.85 : 4.65), size * (selected ? 5.85 : 4.65), 1]}><spriteMaterial map={texture} color={selected ? '#f8d47c' : color} transparent opacity={selected ? .68 : hovered ? .47 : .28} depthWrite={false} blending={THREE.AdditiveBlending}/></sprite><sprite ref={core} renderOrder={4} raycast={() => undefined} scale={[size * 2.28, size * 2.28, 1]}><spriteMaterial map={texture} color="#fff6d5" transparent opacity={selected ? .94 : hovered ? .76 : .60} depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending}/></sprite></group>;
}

function SelectionHalo({ size }: { size: number }) {
  const ring = useRef<THREE.Group>(null);
  const tracer = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ring.current) ring.current.rotation.z = state.clock.elapsedTime * .84;
    if (tracer.current) {
      const angle = state.clock.elapsedTime * 2.45;
      tracer.current.position.set(Math.cos(angle) * size * 1.31, Math.sin(angle) * size * 1.31, .08);
    }
  });
  return <group ref={ring} rotation={[.17, -.28, 0]}><mesh raycast={() => undefined}><torusGeometry args={[size * 1.3, Math.max(.008, size * .024), 14, 84]}/><meshBasicMaterial color="#f7cf71" transparent opacity={.55} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh><mesh ref={tracer} raycast={() => undefined}><sphereGeometry args={[Math.max(.035, size * .09), 16, 16]}/><meshBasicMaterial color="#fff0b8" transparent opacity={.98} blending={THREE.AdditiveBlending}/><pointLight color="#f9cf6c" intensity={5.5} distance={size * 5}/></mesh></group>;
}

function MicroNodeBurst({ color, size }: { color: string; size: number }) {
  const group = useRef<THREE.Group>(null);
  const startedAt = useRef<number | null>(null);
  const particles = useMemo(() => Array.from({ length: 196 }, (_, index) => {
    const angle = index * 2.399963229728653;
    const z = 1 - ((index % 49) / 48) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const distance = size * (1.55 + ((index * 29) % 97) / 28);
    return { x: Math.cos(angle) * ring * distance, y: z * distance, z: Math.sin(angle) * ring * distance, scale: .018 + (index % 5) * .008, phase: index * .47 };
  }), [size]);
  useFrame((state) => {
    if (!group.current) return;
    if (startedAt.current === null) startedAt.current = state.clock.elapsedTime;
    const progress = Math.min((state.clock.elapsedTime - startedAt.current) / 1.28, 1);
    const burst = 1 - Math.pow(1 - progress, 3);
    group.current.rotation.y = progress * .75;
    group.current.children.forEach((child, index) => {
      const particle = particles[index];
      const wobble = Math.sin(state.clock.elapsedTime * 7 + particle.phase) * size * .12 * (1 - progress);
      child.position.set(particle.x * burst + wobble, particle.y * burst - progress * progress * size * .9, particle.z * burst);
      child.scale.setScalar(Math.max(.01, (1 - progress) * (1 - progress) * (1 + (index % 4) * .15)));
    });
  });
  return <group ref={group}>{particles.map((particle, index) => <mesh key={index}><icosahedronGeometry args={[particle.scale, 1]}/><meshBasicMaterial color={color} transparent opacity={.95} depthWrite={false} blending={THREE.AdditiveBlending}/></mesh>)}</group>;
}

function Orb({ nodeId, active, selected = false, lineage = false, labelMode, onFocus, position, color, size, label, detail, preview, citedText, imageUrl, onClick, order = 0, disintegrating = false, onDisintegrationComplete }: { nodeId: string; active: boolean; selected?: boolean; lineage?: boolean; labelMode: 'hover' | 'all'; onFocus: (id: string | null) => void; position: [number,number,number]; color: string; size: number; label: string; detail: string; preview?: string; citedText?: string; imageUrl?: string; onClick?: () => void; order?: number; disintegrating?: boolean; onDisintegrationComplete?: () => void }) {
  const [hovered, setHovered] = useState(false); const [previewHovered, setPreviewHovered] = useState(false); const group = useRef<THREE.Group>(null); const visual = useRef<THREE.Group>(null); const dissolutionStart = useRef<number | null>(null); const blurTimer = useRef<number | null>(null);
  useEffect(() => { if (!disintegrating || !onDisintegrationComplete) return; const timer = window.setTimeout(onDisintegrationComplete, 1320); return () => window.clearTimeout(timer); }, [disintegrating, onDisintegrationComplete]);
  useEffect(() => () => { if (blurTimer.current !== null) window.clearTimeout(blurTimer.current); }, []);
  const cancelBlur = () => { if (blurTimer.current !== null) { window.clearTimeout(blurTimer.current); blurTimer.current = null; } };
  const scheduleBlur = () => { cancelBlur(); blurTimer.current = window.setTimeout(() => { setPreviewHovered(false); onFocus(null); document.body.style.cursor = 'auto'; blurTimer.current = null; }, 110); };
  const previewFocused = active || previewHovered;
  const energized = hovered || previewHovered || selected;
  useFrame((state) => { if (!group.current || !visual.current) return; const appear = THREE.MathUtils.smoothstep((state.clock.elapsedTime - order * .14) / .65, 0, 1); const target = selected ? 1.07 : energized ? 1.025 : 1; if (!disintegrating) { dissolutionStart.current = null; const nextScale = Math.max(.001, appear * target); visual.current.scale.setScalar(THREE.MathUtils.lerp(visual.current.scale.x, nextScale, .16)); return; } if (dissolutionStart.current === null) dissolutionStart.current = state.clock.elapsedTime; const fade = Math.min((state.clock.elapsedTime - dissolutionStart.current) / .52, 1); visual.current.scale.setScalar(Math.max(.001, appear * target * (1 - fade))); });
  // The interactive field follows the visible orb—not its labels or the ambient glow.
  // This makes every sphere reliably targetable without stealing hover from neighbours.
  const hitRadius = size * .96;
  const selectNode = () => { cancelBlur(); setHovered(false); setPreviewHovered(false); onFocus(null); onClick?.(); };
  return <group ref={group} position={position}>
    <group ref={visual}><EnergyAura color={color} size={size} hovered={energized} selected={selected}/>{selected && <SelectionHalo size={size}/>}<mesh raycast={() => undefined}><sphereGeometry args={[size, 72, 72]}/><PlasmaSurface color={color} hovered={energized}/></mesh><pointLight color={selected ? '#ffe39a' : energized ? '#ffe39a' : lineage ? '#f8d47c' : color} intensity={selected ? 10.5 : energized ? 4.9 : lineage ? 2.85 : 2.3} distance={size * (selected ? 10 : 7)}/><Html zIndexRange={[160, 0]} distanceFactor={12} center position={[0, size + .12, 0]} style={{ pointerEvents: previewFocused ? 'auto' : 'none' }}><Preview label={label} detail={detail} preview={preview} citedText={citedText} imageUrl={imageUrl} visible={labelMode === 'all' || selected || previewFocused} focused={previewFocused} onPreviewEnter={() => { cancelBlur(); setPreviewHovered(true); onFocus(nodeId); }} onPreviewLeave={() => { setPreviewHovered(false); scheduleBlur(); }} onPreviewSelect={selectNode}/></Html></group>
    <mesh onPointerOver={(event) => { if (disintegrating) return; event.stopPropagation(); cancelBlur(); setHovered(true); onFocus(nodeId); document.body.style.cursor = 'pointer'; }} onPointerOut={(event) => { event.stopPropagation(); setHovered(false); scheduleBlur(); }} onClick={(event) => { if (disintegrating) return; event.stopPropagation(); selectNode(); }}><sphereGeometry args={[hitRadius, 24, 24]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
    {disintegrating && <MicroNodeBurst color={color} size={size}/>} 
  </group>;
}

function sourceTone(source: Source) {
  const directness = source.credibilityPath?.directness ?? source.evidenceProfile?.directness ?? source.metrics?.semanticDepth ?? 0;
  if (source.isDodgy) return '#df7772';
  if (source.evidenceProfile?.stance === 'refutes') return '#f27d89';
  if (source.evidenceProfile?.stance === 'context') return '#d6ab59';
  if (source.evidenceProfile?.stance === 'supports' && directness >= 90) return '#a4f29a';
  if (source.evidenceProfile?.stance === 'supports') return '#61c69a';
  return '#78b9df';
}

function claimTone(branch: Branch) {
  if (branch.verdict === 'contested') return '#e69b56';
  if (branch.verdict === 'refuted') return '#e2656f';
  if (branch.verdict === 'insufficient_evidence' || branch.verdict === 'formally_refuted') return '#dc7772';
  if ((branch.supportStrength ?? 0) >= 80) return '#a9f39b';
  if (branch.verdict === 'corroborated' || branch.verdict === 'formally_checked') return '#78c69d';
  return '#d8a24b';
}

function branchEvidenceDistance(branch: Branch) {
  const sources = branch.sources;
  const average = (values: number[], fallback: number) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
  const credibility = average(sources.map((source) => source.credibilityScore ?? 50), 40);
  const directness = average(sources.map((source) => source.credibilityPath?.directness ?? source.evidenceProfile?.directness ?? source.metrics?.semanticDepth ?? 45), 40);
  const evidenceQuality = average(sources.map((source) => source.metrics?.evidenceQuality ?? 45), 40);
  const compoundedPath = Math.max(branch.evidenceBalance?.support ?? 0, branch.evidenceBalance?.refutation ?? 0);
  // Spatial distance means evidentiary proximity, not a claim's popularity or a generic confidence score.
  // Direct counterevidence can therefore sit close to the query too—its rose/red colour carries the relation.
  const evidentiaryProximity = directness * .39 + evidenceQuality * .21 + credibility * .13 + compoundedPath * .27;
  const verdictPenalty: Record<string, number> = { corroborated: -.28, formally_checked: -.28, provisionally_supported: .42, contested: 1.05, insufficient_evidence: 1.72, refuted: .10, formally_refuted: 1.56 };
  const hasContradiction = sources.some((source) => source.evidenceProfile?.stance === 'supports') && sources.some((source) => source.evidenceProfile?.stance === 'refutes');
  return 3.05 + (100 - evidentiaryProximity) * .058 + (verdictPenalty[branch.verdict || ''] || .72) + (hasContradiction ? .25 : 0);
}

export function DiscoveryUniverse({ data, isDarkMode, labelMode, onSourceSelect, onClaimSelect, selectedSourceId, selectedClaimId, disintegratingSourceId, disintegratingClaimId, onDisintegrationComplete }: Props) {
  const branches = data.branches;
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const selectedBranchIndex = useMemo(() => selectedSourceId ? branches.findIndex((branch) => branch.sources.some((source) => source.graphId === selectedSourceId)) : selectedClaimId ? branches.findIndex((branch) => branch.graphId === selectedClaimId) : -1, [branches, selectedClaimId, selectedSourceId]);
  const totalSources = branches.reduce((total, branch) => total + branch.sources.length, 0);
  const branchDistances = useMemo(() => branches.map(branchEvidenceDistance), [branches]);
  const outerRadius = Math.max(3.5, ...branchDistances);
  const sceneRadius = outerRadius + 3.25;
  const points = useMemo(() => branches.map((branch, index) => { const angle = (index / Math.max(branches.length, 1)) * Math.PI * 2 - Math.PI / 2; const radius = branchDistances[index]; return [Math.cos(angle) * radius, Math.sin(angle) * radius * .68, index % 2 ? -.68 : .54] as [number,number,number]; }), [branches, branchDistances]);
  const cameraDistance = Math.max(10.5, sceneRadius * 2.05);
  return <div className="discovery-universe"><Canvas onPointerMissed={() => setActiveNode(null)} dpr={[1, 2]} camera={{ position: [0, 0, cameraDistance], fov: 45 }} gl={{ antialias:true, alpha:true }} style={{ touchAction: 'none' }}><color attach="background" args={[isDarkMode ? '#090d13' : '#f6f4ef']}/><fog attach="fog" args={[isDarkMode ? '#090d13' : '#f6f4ef', sceneRadius + 4, sceneRadius * 3.25]}/><ambientLight intensity={.34}/><pointLight position={[0, 1, 4]} intensity={42} color="#d9ad50"/><pointLight position={[-4, -3, 3]} intensity={19} color="#5ca4d5"/><pointLight position={[4, 2, -3]} intensity={12} color="#77c5a0"/><Sparkles count={Math.min(540, 280 + totalSources * 7)} scale={[sceneRadius * 3.1,sceneRadius * 1.9,9]} size={1.65} speed={.25} color={isDarkMode ? '#ead083' : '#a67b24'}/>
    <Orb nodeId="core" active={activeNode === 'core'} lineage={selectedBranchIndex >= 0} labelMode={labelMode} onFocus={setActiveNode} position={[0,0,0]} color="#d4a64b" size={1.08} label={`CORE QUESTION · ASSESSMENT ${data.confidenceScore}%`} detail={data.coreConcept} preview={data.biasAnalysis} order={0}/>
    {branches.map((branch, index) => {
      const strongSupport = (branch.supportStrength ?? 0) >= 80 && branch.verdict !== 'contested';
      const branchColor = claimTone(branch);
      const isLineageBranch = index === selectedBranchIndex;
      const isSelectedBranch = Boolean(selectedClaimId && branch.graphId === selectedClaimId);
      const branchNodeId = `claim-${index}`;
      return <React.Fragment key={branch.graphId || branchNodeId}>
        {isLineageBranch ? <Line points={[[0, 0, 0], points[index]]} color="#ffe29a" lineWidth={4.8} transparent opacity={.44}/> : null}
        {strongSupport && <Line points={[[0, 0, 0], points[index]]} color="#bdf9a3" lineWidth={4.7} transparent opacity={.19}/>}
        <Line points={[[0, 0, 0], points[index]]} color={isLineageBranch ? '#ffe29a' : branchColor} lineWidth={isLineageBranch ? 2.2 : strongSupport ? 1.65 : 1.15} transparent opacity={isLineageBranch ? .96 : strongSupport ? .86 : .58}/>
        <Pulse start={[0, 0, 0]} end={points[index]} color={branchColor} delay={index * .15} active={isLineageBranch}/>
        <Orb nodeId={branchNodeId} active={activeNode === branchNodeId} selected={isSelectedBranch} lineage={isLineageBranch} labelMode={labelMode} onFocus={setActiveNode} position={points[index]} color={branchColor} size={.52 + (strongSupport ? .065 : 0)} label={strongSupport ? `EVIDENCE SUPPORT ${branch.supportStrength}% · ASSESSMENT ${branch.evidenceBalance?.assessmentConfidence ?? branch.confidenceScore}%` : `${branch.verdict?.replaceAll('_', ' ') || 'CLAIM'} · ASSESSMENT ${branch.evidenceBalance?.assessmentConfidence ?? branch.confidenceScore}% · +${branch.evidenceBalance?.support ?? 0}/−${branch.evidenceBalance?.refutation ?? 0}`} detail={branch.claim} preview={branch.biasAnalysis} onClick={() => onClaimSelect?.(branch)} order={index + 1} disintegrating={disintegratingClaimId === branch.graphId} onDisintegrationComplete={disintegratingClaimId === branch.graphId ? onDisintegrationComplete : undefined}/>
        {branch.sources.map((source, sourceIndex) => {
          const credibility = source.credibilityScore ?? 50;
          const directness = source.credibilityPath?.directness ?? source.evidenceProfile?.directness ?? source.metrics?.semanticDepth ?? 45;
          const sourceCount = branch.sources.length;
          const branchAngle = (index / Math.max(branches.length, 1)) * Math.PI * 2 - Math.PI / 2;
          const spread = Math.min(.78, Math.PI / Math.max(3, sourceCount + 1));
          const sourceAngle = branchAngle + (sourceIndex - (sourceCount - 1) / 2) * spread;
          const distance = .54 + (100 - directness) * .014 + (100 - credibility) * .006 + Math.max(0, sourceCount - 3) * .11 + (source.isDodgy ? .34 : 0);
          const sourcePos: [number, number, number] = [points[index][0] + Math.cos(sourceAngle) * distance, points[index][1] + Math.sin(sourceAngle) * distance, points[index][2] - .82 + (sourceIndex % 2) * .22];
          const color = sourceTone(source);
          const isDisintegrating = disintegratingSourceId === source.graphId;
          const isSelectedSource = source.graphId === selectedSourceId;
          const sourceNodeId = `source-${index}-${sourceIndex}`;
          const stance = source.evidenceProfile?.stance || 'unclear';
          const directSupport = stance === 'supports' && directness >= 90 && !source.isDodgy;
          const pathSuffix = source.credibilityPath ? ` · PATH ${source.credibilityPath.compoundedContribution}%` : '';
          return <React.Fragment key={source.graphId || sourceNodeId}>
            {isSelectedSource && <Line points={[points[index], sourcePos]} color="#ffe29a" lineWidth={3.8} transparent opacity={.46}/>}
            <Line points={[points[index], sourcePos]} color={isSelectedSource ? '#ffe29a' : color} lineWidth={isSelectedSource ? 1.65 : .72} transparent opacity={isSelectedSource ? .96 : .55}/>
            <Pulse start={points[index]} end={sourcePos} color={color} delay={index * .12 + sourceIndex * .09} active={isSelectedSource}/>
            <Orb nodeId={sourceNodeId} active={activeNode === sourceNodeId} selected={isSelectedSource} labelMode={labelMode} onFocus={setActiveNode} position={sourcePos} color={color} size={Math.max(.16, .27 - Math.max(0, totalSources - 12) * .003) + (directSupport ? .028 : 0)} label={`${stance === 'refutes' ? 'REFUTING TRACE' : directSupport ? `DIRECT SUPPORT ${directness}%` : stance === 'supports' ? 'SUPPORTING TRACE' : stance === 'context' ? 'CONTEXT TRACE' : 'UNRESOLVED TRACE'} · CRED ${credibility}%${pathSuffix}`} detail={source.title} preview={source.snippet} citedText={source.citedText} imageUrl={source.imageUrl} onClick={() => onSourceSelect(source)} order={index + sourceIndex + 2} disintegrating={isDisintegrating} onDisintegrationComplete={isDisintegrating ? onDisintegrationComplete : undefined}/>
          </React.Fragment>;
        })}
      </React.Fragment>;
    })}
    <OrbitControls enablePan minDistance={Math.max(6.5, sceneRadius * .92)} maxDistance={Math.max(15, sceneRadius * 3.5)} autoRotate autoRotateSpeed={.22} enableDamping dampingFactor={.06}/>
  </Canvas><div className="universe-instruction">Distance maps evidentiary proximity: direct traces sit closer · red can be direct counterevidence · lime marks 90%+ direct support.</div></div>;
}
