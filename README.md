# Sourceful

**A visual evidence engine for journalism, history research, and education.** Sourceful turns a question, claim, or uploaded research lead into an interactive 3D/2D evidence graph. It keeps claim-level provenance, makes the limits of corroboration visible, and lets a researcher inspect the evidence rather than treating an AI answer as an oracle.

![License: MIT](https://img.shields.io/badge/License-MIT-d4a64b.svg)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--5.6-412991.svg)

**Live demo:** https://sourceful-167935310251.europe-west1.run.app

**Repository:** https://github.com/GvidoGvido/sourceful

## What it does

- Researches public claims with the **OpenAI Responses API** and native web search.
- Adds route-aware metadata discovery from public scholarly, archival, scientific, and official-dataset indexes before the web-research pass, then requires the model to verify original records before treating them as evidence.
- Routes work intelligently for public claims, history, scripture, maths, and uploaded documents.
- Builds an explorable 3D discovery graph and a 2D research board with claim and source nodes.
- Evaluates transparent evidence signals: authority, evidence quality, independence, temporal fitness, methods/corrections, corroboration, citation network, and semantic depth.
- Exports claim/source evidence to CSV, saves research artefacts locally, creates briefs, and can dissolve weak traces from the working graph.
- Supports optional browser-managed BYOK: a user can unlock a key for one tab or encrypt it locally with a passphrase. Sourceful never writes a user key to a database, saved graph, or CSV.

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

Sourceful does **not** ask the model to invent a credibility score. The model extracts auditable source attributes—source/evidence type, stance, visible author/method/correction signals, visible references, and passage directness. The server calculates displayed metrics and applies a conservative verdict gate.

- **Corroborated** requires at least one high-evidence primary, official, or academic source plus support across at least three domains.
- **Contested** means independently sourced support and refutation are both present.
- **Insufficient evidence** remains visible as a finding; it is not silently converted into certainty.

Domain diversity is a proxy rather than proof of editorial independence, and cited-reference density is not treated as web-wide inbound citation count.

### Bounded evidence expansion

The first search is an initial pass, not a claim of exhaustive research. A live graph can be extended from the toolbar or a specific claim card. Each extension is a new OpenAI web-research pass focused on missing support, refutation, or context; it deduplicates canonical source URLs before merging results.

- Sourceful caps a graph at **four total passes** and **60 source traces**, with a stricter expansion request limit, so BYOK research cannot turn into an unbounded autonomous crawler.
- For up to 24 not-yet-inspected public source pages per pass, the server safely resolves Open Graph thumbnails, extracts a bounded visible-text candidate for the precise claim, and records links to other *active* source traces. Purple dashed board arcs mean an observed page-to-page link only; they do **not** assert that the link is a scholarly citation or proof.
- Sourceful also stores bounded fingerprints of observed external references. When active traces share one, the board shows a separate provenance path: it is an indication of a potentially shared evidence lineage, **not** independent corroboration.
- Sources sharing a publisher domain are stored as a provenance cluster and are not counted as independent corroboration merely because they appear more than once.

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

## OpenAI Build Week notes

**Suggested track:** Education — Sourceful teaches researchers how to separate primary evidence, independent corroboration, and unsupported repetition.

Codex accelerated the end-to-end build: implementing the React + Three.js graph surfaces, the Express research backend, deterministic evidence scoring, visual interaction work, browser-key vault, deployment container, and verification passes. GPT-5.6 powers route selection, structured source extraction, web research, and research brief generation.

Before submitting:

1. Add the public deployment URL and this repository URL to Devpost.
2. Record a public YouTube demo under three minutes, with audio explaining both Sourceful and how Codex/GPT-5.6 were used.
3. Add the `/feedback` Codex session ID from the primary implementation session.
4. Ensure no secrets or personal research files are committed.

## Validation

```bash
npm run lint
npm run build
```

## License

[MIT](LICENSE)
