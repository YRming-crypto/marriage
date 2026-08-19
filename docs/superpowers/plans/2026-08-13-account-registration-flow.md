# Account Registration Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally usable and production-safe OTP registration flow shared by login and onboarding, with resumable non-sensitive profile drafts.

**Architecture:** Fastify owns OTP generation and environment protection; the React API client exposes typed OTP results and normalizes connection failures. A focused `useOtpAccount` hook owns validation, request state, countdown, verification, and user-facing status while the two pages retain their own layouts. Onboarding persists only step and non-sensitive profile draft data to local storage and gates later steps until account verification.

**Tech Stack:** TypeScript, Fastify, React 19, React Router, Vitest, Testing Library, localStorage, HttpOnly cookies

---

## File Structure

- Modify `apps/api/src/config.ts`: choose the development-only default OTP.
- Modify `apps/api/src/server.ts`: expose `devCode` only outside production.
- Modify `apps/api/src/otp.test.ts`: protect development and production OTP behavior.
- Modify `apps/web/src/api/client.ts`: type `devCode` and normalize unreachable API errors.
- Create `apps/web/src/hooks/useOtpAccount.ts`: shared OTP validation and async state.
- Create `apps/web/src/hooks/useOtpAccount.test.tsx`: hook behavior and countdown tests.
- Modify `apps/web/src/pages/OnboardingPage.tsx`: gated steps, shared OTP hook, resumable profile draft.
- Modify `apps/web/src/pages/OnboardingPage.test.tsx`: registration, gating, and draft tests.
- Modify `apps/web/src/pages/ContentPages.tsx`: login page uses shared OTP hook.
- Create `apps/web/src/pages/AuthPage.test.tsx`: login validation and successful verification tests.
- Modify `apps/web/src/styles/global.css`: stable OTP status and disabled-step styling.
- Modify `README.md`: document one-command local startup and OTP behavior.

### Task 1: Development OTP API

- [ ] Add failing API tests proving non-production defaults to `123456`, explicit overrides work, production never returns `devCode`, and invalid phones fail.
- [ ] Run `npm.cmd test --workspace @ai-marriage/api -- otp.test.ts` and confirm the default-code test fails.
- [ ] Update `getConfig()` so `otpCode` resolves from an explicit override, then `DEV_OTP_CODE`, then `123456` only outside production.
- [ ] Update the request route so `{ devCode }` is returned only when a development OTP exists and `NODE_ENV !== "production"`.
- [ ] Run the API OTP test and full API test suite; expect all tests to pass.

### Task 2: Shared Web OTP State

- [ ] Add failing hook tests for invalid phone, missing agreement, development code display, countdown, verification success, and network failure wording.
- [ ] Run `npm.cmd test --workspace @ai-marriage/web -- useOtpAccount.test.tsx` and confirm it fails because the hook does not exist.
- [ ] Extend `requestOtp()` to return `{ sent, expiresIn, devCode? }`; wrap fetch/network/invalid-body errors with `账号服务暂时无法连接，请确认本地 API 已启动后重试。`.
- [ ] Implement `useOtpAccount` with `phone`, `code`, `agreed`, `message`, `busy`, `secondsUntilResend`, `isVerified`, `sendCode()`, and `verifyAccount()`.
- [ ] Ensure the hook validates `/^1[3-9]\d{9}$/`, requires the agreement, prevents duplicate calls, and clears its timer on unmount.
- [ ] Run hook tests and the full Web suite; expect all tests to pass.

### Task 3: Onboarding Registration And Draft

- [ ] Add failing page tests proving later steps are locked before verification, `123456` completes account confirmation, profile data is saved/restored, and phone/code are not restored.
- [ ] Run the focused onboarding test and confirm the new assertions fail.
- [ ] Replace page-local OTP state with `useOtpAccount` and show an explicit `确认账号并继续` action on the account step.
- [ ] Disable later progress-step buttons until account verification; validate required profile fields before advancing from profile.
- [ ] Store `{ currentStep, profileDraft }` under one versioned local-storage key; tolerate invalid stored JSON and never persist phone or code.
- [ ] Preserve the existing safe return target and favorite intent behavior after completion.
- [ ] Add restrained styles for development-code notice, disabled progress items, stable action widths, and mobile wrapping.
- [ ] Run focused and full Web tests; expect all tests to pass.

### Task 4: Login Page Integration

- [ ] Add failing login-page tests for invalid phone, missing agreement, development OTP, verification, and navigation to onboarding.
- [ ] Run the focused auth test and confirm the new behavior fails.
- [ ] Replace the page-local request logic with `useOtpAccount`, add an explicit agreement checkbox, countdown label, and development-code notice.
- [ ] Keep successful login navigation to `/onboarding` and persist only the returned masked user summary.
- [ ] Run focused and full Web tests; expect all tests to pass.

### Task 5: Integration And Documentation

- [ ] Update `README.md` to make `npm.cmd run dev` the required local command and document development OTP `123456`, API URL, and memory persistence limits.
- [ ] Run `npm.cmd test`, `npm.cmd run build`, `npm.cmd run db:validate`, and `git diff --check`.
- [ ] Start API and Web together; verify `/api/health` and OTP request responses.
- [ ] In the browser, complete registration with a new phone, enter `123456`, save a profile draft, reload and verify restoration, then continue to the original AI avatar path.
- [ ] Inspect desktop and mobile layouts for overlap, disabled-state clarity, and readable status text.
- [ ] Review the final diff for accidental secrets, production OTP exposure, unrelated changes, and missing documentation.
