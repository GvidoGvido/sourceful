# Sourceful

**A visual evidence engine for journalism, history research, and education.** Sourceful turns a question, claim, or uploaded research lead into an interactive 3D/2D evidence graph. It keeps claim-level provenance, makes the limits of corroboration visible, and lets a researcher inspect the evidence rather than treating an AI answer as an oracle.

![License: MIT](https://img.shields.io/badge/License-MIT-d4a64b.svg)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--5.6-412991.svg)

**Live demo:** https://sourceful-knllca53ba-ew.a.run.app

## What it does

- Researches public claims with the **OpenAI Responses API** and native web search.
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
