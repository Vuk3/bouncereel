import type { Features } from './features.ts';

// The /api contract, imported by the Worker (worker/) and by the pages (src/). Field names
// are the JSON's; worker/videos.ts maps D1 rows to them. Nothing in shared/ may use the DOM
// or the Workers runtime: both sides compile it.

export const PLATFORMS = ['youtube', 'tiktok', 'instagram'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

/** Every error the API returns; `code` is stable, `message` is English and says what to do. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** A link to where a video was published. */
/** That a video went up on a platform: ticked on the Videos page, with its link once pasted. */
export interface Post {
  platform: Platform;
  /** null when only the tick was given. */
  url: string | null;
  /** YouTube's video id, TikTok's video id or Instagram's shortcode; null without a link, or when the link does not carry it. */
  externalId: string | null;
  addedAt: string;
}

export interface RaceSide {
  name: string;
  sequence: string;
  special: string;
}

/** What a ball race came to, as the prediction knew it before the recording started. */
export interface RaceSummary {
  /** The top card. */
  a: RaceSide;
  /** The bottom card. */
  b: RaceSide;
  /** null only when nobody finished. */
  winner: 'a' | 'b' | null;
  /** Seconds between the two touching the line; null when the loser never would. */
  margin: number | null;
  leadChanges: number;
}

/** A video as the list shows it: everything but its config. */
export interface VideoSummary {
  id: number;
  game: string;
  /** ISO 8601, UTC. */
  recordedAt: string;
  title: string;
  fileName: string;
  format: string;
  /** The file's measured length. */
  seconds: number;
  stoppedEarly: boolean;
  /** The length it was balanced for. */
  videoLength: number;
  seed: string;
  appVersion: string;
  /** null for a game that is not a ball race. */
  race: RaceSummary | null;
  /** The two balls' colours from its config, top then bottom, for the Videos page's thumbnail; null when the config has none. */
  colors: { a: string; b: string } | null;
  posts: Post[];
  /** Whether texts for posting it were pasted (a superadmin's, PUT /api/admin/videos/:id/texts). */
  hasTexts: boolean;
}

/** What to post with a video on each platform: the bouncereel-post skill's answer, pasted on the Videos page. */
export interface PostTexts {
  youtube: { title: string; description: string; tags: string[]; pinnedComment: string };
  tiktok: { caption: string; pinnedComment: string };
  instagram: { caption: string; pinnedComment: string };
}

export interface VideoTexts extends PostTexts {
  /** ISO 8601, UTC. */
  savedAt: string;
}

/** PUT /api/admin/videos/:id/texts answers with what it stored. */
export interface TextsResponse {
  texts: VideoTexts;
}

export interface VideoDetail extends VideoSummary {
  /** The whole Config it was recorded with: loading it replays the same video. */
  config: unknown;
  /** What to post with it on each platform; null until pasted. */
  texts: VideoTexts | null;
}

/** GET /api/videos, newest first. */
export interface VideosResponse {
  videos: VideoSummary[];
}

/** GET /api/videos/:id */
export interface VideoResponse {
  video: VideoDetail;
}

/** POST /api/videos: what Record sends once a file is saved. */
export interface NewVideo {
  game: 'ball-race';
  recordedAt: string;
  title: string;
  fileName: string;
  format: string;
  seconds: number;
  stoppedEarly: boolean;
  videoLength: number;
  seed: string;
  appVersion: string;
  config: Record<string, unknown>;
  race: RaceSummary;
}

/** POST /api/videos answers 201 with the new video's id. */
export interface CreatedResponse {
  id: number;
}

/** PUT /api/videos/:id/posts/:platform */
/** PUT /api/videos/:id/posts/:platform: posted there, with a link or (none, null or empty) without. */
export interface PostBody {
  url?: string | null;
}

export interface PostResponse {
  post: Post;
}

// ── Accounts ────────────────────────────────────────────────────────────────

/** `superadmin` is made only from the terminal (scripts/admin.mjs); sign-up and the API never grant it. */
export type Role = 'user' | 'superadmin';

/** The signed-in account. */
export interface Account {
  id: number;
  email: string;
  role: Role;
  /** The address has been confirmed through the link in the sign-up mail. */
  verified: boolean;
  createdAt: string;
}

/** POST /api/auth/signup, /api/auth/login */
export interface Credentials {
  email: string;
  password: string;
}

/** What sign-up, login and a password reset answer with, along with the session cookie. */
export interface SignedInResponse {
  account: Account;
}

/** GET /api/auth/reset?token=: who a one-time password link is for. */
export interface ResetInfo {
  email: string;
  /** `superadmin`: the link from `npm run admin`, which also makes the account a superadmin. */
  purpose: 'reset' | 'superadmin';
  /** The address already has an account (a superadmin link can create one). */
  existing: boolean;
}

/** POST /api/auth/reset */
export interface ResetBody {
  token: string;
  password: string;
}

/** POST /api/auth/verify answers with the address it confirmed. */
export interface VerifiedResponse {
  email: string;
}

// ── Plans and subscriptions ─────────────────────────────────────────────────

export const SUBSCRIPTION_STATUSES = ['active', 'canceled'] as const;
/**
 * `active` until `endsAt`, if it has one; `canceled` keeps the plan until `endsAt` and drops
 * to the default plan at once without one. A payment provider will add its own (past_due…).
 */
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PRICE_INTERVALS = ['month', 'year'] as const;
export type PriceInterval = (typeof PRICE_INTERVALS)[number];

export interface Price {
  /** In the currency's minor unit: 900 is €9.00. */
  amount: number;
  /** ISO 4217, upper case: EUR, USD. */
  currency: string;
  /** null for a one-off price. */
  interval: PriceInterval | null;
}

/**
 * How a plan's card looks on the pricing page: `plain` (white), `bold` (the violet, the plan
 * the page points at), `dark` (the ink stage, the top plan).
 */
export const PLAN_TONES = ['plain', 'bold', 'dark'] as const;
export type PlanTone = (typeof PLAN_TONES)[number];

/** A plan as the pricing page shows it. */
export interface PublicPlan {
  id: number;
  name: string;
  description: string;
  /** null: no price yet, shown as "Coming soon". */
  price: Price | null;
  features: Features;
  /** The plan every new account gets, and every ended subscription falls back to. */
  isDefault: boolean;
  tone: PlanTone;
  /** A word or two on the card's corner ("Recommended"); null for none. */
  badge: string | null;
}

/** GET /api/plans: the visible plans that are not archived, in their order. */
export interface PlansResponse {
  plans: PublicPlan[];
  /** false until a payment provider is connected: every upgrade button waits. */
  billing: boolean;
}

export interface Subscription {
  planId: number;
  planName: string;
  status: SubscriptionStatus;
  /** `manual` (set in the admin area) or, later, the payment provider's name. */
  source: string;
  endsAt: string | null;
  updatedAt: string;
}

/** GET /api/account: the account, its plan and what it may do now. */
/**
 * The plan's daily allowance as it stands (`perDay` in shared/features.ts): `used` of `limit`
 * (null: no daily limit) today, the UTC calendar day, and when today ends, midnight UTC; `endsAt`
 * is null until today's first video, which is also when `used` is 0.
 */
export interface Day {
  used: number;
  limit: number | null;
  endsAt: string | null;
}

/** POST /api/account/day: the day after a recording has taken one of its videos. */
export interface DayResponse {
  day: Day;
}

export interface AccountResponse {
  account: Account;
  /** The plan in force now: the subscription's, or the default plan once it has ended. */
  plan: { id: number; name: string };
  subscription: Subscription | null;
  /** What the account may do now; a superadmin's are everything, whatever the plan. */
  features: Features;
  library: { count: number; limit: number | null };
  day: Day;
  billing: boolean;
}

/** POST /api/account/password */
export interface PasswordBody {
  current: string;
  password: string;
}

// ── Admin ───────────────────────────────────────────────────────────────────

/** A user's standing as the admin's list shows it: suspended wins, then an ended subscription. */
export type UserStatus = SubscriptionStatus | 'expired' | 'suspended';

export interface AdminOverview {
  users: { total: number; last7: number; last30: number; suspended: number };
  /** Subscriptions naming each plan, and how many of them are in force now. */
  plans: { id: number; name: string; archived: boolean; subscribers: number; inForce: number }[];
  videos: number;
}

export const USER_SORTS = ['email', 'joined', 'lastLogin', 'videos', 'plan', 'endsAt'] as const;
export type UserSort = (typeof USER_SORTS)[number];

export interface AdminUser {
  id: number;
  email: string;
  role: Role;
  planId: number | null;
  planName: string | null;
  status: UserStatus;
  endsAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  videos: number;
  verified: boolean;
}

/** GET /api/admin/users?q=&plan=&status=&sort=&dir=&page= */
export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

/** One line of the append-only change log. Ids stay after an account or plan is deleted; the names do not. */
export interface LogEntry {
  id: number;
  at: string;
  /** Who made the change; null for the server itself. */
  actor: { id: number; email: string | null } | null;
  subject: 'subscription' | 'plan' | 'account';
  user: { id: number; email: string | null } | null;
  plan: { id: number; name: string | null } | null;
  action: string;
  before: unknown;
  after: unknown;
}

export interface LogResponse {
  entries: LogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /api/admin/users/:id */
export interface AdminUserResponse {
  user: AdminUser & { suspendedAt: string | null };
  subscription: Subscription | null;
  history: LogEntry[];
  videos: VideoSummary[];
}

/** PUT /api/admin/users/:id/subscription: any of the three. */
export interface SubscriptionBody {
  planId?: number;
  endsAt?: string | null;
  status?: SubscriptionStatus;
}

export interface AdminPlan extends PublicPlan {
  sortOrder: number;
  visible: boolean;
  archivedAt: string | null;
  subscribers: number;
  updatedAt: string;
}

export interface AdminPlansResponse {
  plans: AdminPlan[];
}

/** POST /api/admin/plans, PUT /api/admin/plans/:id */
export interface PlanBody {
  name: string;
  description: string;
  price: Price | null;
  visible: boolean;
  tone: PlanTone;
  badge: string | null;
  features: Features;
}

/** Mail a link was sent by: `off` is no RESEND_API_KEY (the link is in the log, local dev only). */
export type MailResult = 'sent' | 'failed' | 'off';
