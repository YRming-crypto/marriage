# AI Marriage Design Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an independently runnable design-optimized version of the AI marriage platform without changing its established business routes or exposing private matching logic.

**Architecture:** Keep the existing React/Vite/Fastify workspace and route contract. Add a small motion enhancer at the app shell, update shared presentation components, and revise page-level layouts through existing semantic classes and design tokens. All business state remains inside the current pages.

**Tech Stack:** React 19, TypeScript, Vite, React Router, Lucide React, CSS animations, IntersectionObserver, Vitest, Testing Library.

---

### Task 1: Design context and navigation shell

**Files:**
- Create: `PRODUCT.md`
- Create: `DESIGN.md`
- Modify: `apps/web/src/components/SiteHeader.tsx`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/global.css`

- [x] Keep the desktop brand, primary navigation and account actions on one line.
- [x] Preserve the mobile menu button and all nine route labels.
- [x] Convert the palette to accessible OKLCH tokens while retaining the warm red identity.
- [x] Verify navigation tests still pass.

### Task 2: Purposeful motion layer

**Files:**
- Create: `apps/web/src/components/MotionEnhancer.tsx`
- Create: `apps/web/src/components/MotionEnhancer.test.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/styles/global.css`

- [x] Write a test showing content is immediately revealed when IntersectionObserver is unavailable.
- [x] Add one-shot intersection reveals for list children marked with `data-reveal`.
- [x] Add cleanup for route changes and observer disposal.
- [x] Provide a complete reduced-motion fallback.

### Task 3: Homepage hierarchy and member presentation

**Files:**
- Modify: `apps/web/src/pages/HomePage.test.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/components/MemberCard.tsx`
- Modify: `apps/web/src/styles/global.css`

- [x] Preserve the photographic hero, quick search and existing public entrances.
- [x] Remove decorative service numbering and make service links a two-column editorial index.
- [x] Increase photo prominence and create rhythm in the homepage member grid without reducing readability.
- [x] Add restrained hero and list choreography using the shared motion layer.
- [x] Verify all homepage behavior tests pass.

### Task 4: Matching hall and profile decision surfaces

**Files:**
- Modify: `apps/web/src/pages/FindPage.tsx`
- Modify: `apps/web/src/pages/MemberPage.tsx`
- Modify: `apps/web/src/styles/global.css`

- [x] Make the desktop filter tool sticky and keep the mobile drawer behavior.
- [x] Clarify result count, sorting and card comparison rhythm.
- [x] Keep the member photograph stable while profile information scrolls on desktop.
- [x] Keep the favorite confirmation and both primary actions visible and readable on mobile.
- [x] Verify filter and favorite-return regression tests pass.

### Task 5: Chat, messages and onboarding polish

**Files:**
- Modify: `apps/web/src/pages/AvatarChatPage.tsx`
- Modify: `apps/web/src/pages/MessagesPage.tsx`
- Modify: `apps/web/src/pages/OnboardingPage.tsx`
- Modify: `apps/web/src/styles/global.css`

- [x] Animate new chat messages and readiness state without delaying interaction.
- [x] Improve tab feedback and empty/notification states.
- [x] Make onboarding progress and current step easier to scan.
- [x] Preserve all existing core-path test expectations.

### Task 6: Verification and visual QA

**Files:**
- Modify: `README.md`

- [x] Run `npm.cmd test` and confirm all API/web tests pass.
- [x] Run `npm.cmd run build` and confirm all workspaces compile.
- [x] Run the optimized web app on ports that do not replace the original app.
- [x] Inspect desktop 1280px and mobile 375px views for homepage, matching hall, profile, onboarding, AI chat and messages.
- [x] Check image loading, console errors, focus visibility and horizontal overflow.
