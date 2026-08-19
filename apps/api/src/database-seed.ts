import { relationshipQuestions } from "@ai-marriage/shared";
import type { ObjectStorageProvider } from "./providers/index.js";
import { createMemoryStore } from "./store/index.js";
import type {
  Store,
  StorePersistence,
  StoredAvatarProfile,
  StoredPhoto,
  StoredProfile,
  StoredUser,
} from "./store/types.js";

export interface DatabaseSeedPersistence extends Pick<
  StorePersistence,
  "hydrate" | "persistUser" | "findUserByPhone" | "persistProfile" | "persistPhoto" | "persistAvatarProfile"
> {}

export interface DatabaseSeedMember {
  id: string;
  phone: string;
  nickname: string;
  gender: "男性" | "女性";
  birthYear: number;
  city: string;
  district: string;
  job: string;
  maritalStatus: "未婚" | "离异" | "丧偶";
  goal: "认真交往" | "以结婚为目标" | "先认识了解";
  introduction: string;
  tags: string[];
  smokingStatus: "不吸烟" | "偶尔吸烟" | "吸烟";
  childrenStatus: "无子女" | "有子女" | "子女已成年";
  photoId: string;
  photoFilename: string;
}

export const DATABASE_SEED_ADMIN = {
  id: "00000000-0000-4000-8000-000000000999",
  phone: "13900139999",
} as const;

export const DATABASE_SEED_MEMBERS: readonly DatabaseSeedMember[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    phone: "13900139000",
    nickname: "林婉清",
    gender: "女性",
    birthYear: 1981,
    city: "上海",
    district: "徐汇",
    job: "教育工作者",
    maritalStatus: "离异",
    goal: "认真交往",
    introduction: "在教育行业工作多年，性格温和，也很看重真诚沟通。闲下来喜欢逛书店、做家常菜。",
    tags: ["真诚", "生活规律", "喜欢阅读"],
    smokingStatus: "不吸烟",
    childrenStatus: "有子女",
    photoId: "10000000-0000-4000-8000-000000000001",
    photoFilename: "member-lin-v2.jpg",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    phone: "13900139001",
    nickname: "周明远",
    gender: "男性",
    birthYear: 1977,
    city: "上海",
    district: "浦东",
    job: "工程项目管理",
    maritalStatus: "离异",
    goal: "以结婚为目标",
    introduction: "工作和生活都比较稳定，平时喜欢摄影、散步和短途旅行。",
    tags: ["稳重", "有责任心", "愿意沟通"],
    smokingStatus: "偶尔吸烟",
    childrenStatus: "子女已成年",
    photoId: "10000000-0000-4000-8000-000000000002",
    photoFilename: "member-zhou-v2.jpg",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    phone: "13900139002",
    nickname: "陈嘉怡",
    gender: "女性",
    birthYear: 1984,
    city: "杭州",
    district: "西湖",
    job: "财务管理",
    maritalStatus: "未婚",
    goal: "认真交往",
    introduction: "生活简单充实，喜欢做饭、看展和整理家里的花草。",
    tags: ["情绪稳定", "爱做饭", "有回应"],
    smokingStatus: "不吸烟",
    childrenStatus: "无子女",
    photoId: "10000000-0000-4000-8000-000000000003",
    photoFilename: "member-chen-v2.jpg",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    phone: "13900139003",
    nickname: "徐建成",
    gender: "男性",
    birthYear: 1974,
    city: "苏州",
    district: "工业园区",
    job: "制造业管理",
    maritalStatus: "丧偶",
    goal: "先认识了解",
    introduction: "为人踏实，重视家庭，也尊重彼此过去的生活。周末喜欢打理花草和骑车。",
    tags: ["顾家", "踏实", "尊重彼此"],
    smokingStatus: "吸烟",
    childrenStatus: "有子女",
    photoId: "10000000-0000-4000-8000-000000000004",
    photoFilename: "member-xu-v2.jpg",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    phone: "13900139004",
    nickname: "王淑云",
    gender: "女性",
    birthYear: 1976,
    city: "南京",
    district: "鼓楼",
    job: "医护工作者",
    maritalStatus: "离异",
    goal: "以结婚为目标",
    introduction: "工作中认真，生活里随和。喜欢旅行和记录日常，希望遇事能够一起商量。",
    tags: ["善解人意", "重视家庭", "有耐心"],
    smokingStatus: "不吸烟",
    childrenStatus: "子女已成年",
    photoId: "10000000-0000-4000-8000-000000000005",
    photoFilename: "member-wang-v2.jpg",
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    phone: "13900139005",
    nickname: "李国伟",
    gender: "男性",
    birthYear: 1979,
    city: "杭州",
    district: "滨江",
    job: "软件服务",
    maritalStatus: "离异",
    goal: "认真交往",
    introduction: "性格温和，遇事愿意沟通。平时会运动、喝咖啡，也喜欢自己下厨。",
    tags: ["温和理性", "愿意沟通", "相互支持"],
    smokingStatus: "偶尔吸烟",
    childrenStatus: "有子女",
    photoId: "10000000-0000-4000-8000-000000000006",
    photoFilename: "member-li-v2.jpg",
  },
  {
    id: "00000000-0000-4000-8000-000000000007",
    phone: "13900139006",
    nickname: "赵雅慧",
    gender: "女性",
    birthYear: 1980,
    city: "上海",
    district: "杨浦",
    job: "文化传媒",
    maritalStatus: "离异",
    goal: "先认识了解",
    introduction: "做事爽快，也愿意听别人说话。休息时喜欢音乐会和老电影。",
    tags: ["坦诚", "善于倾听", "喜欢音乐"],
    smokingStatus: "不吸烟",
    childrenStatus: "无子女",
    photoId: "10000000-0000-4000-8000-000000000007",
    photoFilename: "member-zhao-v2.jpg",
  },
  {
    id: "00000000-0000-4000-8000-000000000008",
    phone: "13900139007",
    nickname: "孙振华",
    gender: "男性",
    birthYear: 1971,
    city: "南京",
    district: "建邺",
    job: "建筑设计",
    maritalStatus: "丧偶",
    goal: "认真交往",
    introduction: "生活稳定，待人真诚。喜欢建筑、音乐和慢慢散步，希望今后的日子彼此照顾。",
    tags: ["真诚", "有耐心", "生活稳定"],
    smokingStatus: "吸烟",
    childrenStatus: "子女已成年",
    photoId: "10000000-0000-4000-8000-000000000008",
    photoFilename: "member-sun-v2.jpg",
  },
];

export interface DatabaseSeedReport {
  usersCreated: number;
  profilesCreated: number;
  photosCreated: number;
  avatarsCreated: number;
  preservedAccounts: number;
}

export interface DatabaseSeedOptions {
  persistence: DatabaseSeedPersistence;
  objectStorage: ObjectStorageProvider;
  loadPhoto(filename: string): Promise<Buffer>;
  now?: () => Date;
}

function seedAnswers(member: DatabaseSeedMember): Record<string, string> {
  const answers = [
    "先把情绪放缓，再把各自真正关心的事情说清楚。",
    "会通过日常问候、分担事情和认真倾听表达关心。",
    "会直接说明需要一点安静时间，并约好之后继续沟通。",
    `散步、做饭，也会安排和${member.tags.at(-1) ?? "兴趣"}有关的活动。`,
    "作息比较规律，工作日重视效率，周末愿意放慢节奏。",
    "按时间和擅长的事情商量，不把家务默认推给一个人。",
    "会综合双方工作、家庭和关系稳定程度认真讨论。",
    "生活稳定，有陪伴也保留各自成长的空间。",
    "大额支出共同决定，日常开支透明，也保留合理的个人额度。",
    "尊重双方父母，同时以两个人的小家庭决定为主。",
    "尊重彼此已有的家庭情况，重要决定需要充分沟通。",
    "提前商量并尽量公平安排，不让任何一方长期委屈。",
    "欺骗、羞辱、暴力和长期拒绝沟通都不能接受。",
    "尊重朋友、兴趣和适度独处，也愿意分享重要安排。",
    member.introduction,
  ];
  return Object.fromEntries(relationshipQuestions.map((question, index) => [question, answers[index]]));
}

function seedProfile(member: DatabaseSeedMember, createdAt: string): StoredProfile {
  return {
    userId: member.id,
    nickname: member.nickname,
    gender: member.gender,
    birthYear: member.birthYear,
    city: member.city,
    district: member.district,
    job: member.job,
    maritalStatus: member.maritalStatus,
    goal: member.goal,
    introduction: member.introduction,
    preference: {
      preferredGender: member.gender === "女性" ? "男性" : "女性",
      minAge: "35",
      maxAge: "65",
      region: "不限地区",
      acceptsLongDistance: "true",
      valuedQualities: member.tags.join("、"),
      dealBreakers: "欺骗、暴力、长期拒绝沟通",
      selfSmokingStatus: member.smokingStatus,
      selfChildrenStatus: member.childrenStatus,
    },
    answers: seedAnswers(member),
    profileStatus: "approved",
    visibility: "public",
    reviewReason: null,
    updatedAt: createdAt,
  };
}

function seedAvatar(member: DatabaseSeedMember, createdAt: string): StoredAvatarProfile {
  return {
    userId: member.id,
    version: 1,
    approvedFacts: [
      { topic: "生活习惯", fact: member.introduction },
      { topic: "关系期待", fact: member.goal },
      { topic: "兴趣偏好", fact: member.tags.join("、") },
    ],
    relationshipExpectations: [member.goal, "真诚沟通", "尊重彼此的生活节奏"],
    boundaries: ["不公开手机号和详细地址", "不替本人作出承诺", "不讨论未获得授权的隐私"],
    unknownResponse: "这个问题没有得到本人明确授权，建议在双方同意真人聊天后再确认。",
    status: "enabled",
    generatedAt: createdAt,
    enabledAt: createdAt,
  };
}

function existingUserByPhone(store: Store, phone: string) {
  const userId = store.usersByPhone.get(phone);
  return userId ? store.users.get(userId) : undefined;
}

export async function seedDatabase(options: DatabaseSeedOptions): Promise<DatabaseSeedReport> {
  const store = createMemoryStore([]);
  await options.persistence.hydrate(store);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const report: DatabaseSeedReport = {
    usersCreated: 0,
    profilesCreated: 0,
    photosCreated: 0,
    avatarsCreated: 0,
    preservedAccounts: 0,
  };

  const ensureUser = async (seed: { id: string; phone: string }, role: StoredUser["role"]) => {
    const existing = await options.persistence.findUserByPhone(seed.phone) ?? existingUserByPhone(store, seed.phone);
    if (existing) {
      report.preservedAccounts += 1;
      return existing.id === seed.id ? existing : undefined;
    }
    if (store.users.has(seed.id)) {
      report.preservedAccounts += 1;
      return undefined;
    }
    const user: StoredUser = { id: seed.id, phone: seed.phone, role, status: "active", createdAt: now };
    await options.persistence.persistUser(user);
    store.users.set(user.id, user);
    store.usersByPhone.set(user.phone, user.id);
    report.usersCreated += 1;
    return user;
  };

  await ensureUser(DATABASE_SEED_ADMIN, "admin");

  for (const member of DATABASE_SEED_MEMBERS) {
    const user = await ensureUser(member, "user");
    if (!user) continue;

    if (!store.profiles.has(user.id)) {
      const profile = seedProfile(member, now);
      await options.persistence.persistProfile(profile);
      store.profiles.set(user.id, profile);
      report.profilesCreated += 1;
    }

    if (!store.photos.has(member.photoId)) {
      const photoData = await options.loadPhoto(member.photoFilename);
      const uploaded = await options.objectStorage.upload({
        userId: user.id,
        filename: member.photoFilename,
        mimeType: "image/jpeg",
        data: photoData,
      });
      const photo: StoredPhoto = {
        id: member.photoId,
        userId: user.id,
        filename: member.photoFilename,
        objectKey: uploaded.key,
        url: `/api/photos/${encodeURIComponent(member.photoId)}/content`,
        mimeType: "image/jpeg",
        sizeBytes: photoData.length,
        isPrimary: true,
        reviewStatus: "approved",
        reviewReason: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await options.persistence.persistPhoto(photo);
      } catch (error) {
        await options.objectStorage.delete(uploaded.key).catch(() => undefined);
        throw error;
      }
      store.photos.set(photo.id, photo);
      report.photosCreated += 1;
    }

    if (!store.avatarProfiles.has(user.id)) {
      const avatarProfile = seedAvatar(member, now);
      await options.persistence.persistAvatarProfile(avatarProfile);
      store.avatarProfiles.set(user.id, avatarProfile);
      report.avatarsCreated += 1;
    }
  }

  return report;
}
