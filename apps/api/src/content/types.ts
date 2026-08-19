export type ContentType = "article" | "event";
export type ContentStatus = "draft" | "published" | "offline";
export type ContentActorRole = "member" | "admin";
export type EventRegistrationStatus = "registered" | "cancelled";

export interface ContentActor {
  userId: string;
  role: ContentActorRole;
}

export interface EventDetailsInput {
  startsAt: number;
  endsAt: number;
  location: string;
  capacity: number;
}

export interface EventDetails extends EventDetailsInput {
  remainingCapacity: number;
}

export interface CreateContentInput {
  type: ContentType;
  title: string;
  summary: string;
  body: string;
  tags?: string[];
  coverImageUrl?: string | null;
  imageUrls?: string[];
  event?: EventDetailsInput;
}

export interface CreateMemberMomentInput {
  body: string;
  imageUrls?: string[];
}

export type UpdateContentInput = Partial<CreateContentInput>;

export interface ContentItem {
  id: string;
  type: ContentType;
  status: ContentStatus;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  coverImageUrl: string | null;
  imageUrls?: string[];
  authorId: string;
  likeCount: number;
  registrationCount: number;
  event: EventDetails | null;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  offlineAt: number | null;
}

export interface PublicContentFilters {
  type?: ContentType;
  tag?: string;
  query?: string;
  upcomingOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ContentPage {
  items: ContentItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ContentReactionResult {
  liked: boolean;
  changed: boolean;
  likeCount: number;
}

export interface EventRegistration {
  id: string;
  contentId: string;
  userId: string;
  status: EventRegistrationStatus;
  registeredAt: number;
  cancelledAt: number | null;
  updatedAt: number;
}

export interface EventRegistrationResult {
  changed: boolean;
  registration: EventRegistration | null;
  registrationCount: number;
  remainingCapacity: number;
}

export interface EventRegistrationListItem {
  registration: EventRegistration;
  content: ContentItem;
}

export type ContentIdPrefix = "content" | "registration";

export interface ContentActivityServiceOptions {
  now?: () => number;
  createId?: (prefix: ContentIdPrefix) => string;
}

export interface ContentActivityState {
  content: ContentItem[];
  likes: Array<{ contentId: string; userIds: string[] }>;
  registrations: EventRegistration[];
}
