# Sourceful

**Truth modelling in your pocket.** Sourceful is a visual evidence engine for journalism, history research, and education. It turns a question, claim, or uploaded research lead into an interactive 3D/2D evidence graph, making the provenance, disagreement, and limits of corroboration inspectable instead of presenting an AI answer as an oracle.

![License: MIT](https://img.shields.io/badge/License-MIT-d4a64b.svg)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--5.6-412991.svg)

## Why Sourceful

**Sourceful turns a question into an evidence map—not just a search-results page.** Each claim is connected to the passages that support, refute, or contextualise it, while the graph exposes provenance overlap, source directness, independence, and bounded evidence contribution.

Its distinction is **explainable uncertainty**: rather than returning a black-box truth label, Sourceful lets a learner, researcher, or journalist inspect the route to a conclusion and distinguish genuine corroboration from repetition or shared origin.

**Live demo:** https://sourceful-167935310251.europe-west1.run.app

**Repository:** https://github.com/GvidoGvido/sourceful

## What it does

- Researches public claims with the **OpenAI Responses API** and native web search.
- Adds route-aware metadata discovery from public scholarly, archival, scientific, and official-dataset indexes before the web-research pass, then requires the model to verify original records before treating them as evidence.
- Routes work intelligently for public claims, history, scripture, maths, and uploaded documents.
- Builds an explorable 3D discovery graph and a 2D research board with claim and source nodes.
- Includes a built-in “How to read the graph” legend covering node roles, stance colours, assessment scores, evidence distance, and the selected gold provenance route.
- Uses an explicit visual evidence key: green supports, lime marks high-directness support, amber adds context, rose/red carries counterevidence or trace risk, and blue marks unresolved or non-scoring observed-lineage leads. A blue node never strengthens a claim by itself.
- Keeps layered dossiers usable: source, claim, library, and Info panels may remain open, but the panel most recently opened or clicked takes visual precedence.
- Calculates an auditable credibility path for every trace: source quality, exact claim relevance, directness, independence, and bounded compounded contribution.
- Compounds supporting and refuting paths **separately** per branch, discounting repeated sources that share publisher or observed-reference provenance.
- Exports claim/source evidence to CSV, saves research artefacts locally, creates briefs, and can dissolve weak traces from the working graph.
- Supports optional browser-managed BYOK: a user can unlock a key for one tab or encrypt it locally with a passphrase. Sourceful never writes a user key to a database, saved graph, or CSV.

## Use cases

- **Journalism:** trace a breaking public claim to primary statements, reporting, counterevidence, and repeated-origin risks.
- **History and religion:** separate primary text or archive material from modern interpretation, edition differences, and historiographical disagreement.
- **Education:** let learners inspect why independent corroboration is stronger than many copies of one assertion.
- **Everyday fact-checking:** investigate a celebrity claim, viral post, statistic, or “my friend said…” assertion without being forced into a false binary.
- **Document review:** upload a PDF, DOCX, RTF, text, CSV, JSON, or image (up to 8 MB) and investigate its claims against external material.

## Guided demo and visuals

The guided demo is a simulated research artefact intended to teach the interface and evidence model before a visitor connects an API key. Its included research-desk illustration is a locally bundled, OpenAI-generated **decorative demo visual**. It is visibly labelled in the app and is never presented as a source image, source extract, or proof. Live source-card images are only displayed when metadata is available from that same fetched page.

## Run locally

Requirements: Node.js 22+ and an OpenAI API key with Responses API access.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Choose **Configure → Connect API key** and either connect it for the current tab or encrypt it on the device with a passphrase. You can also use a server-owned key for local development:

```bash
cp .env.example .env.local
```

Then set `OPENAI_API_KEY` in `.env.local`. Never commit that file.

### Optional Google-grounded discovery pass

Set `GEMINI_API_KEY` in `.env.local` to enable the separately-labelled Google cross-check. This is optional: OpenAI native web search is Sourceful’s default discovery mechanism and OpenAI remains responsible for assembling the graph.

## Evidence standard

Sourceful does **not** ask the model to invent a truth or credibility score. The model extracts auditable source attributes—source/evidence type, stance, visible author/method/correction signals, visible references, and passage directness. The server then calculates the displayed path and branch signals.

For each source, its compounded contribution is the geometric combination of:

1. **Source quality** — the observable authority, evidence quality, transparency, and citation signals available for that trace.
2. **Claim relevance** — how strongly the exact fetched/returned passage overlaps the active branch claim.
3. **Directness** — whether the material directly supplies the evidence rather than merely commenting on it. After a page is inspected, Sourceful caps the extractor’s initial observation against the exact claim terms recovered from that page’s passage, so a polished but tangential result cannot retain an inflated directness score.
4. **Independence** — discounted when a trace is in the same publisher or observed shared-reference provenance path.

The system first combines repeated material within one provenance path with a strong discount, then compounds only across distinct paths. Supporting, refuting, and contextual evidence remain separate values. This means a branch can be well researched and strongly refuted; a high **assessment confidence** is not automatically high **support for the claim**.

- **Corroborated** requires strong support across at least two provenance-separated paths, including a primary, official, or academic supporting path.
- **Contested** means material supporting and refuting paths are both substantial.
- **Refuted** means sufficiently strong refuting paths materially outweigh supporting paths.
- **Insufficient evidence** remains visible as a finding; it is not silently converted into certainty.

Domain diversity is a proxy rather than proof of editorial independence. Shared citations are a clue of possible common provenance, not proof of copying; cited-reference density is not treated as a web-wide inbound citation count.

### Bounded fetched-passage review

After public-page inspection, Sourceful may send only the recovered, claim-relevant excerpt—not a whole crawled page—to GPT-5.6 for a second, source-specific review. The pass is capped at **18 excerpts** and the model can revise only the excerpt's stance, evidence type, and directness against its precise branch claim. It cannot use source reputation, URLs, or outside knowledge as evidence in that pass, and it cannot infer author credentials or turn a linked page into corroboration. The review is visible in the source dossier and the deterministic provenance scorer then recalculates the trace and branch from those bounded observations.

### Bounded evidence expansion

The first search is an initial pass, not a claim of exhaustive research. A live graph can be extended from the toolbar or a specific claim card. Each extension is a new OpenAI web-research pass focused on missing support, refutation, or context; it deduplicates canonical source URLs before merging results.

- Sourceful caps a graph at **four total passes** and **60 source traces**, with a stricter expansion request limit, so BYOK research cannot turn into an unbounded autonomous crawler.
- For up to 24 not-yet-inspected public source pages per pass, the server safely resolves Open Graph thumbnails, extracts a bounded visible-text candidate for the precise claim, and records links to other *active* source traces. Purple dashed board arcs mean an observed page-to-page link only; they do **not** assert that the link is a scholarly citation or proof.
- A researcher can select a direct source and choose **Trace 2–3 observed sources**. Sourceful safely fetches at most ten reference-like public links from that page, keeps only up to three child pages with a recovered claim-relevant passage, and renders them as blue **observed lineage** leads. They are deliberately excluded from support/refutation and compounded-confidence calculations: a citation-heavy page cannot manufacture a stronger verdict by expanding into many descendants.
- Sourceful also stores bounded fingerprints of observed external references. When active traces share one, the board shows a separate provenance path: it is an indication of a potentially shared evidence lineage, **not** independent corroboration.
- Sources sharing a publisher domain are stored as a provenance cluster and are not counted as independent corroboration merely because they appear more than once.

### Reference sourcing and provenance

Every source node is meant to be inspectable. When available, a dossier exposes the original URL, returned author/date, exact cited text, a claim-aligned page extract, visible source attributes, observed active links, external-reference fingerprints, and a source-specific Open Graph thumbnail. A research brief lists intercepted active-source links and their average source-confidence context.

The graph distinguishes three relationships:

- **Direct observed link:** one inspected public page links to another active trace.
- **Shared publisher:** two traces come from the same publisher domain.
- **Shared cited reference:** inspected traces visibly point to the same external reference.

These are provenance observations, not automatically scholarly citations, proof of copying, or proof that either source is correct. Sourceful does not currently produce a complete bibliographic parser for arbitrary PDFs, paywalled pages, or archives.

### Route-aware discovery adapters

Before a live web-research pass, Sourceful can request a small metadata packet from public, no-key connectors appropriate to the route: **OpenAlex** and **Crossref** for scholarly leads; the **Library of Congress** search API for historical, scripture, and document routes; **Europe PMC** for science/health-shaped questions; and **Data.gov** for data/statistics-shaped questions. Each connector is time-bounded and its records are presented to GPT-5.6 as leads only. Sourceful does not treat a catalog record, DOI, citation count, or shared reference as proof—final graph sources must still be real original pages retrieved through the web-research workflow.

This is a deliberately bounded foundation for deeper provenance work. A production-grade long-running investigation would still need a persistent job queue, full-text/structured citation parsers for PDFs and archives, authenticated specialist databases, human review checkpoints, and explicit per-user cost controls.

## Deploy to Google Cloud Run

The repository includes a production Dockerfile. The app is public, but live research requires either a server environment key or a visitor’s own key through the in-browser vault.

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=YOUR_PROJECT_ID
gcloud run deploy sourceful \
  --source . \
  --project=YOUR_PROJECT_ID \
  --region=europe-west1 \
  --allow-unauthenticated \
  --port=8080
```

To run Sourceful with a shared server key, set `OPENAI_API_KEY` as a Cloud Run secret or environment variable. For a public demo, prefer BYOK and leave that variable unset.

### Public deployment safety

- No browser key is embedded in the frontend bundle.
- BYOK requests are same-origin and sent only over HTTPS to the server for the active request.
- The optional remembered-key vault uses PBKDF2 + AES-GCM and requires the user’s passphrase after a refresh. The passphrase is not stored.
- API responses are `no-store`; the service disables `X-Powered-By`, sends restrictive browser security headers, enforces 1 MB JSON and 4 MB upload limits, and applies a per-instance request throttle.
- Do not treat browser encryption as protection against an untrusted browser extension or XSS. Use restricted project keys and keep deployment dependencies current.

Key safety: keys are not persisted or logged by the server. “Remember key” is opt-in and encrypts it locally with AES-GCM using a passphrase that is not stored. That is reasonable for a BYOK hackathon app, but not absolute protection: browser extensions, malware, or an XSS compromise could still access an unlocked key. Users should use a dedicated, low-budget OpenAI project key—not a main organisational key. OpenAI’s official guidance remains to avoid exposing keys in browser code.

## OpenAI Build Week

### How GPT-5.6 powers Sourceful

GPT-5.6 is the reasoning layer behind each live research pass. Through the OpenAI Responses API, it:

- classifies the question into an appropriate research route (public claim, history, scripture, mathematics, or document-led investigation);
- uses web search to discover and compare relevant public material;
- converts the research into a strict, structured claim/source graph rather than free-form prose;
- extracts a claim-aligned passage, stance, and observable evidence attributes for every trace; and
- produces a readable research brief that preserves uncertainty, counterevidence, and the limits of the current investigation.

Sourceful deliberately keeps the final credibility calculations deterministic and inspectable on the server. GPT-5.6 supplies structured observations from retrieved evidence; Sourceful then applies provenance clustering, directness caps, repeated-origin discounts, and separate support/refutation aggregation. The result is an AI-assisted workflow where the route to a conclusion remains visible and challengeable.

### How Codex accelerated the build

Codex was used throughout the end-to-end implementation and refinement of Sourceful:

- building the React, Tailwind, Framer Motion, and Three.js 3D discovery surface alongside the fixed-scale 2D research board;
- implementing the Express research API, OpenAI Responses workflow, route-aware public metadata adapters, structured validation, and evidence/provenance scoring pipeline;
- designing the interaction model: draggable graph navigation, hover extracts, selected-path highlighting, source dossiers, CSV export, saved research artefacts, and research briefs;
- creating the browser-managed BYOK vault and its safety controls, including local AES-GCM encryption for opt-in remembered keys;
- iterating on accessible responsive layouts, light/dark visual systems, animations, tooltips, and mobile graph controls; and
- adding deployment assets, verification checks, and documentation for a public Cloud Run demo.

This is not a claim that the model independently produced reliable verdicts. Codex accelerated implementation decisions, testing, and visual/interaction iteration; GPT-5.6 performs bounded retrieval and structured analysis within Sourceful's explicit evidence model.


## Validation

```bash
npm run lint
npm run build
```

## License

[MIT](LICENSE)
