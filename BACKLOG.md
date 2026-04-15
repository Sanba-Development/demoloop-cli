# DemoLoop Backlog

---

## Discovery → MVP Roadmap

### Phase 1 — Discovery (current)
- [ ] **[HIGH]** Collect and analyze first waitlist responses from demoloop.sanba.dev
- [ ] **[HIGH]** Validate top integration: Claude Code output parsing (CLAUDE.md, session logs)
- [ ] **[MEDIUM]** Voice interview with first 3 waitlist signups
- [ ] **[MEDIUM]** Define "done" criteria for MVP demo loop end-to-end

### Phase 2 — CLI Alpha (Option B: CLI + Dashboard)
- [ ] **[HIGH]** Fix Windows audio recording (PowerShell MediaFoundation or Sox install guide)
- [ ] **[HIGH]** Add Cursor agent output parser (reads .cursor/chat history)
- [ ] **[HIGH]** Add Claude Code session parser (.claude/sessions/*.jsonl)
- [ ] **[HIGH]** End-to-end test: real agent session → demoloop start → tasks in BACKLOG.md
- [ ] **[MEDIUM]** Story grouping: cluster commits by feature, not 1:1 with commits
- [ ] **[MEDIUM]** Dashboard: add task checkbox toggle (marks done in session JSON)
- [ ] **[MEDIUM]** Dashboard: copy tasks as markdown button
- [ ] **[LOW]** Add --since flag (e.g. demoloop start --since yesterday)
- [ ] **[LOW]** GitHub Issues integration (create issues from tasks via gh CLI)

### Phase 3 — Beta Polish
- [ ] **[HIGH]** npm publish (demoloop@0.1.0)
- [ ] **[HIGH]** brew tap + formula (Sanba-Development/homebrew-tap)
- [ ] **[MEDIUM]** Config file schema validation + helpful errors
- [ ] **[MEDIUM]** Voice selection wizard (demoloop init --voice)
- [ ] **[MEDIUM]** Opt-in telemetry (PostHog) for usage metrics
- [ ] **[LOW]** VS Code extension wrapper (runs demoloop start in integrated terminal)

### Phase 4 — Launch
- [ ] **[HIGH]** README.md with GIF demo
- [ ] **[HIGH]** HackerNews Show HN post (draft ready)
- [ ] **[HIGH]** Private beta invites to waitlist (Formspree → email list)
- [ ] **[MEDIUM]** Update demoloop.sanba.dev with install instructions
- [ ] **[MEDIUM]** Reddit posts: r/ClaudeAI, r/cursor, r/vibecoding
- [ ] **[LOW]** Product Hunt launch prep

---
