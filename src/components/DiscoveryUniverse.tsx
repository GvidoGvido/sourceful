import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Html, Line, OrbitControls, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { Branch, VerificationResult, Source } from '../types';

type Props = { data: VerificationResult; isDarkMode: boolean; labelMode: 'hover' | 'all'; onSourceSelect: (source: Source) => void; onClaimSelect?: (claim: Branch) => void; disintegratingSourceUrl?: string | null; disintegratingClaim?: string | null; onDisintegrationComplete?: () => void };

function Preview({ label, detail, preview, citedText, visible, focused }: { label: string; detail: string; preview?: string; citedText?: string; visible: boolean; focused: boolean }) {
  if (!visible) return null;
  const excerpt = preview || detail;
  const parts = citedText && excerpt.includes(citedText) ? excerpt.split(citedText) : [excerpt];
  return <div className={`universe-label visible ${focused ? 'focused' : 'passive'}`}><span>{label}</span><strong>{detail}</strong>{focused && preview && <div className="cosmic-preview">{parts.map((part, index) => <React.Fragment key={index}><i>{part}</i>{citedText && index < parts.length - 1 && <b>{citedText}</b>}</React.Fragment>)}</div>}</div>;
}

function Pulse({ start, end, color, delay = 0 }: { start: [number,number,number]; end: [number,number,number]; color: string; delay?: number }) {
  const ref = useRef<THREE.Mesh>(null); useFrame((state) => { const t = ((state.clock.elapsedTime * .34 + delay) % 1 + 1) % 1; const eased = t * t * (3 - 2 * t); if (ref.current) ref.current.position.set(THREE.MathUtils.lerp(start[0], end[0], eased), THREE.MathUtils.lerp(start[1], end[1], eased), THREE.MathUtils.lerp(start[2], end[2], eased)); });
  return <mesh ref={ref}><sphereGeometry args={[.052, 14, 14]}/><meshBasicMaterial color={color}/><pointLight color={color} intensity={1.9} distance={1.2}/></mesh>;
}

function PlasmaSurface({ color, hovered }: { color: string; hovered: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uHot: { value: new THREE.Color('#fff1bb') }, uHover: { value: 0 } }), [color]);
  useFrame((state) => { if (!material.current) return; material.current.uniforms.uTime.value = state.clock.elapsedTime; material.current.uniforms.uHover.value = THREE.MathUtils.lerp(material.current.uniforms.uHover.value, hovered ? 1 : 0, .08); });
  return <shaderMaterial ref={material} uniforms={uniforms} vertexShader={`varying vec3 vNormal; varying vec3 vPosition; void main(){ vNormal=normalize(normalMatrix*normal); vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`} fragmentShader={`uniform float uTime; uniform float uHover; uniform vec3 uColor; uniform vec3 uHot; varying vec3 vNormal; varying vec3 vPosition; float cloud(vec3 p){ float a=sin(p.x*1.08+p.y*.52+uTime*.52); float b=sin(p.y*.86-p.z*.68-uTime*.39); float c=sin(p.z*.76+p.x*.57+uTime*.29); return (a+b+c)/6.0+.5; } void main(){ vec3 p=normalize(vPosition); float field=smoothstep(.13,.87,cloud(p)); vec3 viewDir=normalize(cameraPosition-vPosition); float rim=pow(1.0-max(dot(normalize(vNormal),viewDir),0.0),2.2); vec3 body=mix(uColor*.36,uColor*.96,.30+field*.28); body+=mix(uColor,uHot,.30)*(.10+field*.16); body+=uColor*rim*(.22+uHover*.20); gl_FragColor=vec4(body,.96); }`} transparent depthWrite={false} blending={THREE.NormalBlending}/>;
}

function EnergyAura({ color, size, hovered }: { color: string; size: number; hovered: boolean }) {
  const texture = useMemo(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192; const context = canvas.getContext('2d')!; const gradient = context.createRadialGradient(96,96,0,96,96,96); gradient.addColorStop(0, 'rgba(255,255,255,.86)'); gradient.addColorStop(.10, 'rgba(255,255,255,.54)'); gradient.addColorStop(.28, 'rgba(255,255,255,.20)'); gradient.addColorStop(.58, 'rgba(255,255,255,.055)'); gradient.addColorStop(1, 'rgba(255,255,255,0)'); context.fillStyle = gradient; context.fillRect(0,0,192,192); const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; return map; }, []);
  const group = useRef<THREE.Group>(null); const core = useRef<THREE.Sprite>(null); useFrame((state) => { if (!group.current) return; const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.55 + size) * .07 + (hovered ? .11 : 0); group.current.scale.setScalar(pulse); if (core.current) { const corePulse = 1 + Math.sin(state.clock.elapsedTime * 2.7 + size * 3) * .13 + (hovered ? .12 : 0); core.current.scale.set(size * 2.28 * corePulse, size * 2.28 * corePulse, 1); } });
  return <group ref={group}><sprite raycast={() => undefined} scale={[size * 7.1, size * 7.1, 1]}><spriteMaterial map={texture} color={color} transparent opacity={hovered ? .48 : .28} depthWrite={false} blending={THREE.AdditiveBlending}/></sprite><sprite raycast={() => undefined} scale={[size * 4.65, size * 4.65, 1]}><spriteMaterial map={texture} color={color} transparent opacity={hovered ? .47 : .28} depthWrite={false} blending={THREE.AdditiveBlending}/></sprite><sprite ref={core} renderOrder={4} raycast={() => undefined} scale={[size * 2.28, size * 2.28, 1]}><spriteMaterial map={texture} color="#fff6d5" transparent opacity={hovered ? .76 : .60} depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending}/></sprite></group>;
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

function Orb({ nodeId, active, labelMode, onFocus, position, color, size, label, detail, preview, citedText, onClick, order = 0, disintegrating = false, onDisintegrationComplete }: { nodeId: string; active: boolean; labelMode: 'hover' | 'all'; onFocus: (id: string | null) => void; position: [number,number,number]; color: string; size: number; label: string; detail: string; preview?: string; citedText?: string; onClick?: () => void; order?: number; disintegrating?: boolean; onDisintegrationComplete?: () => void }) {
  const [hovered, setHovered] = useState(false); const group = useRef<THREE.Group>(null); const visual = useRef<THREE.Group>(null); const dissolutionStart = useRef<number | null>(null);
  useEffect(() => { if (!disintegrating || !onDisintegrationComplete) return; const timer = window.setTimeout(onDisintegrationComplete, 1320); return () => window.clearTimeout(timer); }, [disintegrating, onDisintegrationComplete]);
  useFrame((state) => { if (!group.current || !visual.current) return; const appear = THREE.MathUtils.smoothstep((state.clock.elapsedTime - order * .14) / .65, 0, 1); const target = hovered ? 1.1 : 1; if (!disintegrating) { dissolutionStart.current = null; visual.current.scale.setScalar(Math.max(.001, appear * target)); return; } if (dissolutionStart.current === null) dissolutionStart.current = state.clock.elapsedTime; const fade = Math.min((state.clock.elapsedTime - dissolutionStart.current) / .52, 1); visual.current.scale.setScalar(Math.max(.001, appear * target * (1 - fade))); });
  const hitRadius = size * (nodeId === 'core' ? .34 : size > .4 ? .55 : .72);
  return <Float speed={1.3 + size} rotationIntensity={.25} floatIntensity={.7}><group ref={group} position={position}>
    <group ref={visual}><EnergyAura color={color} size={size} hovered={hovered}/><mesh raycast={() => undefined}><sphereGeometry args={[size, 72, 72]}/><PlasmaSurface color={color} hovered={hovered}/></mesh><pointLight color={color} intensity={hovered ? 3.8 : 2.3} distance={size * 7}/><Html zIndexRange={[160, 0]} distanceFactor={12} center position={[0, size + .42, 0]} style={{ pointerEvents:'none' }}><Preview label={label} detail={detail} preview={preview} citedText={citedText} visible={labelMode === 'all' || active} focused={active}/></Html></group>
    <mesh onPointerOver={(event) => { if (disintegrating) return; event.stopPropagation(); setHovered(true); onFocus(nodeId); document.body.style.cursor = 'pointer'; }} onPointerOut={(event) => { event.stopPropagation(); setHovered(false); onFocus(null); document.body.style.cursor = 'auto'; }} onClick={(event) => { if (disintegrating) return; event.stopPropagation(); onClick?.(); }}><sphereGeometry args={[hitRadius, 24, 24]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
    {disintegrating && <MicroNodeBurst color={color} size={size}/>} 
  </group></Float>;
}

export function DiscoveryUniverse({ data, isDarkMode, labelMode, onSourceSelect, onClaimSelect, disintegratingSourceUrl, disintegratingClaim, onDisintegrationComplete }: Props) {
  const branches = data.branches.slice(0, 5);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const points = useMemo(() => branches.map((branch, index) => { const angle = (index / Math.max(branches.length, 1)) * Math.PI * 2 - Math.PI / 2; const radius = 3.15 + (100 - branch.confidenceScore) * .018; return [Math.cos(angle) * radius, Math.sin(angle) * radius * .62, index % 2 ? -.8 : .65] as [number,number,number]; }), [branches]);
  return <div className="discovery-universe"><Canvas onPointerMissed={() => setActiveNode(null)} dpr={[1, 2]} camera={{ position: [0, 0, 10], fov: 45 }} gl={{ antialias:true, alpha:true }}><color attach="background" args={[isDarkMode ? '#090d13' : '#f6f4ef']}/><fog attach="fog" args={[isDarkMode ? '#090d13' : '#f6f4ef', 8, 19]}/><ambientLight intensity={.34}/><pointLight position={[0, 1, 4]} intensity={42} color="#d9ad50"/><pointLight position={[-4, -3, 3]} intensity={19} color="#5ca4d5"/><pointLight position={[4, 2, -3]} intensity={12} color="#77c5a0"/><Sparkles count={280} scale={[18,11,9]} size={1.65} speed={.25} color={isDarkMode ? '#ead083' : '#a67b24'}/>
    <Orb nodeId="core" active={activeNode === 'core'} labelMode={labelMode} onFocus={setActiveNode} position={[0,0,0]} color="#d4a64b" size={1.08} label="CORE QUESTION" detail={data.coreConcept} preview={data.biasAnalysis} order={0}/>
    {branches.map((branch, index) => <React.Fragment key={branch.claim}><Line points={[[0,0,0], points[index]]} color={branch.confidenceScore > 70 ? '#d3a448' : '#b68756'} lineWidth={1.15} transparent opacity={.58}/><Pulse start={[0,0,0]} end={points[index]} color="#f0c564" delay={index * .19}/><Orb nodeId={`claim-${index}`} active={activeNode === `claim-${index}`} labelMode={labelMode} onFocus={setActiveNode} position={points[index]} color={branch.confidenceScore > 70 ? '#78bc9b' : '#d8a24b'} size={.52} label={`CLAIM ${String(index+1).padStart(2,'0')}`} detail={branch.claim} preview={branch.biasAnalysis} onClick={() => onClaimSelect?.(branch)} order={index + 1} disintegrating={disintegratingClaim === branch.claim} onDisintegrationComplete={disintegratingClaim === branch.claim ? onDisintegrationComplete : undefined}/>{branch.sources.slice(0, 3).map((source, sourceIndex) => { const credibility = source.credibilityScore ?? 50; const distance = .64 + (100 - credibility) * .011; const offset = sourceIndex - 1; const sourcePos: [number,number,number] = [points[index][0] + offset * distance, points[index][1] + (sourceIndex === 1 ? -1 : .85) * distance, points[index][2] - .85]; const color = source.isDodgy ? '#df7772' : '#6faed2'; const isDisintegrating = disintegratingSourceUrl === source.url; const sourceId = `source-${index}-${sourceIndex}`; return <React.Fragment key={source.url}><Line points={[points[index], sourcePos]} color={color} lineWidth={.72} transparent opacity={.52}/><Pulse start={points[index]} end={sourcePos} color={color} delay={index * .17 + sourceIndex * .13}/><Orb nodeId={sourceId} active={activeNode === sourceId} labelMode={labelMode} onFocus={setActiveNode} position={sourcePos} color={color} size={.25} label="SOURCE TRACE" detail={source.title} preview={source.snippet} citedText={source.citedText} onClick={() => onSourceSelect(source)} order={index + sourceIndex + 2} disintegrating={isDisintegrating} onDisintegrationComplete={isDisintegrating ? onDisintegrationComplete : undefined}/></React.Fragment>; })}</React.Fragment>)}
    <OrbitControls enablePan={false} minDistance={6.5} maxDistance={15} autoRotate autoRotateSpeed={.22} enableDamping dampingFactor={.06}/>
  </Canvas><div className="universe-instruction">Distance key: core → claim shows claim confidence; claim → source shows evidence strength · hover a sphere to read its trace</div></div>;
}
