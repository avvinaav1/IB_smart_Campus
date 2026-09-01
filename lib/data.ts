import type { CampusEvent, Community, Post } from "@/lib/types";

export const communities: Community[] = [
  {
    id: "c/campuslife",
    creatorId: "system",
    name: "Campus Life",
    members: "2.4k",
    color: "#4F46E5",
    emoji: "🎓",
    iconUrl: "",
    bannerUrl: "",
    description: "Campus updates, announcements, and student life stories from around the community.",
    joined: true,
    privacy: "public",
    role: "MEMBER",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
    updatedAt: Date.now() - 1000 * 60 * 60 * 12,
  },
  {
    id: "c/tech-club",
    creatorId: "system",
    name: "Tech Club",
    members: "870",
    color: "#0EA5E9",
    emoji: "💻",
    iconUrl: "",
    bannerUrl: "",
    description: "Hackathons, project showcases, and tech networking for builders and innovators.",
    joined: false,
    privacy: "restricted",
    role: undefined,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 20,
    updatedAt: Date.now() - 1000 * 60 * 60 * 6,
  },
  {
    id: "c/books-and-brews",
    creatorId: "system",
    name: "Books & Brews",
    members: "430",
    color: "#F59E0B",
    emoji: "📚",
    iconUrl: "",
    bannerUrl: "",
    description: "Reading circles, coffee chats, and thoughtful discussion around books and ideas.",
    joined: true,
    privacy: "public",
    role: "ADMIN",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 10,
    updatedAt: Date.now() - 1000 * 60 * 60 * 2,
  },
];

export const events: CampusEvent[] = [];

export const posts: Post[] = [
 {}
];
