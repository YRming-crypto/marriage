import { relationshipQuestionGroups, relationshipQuestions, type Photo } from "@ai-marriage/shared";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Save, ShieldCheck, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, deletePhoto, getMe, getMyPhotos, savePendingInterest, saveProfile, setPrimaryPhoto, uploadPhoto } from "../api/client";
import { useOtpAccount } from "../hooks/useOtpAccount";

const AUTH_KEY = "ai-marriage-auth-user";
const DRAFT_KEY = "ai-marriage-onboarding-draft-v1";
const DRAFT_SESSION_KEY = "ai-marriage-onboarding-sensitive-draft-v1";
const LEGACY_STEP_KEY = "ai-marriage-onboarding-step";
const PROFILE_SESSION_KEY = "ai-marriage-auth-profile";
const DRAFT_VERSION = 2;
const DRAFT_SAVE_DELAY_MS = 700;
const API_BASE = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4184").replace(/\/$/, "");

const steps = [
  { id: "account", label: "账号确认", short: "账号" },
  { id: "profile", label: "基本资料", short: "资料" },
  { id: "photos", label: "上传照片", short: "照片" },
  { id: "preferences", label: "交往期待", short: "期待" },
  { id: "questions", label: "关系问答", short: "问答" },
  { id: "review", label: "提交确认", short: "确认" },
] as const;

const questionGroups = relationshipQuestionGroups;
const currentQuestions = relationshipQuestions;

const emptyProfileDraft = {
  nickname: "",
  gender: "女性",
  birthYear: "",
  city: "上海",
  district: "",
  job: "",
  maritalStatus: "未婚",
  goal: "认真交往",
  smokingStatus: "不吸烟",
  childrenStatus: "无子女",
  introduction: "",
};

type ProfileDraft = typeof emptyProfileDraft;

const emptyPreferencesDraft = {
  preferredGender: "男性",
  relationshipGoal: "认真交往",
  minAge: "40",
  maxAge: "50",
  region: "同城优先",
  valuedQualities: "",
  dealBreakers: "",
};

type PreferencesDraft = typeof emptyPreferencesDraft;
type AnswersDraft = Record<string, string>;

function countAnsweredQuestions(answers: AnswersDraft) {
  return currentQuestions.filter((question) => answers[question]?.trim()).length;
}

interface DurableDraft {
  currentStep: number;
  profileDraft: ProfileDraft;
}

interface SensitiveDraft {
  preferencesDraft: PreferencesDraft;
  answersDraft: AnswersDraft;
}

interface DurableDraftStore {
  version: 2;
  drafts: Record<string, DurableDraft>;
}

interface SensitiveDraftStore {
  version: 1;
  drafts: Record<string, SensitiveDraft>;
}

interface AuthUserSummary {
  id: string;
  phoneMasked: string;
}

interface ServerOnboardingDraft {
  currentStep: number;
  status: "in_progress" | "submitted";
  data: Record<string, unknown>;
}

interface DraftPayload {
  currentStep: number;
  data: {
    profileDraft: ProfileDraft;
    preferencesDraft: PreferencesDraft;
    answersDraft: AnswersDraft;
  };
}

export interface OnboardingDraftApi {
  loadDraft(): Promise<{ draft: ServerOnboardingDraft | null }>;
  saveDraft(payload: DraftPayload): Promise<unknown>;
}

async function requestDraft(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as { data?: unknown; error?: { message?: unknown } };
  if (!response.ok) {
    const message = typeof body.error?.message === "string" ? body.error.message : "云端草稿服务暂时不可用。";
    throw new Error(message);
  }
  return body.data;
}

const defaultDraftApi: OnboardingDraftApi = {
  async loadDraft() {
    const data = await requestDraft("/api/me/onboarding-draft") as { draft?: unknown } | undefined;
    const draft = data?.draft;
    if (typeof draft !== "object" || draft === null || Array.isArray(draft)) return { draft: null };
    const record = draft as Record<string, unknown>;
    if (typeof record.data !== "object" || record.data === null || Array.isArray(record.data)) return { draft: null };
    return {
      draft: {
        currentStep: safeStep(record.currentStep),
        status: record.status === "submitted" ? "submitted" : "in_progress",
        data: record.data as Record<string, unknown>,
      },
    };
  },
  saveDraft(payload) {
    return requestDraft("/api/me/onboarding-draft", { method: "PUT", body: JSON.stringify(payload) });
  },
};

function readConfirmedAccount(): AuthUserSummary | null {
  try {
    const storedUser = JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null") as unknown;
    const valid = typeof storedUser === "object"
      && storedUser !== null
      && "id" in storedUser
      && "phoneMasked" in storedUser
      && typeof storedUser.id === "string"
      && storedUser.id.length > 0
      && typeof storedUser.phoneMasked === "string"
      && storedUser.phoneMasked.length > 0;
    return valid ? storedUser as AuthUserSummary : null;
  } catch {
    return null;
  }
}

function safeStep(value: unknown) {
  const parsedStep = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsedStep)
    ? Math.min(Math.max(Math.trunc(parsedStep), 0), steps.length - 1)
    : 0;
}

function readProfileDraft(value: unknown): ProfileDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const draft = { ...emptyProfileDraft };
  for (const key of Object.keys(draft) as Array<keyof ProfileDraft>) {
    if (typeof record[key] === "string") draft[key] = record[key];
    if (key === "birthYear" && typeof record[key] === "number" && Number.isFinite(record[key])) {
      draft[key] = String(record[key]);
    }
  }
  return draft;
}

function readPreferencesDraft(value: unknown): PreferencesDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const draft = { ...emptyPreferencesDraft };
  for (const key of Object.keys(draft) as Array<keyof PreferencesDraft>) {
    if (typeof record[key] === "string") draft[key] = record[key];
  }
  return draft;
}

function readAnswersDraft(value: unknown): AnswersDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(currentQuestions.flatMap((question) => typeof record[question] === "string" ? [[question, record[question]]] : []));
}

function emptyDurableDraftStore(): DurableDraftStore {
  return { version: DRAFT_VERSION, drafts: {} };
}

function emptySensitiveDraftStore(): SensitiveDraftStore {
  return { version: 1, drafts: {} };
}

function readDurableDraftStore(raw: string | null) {
  const empty = emptyDurableDraftStore();
  if (!raw) return { store: empty, legacySensitive: {} as Record<string, SensitiveDraft>, valid: true };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { store: empty, legacySensitive: {}, valid: false };
    }
    const record = parsed as Record<string, unknown>;
    if (record.version === DRAFT_VERSION && typeof record.drafts === "object" && record.drafts !== null && !Array.isArray(record.drafts)) {
      const drafts: Record<string, DurableDraft> = {};
      for (const [userId, value] of Object.entries(record.drafts as Record<string, unknown>)) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
        const draftRecord = value as Record<string, unknown>;
        const profile = readProfileDraft(draftRecord.profileDraft);
        if (profile) drafts[userId] = { currentStep: safeStep(draftRecord.currentStep), profileDraft: profile };
      }
      return { store: { version: DRAFT_VERSION, drafts }, legacySensitive: {}, valid: true };
    }

    const userId = typeof record.userId === "string" ? record.userId : "";
    const profile = readProfileDraft(record.profileDraft);
    if (!userId || !profile) return { store: empty, legacySensitive: {}, valid: false };
    const preferences = readPreferencesDraft(record.preferencesDraft) ?? emptyPreferencesDraft;
    const answers = readAnswersDraft(record.answersDraft);
    return {
      store: { version: DRAFT_VERSION, drafts: { [userId]: { currentStep: safeStep(record.currentStep), profileDraft: profile } } },
      legacySensitive: { [userId]: { preferencesDraft: preferences, answersDraft: answers } },
      valid: true,
    };
  } catch {
    return { store: empty, legacySensitive: {}, valid: false };
  }
}

function readSensitiveDraftStore(): SensitiveDraftStore {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DRAFT_SESSION_KEY) ?? "null") as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptySensitiveDraftStore();
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || typeof record.drafts !== "object" || record.drafts === null || Array.isArray(record.drafts)) {
      return emptySensitiveDraftStore();
    }
    const drafts: Record<string, SensitiveDraft> = {};
    for (const [userId, value] of Object.entries(record.drafts as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const draftRecord = value as Record<string, unknown>;
      drafts[userId] = {
        preferencesDraft: readPreferencesDraft(draftRecord.preferencesDraft) ?? emptyPreferencesDraft,
        answersDraft: readAnswersDraft(draftRecord.answersDraft),
      };
    }
    return { version: 1, drafts };
  } catch {
    return emptySensitiveDraftStore();
  }
}

function writeDrafts(userId: string, step: number, profile: ProfileDraft, preferences: PreferencesDraft, answers: AnswersDraft) {
  const durable = readDurableDraftStore(localStorage.getItem(DRAFT_KEY)).store;
  durable.drafts[userId] = { currentStep: safeStep(step), profileDraft: profile };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(durable));

  const sensitive = readSensitiveDraftStore();
  sensitive.drafts[userId] = { preferencesDraft: preferences, answersDraft: answers };
  sessionStorage.setItem(DRAFT_SESSION_KEY, JSON.stringify(sensitive));
  localStorage.removeItem(LEGACY_STEP_KEY);
}

function removeDrafts(userId: string) {
  const durable = readDurableDraftStore(localStorage.getItem(DRAFT_KEY)).store;
  delete durable.drafts[userId];
  if (Object.keys(durable.drafts).length === 0) localStorage.removeItem(DRAFT_KEY);
  else localStorage.setItem(DRAFT_KEY, JSON.stringify(durable));

  const sensitive = readSensitiveDraftStore();
  delete sensitive.drafts[userId];
  if (Object.keys(sensitive.drafts).length === 0) sessionStorage.removeItem(DRAFT_SESSION_KEY);
  else sessionStorage.setItem(DRAFT_SESSION_KEY, JSON.stringify(sensitive));
}

function readServerProfileValue(value: unknown) {
  const profile = readProfileDraft(value);
  if (!profile || typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const serverProfile = value as Record<string, unknown>;
  const preference = serverProfile.preference;
  if (typeof preference === "object" && preference !== null && !Array.isArray(preference)) {
    const preferenceRecord = preference as Record<string, unknown>;
    if (typeof preferenceRecord.selfSmokingStatus === "string") {
      profile.smokingStatus = preferenceRecord.selfSmokingStatus;
    }
    if (typeof preferenceRecord.selfChildrenStatus === "string") {
      profile.childrenStatus = preferenceRecord.selfChildrenStatus;
    }
  }
  return {
    profile,
    preferences: readPreferencesDraft(preference) ?? emptyPreferencesDraft,
    answers: readAnswersDraft(serverProfile.answers),
  };
}

function readServerProfile(userId: string) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROFILE_SESSION_KEY) ?? "null") as unknown;
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
    const record = stored as Record<string, unknown>;
    if (record.userId !== userId) return null;
    const profile = readServerProfileValue(record.profile);
    sessionStorage.removeItem(PROFILE_SESSION_KEY);
    return profile;
  } catch {
    return null;
  }
}

function readServerDraftValue(value: ServerOnboardingDraft | null) {
  if (!value || value.status !== "in_progress") return null;
  const profile = readProfileDraft(value.data.profileDraft ?? value.data);
  if (!profile) return null;
  return {
    currentStep: safeStep(value.currentStep),
    profile,
    preferences: readPreferencesDraft(value.data.preferencesDraft ?? value.data.preference) ?? emptyPreferencesDraft,
    answers: readAnswersDraft(value.data.answersDraft ?? value.data.answers),
  };
}

function profileValidationMessage(profile: ProfileDraft) {
  const requiredValues = [profile.nickname, profile.birthYear, profile.district, profile.job, profile.introduction];
  if (requiredValues.some((value) => !value.trim())) {
    return "请完整填写昵称、出生年份、所在区域、职业大类和自我介绍。";
  }
  const birthYear = Number(profile.birthYear);
  const latestBirthYear = new Date().getFullYear() - 18;
  if (!/^\d{4}$/.test(profile.birthYear) || birthYear < 1940 || birthYear > latestBirthYear) {
    return "请输入合法的出生年份，用户需年满 18 周岁。";
  }
  return "";
}

export function OnboardingPage({ draftApi = defaultDraftApi }: { draftApi?: OnboardingDraftApi } = {}) {
  const [searchParams] = useSearchParams();
  const [currentStep, setCurrentStep] = useState(0);
  const [restoredStep, setRestoredStep] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmedUser, setConfirmedUser] = useState<AuthUserSummary | null>(readConfirmedAccount);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft);
  const [preferencesDraft, setPreferencesDraft] = useState<PreferencesDraft>(emptyPreferencesDraft);
  const [answersDraft, setAnswersDraft] = useState<AnswersDraft>({});
  const [profileMessage, setProfileMessage] = useState("");
  const [answersMessage, setAnswersMessage] = useState("");
  const [completionMessage, setCompletionMessage] = useState("");
  const [draftSyncMessage, setDraftSyncMessage] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [photoMessage, setPhotoMessage] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completionResult, setCompletionResult] = useState<{ avatarTarget: string } | null>(null);
  const skipNextDraftSave = useRef(false);
  const otpAccount = useOtpAccount();
  const returnTo = searchParams.get("next");
  const intent = searchParams.get("intent");
  const requestedStepId = searchParams.get("step");
  const requestedStepIndex = requestedStepId === "questions" ? steps.findIndex((step) => step.id === "questions") : requestedStepId === "photos" ? 2 : null;
  const safeReturnTo = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/find";
  const progress = Math.round(((currentStep + 1) / steps.length) * 100);
  const currentStepData = steps[currentStep];
  const answeredQuestionCount = countAnsweredQuestions(answersDraft);
  const remainingQuestionCount = currentQuestions.length - answeredQuestionCount;
  const allQuestionsAnswered = remainingQuestionCount === 0;
  const hasUploadedPhoto = photoCount > 0;
  const profileComplete = profileValidationMessage(profileDraft) === "";
  const accountConfirmed = confirmedUser !== null;
  const handlePhotoCountChange = useCallback((count: number) => {
    setPhotoCount(count);
    if (count > 0) setPhotoMessage("");
  }, []);

  useEffect(() => {
    const storedUser = readConfirmedAccount();
    if (!storedUser) return;
    let active = true;
    void getMe().then((result) => {
      if (!active || result.user.id === storedUser.id) return;
      localStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(PROFILE_SESSION_KEY);
      setConfirmedUser(null);
      setCurrentStep(0);
    }).catch((error: unknown) => {
      if (!active || !(error instanceof ApiError) || error.code !== "AUTH_REQUIRED") return;
      localStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(PROFILE_SESSION_KEY);
      setConfirmedUser(null);
      setCurrentStep(0);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const durableResult = readDurableDraftStore(localStorage.getItem(DRAFT_KEY));
    const userId = confirmedUser?.id;
    if (localStorage.getItem(DRAFT_KEY) !== null && durableResult.valid) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(durableResult.store));
      const existingSensitive = readSensitiveDraftStore();
      existingSensitive.drafts = { ...durableResult.legacySensitive, ...existingSensitive.drafts };
      if (Object.keys(existingSensitive.drafts).length > 0) {
        sessionStorage.setItem(DRAFT_SESSION_KEY, JSON.stringify(existingSensitive));
      }
    }
    if (!userId) {
      const legacyStep = localStorage.getItem(DRAFT_KEY) === null ? localStorage.getItem(LEGACY_STEP_KEY) : null;
      if (legacyStep !== null) {
        setCurrentStep(0);
        setRestoredStep(0);
      }
      setDraftReady(false);
      return () => { active = false; };
    }

    const localDurable = durableResult.store.drafts[userId];
    const localSensitive = readSensitiveDraftStore().drafts[userId];
    const applyDraft = (step: number, profile: ProfileDraft, preferences: PreferencesDraft, answers: AnswersDraft, source: "cloud" | "browser") => {
      if (!active) return;
      const permittedStep = step > 1 && profileValidationMessage(profile) !== "" ? 1 : step;
      const restoredTarget = requestedStepIndex !== null && profileValidationMessage(profile) === "" ? requestedStepIndex : permittedStep;
      setProfileDraft(profile);
      setPreferencesDraft(preferences);
      setAnswersDraft(answers);
      setCurrentStep(restoredTarget);
      setRestoredStep(restoredTarget);
      if (source === "cloud") {
        writeDrafts(userId, restoredTarget, profile, preferences, answers);
        setDraftSyncMessage("已从云端恢复建档草稿。");
      }
    };

    const applyProfileFallback = async () => {
      if (!active) return;
      setCurrentStep(1);
      const serverProfile = readServerProfile(userId);
      if (serverProfile) {
        setProfileDraft(serverProfile.profile);
        setPreferencesDraft(serverProfile.preferences);
        setAnswersDraft(serverProfile.answers);
        if (requestedStepIndex !== null && profileValidationMessage(serverProfile.profile) === "") setCurrentStep(requestedStepIndex);
        return;
      }
      try {
        const result = await getMe();
        if (!active || result.user.id !== userId || !result.profile) return;
        const fetchedProfile = readServerProfileValue(result.profile);
        if (!fetchedProfile) return;
        setProfileDraft(fetchedProfile.profile);
        setPreferencesDraft(fetchedProfile.preferences);
        setAnswersDraft(fetchedProfile.answers);
        if (requestedStepIndex !== null && profileValidationMessage(fetchedProfile.profile) === "") setCurrentStep(requestedStepIndex);
      } catch {
        // The page remains editable even when profile refresh is unavailable.
      }
    };

    if (localDurable) {
      applyDraft(localDurable.currentStep, localDurable.profileDraft, localSensitive?.preferencesDraft ?? emptyPreferencesDraft, localSensitive?.answersDraft ?? {}, "browser");
    } else {
      const legacyStep = localStorage.getItem(LEGACY_STEP_KEY);
      const initialStep = legacyStep === null ? 1 : Math.max(1, safeStep(legacyStep));
      setCurrentStep(initialStep > 1 ? 1 : initialStep);
      if (legacyStep !== null) setRestoredStep(1);
    }

    void draftApi.loadDraft().then(async (result) => {
      if (!active) return;
      const cloudDraft = readServerDraftValue(result.draft);
      if (cloudDraft) {
        applyDraft(cloudDraft.currentStep, cloudDraft.profile, cloudDraft.preferences, cloudDraft.answers, "cloud");
      } else if (localDurable) {
        applyDraft(localDurable.currentStep, localDurable.profileDraft, localSensitive?.preferencesDraft ?? emptyPreferencesDraft, localSensitive?.answersDraft ?? {}, "browser");
      } else {
        await applyProfileFallback();
      }
    }).catch(async () => {
      if (!active) return;
      setDraftSyncMessage("云端草稿暂时不可用，已继续使用本浏览器草稿。稍后会自动重试保存。");
      if (localDurable) {
        applyDraft(localDurable.currentStep, localDurable.profileDraft, localSensitive?.preferencesDraft ?? emptyPreferencesDraft, localSensitive?.answersDraft ?? {}, "browser");
      } else {
        await applyProfileFallback();
      }
    }).finally(() => {
      if (!active) return;
      skipNextDraftSave.current = true;
      setDraftReady(true);
    });

    return () => { active = false; };
  }, [confirmedUser?.id, draftApi, requestedStepIndex]);

  useEffect(() => {
    const userId = confirmedUser?.id;
    if (!userId || !draftReady) return;
    writeDrafts(userId, currentStep, profileDraft, preferencesDraft, answersDraft);
    if (skipNextDraftSave.current) {
      skipNextDraftSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const payload = { currentStep, data: { profileDraft, preferencesDraft, answersDraft } };
      void draftApi.saveDraft(payload).then(() => {
        setDraftSyncMessage("建档草稿已保存到云端。");
      }).catch(() => {
        setDraftSyncMessage("云端保存失败，内容已安全保留在本浏览器。稍后修改时会自动重试。");
      });
    }, DRAFT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [answersDraft, confirmedUser?.id, currentStep, draftApi, draftReady, preferencesDraft, profileDraft]);

  const contextText = useMemo(() => {
    if (intent === "favorite") return "系统会保留你的“感兴趣”选择，资料、照片和 AI 分身满足条件后自动完成。";
    if (returnTo?.includes("matchmaking")) return "完成后会直接带你回到刚才选择的 AI 分身聊天。";
    return "可以随时保存并稍后继续，已经填写的内容不会丢失。";
  }, [intent, returnTo]);

  function persistDraft(step: number, userId = confirmedUser?.id ?? null) {
    if (!userId) return;
    writeDrafts(userId, step, profileDraft, preferencesDraft, answersDraft);
  }

  function saveDraft() {
    persistDraft(currentStep);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
    if (!confirmedUser || !draftReady) return;
    void draftApi.saveDraft({ currentStep, data: { profileDraft, preferencesDraft, answersDraft } }).then(() => {
      setDraftSyncMessage("建档草稿已保存到云端。");
    }).catch(() => {
      setDraftSyncMessage("云端保存失败，内容已安全保留在本浏览器。稍后修改时会自动重试。");
    });
  }

  async function confirmAccountAndContinue() {
    if (accountConfirmed) {
      setCurrentStep(1);
      persistDraft(1);
      return;
    }
    const result = await otpAccount.verifyAccount();
    if (!result) return;
    localStorage.setItem(AUTH_KEY, JSON.stringify(result.user));
    const serverProfile = result.profile ? readServerProfileValue(result.profile) : null;
    const nextProfile = serverProfile?.profile ?? emptyProfileDraft;
    const nextPreferences = serverProfile?.preferences ?? emptyPreferencesDraft;
    const nextAnswers = serverProfile?.answers ?? {};
    setProfileDraft(nextProfile);
    setPreferencesDraft(nextPreferences);
    setAnswersDraft(nextAnswers);
    setConfirmedUser(result.user);
    setCurrentStep(1);
    writeDrafts(result.user.id, 1, nextProfile, nextPreferences, nextAnswers);
  }

  async function requireUploadedPhoto() {
    try {
      const result = await getMyPhotos();
      const count = Array.isArray(result.items) ? result.items.length : 0;
      setPhotoCount(count);
      if (count > 0) {
        setPhotoMessage("");
        return true;
      }
      setPhotoMessage("请至少上传 1 张照片，再进入最终确认。");
    } catch {
      setPhotoMessage("暂时无法确认已上传照片，请在照片步骤重新加载后再试。");
    }
    setCurrentStep(2);
    persistDraft(2);
    return false;
  }

  async function nextStep() {
    if (currentStep === 0) {
      await confirmAccountAndContinue();
      return;
    }
    if (currentStep === 1) {
      const validationMessage = profileValidationMessage(profileDraft);
      setProfileMessage(validationMessage);
      if (validationMessage) return;
    }
    if (currentStep === 2 && !await requireUploadedPhoto()) return;
    if (currentStep === 4) {
      if (!allQuestionsAnswered) {
        setAnswersMessage(`关系问答还差 ${remainingQuestionCount} 题，请完成全部 15 题后再提交档案。`);
        return;
      }
      if (!await requireUploadedPhoto()) return;
    }
    const next = Math.min(currentStep + 1, steps.length - 1);
    setCurrentStep(next);
    persistDraft(next);
  }

  function goToStep(index: number) {
    if (!accountConfirmed && index > 0) return;
    if (index > 1 && !profileComplete) {
      setProfileMessage(profileValidationMessage(profileDraft));
      setCurrentStep(1);
      return;
    }
    if (index === steps.length - 1 && (!hasUploadedPhoto || !allQuestionsAnswered)) return;
    setProfileMessage("");
    setCurrentStep(index);
    persistDraft(index);
  }

  async function completeOnboarding() {
    if (completing) return;
    const validationMessage = profileValidationMessage(profileDraft);
    if (validationMessage) {
      setProfileMessage(validationMessage);
      setCurrentStep(1);
      return;
    }
    if (!allQuestionsAnswered) {
      setAnswersMessage(`关系问答还差 ${remainingQuestionCount} 题，请完成全部 15 题后再提交档案。`);
      setCurrentStep(steps.findIndex((step) => step.id === "questions"));
      return;
    }
    if (!await requireUploadedPhoto()) return;
    setCompleting(true);
    try {
      if (!confirmedUser) throw new Error("请先登录。");
      await saveProfile({ ...profileDraft, birthYear: Number(profileDraft.birthYear), preference: preferencesDraft, answers: answersDraft });
      const memberId = searchParams.get("member");
      const interestIntent = intent === "favorite" && memberId ? await savePendingInterest(memberId) : null;
      localStorage.setItem("ai-marriage-profile-saved", "true");
      removeDrafts(confirmedUser.id);
      localStorage.removeItem(LEGACY_STEP_KEY);
      sessionStorage.removeItem(PROFILE_SESSION_KEY);
      let avatarTarget = "/me/avatar";
      if (interestIntent?.intent.status === "pending" && memberId) {
        const params = new URLSearchParams({ pendingInterest: memberId, next: safeReturnTo });
        avatarTarget = `/me/avatar?${params}`;
      } else if (interestIntent?.intent.status === "fulfilled") {
        const [pathAndQuery, hash] = safeReturnTo.split("#", 2);
        const separator = pathAndQuery.includes("?") ? "&" : "?";
        const next = `${pathAndQuery}${separator}favorited=1${hash ? `#${hash}` : ""}`;
        avatarTarget = `/me/avatar?${new URLSearchParams({ next })}`;
      } else if (returnTo && safeReturnTo !== "/onboarding" && !safeReturnTo.startsWith("/onboarding?")) {
        avatarTarget = `/me/avatar?${new URLSearchParams({ next: safeReturnTo })}`;
      }
      setCompletionResult({ avatarTarget });
    } catch (error) {
      setCompletionMessage(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setCompleting(false);
    }
  }

  if (completionResult) {
    return (
      <div className="onboarding-page">
        <div className="shell onboarding-shell">
          <section className="onboarding-card" aria-labelledby="onboarding-success-title">
            <div className="step-intro">
              <span><Check size={18} />建档完成</span>
              <h1 id="onboarding-success-title">婚恋档案已建立，可以开始寻找缘分</h1>
              <p>你的资料已经保存。接下来可以生成并启用 AI 分身，也可以先去匹配大厅看看合适的人。</p>
            </div>
            <div className="onboarding-card__footer">
              <Link className="button button--soft" to="/find">进入匹配大厅</Link>
              <Link className="button button--primary" to={completionResult.avatarTarget}>生成并启用 AI 分身<ArrowRight /></Link>
            </div>
          </section>
          <p className="privacy-note"><ShieldCheck />你仍可在个人中心修改档案和管理 AI 分身授权。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-page">
      <div className="shell onboarding-shell">
        <header className="onboarding-header">
          <Link className="back-link" to={returnTo ? safeReturnTo : "/"}><ArrowLeft />暂时返回</Link>
          <div><span>统一入口</span><h1>建立婚恋档案</h1><p>{contextText}</p></div>
          <button className="button button--soft" type="button" onClick={saveDraft}><Save />{saved ? "已保存" : "保存并稍后继续"}</button>
        </header>

        <div className="onboarding-progress" aria-label={`建档完成 ${progress}%`}>
          <div className="onboarding-progress__top"><strong>当前步骤：{currentStepData.label}</strong><span>第 {currentStep + 1} 步，共 {steps.length} 步 · {progress}%</span></div>
          {restoredStep !== null ? <p className="onboarding-progress__restore" role="status" aria-label="草稿恢复状态">已恢复上次保存的进度：第 {restoredStep + 1} 步“{steps[restoredStep].label}”</p> : null}
          {draftSyncMessage ? <p className="onboarding-progress__restore" role="status" aria-label="草稿同步状态">{draftSyncMessage}</p> : null}
          <div
            className="progress-track"
            role="progressbar"
            aria-label="建档进度"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={currentStep + 1}
            aria-valuetext={`第 ${currentStep + 1} 步，共 ${steps.length} 步：${currentStepData.label}`}
          ><span style={{ width: `${progress}%` }} /></div>
          <ol>
            {steps.map((step, index) => (
              <li key={step.id} className={`${index === currentStep ? "is-current" : index < currentStep ? index === 2 && !hasUploadedPhoto ? "is-skipped" : "is-complete" : ""}${(!accountConfirmed && index > 0) || (accountConfirmed && !profileComplete && index > 1) || (index === steps.length - 1 && (!hasUploadedPhoto || !allQuestionsAnswered)) ? " is-locked" : ""}`}>
                <button
                  type="button"
                  disabled={(!accountConfirmed && index > 0) || (accountConfirmed && !profileComplete && index > 1) || (index === steps.length - 1 && (!hasUploadedPhoto || !allQuestionsAnswered))}
                  onClick={() => goToStep(index)}
                  aria-current={index === currentStep ? "step" : undefined}
                  aria-label={`第 ${index + 1} 步：${step.label}${!accountConfirmed && index > 0 ? "，请先确认账号" : accountConfirmed && !profileComplete && index > 1 ? "，请先完善基本资料" : index === steps.length - 1 && (!hasUploadedPhoto || !allQuestionsAnswered) ? "，请先完成照片和问答" : index === currentStep ? "，当前步骤" : index < currentStep ? index === 2 && !hasUploadedPhoto ? "，已跳过" : "，已完成" : "，未开始"}`}
                >
                  <b>{index < currentStep && (index !== 2 || hasUploadedPhoto) ? <Check size={17} /> : index + 1}</b><span>{step.label}</span><small>{step.short}</small>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <section className="onboarding-card">
          {currentStep === 0 ? <AccountStep phone={otpAccount.phone} code={otpAccount.code} agreed={otpAccount.agreed} busy={otpAccount.busy} countdown={otpAccount.secondsUntilResend} isVerified={accountConfirmed || otpAccount.isVerified} message={otpAccount.message} onPhoneChange={otpAccount.setPhone} onCodeChange={otpAccount.setCode} onAgreedChange={otpAccount.setAgreed} onRequestCode={() => void otpAccount.sendCode()} /> : null}
          {currentStep === 1 ? <ProfileStep value={profileDraft} onChange={(key, value) => { setProfileMessage(""); setProfileDraft((current) => ({ ...current, [key]: value })); }} /> : null}
          {currentStep === 2 ? <PhotosStep onPhotoCountChange={handlePhotoCountChange} /> : null}
          {currentStep === 3 ? <PreferencesStep value={preferencesDraft} onChange={(key, value) => setPreferencesDraft((current) => ({ ...current, [key]: value }))} /> : null}
          {currentStep === 4 ? <QuestionsStep value={answersDraft} onChange={(question, value) => { setAnswersMessage(""); setAnswersDraft((current) => ({ ...current, [question]: value })); }} /> : null}
          {currentStep === 5 ? <ReviewStep profile={profileDraft} preferences={preferencesDraft} answeredQuestionCount={answeredQuestionCount} photoCount={photoCount} /> : null}
          {currentStep === 1 && profileMessage ? <p className="form-error" role="alert">{profileMessage}</p> : null}
          {currentStep === 2 && photoMessage ? <p className="form-error" role="alert">{photoMessage}</p> : null}
          {currentStep === 4 && answersMessage ? <p className="form-error" role="alert">{answersMessage}</p> : null}
          <div className="onboarding-card__footer">
            <button className="button button--text" type="button" disabled={currentStep === 0} onClick={() => setCurrentStep((step) => Math.max(0, step - 1))}><ArrowLeft />上一步</button>
            {currentStep < steps.length - 1 ? (
              <button className="button button--primary" type="button" disabled={otpAccount.busy} onClick={() => void nextStep()}>{currentStep === 0 ? otpAccount.busy ? "正在确认..." : "确认账号并继续" : currentStep === 4 ? "保存并预览" : "保存并继续"}<ArrowRight /></button>
            ) : (
              <button className="button button--primary" type="button" onClick={() => void completeOnboarding()} disabled={completing}>{completing ? "正在保存..." : "确认提交档案"}<Check /></button>
            )}
          </div>
          {completionMessage ? <p className="form-tip" role="status">{completionMessage}</p> : null}
        </section>

        <p className="privacy-note"><ShieldCheck />标注为“仅用于智能牵线”的内容不会直接展示给其他用户。</p>
      </div>
    </div>
  );
}

function StepIntro({ title, description, time }: { title: string; description: string; time: string }) {
  return <div className="step-intro"><span>预计用时 {time}</span><h2>{title}</h2><p>{description}</p></div>;
}

function AccountStep({ phone, code, agreed, busy, countdown, isVerified, message, onPhoneChange, onCodeChange, onAgreedChange, onRequestCode }: { phone: string; code: string; agreed: boolean; busy: boolean; countdown: number; isVerified: boolean; message: string; onPhoneChange: (value: string) => void; onCodeChange: (value: string) => void; onAgreedChange: (value: boolean) => void; onRequestCode: () => void }) {
  const requestLabel = busy ? "发送中..." : countdown > 0 ? `${countdown} 秒后重发` : "获取验证码";
  return <><StepIntro title="先确认你的账号" description="我们只使用手机号完成登录和重要通知，不会把手机号展示给其他用户。" time="1 分钟" /><div className="form-grid"><label><span>手机号码</span><input aria-label="手机号码" value={phone} onChange={(event) => onPhoneChange(event.target.value)} type="tel" placeholder="请输入常用手机号" autoComplete="tel" /></label><label><span>验证码</span><span className="input-with-action"><input aria-label="验证码" value={code} onChange={(event) => onCodeChange(event.target.value)} inputMode="numeric" maxLength={6} placeholder="6 位验证码" autoComplete="one-time-code" /><button type="button" disabled={busy || countdown > 0 || isVerified} onClick={onRequestCode}>{requestLabel}</button></span></label></div>{message ? <p className={`form-tip account-status${isVerified ? " account-status--success" : ""}`} role="status">{message}</p> : isVerified ? <p className="form-tip account-status account-status--success" role="status">账号已确认，可以继续完善资料。</p> : null}<label className="check-row"><input type="checkbox" checked={agreed} onChange={(event) => onAgreedChange(event.target.checked)} />我已阅读并同意《用户协议》和《隐私政策》</label></>;
}

function ProfileStep({ value, onChange }: { value: ProfileDraft; onChange: (key: keyof ProfileDraft, value: string) => void }) {
  const currentYear = new Date().getFullYear();
  const birthYears = Array.from({ length: currentYear - 1930 + 1 }, (_, index) => String(currentYear - index));
  const districtOptions = {
    上海: ["静安", "徐汇", "浦东", "黄浦", "长宁", "虹口", "杨浦", "普陀", "宝山", "嘉定", "闵行", "松江"],
    杭州: ["西湖", "上城", "下城", "滨江", "余杭", "江干", "拱墅", "萧山", "钱塘"],
    南京: ["鼓楼", "秦淮", "玄武", "建邺", "栖霞", "雨花台", "江宁", "浦口"],
    苏州: ["姑苏", "吴中", "工业园区", "虎丘", "相城区", "高新区", "吴江"],
  } as const;

  const availableDistricts: readonly string[] = districtOptions[value.city as keyof typeof districtOptions] ?? ["静安"];

  function handleCityChange(nextCity: string) {
    onChange("city", nextCity);
    if (!availableDistricts.includes(value.district)) {
      onChange("district", "");
    }
  }

  return <><StepIntro title="介绍一下自己" description="这里填写的是基本公开资料。详细地址、手机号和真实姓名不会公开。" time="3 分钟" /><div className="form-grid"><label><span>昵称</span><input value={value.nickname} onChange={(event) => onChange("nickname", event.target.value)} placeholder="其他用户看到的称呼" /></label><label><span>性别</span><select value={value.gender} onChange={(event) => onChange("gender", event.target.value)}><option>女性</option><option>男性</option></select></label><label><span>出生年份</span><select value={value.birthYear} aria-label="出生年份" onChange={(event) => onChange("birthYear", event.target.value)}><option value="">请选择</option>{birthYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label><label><span>所在城市</span><select value={value.city} aria-label="所在城市" onChange={(event) => handleCityChange(event.target.value)}><option>上海</option><option>杭州</option><option>南京</option><option>苏州</option></select></label><label><span>所在区域</span><select value={value.district} aria-label="所在区域" onChange={(event) => onChange("district", event.target.value)}><option value="">请选择</option>{availableDistricts.map((district) => <option key={district} value={district}>{district}</option>)}</select></label><label><span>婚姻状态</span><select value={value.maritalStatus} onChange={(event) => onChange("maritalStatus", event.target.value)}><option>未婚</option><option>离异</option><option>丧偶</option></select></label><label><span>职业大类</span><input value={value.job} onChange={(event) => onChange("job", event.target.value)} placeholder="例如：教育、制造、医护" /></label><label><span>吸烟情况</span><select value={value.smokingStatus} onChange={(event) => onChange("smokingStatus", event.target.value)}><option>不吸烟</option><option>偶尔吸烟</option><option>吸烟</option></select></label><label><span>子女情况</span><select value={value.childrenStatus} onChange={(event) => onChange("childrenStatus", event.target.value)}><option>无子女</option><option>有子女</option><option>子女已成年</option></select></label><label className="form-grid__wide"><span>简单介绍自己</span><textarea value={value.introduction} onChange={(event) => onChange("introduction", event.target.value)} placeholder="可以写写你的性格、生活习惯和兴趣。" /></label></div></>;
}

function PhotosStep({ onPhotoCountChange }: { onPhotoCountChange: (count: number) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [primaryBusyId, setPrimaryBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    getMyPhotos().then((result) => {
      if (!active) return;
      const items = Array.isArray(result?.items) ? result.items : [];
      setPhotos(items);
      onPhotoCountChange(items.length);
    }).catch(() => { if (active) setMessage("暂时无法读取已上传照片。"); });
    return () => { active = false; };
  }, [onPhotoCountChange]);

  async function onFile(file: File | undefined) {
    if (!file || uploadBusy) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 8 * 1024 * 1024) {
      setMessage("请选择不超过 8MB 的 JPG、PNG 或 WebP 照片。");
      return;
    }
    setUploadBusy(true);
    setMessage("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("照片读取失败。"));
        reader.readAsDataURL(file);
      });
      const result = await uploadPhoto({ filename: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", sizeBytes: file.size, dataUrl });
      const next = [...photos, result.photo];
      setPhotos(next);
      onPhotoCountChange(next.length);
      setMessage("照片已上传，等待审核。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "照片上传失败，请稍后重试。");
    } finally {
      setUploadBusy(false);
    }
  }

  async function makePrimary(photo: Photo) {
    if (primaryBusyId === photo.id || deleteBusyId === photo.id) return;
    setPrimaryBusyId(photo.id);
    setMessage("");
    try {
      const result = await setPrimaryPhoto(photo.id);
      setPhotos((current) => current.map((item) => ({ ...item, isPrimary: item.id === result.photo.id })));
      setMessage(`已将${photo.filename}设为主照片。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "设置主照片失败，请稍后重试。");
    } finally {
      setPrimaryBusyId(null);
    }
  }

  async function remove(photo: Photo) {
    if (deleteBusyId === photo.id || primaryBusyId === photo.id) return;
    if (!window.confirm(`确定删除“${photo.filename}”吗？删除后无法恢复。`)) return;
    setDeleteBusyId(photo.id);
    setMessage("");
    try {
      await deletePhoto(photo.id);
      const remaining = photos.filter((item) => item.id !== photo.id);
      const normalized = photo.isPrimary && remaining.length > 0
        ? remaining.map((item, index) => ({ ...item, isPrimary: index === 0 }))
        : remaining;
      setPhotos(normalized);
      onPhotoCountChange(normalized.length);
      setMessage(`已删除${photo.filename}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除照片失败，请稍后重试。");
    } finally {
      setDeleteBusyId(null);
    }
  }

  const reviewLabel = { pending: "等待审核", approved: "审核通过", rejected: "需要重新上传" } as const;
  return <>
    <StepIntro title="上传真实、清晰的照片" description="照片会先进入人工审核，只有审核通过的照片才会展示在匹配大厅。" time="2 分钟" />
    <label className="photo-upload">
      <ImagePlus size={42} />
      <strong>{uploadBusy ? "正在上传..." : "选择一张清晰照片"}</strong>
      <p>支持 JPG、PNG、WebP，单张不超过 8MB，最多 6 张。</p>
      <span className="button button--soft">选择照片</span>
      <input aria-label="选择照片" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadBusy || photos.length >= 6} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
    {photos.length ? <div className="onboarding-photo-list">{photos.map((photo) => {
      const settingPrimary = primaryBusyId === photo.id;
      const deleting = deleteBusyId === photo.id;
      return <article key={photo.id}>
        <img src={photo.url} alt={`${photo.filename}预览`} />
        <div>
          <strong>{photo.isPrimary ? "主照片" : photo.filename}</strong>
          <span>{reviewLabel[photo.reviewStatus]}</span>
          {photo.reviewReason ? <p>{photo.reviewReason}</p> : null}
        </div>
        <div>
          {!photo.isPrimary ? <button className="icon-button" type="button" title="设为主照片" aria-label={`设为主照片：${photo.filename}`} aria-busy={settingPrimary} disabled={settingPrimary || deleting} onClick={() => void makePrimary(photo)}><Star /></button> : null}
          <button className="icon-button" type="button" title="删除照片" aria-label={`删除照片：${photo.filename}`} aria-busy={deleting} disabled={deleting || settingPrimary} onClick={() => void remove(photo)}><Trash2 /></button>
        </div>
      </article>;
    })}</div> : null}
    {message ? <p className="form-tip" role="status"><ShieldCheck />{message}</p> : <div className="form-tip"><ShieldCheck /><span>照片不会公开原始文件位置，审核通过前也不会出现在大厅。</span></div>}
  </>;
}

function PreferencesStep({ value, onChange }: { value: PreferencesDraft; onChange: (key: keyof PreferencesDraft, value: string) => void }) {
  return <><StepIntro title="你希望认识怎样的人" description="这些条件会帮助系统缩小范围。你之后可以在个人中心随时修改。" time="3 分钟" /><div className="form-grid"><label><span>想认识</span><select value={value.preferredGender} onChange={(event) => onChange("preferredGender", event.target.value)}><option>男性</option><option>女性</option></select></label><label><span>交往目标</span><select value={value.relationshipGoal} onChange={(event) => onChange("relationshipGoal", event.target.value)}><option>认真交往</option><option>以结婚为目标</option><option>先认识了解</option></select></label><fieldset><legend>希望年龄</legend><select aria-label="最低年龄" value={value.minAge} onChange={(event) => onChange("minAge", event.target.value)}><option>40</option><option>45</option><option>50</option></select><span>至</span><select aria-label="最高年龄" value={value.maxAge} onChange={(event) => onChange("maxAge", event.target.value)}><option>50</option><option>55</option><option>60</option></select></fieldset><label><span>希望地区</span><select value={value.region} onChange={(event) => onChange("region", event.target.value)}><option>同城优先</option><option>同省也可以</option><option>不限地区</option></select></label><label className="form-grid__wide"><span>最看重的品质</span><input value={value.valuedQualities} onChange={(event) => onChange("valuedQualities", event.target.value)} placeholder="例如：真诚、有责任心、情绪稳定" /></label><label className="form-grid__wide"><span>明确不能接受的事项</span><textarea value={value.dealBreakers} onChange={(event) => onChange("dealBreakers", event.target.value)} placeholder="这些内容仅用于智能牵线，不会直接公开。" /></label></div></>;
}

function QuestionsStep({ value, onChange }: { value: AnswersDraft; onChange: (question: string, value: string) => void }) {
  const questionCount = currentQuestions.length;
  const answeredCount = countAnsweredQuestions(value);
  return <><StepIntro title="关系与生活问答" description="5 个主题，共 15 个问题。可以分组完成，真实回答没有标准答案。" time="约 12 分钟" /><div className="question-progress"><div><strong>全部 15 题（提交档案前必填）</strong><span>已回答 {answeredCount}/{questionCount} 题</span></div><div className="progress-track" role="progressbar" aria-label="AI 问答进度" aria-valuemin={0} aria-valuemax={questionCount} aria-valuenow={answeredCount} aria-valuetext={`已回答 ${answeredCount}/${questionCount} 题`}><span style={{ width: `${(answeredCount / questionCount) * 100}%` }} /></div></div><div className="question-groups">{questionGroups.map((group, groupIndex) => <fieldset key={group.title}><legend>{groupIndex + 1}. {group.title}</legend>{group.questions.map((question, index) => <label key={question}><span>{question}</span><textarea value={value[question] ?? ""} onChange={(event) => onChange(question, event.target.value)} placeholder={index === 0 ? "写下你的真实想法即可，不需要标准答案。" : "可以稍后回来继续填写。"} /></label>)}</fieldset>)}</div></>;
}

function ReviewStep({ profile, preferences, answeredQuestionCount, photoCount }: { profile: ProfileDraft; preferences: PreferencesDraft; answeredQuestionCount: number; photoCount: number }) {
  return <>
    <StepIntro title="提交前确认" description="请核对下面的信息。确认提交后，资料和照片会进入审核，通过后才能在匹配大厅联系其他会员。" time="1 分钟" />
    <div className="onboarding-review" aria-label="档案预览">
      <section><h3>基本资料</h3><dl><div><dt>昵称</dt><dd>{profile.nickname}</dd></div><div><dt>年龄信息</dt><dd>{profile.birthYear} 年出生</dd></div><div><dt>所在地区</dt><dd>{profile.city} · {profile.district}</dd></div><div><dt>职业</dt><dd>{profile.job}</dd></div><div><dt>交往目标</dt><dd>{profile.goal}</dd></div></dl></section>
      <section><h3>交往期待</h3><dl><div><dt>想认识</dt><dd>{preferences.preferredGender}，{preferences.minAge} 至 {preferences.maxAge} 岁</dd></div><div><dt>地区</dt><dd>{preferences.region}</dd></div><div><dt>看重的品质</dt><dd>{preferences.valuedQualities || "暂未填写"}</dd></div></dl></section>
      <section><h3>照片与问答</h3><p>已上传 {photoCount} 张照片</p><p>已回答 {answeredQuestionCount} 道关系问答</p></section>
    </div>
  </>;
}
