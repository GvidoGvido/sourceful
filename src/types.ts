export interface Source {
  title: string;
  url: string;
  snippet: string;
  citedText: string;
  imageUrl?: string;
  credibilityScore?: number;
  isDodgy?: boolean;
  isKilled?: boolean;
  author?: string;
  publishedAt?: string;
  citations?: number;
  /** Links from this fetched page to another active trace. These are observed links, not assumed citations. */
  observedReferenceCount?: number;
  semanticDepth?: number;
  verificationStatus?: 'checking' | 'verified' | 'contested';
  provider?: 'openai_web' | 'gemini_google';
  evidenceProfile?: EvidenceProfile;
  metrics?: SourceMetrics;
}

export interface EvidenceRelation {
  fromUrl: string;
  toUrl: string;
  kind: 'references' | 'shared_publisher';
  strength: number;
  note: string;
}

export interface ProvenanceCluster {
  id: string;
  label: string;
  sourceUrls: string[];
  basis: 'publisher';
}

export interface ResearchMetadata {
  completedPasses: number;
  maxPasses: number;
  nodeBudget: number;
  sourcePagesInspected: number;
  observedRelations: number;
}

export interface EvidenceProfile {
  sourceType: 'primary' | 'official_record' | 'academic' | 'institutional' | 'newsroom' | 'analysis' | 'advocacy' | 'commercial' | 'user_generated' | 'unknown';
  evidenceType: 'direct_document' | 'dataset' | 'peer_reviewed' | 'on_record_reporting' | 'secondary_summary' | 'commentary' | 'unverified';
  stance: 'supports' | 'refutes' | 'context' | 'unclear';
  authorNamed: boolean;
  methodologyVisible: boolean;
  correctionsVisible: boolean;
  citedReferenceCount: number;
  directness: number;
  reliabilityFlags: string[];
}

export interface SourceMetrics {
  authority: number;
  evidenceQuality: number;
  independence: number;
  recency: number;
  transparency: number;
  corroboration: number;
  citationNetwork: number;
  semanticDepth: number;
}

export interface Branch {
  claim: string;
  confidenceScore: number;
  biasAnalysis?: string;
  verdict?: 'corroborated' | 'provisionally_supported' | 'contested' | 'insufficient_evidence' | 'formally_checked' | 'formally_refuted';
  decisionReasons?: string[];
  sources: Source[];
}

export interface VerificationResult {
  isDemo?: boolean;
  coreConcept: string;
  confidenceScore: number;
  biasAnalysis?: string;
  evidenceStandard?: string;
  researchRoute?: 'public_claim' | 'historical' | 'scripture' | 'math' | 'document';
  evidenceRelations?: EvidenceRelation[];
  provenanceClusters?: ProvenanceCluster[];
  researchMetadata?: ResearchMetadata;
  branches: Branch[];
}

export type AppState = 'idle' | 'encrypting' | 'loading' | 'results';
