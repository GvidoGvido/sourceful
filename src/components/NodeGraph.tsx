import React, { useMemo, useEffect, useRef, useState } from 'react';
import { motion, Variants } from 'motion/react';
import { VerificationResult, Source, Branch } from '../types';
import { ShieldAlert, ExternalLink, ShieldCheck, Link2, Target, Activity, Minus, Plus, Maximize2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface NodeGraphProps {
  data: VerificationResult;
  isDarkMode: boolean;
  onSourceSelect?: (source: Source) => void;
  onClaimSelect?: (claim: Branch) => void;
  disintegratingSourceUrl?: string | null;
  disintegratingClaim?: string | null;
  onDisintegrationComplete?: () => void;
}

type BoardPointer = { x: number; y: number };
type PinchGesture = { distance: number; centerX: number; centerY: number; localX: number; localY: number; zoom: number; viewX: number; viewY: number };

const generateLayout = (data: VerificationResult) => {
  const CORE_W = 380;
  const CORE_H = 200;
  
  const BRANCH_W = 360;
  const BRANCH_H = 180;
  
  const SOURCE_W = 440;
  const SOURCE_H = 460;
  
  const GAP_X = 240; 
  const GAP_Y = 80;  
  
  const nodes: any[] = [];
  const edges: any[] = [];
  
  let currentY = 0;
  
  data.branches.forEach((branch, bIdx) => {
    const startY = currentY;
    const branchX = CORE_W + GAP_X + (100 - branch.confidenceScore) * 1.8;
    
    branch.sources.forEach((source, sIdx) => {
      nodes.push({
        id: `source-${bIdx}-${sIdx}`,
        type: 'source',
        data: source,
        branchData: branch,
        x: branchX + BRANCH_W + GAP_X + (100 - (source.credibilityScore ?? 50)) * 1.25,
        y: currentY,
        width: SOURCE_W,
        height: SOURCE_H,
        animOrder: 2 + (bIdx * 0.5) + (sIdx * 0.2) // for staggered animation
      });
      currentY += SOURCE_H + GAP_Y;
    });
    
    const endY = currentY - GAP_Y;
    const branchY = startY + (endY - startY) / 2 - (BRANCH_H / 2);
    
    nodes.push({
      id: `branch-${bIdx}`,
      type: 'branch',
      data: branch,
      x: branchX,
      y: branchY,
      width: BRANCH_W,
      height: BRANCH_H,
      parentId: 'core',
      animOrder: 1 + (bIdx * 0.5)
    });
    
    branch.sources.forEach((source, sIdx) => {
      const sNode = nodes.find(n => n.id === `source-${bIdx}-${sIdx}`);
      edges.push({
        id: `edge-branch-${bIdx}-source-${sIdx}`,
        startX: branchX + BRANCH_W,
        startY: branchY + BRANCH_H / 2,
        endX: sNode.x,
        endY: sNode.y + SOURCE_H / 2,
        isDodgy: source.isDodgy,
        stance: source.evidenceProfile?.stance,
        animOrder: 1.5 + (bIdx * 0.5) + (sIdx * 0.2)
      });
    });
  });
  
  const totalHeight = currentY - GAP_Y;
  const coreY = (totalHeight / 2) - (CORE_H / 2);
  
  nodes.push({
    id: 'core',
    type: 'core',
    data: data,
    x: 0,
    y: coreY,
    width: CORE_W,
    height: CORE_H,
    animOrder: 0
  });
  
  data.branches.forEach((branch, bIdx) => {
    const bNode = nodes.find(n => n.id === `branch-${bIdx}`);
    edges.push({
      id: `edge-core-branch-${bIdx}`,
      startX: CORE_W,
      startY: coreY + CORE_H / 2,
      endX: bNode.x,
      endY: bNode.y + BRANCH_H / 2,
      isDodgy: false,
      animOrder: 0.5 + (bIdx * 0.5)
    });
  });
  
  // Center around (0,0)
  const offsetY = -(totalHeight / 2);
  const offsetX = -((CORE_W + GAP_X + BRANCH_W + GAP_X + SOURCE_W) / 2);
  
  nodes.forEach(n => {
    n.x += offsetX;
    n.y += offsetY;
  });
  
  edges.forEach(e => {
    e.startX += offsetX;
    e.startY += offsetY;
    e.endX += offsetX;
    e.endY += offsetY;
  });
  
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));

  return { nodes, edges, bounds: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY } };
};

const draw: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (custom: number) => ({
    pathLength: 1,
    opacity: 0.6,
    transition: {
      pathLength: { delay: custom, type: "spring" as const, duration: 2, bounce: 0 },
      opacity: { delay: custom, duration: 0.1 }
    }
  })
};

const nodeAnim: Variants = {
  hidden: { opacity: 0, scale: 0.8, filter: 'blur(10px)' },
  visible: (custom: number) => ({
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      delay: custom,
      type: "spring" as const,
      damping: 20,
      stiffness: 100
    }
  })
};

function MicroNodeBurst({ isDodgy }: { isDodgy: boolean }) {
  return <div className="board-micro-node-burst" aria-hidden="true">{Array.from({ length: 180 }, (_, index) => { const angle = index * 2.399963229728653; const radius = 80 + ((index * 23) % 143); return <motion.i key={index} className={isDodgy ? 'red' : 'blue'} initial={{ opacity: 1, x: 0, y: 0, scale: .9 }} animate={{ opacity: 0, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius + 58, scale: index % 6 === 0 ? 1.25 : .08 }} transition={{ duration: .8 + (index % 9) * .06, ease: 'easeOut' }} />; })}</div>;
}

export function NodeGraph({ data, isDarkMode, onSourceSelect, onClaimSelect, disintegratingSourceUrl, disintegratingClaim, onDisintegrationComplete }: NodeGraphProps) {
  const { nodes, edges, bounds } = useMemo(() => generateLayout(data), [data]);
  const boardRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number; viewX: number; viewY: number } | null>(null);
  const pointersRef = useRef(new Map<number, BoardPointer>());
  const pinchRef = useRef<PinchGesture | null>(null);
  const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ x: 0, y: 0, zoom: .35 });
  const fitInset = { horizontal: 72, top: 86, bottom: 76 };
  const fitZoom = boardSize.width && boardSize.height ? Math.max(.1, Math.min((boardSize.width - fitInset.horizontal * 2) / bounds.width, (boardSize.height - fitInset.top - fitInset.bottom) / bounds.height)) : .2;
  const minZoom = Math.min(.12, fitZoom);
  const maxZoom = Math.max(1.7, fitZoom * 7);
  const clampZoom = (value: number) => Math.max(minZoom, Math.min(maxZoom, value));
  const fitGraph = () => setView({ x: -(bounds.minX + bounds.maxX) * fitZoom / 2, y: (fitInset.top + (boardSize.height - fitInset.bottom)) / 2 - boardSize.height / 2 - (bounds.minY + bounds.maxY) * fitZoom / 2, zoom: fitZoom });
  const zoomAt = (nextZoom: number, clientX?: number, clientY?: number) => {
    const zoom = clampZoom(nextZoom);
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || clientX === undefined || clientY === undefined) return setView((current) => ({ ...current, zoom }));
    const pointerX = clientX - rect.left - rect.width / 2;
    const pointerY = clientY - rect.top - rect.height / 2;
    setView((current) => ({ x: pointerX - (pointerX - current.x) * (zoom / current.zoom), y: pointerY - (pointerY - current.y) * (zoom / current.zoom), zoom }));
  };
  const changeZoom = (amount: number) => zoomAt(view.zoom + amount);
  const beginPinch = () => {
    const pointers = [...pointersRef.current.values()]; const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || pointers.length !== 2) return;
    const [first, second] = pointers; const centerX = (first.x + second.x) / 2; const centerY = (first.y + second.y) / 2;
    pinchRef.current = { distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), centerX, centerY, localX: centerX - rect.left - rect.width / 2, localY: centerY - rect.top - rect.height / 2, zoom: view.zoom, viewX: view.x, viewY: view.y };
    panRef.current = null;
  };
  useEffect(() => {
    const element = boardRef.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBoardSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (boardSize.width && boardSize.height) fitGraph(); }, [data, boardSize.width, boardSize.height]);
  useEffect(() => { if ((!disintegratingSourceUrl && !disintegratingClaim) || !onDisintegrationComplete) return; const timer = window.setTimeout(onDisintegrationComplete, 1320); return () => window.clearTimeout(timer); }, [disintegratingSourceUrl, disintegratingClaim, onDisintegrationComplete]);
  
  return (
    <div ref={boardRef} className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none" onWheel={(event) => { event.preventDefault(); zoomAt(view.zoom * (event.deltaY > 0 ? .84 : 1.18), event.clientX, event.clientY); }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button, a, input, details, [data-board-control]')) return; pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); event.currentTarget.setPointerCapture(event.pointerId); if (pointersRef.current.size === 2) beginPinch(); else if (pointersRef.current.size === 1) panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y }; }} onPointerMove={(event) => { const pointer = pointersRef.current.get(event.pointerId); if (!pointer) return; pointer.x = event.clientX; pointer.y = event.clientY; const pinch = pinchRef.current; if (pinch && pointersRef.current.size === 2) { const [first, second] = [...pointersRef.current.values()]; const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)); const centerX = (first.x + second.x) / 2; const centerY = (first.y + second.y) / 2; const zoom = clampZoom(pinch.zoom * (distance / pinch.distance)); const ratio = zoom / pinch.zoom; setView({ x: pinch.localX - (pinch.localX - pinch.viewX) * ratio + centerX - pinch.centerX, y: pinch.localY - (pinch.localY - pinch.viewY) * ratio + centerY - pinch.centerY, zoom }); return; } const pan = panRef.current; if (!pan || pan.pointerId !== event.pointerId) return; setView((current) => ({ ...current, x: pan.viewX + event.clientX - pan.x, y: pan.viewY + event.clientY - pan.y })); }} onPointerUp={(event) => { pointersRef.current.delete(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); panRef.current = null; pinchRef.current = null; }} onPointerCancel={(event) => { pointersRef.current.delete(event.pointerId); panRef.current = null; pinchRef.current = null; }}>
      <div className="board-zoom-controls" data-board-control onPointerDown={(event) => event.stopPropagation()}><button onClick={() => changeZoom(.12)} title="Zoom in"><Plus size={15}/></button><span>{Math.round(view.zoom * 100)}%</span><button onClick={() => changeZoom(-.12)} title="Zoom out"><Minus size={15}/></button><button onClick={fitGraph} title="Fit entire knowledge graph"><Maximize2 size={14}/></button></div>
      <div className="board-world" style={{ transform: `translate3d(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px), 0) scale(${view.zoom})` }}>
        <div className="relative pointer-events-none" style={{ width: 0, height: 0 }}>
          
          {/* Edges */}
          <svg className="absolute overflow-visible z-0 pointer-events-none" style={{ top: 0, left: 0 }}>
            {edges.map(edge => {
              const pathColor = edge.isDodgy ? (isDarkMode ? '#ef4444' : '#dc2626') : edge.stance === 'refutes' ? (isDarkMode ? '#fb7185' : '#e11d48') : edge.stance === 'context' ? (isDarkMode ? '#fbbf24' : '#d97706') : edge.stance === 'supports' ? (isDarkMode ? '#5ee3ae' : '#059669') : (isDarkMode ? '#60a5fa' : '#2563eb');
                
              return (
                <g key={edge.id}>
                  {/* Glow layer */}
                  <motion.path
                    d={`M ${edge.startX} ${edge.startY} C ${edge.startX + 150} ${edge.startY}, ${edge.endX - 150} ${edge.endY}, ${edge.endX} ${edge.endY}`}
                    fill="transparent"
                    stroke={pathColor}
                    strokeWidth={8}
                    className="opacity-20 blur-md mix-blend-screen"
                    custom={edge.animOrder}
                    variants={draw}
                    initial="hidden"
                    animate="visible"
                  />
                  {/* Core line */}
                  <motion.path
                    d={`M ${edge.startX} ${edge.startY} C ${edge.startX + 150} ${edge.startY}, ${edge.endX - 150} ${edge.endY}, ${edge.endX} ${edge.endY}`}
                    fill="transparent"
                    stroke={pathColor}
                    strokeWidth={2}
                    custom={edge.animOrder}
                    variants={draw}
                    initial="hidden"
                    animate="visible"
                  />
                  
                  {/* Animated traveling dot */}
                  <motion.circle
                    r="4"
                    fill={pathColor}
                    custom={edge.animOrder + 1}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{
                      delay: edge.animOrder + 1,
                      duration: 2,
                      repeat: Infinity,
                      repeatDelay: 3
                    }}
                  >
                    <animateMotion
                      dur="2s"
                      repeatCount="indefinite"
                      path={`M ${edge.startX} ${edge.startY} C ${edge.startX + 150} ${edge.startY}, ${edge.endX - 150} ${edge.endY}, ${edge.endX} ${edge.endY}`}
                    />
                  </motion.circle>
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map(node => {
            const isDisintegrating = (node.type === 'source' && node.data.url === disintegratingSourceUrl) || (node.type === 'branch' && node.data.claim === disintegratingClaim);
            const fadingWithClaim = node.type === 'source' && node.branchData?.claim === disintegratingClaim;
            return (
            <motion.div
              key={node.id}
              custom={node.animOrder}
              variants={nodeAnim}
              initial="hidden"
              animate={isDisintegrating ? { opacity: 0, scale: .04, filter: 'blur(18px)' } : fadingWithClaim ? { opacity: 0, scale: .5, filter: 'blur(13px)' } : 'visible'}
              className="absolute pointer-events-auto origin-center"
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
              }}
            >
              {node.type === 'core' && <CoreNode data={node.data} isDarkMode={isDarkMode} />}
              {node.type === 'branch' && <BranchNode data={node.data} isDarkMode={isDarkMode} onSelect={onClaimSelect} />}
              {node.type === 'source' && <SourceNode source={node.data} isDarkMode={isDarkMode} onSelect={onSourceSelect} />}
              {isDisintegrating && <MicroNodeBurst isDodgy={node.data.isDodgy}/>} 
            </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CoreNode({ data, isDarkMode }: { data: VerificationResult, isDarkMode: boolean }) {
  return (
    <div className={cn(
      "w-full h-full rounded-2xl border p-6 flex flex-col shadow-[0_0_50px_-12px_rgba(59,130,246,0.5)] transition-colors backdrop-blur-2xl relative overflow-hidden",
      isDarkMode ? "bg-slate-900/90 border-blue-500/50" : "bg-white/90 border-blue-400"
    )}>
      {/* Glow orb */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/20 rounded-full blur-3xl" />
      
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <h2 className={cn("shrink-0 text-[10px] font-bold uppercase tracking-[0.2em] mb-3 flex items-center gap-2", isDarkMode ? "text-blue-400" : "text-blue-600")}>
          <Target size={14} /> Core Concept Analyzed
        </h2>
        <div className="core-node-copy custom-scrollbar" onWheel={(event) => event.stopPropagation()}>
          <p className={cn("font-serif leading-[1.18]", isDarkMode ? "text-white" : "text-slate-900")}>
            {data.coreConcept}
          </p>
        </div>
        <div className="mt-3 flex shrink-0 items-center gap-4">
          <div className={cn("px-4 py-2 rounded-lg border font-mono font-bold text-sm", isDarkMode ? "bg-blue-500/10 border-blue-500/30 text-blue-300" : "bg-blue-50 border-blue-200 text-blue-700")}>
            CONFIDENCE: {data.confidenceScore}%
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchNode({ data, isDarkMode, onSelect }: { data: Branch, isDarkMode: boolean, onSelect?: (claim: Branch) => void }) {
  return (
    <button type="button" onClick={() => onSelect?.(data)} title="Open confidence claim controls" className={cn(
      "w-full h-full rounded-xl border p-6 flex flex-col justify-center text-left shadow-[0_0_30px_-10px_rgba(148,163,184,0.3)] transition-colors backdrop-blur-xl relative cursor-pointer hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-amber-400/70",
      isDarkMode ? "bg-slate-800/90 border-slate-600/50" : "bg-slate-50/90 border-slate-300"
    )}>
      <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-4 flex items-center justify-center bg-slate-900 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)]">
        <div className="w-2 h-2 rounded-full bg-blue-400" />
      </div>
      
      <h3 className={cn("text-[10px] font-bold uppercase tracking-[0.15em] mb-3 flex items-center gap-2", isDarkMode ? "text-slate-400" : "text-slate-500")}>
        <Link2 size={12} /> Supporting Claim
      </h3>
      <p className={cn("text-base font-medium leading-relaxed mb-4", isDarkMode ? "text-slate-200" : "text-slate-800")}>
        {data.claim}
      </p>
      
      <div className="mt-auto">
         <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-mono", 
            data.confidenceScore > 70 
              ? (isDarkMode ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-green-50 border-green-200 text-green-700")
              : (isDarkMode ? "bg-orange-500/10 border-orange-500/30 text-orange-400" : "bg-orange-50 border-orange-200 text-orange-700")
         )}>
           <Activity size={12} /> Claim Score: {data.confidenceScore}%
         </div>
      </div>
    </button>
  );
}

function SourceNode({ source, isDarkMode, onSelect }: { source: Source, isDarkMode: boolean, onSelect?: (source: Source) => void }) {
  const isDodgy = source.isDodgy;
  const stance = source.evidenceProfile?.stance || 'unclear';
  const stanceLabel = stance === 'supports' ? 'Supports claim' : stance === 'refutes' ? 'Refutes claim' : stance === 'context' ? 'Adds context' : 'Relation unclear';
  const accent = isDodgy ? 'red' : stance === 'refutes' ? 'rose' : stance === 'context' ? 'amber' : stance === 'supports' ? 'emerald' : 'blue';
  const accentStyle = accent === 'red' ? 'bg-red-500 text-red-500' : accent === 'rose' ? 'bg-rose-400 text-rose-400' : accent === 'amber' ? 'bg-amber-400 text-amber-400' : accent === 'emerald' ? 'bg-emerald-400 text-emerald-400' : 'bg-blue-500 text-blue-500';
  const badgeStyle = accent === 'red' ? 'bg-red-500/90' : accent === 'rose' ? 'bg-rose-500/90' : accent === 'amber' ? 'bg-amber-500/90' : accent === 'emerald' ? 'bg-emerald-500/90' : 'bg-blue-500/90';
  
  return (
    <button onClick={() => onSelect?.(source)} className={cn(
      "w-full h-full rounded-2xl border flex flex-col shadow-2xl transition-all duration-500 overflow-hidden relative group text-left cursor-pointer hover:-translate-y-1 hover:scale-[1.015] focus:outline-none focus:ring-2 focus:ring-amber-400/70",
      isDarkMode 
        ? (isDodgy ? "bg-slate-900/95 border-red-500/50 shadow-[0_0_40px_-10px_rgba(239,68,68,0.3)]" : "bg-slate-900/95 border-blue-500/30 shadow-[0_0_40px_-10px_rgba(59,130,246,0.2)]") 
        : (isDodgy ? "bg-white/95 border-red-400 shadow-[0_0_40px_-10px_rgba(239,68,68,0.3)]" : "bg-white/95 border-slate-300 shadow-xl")
    )}>
      
      {/* Glowing Edge Indicator */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-1 shadow-[0_0_20px_2px_currentColor]",
        accentStyle
      )} />

      {/* Header Image or Gradient */}
      <div className="h-40 w-full relative shrink-0 overflow-hidden bg-slate-950">
        {source.imageUrl ? (
          <>
            <img src={source.imageUrl} alt={source.title} className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
          </>
        ) : (
          <div className={cn("w-full h-full bg-gradient-to-br", accent === 'red' || accent === 'rose' ? "from-rose-900/40 to-slate-900" : accent === 'amber' ? "from-amber-900/40 to-slate-900" : accent === 'emerald' ? "from-emerald-900/40 to-slate-900" : "from-blue-900/40 to-slate-900")} />
        )}
        
        {/* Relation and quality are intentionally separate: neither is a verdict on the claim. */}
        <div className="absolute top-4 right-4 flex flex-wrap justify-end gap-2">
          {isDodgy ? (
            <div className="bg-red-500/90 text-white px-3 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase flex items-center gap-1 shadow-lg backdrop-blur-md">
              <ShieldAlert size={14} /> High risk
            </div>
          ) : (
             <div className={cn("text-white px-3 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase flex items-center gap-1 shadow-lg backdrop-blur-md", badgeStyle)}>
              <ShieldCheck size={14} /> {stanceLabel}
            </div>
          )}
          <div className="bg-slate-950/70 text-white px-2.5 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase shadow-lg backdrop-blur-md">Evidence {source.credibilityScore ?? '—'}</div>
        </div>
      </div>

      <div className="p-6 flex flex-col flex-1 overflow-hidden">
        <h3 className={cn("text-lg font-bold mb-4 line-clamp-2", isDarkMode ? "text-white" : "text-slate-900")}>
          {source.title}
        </h3>
        
        <div className="source-node-scroll custom-scrollbar" onWheel={(event) => event.stopPropagation()}>
           <p className={cn("text-sm leading-relaxed", isDarkMode ? "text-slate-300" : "text-slate-600")}>
            {source.snippet.includes(source.citedText) ? (
              source.snippet.split(source.citedText).map((part, i, arr) => (
                <span key={i}>
                  {part}
                  {i < arr.length - 1 && (
                    <span className={cn(
                      "font-semibold px-1 rounded mx-0.5 whitespace-pre-wrap", 
                      isDodgy 
                        ? (isDarkMode ? "bg-red-500/20 text-red-200" : "bg-red-100 text-red-800")
                        : (isDarkMode ? "bg-blue-500/20 text-blue-200" : "bg-blue-100 text-blue-800")
                    )}>
                      {source.citedText}
                    </span>
                  )}
                </span>
              ))
            ) : source.snippet}
          </p>
        </div>

        <div className="source-scroll-cue" aria-hidden="true"><i/> Scroll source extract</div>

        <div className="pt-4 mt-4 border-t border-slate-500/20 shrink-0">
          <span
            className={cn(
              "inline-flex items-center gap-2 transition-colors text-sm font-medium w-full justify-center px-4 py-3 rounded-xl",
              isDarkMode 
                ? "bg-slate-800 hover:bg-slate-700 text-white" 
                : "bg-slate-100 hover:bg-slate-200 text-slate-900"
            )}
          >
            Open evidence dossier <ExternalLink size={16} />
          </span>
        </div>
      </div>
      <div className="absolute inset-x-6 bottom-20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        <div className="source-extract-plaque"><span>EXTRACT</span><strong>{source.citedText}</strong><p>{source.snippet}</p></div>
      </div>
    </button>
  );
}
