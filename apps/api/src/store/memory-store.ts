import { randomUUID } from "node:crypto";
import type { Store, StoredAvatarProfile, StoredMember, StoredSoulTestResult } from "./types.js";

const seedMembers: StoredMember[] = [
  {
    id: "lin-wanqing",
    demo: true,
    nickname: "林婉清",
    gender: "女性",
    age: 45,
    city: "上海",
    district: "徐汇",
    job: "教育工作者",
    maritalStatus: "离异",
    goal: "认真交往",
    tags: ["喜欢阅读", "生活规律", "周末徒步"],
    introduction: "在教育行业工作多年，性格温和，也很看重真诚沟通。闲下来喜欢逛书店、做家常菜。",
    photoUrl: "/images/member-lin-v2.jpg",
    activeLabel: "今天活跃",
    verified: true,
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    score: 92,
    voiceIntroDuration: 18,
    voiceIntroTranscript: "你好，很高兴认识你。我是一名老师，平时喜欢安静地看书、做做饭，周末会去公园散步。希望遇到一个真诚、温和的人，一起分享生活里的点滴。",
  },
  {
    id: "zhou-mingyuan",
    demo: true,
    nickname: "周明远",
    gender: "男性",
    age: 49,
    city: "上海",
    district: "浦东",
    job: "工程项目管理",
    maritalStatus: "离异",
    goal: "以结婚为目标",
    tags: ["稳重随和", "摄影", "不吸烟"],
    introduction: "工作和生活都比较稳定，平时喜欢摄影、散步和短途旅行。",
    photoUrl: "/images/member-zhou-v2.jpg",
    activeLabel: "刚刚在线",
    verified: true,
    ownerUserId: "00000000-0000-4000-8000-000000000002",
    score: 88,
    voiceIntroDuration: 22,
    voiceIntroTranscript: "你好呀，我是周明远。在IT行业工作，生活节奏比较规律。周末喜欢带上相机出去拍照，或者在家看看电影。希望能认识一个聊得来的人。",
  },
  {
    id: "chen-jiayi",
    demo: true,
    nickname: "陈嘉怡",
    gender: "女性",
    age: 42,
    city: "杭州",
    district: "西湖",
    job: "财务管理",
    maritalStatus: "未婚",
    goal: "认真交往",
    tags: ["爱做饭", "看展", "情绪稳定"],
    introduction: "生活简单充实，喜欢做饭、看展和整理家里的花草。",
    photoUrl: "/images/member-chen-v2.jpg",
    activeLabel: "1 小时前活跃",
    verified: true,
    ownerUserId: "00000000-0000-4000-8000-000000000003",
    score: 84,
  },
];

export function createMemoryStore(seed: StoredMember[] = seedMembers): Store {
  const members = new Map(seed.map((member) => [member.id, structuredClone(member)]));
  const seededUsers = seed
    .filter((member) => member.ownerUserId)
    .map((member) => [member.ownerUserId!, { id: member.ownerUserId!, phone: member.id === "lin-wanqing" ? "13900139000" : member.id === "zhou-mingyuan" ? "13900139001" : "13900139002", role: "user" as const, status: "active" as const, createdAt: new Date().toISOString() }] as const);
  const users = new Map(seededUsers);
  const usersByPhone = new Map(seededUsers.map(([id, user]) => [user.phone, id]));
  const avatarProfiles = new Map<string, StoredAvatarProfile>(seed.flatMap((member) => member.ownerUserId ? [[member.ownerUserId, {
    userId: member.ownerUserId,
    version: 1,
    approvedFacts: [
      { topic: "生活习惯", fact: member.introduction },
      { topic: "关系期待", fact: member.goal },
      { topic: "兴趣偏好", fact: member.tags.join("、") },
    ],
    relationshipExpectations: [member.goal],
    boundaries: ["不公开手机号和详细地址", "不替本人作出承诺"],
    unknownResponse: "这个问题没有得到本人明确授权，建议在双方同意真人聊天后再确认。",
    status: "enabled",
    generatedAt: new Date().toISOString(),
    enabledAt: new Date().toISOString(),
  } satisfies StoredAvatarProfile]] : []));

  const seedSoulTestResults: Array<[string, StoredSoulTestResult]> = [
    ["00000000-0000-4000-8000-000000000001", {
      userId: "00000000-0000-4000-8000-000000000001",
      completedAt: new Date().toISOString(),
      dimensions: [
        { dimension: "social", dimensionLabel: "社交能量", labelA: "外向", labelB: "内向", score: 25, polarity: "introvert", description: "你享受独处，在安静中找到内心的力量。" },
        { dimension: "expression", dimensionLabel: "情感表达", labelA: "直接", labelB: "含蓄", score: 25, polarity: "reserved", description: "你更习惯用行动代替言语，在细节中传递温度。" },
        { dimension: "pace", dimensionLabel: "生活节奏", labelA: "随性", labelB: "规律", score: 25, polarity: "structured", description: "你喜欢井井有条的生活，稳定的节奏让你安心。" },
        { dimension: "decision", dimensionLabel: "决策风格", labelA: "感性", labelB: "理性", score: 40, polarity: "rational", description: "你善于分析和权衡，做决定时更看重逻辑和事实。" },
        { dimension: "intimacy", dimensionLabel: "亲密模式", labelA: "紧密", labelB: "独立", score: 40, polarity: "independent", description: "你重视彼此空间，在相互支持的同时保持独立。" },
      ],
      personalityType: "anchor",
      personalityLabel: "踏实陪伴者",
      personalityDescription: "你重视承诺和陪伴，是关系中稳定的力量。在感情中，你追求细水长流和相互扶持。",
      tags: ["踏实", "忠诚", "陪伴"],
      matchHint: "适合与同样重视长期关系、珍惜平淡幸福的人在一起。",
    }],
    ["00000000-0000-4000-8000-000000000002", {
      userId: "00000000-0000-4000-8000-000000000002",
      completedAt: new Date().toISOString(),
      dimensions: [
        { dimension: "social", dimensionLabel: "社交能量", labelA: "外向", labelB: "内向", score: 40, polarity: "introvert", description: "你享受独处，在安静中找到内心的力量。" },
        { dimension: "expression", dimensionLabel: "情感表达", labelA: "直接", labelB: "含蓄", score: 40, polarity: "reserved", description: "你更习惯用行动代替言语，在细节中传递温度。" },
        { dimension: "pace", dimensionLabel: "生活节奏", labelA: "随性", labelB: "规律", score: 25, polarity: "structured", description: "你喜欢井井有条的生活，稳定的节奏让你安心。" },
        { dimension: "decision", dimensionLabel: "决策风格", labelA: "感性", labelB: "理性", score: 20, polarity: "rational", description: "你善于分析和权衡，做决定时更看重逻辑和事实。" },
        { dimension: "intimacy", dimensionLabel: "亲密模式", labelA: "紧密", labelB: "独立", score: 50, polarity: "attached", description: "你希望和对方紧密联结，一起分享生活的每个角落。" },
      ],
      personalityType: "pioneer",
      personalityLabel: "稳重行动派",
      personalityDescription: "你做事果断、有计划，同时内心有自己的浪漫。在关系中，你追求目标一致和互相支持。",
      tags: ["果断", "有规划", "务实"],
      matchHint: "适合与尊重你的节奏、同样认真对待关系的人在一起。",
    }],
    ["00000000-0000-4000-8000-000000000003", {
      userId: "00000000-0000-4000-8000-000000000003",
      completedAt: new Date().toISOString(),
      dimensions: [
        { dimension: "social", dimensionLabel: "社交能量", labelA: "外向", labelB: "内向", score: 60, polarity: "extrovert", description: "你喜欢热闹，善于在社交中获取能量。" },
        { dimension: "expression", dimensionLabel: "情感表达", labelA: "直接", labelB: "含蓄", score: 75, polarity: "direct", description: "你习惯坦率表达感受，不喜欢猜来猜去。" },
        { dimension: "pace", dimensionLabel: "生活节奏", labelA: "随性", labelB: "规律", score: 75, polarity: "spontaneous", description: "你随遇而安，享受生活中的不确定性和惊喜。" },
        { dimension: "decision", dimensionLabel: "决策风格", labelA: "感性", labelB: "理性", score: 75, polarity: "emotional", description: "你习惯跟着感觉走，重视内心的体验和共鸣。" },
        { dimension: "intimacy", dimensionLabel: "亲密模式", labelA: "紧密", labelB: "独立", score: 60, polarity: "attached", description: "你希望和对方紧密联结，一起分享生活的每个角落。" },
      ],
      personalityType: "explorer",
      personalityLabel: "浪漫探索家",
      personalityDescription: "你对生活充满好奇，善于发现日常中的美好。在关系中，你追求新鲜感和共同成长。",
      tags: ["浪漫", "好奇", "感性"],
      matchHint: "适合与愿意和你一起尝试新事物、坦诚表达感受的人在一起。",
    }],
  ];

  return {
    users,
    usersByPhone,
    otpRequests: new Map(),
    sessions: new Map(),
    restrictedSessions: new Map(),
    onboardingDrafts: new Map(),
    profiles: new Map(),
    members,
    interests: new Map(),
    matchSkips: new Map(),
    matchFilters: new Map(),
    matchSnapshots: new Map(),
    avatarSessions: new Map(),
    avatarMessages: new Map(),
    avatarReplyFailureTasks: new Map(),
    chatRequests: new Map(),
    conversations: new Map(),
    messages: new Map(),
    messageReceipts: new Map(),
    photos: new Map(),
    avatarProfiles,
    notifications: new Map(),
    reports: new Map(),
    blocks: new Map(),
    accountAppeals: new Map(),
    dataExports: new Map(),
    adminAuditLogs: new Map(),
    maintenanceRuns: new Map(),
    soulTestResults: new Map(seedSoulTestResults),
    dailyPicks: new Map(),
    comments: new Map(),
    checkIns: new Map(),
    vipSubscriptions: new Map(),
    videoIntros: new Map(),
  };
}

export function createId(prefix: string): string {
  return randomUUID();
}

export { seedMembers };
