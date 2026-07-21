---
target: Panorama confidence-breakdown card + /runs live sync banner
total_score: 20
p0_count: 0
p1_count: 2
timestamp: 2026-07-21T21-21-12Z
slug: ma-confidence-breakdown-card-runs-live-sync-banner
---
Method: dual-agent (A: assessment-A-design-review · B: assessment-B-detector)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Auto-refresh had no confirmation a refresh happened — n/a after aria-live fix |
| 2 | Match System / Real World | 3 | Good jargon translation for N/S/SEM_LV |
| 3 | User Control and Freedom | 1 | No pause for animate-ping/poll — reduced-motion respected now, no manual pause control (deferred) |
| 4 | Consistency and Standards | 2 | Bar thickness + a 3rd unlinked color-triad definition — both fixed |
| 5 | Error Prevention | n/a | No destructive actions in scope |
| 6 | Recognition Rather Than Recall | 4 | Swatch + label + value + % always shown together |
| 7 | Flexibility and Efficiency | 1 | Running-sync card had no link to run detail — fixed |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained color budget, no decoration |
| 9 | Error Recovery | n/a | No error state in scope |
| 10 | Help and Documentation | 3 | Inline hint text sufficient for scope |
| **Total** | | **20/32 scored** (2 n/a) | **Acceptable → Good after fixes** |

## Anti-Patterns Verdict

**Not AI slop.** Both additions pass the product-register test (product.md): no invented fonts/shadows/gradients, motion encodes real state (a running job), reuses existing Card/SectionTitle/formatBRL primitives, keeps palette centralized. Issues found were calibration/consistency bugs, not AI-slop tells.

**Deterministic scan**: `detect.mjs --json` against all 4 touched files — exit 0, zero findings.

## Overall Impression

Solid, restrained additions that follow the existing design system's structure (Card/SectionTitle, centralized palette) but picked new colors without the same contrast rigor already documented for `MAGNITUDE`, and missed a couple of small consistency/reachability details (link-through, bar thickness) that the rest of the app is consistent about.

## What's Working

- Single-string jargon translation (`'Categoria única ("N")'`) does both "match real world" and "recognition not recall" work in one label.
- Palette kept centralized in `palette.ts` rather than inlined — a future recolor is a one-line change.
- `ConfidenceBreakdown` reuses the exact Card/SectionTitle scaffolding as its sibling breakdown cards on the same page.

## Priority Issues (fixed in this session unless noted)

**[P1] Two of three `CONFIANCA` fill colors failed WCAG 1.4.11 non-text contrast (≥3:1) against the white Card background** — `emerald-500` ≈2.5:1, `amber-500` ≈2.1:1 (verified by manual luminance calculation). **Fixed**: swapped to the existing `positive`/`warning`/`negative` tokens already declared in `tailwind.config.ts` (unused elsewhere until now) — all ≥5:1.

**[P2] Running-sync card was the one place a run is referenced without a link to `/runs/{id}`**, unlike every other reference in the app. **Fixed**: added a "Ver detalhes →" link.

**[P2] Bar thickness (`h-2.5`) diverged from `BreakdownList`'s established `h-1.5`** for the same visual pattern on the same page. **Fixed**.

**[P2] `CONFIANCA` was a third, unlinked definition of the same good/caution/bad triad** already present (unused) in `tailwind.config.ts` and (differently) in `KpiCard`'s tone mapping. **Fixed**: now mirrors the config tokens directly.

**[P1/P2] No `aria-live`/`role="status"` on the auto-updating sync banner, and no reduced-motion fallback for the pulsing indicator** (WCAG 4.1.3 / prefers-reduced-motion). **Fixed**: added `role="status" aria-live="polite"` (matching the codebase's own existing `contas-panel.tsx` convention) and `motion-safe:animate-ping`.

**[P3, deferred] No manual pause/refresh-now control for the indefinite 5s poll (WCAG 2.2.2).** Judged as a real but heavier UX/scope decision (adds a new interaction, not just a fix) for a low-traffic internal tool — left for the user to request explicitly rather than added unprompted.

## Persona Red Flags

**Alex (power user)**: no manual "refresh now" (deferred, see above); running-sync card previously broke the click-through habit trained everywhere else in the app (now fixed).

**Sam (accessibility)**: directly hit by the contrast failure (now fixed) and the missing live-region announcement (now fixed); still no pause control for the indefinite animation/poll (deferred, same as Alex's gap but a harder requirement here).

## Minor Observations (not changed — pre-existing patterns, out of scope)

- `"tabular"` isn't a real Tailwind utility (`tabular-nums` is) — inherited from `kpi-card.tsx`/`breakdown-list.tsx`; corrected in the new component only, not the pre-existing files.
- `STATUS_LABEL` is duplicated verbatim between `page.tsx` and `runs/page.tsx` — pre-existing drift risk, not introduced by this change.
