# AI Marriage Portal V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable first version of the AI marriage platform that lets a middle-aged user browse real-photo member cards, enter the matching hall, inspect a member, and start one combined onboarding flow.

**Architecture:** Use an npm workspace with a React/Vite web app, a small Fastify API, and a shared TypeScript package. The first visible release focuses on the public portal and route framework; AI scoring remains behind user-facing language and is not exposed on the homepage.

**Tech Stack:** React, TypeScript, Vite, React Router, Lucide React, Fastify, Vitest, Testing Library.

---

## File Map

- `ai-marriage-platform/package.json`: workspace scripts for development, build and tests.
- `ai-marriage-platform/apps/web/src/app/router.tsx`: the nine public navigation destinations and detail routes.
- `ai-marriage-platform/apps/web/src/pages/HomePage.tsx`: marriage portal homepage with member photography and major services.
- `ai-marriage-platform/apps/web/src/pages/FindPage.tsx`: filterable matching hall.
- `ai-marriage-platform/apps/web/src/pages/MemberPage.tsx`: public member profile and AI-avatar entry.
- `ai-marriage-platform/apps/web/src/pages/OnboardingPage.tsx`: combined login, profile, photo, preference and AI-question flow.
- `ai-marriage-platform/apps/web/src/pages/SectionPage.tsx`: complete but lightweight content for the remaining top-level entrances.
- `ai-marriage-platform/apps/web/src/components/`: shared shell, member cards and section headings.
- `ai-marriage-platform/apps/web/src/data/`: demo members and portal content.
- `ai-marriage-platform/apps/web/src/styles/`: locked design tokens and responsive page styles.
- `ai-marriage-platform/apps/api/src/server.ts`: health and member endpoints.
- `ai-marriage-platform/packages/shared/src/index.ts`: shared member and route types.

### Task 1: Workspace and route contract

**Files:**
- Create: `ai-marriage-platform/package.json`
- Create: `ai-marriage-platform/packages/shared/src/index.ts`
- Create: `ai-marriage-platform/apps/web/src/app/navigation.ts`
- Test: `ai-marriage-platform/apps/web/src/app/navigation.test.ts`

- [ ] **Step 1: Write the failing navigation contract test**

```ts
expect(mainNavigation.map((item) => item.label)).toEqual([
  "首页", "寻找缘分", "智能牵线", "消息", "动态",
  "线下活动", "幸福案例", "婚恋课堂", "我的",
]);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm.cmd run test --workspace @ai-marriage/web -- navigation.test.ts`

Expected: FAIL because the workspace or navigation module does not exist.

- [ ] **Step 3: Add the workspace and navigation implementation**

```ts
export const mainNavigation = [
  { label: "首页", to: "/" },
  { label: "寻找缘分", to: "/find" },
  { label: "智能牵线", to: "/matchmaking" },
  { label: "消息", to: "/messages" },
  { label: "动态", to: "/moments" },
  { label: "线下活动", to: "/activities" },
  { label: "幸福案例", to: "/stories" },
  { label: "婚恋课堂", to: "/classroom" },
  { label: "我的", to: "/me" },
] as const;
```

- [ ] **Step 4: Re-run the focused test**

Expected: PASS with all nine destinations in the approved order.

### Task 2: Portal homepage and member cards

**Files:**
- Create: `ai-marriage-platform/apps/web/src/data/members.ts`
- Create: `ai-marriage-platform/apps/web/src/components/MemberCard.tsx`
- Create: `ai-marriage-platform/apps/web/src/pages/HomePage.tsx`
- Create: `ai-marriage-platform/apps/web/src/styles/tokens.css`
- Create: `ai-marriage-platform/apps/web/src/styles/global.css`
- Test: `ai-marriage-platform/apps/web/src/pages/HomePage.test.tsx`

- [ ] **Step 1: Write a failing homepage behavior test**

```tsx
render(<MemoryRouter><HomePage /></MemoryRouter>);
expect(screen.getByRole("heading", { name: "认真认识，安心交往" })).toBeVisible();
expect(screen.getAllByRole("article", { name: /演示会员/ }).length).toBeGreaterThanOrEqual(6);
expect(screen.getByRole("link", { name: "寻找合适对象" })).toHaveAttribute("href", "/find");
```

- [ ] **Step 2: Run the test and verify missing components fail**

Run: `npm.cmd run test --workspace @ai-marriage/web -- HomePage.test.tsx`

Expected: FAIL because `HomePage` does not exist.

- [ ] **Step 3: Implement the homepage surfaces**

The homepage must render, in order: masthead, photographic hero, quick search, same-city members, today's recommendations, six major service entrances, moments, activities, stories, safety, classroom and footer. Member cards show only approved public demo information and use the label `演示资料`.

- [ ] **Step 4: Implement stable responsive styling**

Use one content shell, warm red primary color, portrait media at `aspect-ratio: 4 / 5`, 44px minimum controls, 16px minimum body copy, and breakpoints that produce four, two and one member columns without horizontal scrolling.

- [ ] **Step 5: Re-run the homepage test**

Expected: PASS and no missing image `alt` text.

### Task 3: Matching hall, member detail and combined onboarding

**Files:**
- Create: `ai-marriage-platform/apps/web/src/pages/FindPage.tsx`
- Create: `ai-marriage-platform/apps/web/src/pages/MemberPage.tsx`
- Create: `ai-marriage-platform/apps/web/src/pages/OnboardingPage.tsx`
- Create: `ai-marriage-platform/apps/web/src/app/router.tsx`
- Test: `ai-marriage-platform/apps/web/src/pages/FindPage.test.tsx`
- Test: `ai-marriage-platform/apps/web/src/pages/OnboardingPage.test.tsx`

- [ ] **Step 1: Write failing route and filter tests**

```tsx
expect(screen.getByRole("heading", { name: "寻找适合你的缘分" })).toBeVisible();
await user.selectOptions(screen.getByLabelText("所在城市"), "上海");
expect(screen.getAllByText("上海", { exact: false }).length).toBeGreaterThan(0);
```

- [ ] **Step 2: Write the combined onboarding assertion**

```tsx
expect(screen.getByText("建立婚恋档案")).toBeVisible();
expect(screen.getByText("基本资料")).toBeVisible();
expect(screen.getByText("上传照片")).toBeVisible();
expect(screen.getByText("交往期待")).toBeVisible();
expect(screen.getByText("关系问答")).toBeVisible();
```

- [ ] **Step 3: Implement matching hall filtering and detail navigation**

Filter members by gender, age range, city, marital status and relationship goal. Member detail contains photo, basic information, introduction, public lifestyle tags, `感兴趣` and `和 TA 的 AI 分身聊聊`; the second action redirects an incomplete user to `/onboarding?next=...`.

- [ ] **Step 4: Implement one combined onboarding route**

Use a five-step stepper inside a single route. The visible blocks are account confirmation, profile, photos, preferences, and relationship questions. Save draft values in local storage and never place those substeps in the top navigation.

- [ ] **Step 5: Run focused tests**

Expected: filter, route and combined-onboarding tests pass.

### Task 4: Remaining entrance pages, API, build and visual QA

**Files:**
- Create: `ai-marriage-platform/apps/web/src/pages/SectionPage.tsx`
- Create: `ai-marriage-platform/apps/api/src/server.ts`
- Create: `ai-marriage-platform/apps/api/src/server.test.ts`
- Create: `ai-marriage-platform/README.md`

- [ ] **Step 1: Write the API health test**

```ts
const response = await app.inject({ method: "GET", url: "/api/health" });
expect(response.statusCode).toBe(200);
expect(response.json()).toEqual({ status: "ok", service: "ai-marriage-api" });
```

- [ ] **Step 2: Implement the remaining route framework**

Each of `智能牵线`, `消息`, `动态`, `线下活动`, `幸福案例`, `婚恋课堂`, and `我的` receives a real route with domain-specific title, sample content, empty/loading-safe layout and one useful next action. No page displays algorithm weights or Prompt text.

- [ ] **Step 3: Implement and test the API**

Expose `/api/health` and `/api/members`. Do not expose private answers, matching weights or model prompts.

- [ ] **Step 4: Run the complete verification suite**

Run:

```text
npm.cmd test
npm.cmd run build
```

Expected: all tests pass and web/API TypeScript builds complete successfully.

- [ ] **Step 5: Start the local development server and perform browser QA**

Run: `npm.cmd run dev`

Verify at desktop and mobile widths: homepage is nonblank, member photos load, navigation is usable, filters work, detail route opens, onboarding is one combined block, and no content overlaps.
