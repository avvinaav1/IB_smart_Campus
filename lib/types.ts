export type View = "home" | "explore" | "events" | "rewards" | "chat" | "profile";

export type SessionUser = {
  id: string;
  email: string;
  username: string;
  about: string;
  campus: string;
  avatarUrl: string;
  isPrivate: boolean;
  hasPassword: boolean;
  points: number;
  referralCode: string;
  profileSetupComplete: boolean;
  createdAt: number;
};

export type UserSearchResult = {
  id: string;
  username: string;
  about: string;
  avatarUrl: string;
  isPrivate: boolean;
  followStatus: "none" | "pending" | "accepted" | "rejected";
  chatStatus: "none" | "pending_sent" | "pending_received" | "rejected" | "connected";
};

export type FollowRequestView = {
  id: string;
  sender: Pick<UserSearchResult, "id" | "username" | "avatarUrl" | "isPrivate">;
  createdAt: number;
};

export type ChatRequestView = {
  id: string;
  sender: Pick<UserSearchResult, "id" | "username" | "avatarUrl" | "isPrivate">;
  initialMessage: string;
  createdAt: number;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: number;
};

export type DirectConversation = {
  id: string;
  otherUser: Pick<UserSearchResult, "id" | "username" | "avatarUrl" | "isPrivate">;
  messages: ChatMessage[];
  updatedAt: number;
};

export type PostComment = {
  id: string;
  postId: number;
  userId: string;
  author: string;
  body: string;
  createdAt: number;
};

export type Post = {
  id: number;
  communityId: string;
  authorId?: string;
  userId?: string;
  clientRequestId?: string;
  createdAt?: number;
  community: string;
  accent: string;
  author: string;
  time: string;
  flair?: string;
  title: string;
  body?: string;
  image?: string;
  images?: string[];
  votes: number;
  comments: number;
  commentItems?: PostComment[];
  voted?: 1 | -1;
  saved?: boolean;
  poll?: { label: string; percent: number }[];
};

export type UserDashboard = {
  karma: number;
  postCount: number;
  followers: number;
  streak: number;
  posts: Post[];
};

export type CustomFormField =
  | {
      id: string;
      type: "short_text" | "long_text";
      label: string;
      required: boolean;
      placeholder?: string;
      maxLength?: number;
    }
  | {
      id: string;
      type: "number";
      label: string;
      required: boolean;
      min?: number;
      max?: number;
    }
  | {
      id: string;
      type: "select";
      label: string;
      required: boolean;
      options: Array<{ id: string; label: string; value: string }>;
    }
  | {
      id: string;
      type: "checkbox";
      label: string;
      required: boolean;
    };

export type CustomFormSchema = { version: 1; fields: CustomFormField[] };
export type CustomFormAnswer = string | number | boolean;
export type CustomFormAnswers = Record<string, CustomFormAnswer>;

export type CoverFit = "fill" | "fit";

export type CampusEvent = {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  category: string;
  location: string;
  venueName: string;
  venueAddress: string;
  directionsUrl: string;
  campus: string;
  community?: string;
  startsAt: string;
  endsAt?: string;
  capacity: number;
  imageUrl: string;
  coverFit: CoverFit;
  coverFocusX: number;
  coverFocusY: number;
  customFormSchema: CustomFormSchema;
  going: number;
  waitlisted: number;
  viewerRsvpStatus?: "going" | "waitlisted";
  viewerCheckInCode?: string;
  viewerCheckInStatus?: "REGISTERED" | "CHECKED_IN";
  isCreator: boolean;
  isEventAdmin: boolean;
  canManageEvent: boolean;
  createdAt: number;
  updatedAt: number;
  month: string;
  day: string;
  time: string;
  endMonth?: string;
  endDay?: string;
  endTime?: string;
};

export type EventAttendee = {
  rsvpId: string;
  userId: string;
  username: string;
  email: string;
  rsvpStatus: "going" | "waitlisted";
  status: "REGISTERED" | "CHECKED_IN";
  checkInCode: string;
  customFormAnswers: CustomFormAnswers;
  checkedInAt?: number;
  checkedInBy?: string;
  createdAt: number;
  updatedAt: number;
};

export type EventAdmin = {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string;
  createdAt: number;
};

export type Community = {
  id: string;
  creatorId: string;
  name: string;
  members: string;
  color: string;
  emoji: string;
  iconUrl: string;
  bannerUrl: string;
  description: string;
  joined: boolean;
  privacy?: "public" | "restricted" | "private";
  role?: "ADMIN" | "MEMBER";
  createdAt: number;
  updatedAt: number;
};

export type Conversation = {
  id: number;
  name: string;
  avatar: string;
  preview: string;
  time: string;
  unread?: number;
  online?: boolean;
  group?: boolean;
};
