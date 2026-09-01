"use client";

import Image from "next/image";
import {
  ArrowRight, Bell, Bookmark, CalendarDays, Check, ChevronDown, CircleUserRound,
  Clock3, Compass, Copy, Ellipsis, Gift, Globe2, Home, ImagePlus, Inbox, KeyRound, Link2, LoaderCircle, LockKeyhole, MapPin,
  LogOut, Menu, MessageCircle, MessageSquare, Moon, Plus, Search, Send, Settings, Share2,
  Download, ExternalLink, ShieldCheck, Star, Sun, TicketCheck, TrendingUp, Trophy, UserCheck, UserPlus, Users, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthLoading, AuthScreen } from "@/components/auth-screen";
import { CampusPicker } from "@/components/campus-picker";
import { EventRegistrationDetail } from "@/components/event-registration-detail";
import { ProfileEditor } from "@/components/profile-editor";
import { ProfileSetup } from "@/components/profile-setup";
import type { CampusEvent, ChatRequestView, Community, CustomFormField, DirectConversation, EventAttendee, FollowRequestView, Post, SessionUser, UserDashboard, UserSearchResult, View } from "@/lib/types";

const nav = [
  { id: "home" as View, label: "Home", icon: Home },
  { id: "explore" as View, label: "Communities", icon: Compass },
  { id: "events" as View, label: "Events", icon: CalendarDays },
  { id: "rewards" as View, label: "Rewards", icon: Gift },
  { id: "chat" as View, label: "Chat", icon: MessageSquare },
];

const mobileNav = [
  { id: "home" as View, label: "Home", icon: Home },
  { id: "explore" as View, label: "Explore", icon: Compass },
  { id: "create", label: "Create", icon: Plus },
  { id: "events" as View, label: "Events", icon: CalendarDays },
  { id: "chat" as View, label: "Chat", icon: MessageSquare },
  { id: "profile" as View, label: "Profile", icon: CircleUserRound },
];

const formatNumber = (value: number) => value.toLocaleString();

function withVote(post: Post, direction: 1 | -1) {
  const voted = post.voted === direction ? undefined : direction;
  return { ...post, votes: post.votes + (voted || 0) - (post.voted || 0), voted };
}

async function requestUserDashboard() {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load your dashboard.");
  return result.data.dashboard as UserDashboard;
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json() as { data?: T; error?: string };
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result.data;
}

function Avatar({ text, image, color = "#6C3BFF", size = 38 }: { text: string; image?: string; color?: string; size?: number }) {
  return <span className="avatar" style={{ background: color, width: size, height: size }}>{image ? <Image src={image} alt="" fill sizes={`${size}px`} unoptimized /> : text.slice(0, 2).toUpperCase()}</span>;
}

function BrandLogo({ size = 38 }: { size?: number }) {
  return <span className="brand-logo-frame" style={{ width: size, height: size }} aria-hidden="true">
    <Image className="brand-logo brand-logo-black" src="/smart-campus-logo-black.png" alt="" width={6103} height={6103} priority />
    <Image className="brand-logo brand-logo-white" src="/smart-campus-logo-white.png" alt="" width={1024} height={1024} priority />
  </span>;
}

function IconButton({ label, children, onClick, active }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return <button type="button" className={`icon-button ${active ? "active" : ""}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function Toast({ message }: { message: string }) {
  return <div className="toast" role="status"><Check size={17} strokeWidth={3} />{message}</div>;
}

export function SmartCampusApp() {
  const [authUser, setAuthUser] = useState<SessionUser | null | undefined>(undefined);
  const [view, setView] = useState<View>("home");
  const [posts, setPosts] = useState<Post[]>([]);
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [dashboard, setDashboard] = useState<UserDashboard | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerCommunity, setComposerCommunity] = useState("c/campuslife");
  const [eventOpen, setEventOpen] = useState<CampusEvent | null>(null);
  const [commentPostId, setCommentPostId] = useState<number | null>(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [privacyPending, setPrivacyPending] = useState(false);
  const [votePending, setVotePending] = useState<Set<number>>(() => new Set());
  const [toast, setToast] = useState("");
  const voteRequests = useRef(new Set<number>());

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => { if (active) setAuthUser(result.data?.authenticated ? result.data.user : null); })
      .catch(() => { if (active) setAuthUser(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const frame = window.requestAnimationFrame(() => setTheme(current));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!authUser?.profileSetupComplete) return;
    let active = true;
    async function refreshGlobalFeed() {
      try {
        const response = await fetch("/api/posts", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not refresh the feed.");
        if (!active) return;
        const serverPosts = Array.isArray(result.data?.posts) ? result.data.posts as Post[] : [];
        setPosts((current) => {
          const serverRequestIds = new Set(serverPosts.map((post) => post.clientRequestId).filter(Boolean));
          const pending = current.filter((post) => post.id < 0 && !serverRequestIds.has(post.clientRequestId));
          const localById = new Map(current.filter((post) => post.id > 0).map((post) => [post.id, post]));
          const hydrated = serverPosts.map((post) => {
            const local = localById.get(post.id);
            return local ? { ...post, saved: local.saved } : post;
          });
          return [...pending, ...hydrated];
        });
      } catch {
        if (active) setToast("Could not refresh the global feed.");
      }
    }
    void refreshGlobalFeed();
    const interval = window.setInterval(refreshGlobalFeed, 20_000);
    window.addEventListener("focus", refreshGlobalFeed);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshGlobalFeed);
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser?.profileSetupComplete) return;
    let active = true;
    async function refreshCommunities() {
      try {
        const data = await requestJson<{ communities: Community[] }>("/api/communities", { cache: "no-store" });
        if (active) setCommunities(data?.communities || []);
      } catch {
        if (active) setToast("Could not refresh the community directory.");
      }
    }
    void refreshCommunities();
    const interval = window.setInterval(refreshCommunities, 20_000);
    window.addEventListener("focus", refreshCommunities);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshCommunities);
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser?.profileSetupComplete) return;
    let active = true;
    async function refreshGlobalEvents() {
      try {
        const data = await requestJson<{ events: CampusEvent[] }>("/api/events", { cache: "no-store" });
        if (!active) return;
        const nextEvents = data?.events || [];
        setEvents(nextEvents);
        setEventOpen((current) => current ? nextEvents.find((event) => event.id === current.id) || current : null);
      } catch {
        if (active) setToast("Could not refresh the global events feed.");
      }
    }
    void refreshGlobalEvents();
    const interval = window.setInterval(refreshGlobalEvents, 20_000);
    window.addEventListener("focus", refreshGlobalEvents);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshGlobalEvents);
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser?.profileSetupComplete) return;
    let active = true;
    async function refreshDashboard() {
      try {
        const next = await requestUserDashboard();
        if (active) setDashboard(next);
      } catch {
        if (active) setToast("Could not refresh your dashboard.");
      }
    }
    void refreshDashboard();
    const interval = window.setInterval(refreshDashboard, 20_000);
    window.addEventListener("focus", refreshDashboard);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshDashboard);
    };
  }, [authUser]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("sc-theme", next);
  }

  function go(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const viewTitle: Record<View, string> = { home: "Your campus", explore: "Explore", events: "Events", rewards: "Rewards", chat: "Messages", profile: "Profile" };

  function resetUserState() {
    setPosts([]);
    setEvents([]);
    setDashboard(null);
    setCommunities([]);
    setSearchOpen(false);
    setNotificationsOpen(false);
    setComposerOpen(false);
    setEventOpen(null);
    setCommentPostId(null);
    setProfileEditorOpen(false);
    setPrivacyPending(false);
    voteRequests.current.clear();
    setVotePending(new Set());
    setComposerCommunity("c/campuslife");
  }

  function completeAuthentication(user: SessionUser) {
    resetUserState();
    setView("home");
    setAuthUser(user);
  }

  async function changePrivacy(isPrivate: boolean) {
    if (!authUser || privacyPending) return;
    setPrivacyPending(true);
    try {
      const data = await requestJson<{ user: SessionUser }>("/api/profile/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate }),
      });
      if (!data?.user) throw new Error("The server did not return your updated account.");
      setAuthUser(data.user);
      setToast(isPrivate ? "Your profile is now private" : "Your profile is now public");
    } catch (privacyError) {
      setToast(privacyError instanceof Error ? privacyError.message : "Could not update profile privacy.");
    } finally {
      setPrivacyPending(false);
    }
  }

  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      resetUserState();
      localStorage.clear();
      sessionStorage.clear();
      document.documentElement.dataset.theme = "light";
      setTheme("light");
      setAuthUser(null);
      setView("home");
    } catch {
      setToast("Could not log out. Please try again.");
    }
  }

  async function persistPost(draft: Post) {
    const clientRequestId = crypto.randomUUID();
    const optimistic: Post = {
      ...draft,
      id: -Date.now(),
      userId: authUser?.id,
      clientRequestId,
      createdAt: Date.now(),
      time: "posting…",
    };
    setPosts((current) => [optimistic, ...current]);
    setComposerOpen(false);
    go("home");
    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId,
          communityId: draft.communityId,
          flair: draft.flair,
          title: draft.title,
          body: draft.body,
          images: draft.images,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The post could not be saved.");
      const saved = result.data?.post as Post;
      setPosts((current) => [saved, ...current.filter((post) => post.clientRequestId !== clientRequestId && post.id !== saved.id)]);
      void requestUserDashboard().then(setDashboard).catch(() => undefined);
      setToast(`Posted to ${saved.community}`);
    } catch (error) {
      setPosts((current) => current.filter((post) => post.clientRequestId !== clientRequestId));
      setToast(error instanceof Error ? error.message : "The post could not be saved.");
    }
  }

  async function persistCommunityMembership(community: Community) {
    try {
      const data = await requestJson<{ community: Community }>(`/api/communities/${community.id}/membership`, { method: community.joined ? "DELETE" : "POST" });
      if (!data?.community) throw new Error("The server did not return the updated community.");
      setCommunities((current) => current.map((item) => item.id === community.id ? data.community : item));
      setToast(community.joined ? `Left ${community.name}` : `Joined ${community.name}`);
    } catch (membershipError) {
      setToast(membershipError instanceof Error ? membershipError.message : "Could not update your community membership.");
    }
  }

  async function persistVote(id: number, direction: 1 | -1) {
    if (voteRequests.current.has(id)) return;
    const original = posts.find((post) => post.id === id);
    if (!original || original.id < 0) return;
    const optimistic = withVote(original, direction);
    const desiredVote = optimistic.voted ?? null;
    voteRequests.current.add(id);
    setVotePending((current) => new Set(current).add(id));
    setPosts((current) => current.map((post) => post.id === id ? optimistic : post));
    try {
      const response = await fetch(`/api/posts/${id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: desiredVote }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your vote could not be saved.");
      const saved = result.data.post as Post;
      setPosts((current) => current.map((post) => post.id === id ? { ...saved, saved: post.saved } : post));
      void requestUserDashboard().then(setDashboard).catch(() => undefined);
    } catch (error) {
      setPosts((current) => current.map((post) => post.id === id && post.voted === optimistic.voted ? {
        ...post,
        votes: post.votes - (optimistic.voted || 0) + (original.voted || 0),
        voted: original.voted,
      } : post));
      setToast(error instanceof Error ? error.message : "Your vote could not be saved.");
    } finally {
      voteRequests.current.delete(id);
      setVotePending((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  if (authUser === undefined) return <AuthLoading />;
  if (!authUser) return <AuthScreen onAuthenticated={completeAuthentication} />;
  if (!authUser.profileSetupComplete) return <ProfileSetup user={authUser} onComplete={completeAuthentication} />;
  const activeCommentPost = commentPostId === null ? null : posts.find((post) => post.id === commentPostId) || null;

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <button className="brand" onClick={() => go("home")} aria-label="Smart Campus home">
          <BrandLogo />
          <span><b>smart</b>campus</span>
        </button>
        <nav aria-label="Primary navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "selected" : ""} onClick={() => go(id)}>
              <Icon size={21} strokeWidth={view === id ? 2.8 : 2.2} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="create-button" onClick={() => { setComposerCommunity("c/campuslife"); setComposerOpen(true); }}><Plus size={20} strokeWidth={3} />Create post</button>
        <div className="side-card">
          <span className="eyebrow lime">YOUR STREAK</span>
          <div className="streak"><span>🔥</span><b>{dashboard?.streak ?? 0}</b><small>days</small></div>
          <p>Show up tomorrow to keep it alive.</p>
        </div>
        <button className="user-pill" onClick={() => go("profile")}>
          <Avatar text={authUser.username} image={authUser.avatarUrl} color="#FF5C8A" />
          <span><b>{authUser.username}</b><small>{authUser.email}</small></span>
          <Ellipsis size={19} />
        </button>
      </aside>

      <div className="main-shell">
        <header className="top-bar">
          <button className="mobile-brand" onClick={() => go("home")}><BrandLogo size={34} /><b>smart</b>campus</button>
          <div className="page-label"><span>{viewTitle[view]}</span><small title={authUser.campus || "Campus not selected"}>{authUser.campus || "Campus not selected"}</small></div>
          <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={19} /><span>Search campus</span><kbd>⌘ K</kbd></button>
          <div className="top-actions">
            <IconButton label="Switch theme" onClick={toggleTheme}>{theme === "light" ? <Moon size={20} /> : <Sun size={20} />}</IconButton>
            <IconButton label="Notifications" onClick={() => setNotificationsOpen(true)}><Bell size={20} /><span className="notify-dot" /></IconButton>
            <button className="mini-avatar" onClick={() => go("profile")}><Avatar text={authUser.username} image={authUser.avatarUrl} color="#FF5C8A" size={36} /></button>
          </div>
        </header>

        <main>
          {view === "home" && <HomeView user={authUser} posts={posts} events={events} communities={communities} setPosts={setPosts} vote={persistVote} votePending={votePending} onExplore={() => go("explore")} onEvents={() => go("events")} onEvent={setEventOpen} openComments={setCommentPostId} notify={setToast} />}
          {view === "explore" && <ExploreView items={communities} setItems={setCommunities} posts={posts} setPosts={setPosts} vote={persistVote} votePending={votePending} notify={setToast} onMembership={persistCommunityMembership} onEvents={() => go("events")} openComments={setCommentPostId} openComposer={(community = "c/campuslife") => { setComposerCommunity(community); setComposerOpen(true); }} />}
          {view === "events" && <EventsView events={events} communities={communities} defaultCampus={authUser.campus || ""} onEvent={setEventOpen} onCreated={(event) => { setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)]); setEventOpen(event); }} notify={setToast} />}
          {view === "rewards" && <RewardsView user={authUser} notify={setToast} />}
          {view === "chat" && <ChatView user={authUser} notify={setToast} onDiscover={() => setSearchOpen(true)} />}
          {view === "profile" && <ProfileView user={authUser} dashboard={dashboard} theme={theme} toggleTheme={toggleTheme} privacyPending={privacyPending} onPrivacyChange={changePrivacy} onRewards={() => go("rewards")} onEdit={() => setProfileEditorOpen(true)} onLogout={logout} />}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileNav.map(({ id, label, icon: Icon }) => id === "create" ? (
          <button key={id} className="mobile-create" aria-label="Create post" onClick={() => { setComposerCommunity("c/campuslife"); setComposerOpen(true); }}><Icon size={25} strokeWidth={3} /></button>
        ) : (
          <button key={id} className={view === id ? "selected" : ""} onClick={() => go(id as View)}>
            <span><Icon size={21} /></span><small>{label}</small>
          </button>
        ))}
      </nav>

      {searchOpen && <SearchPanel close={() => setSearchOpen(false)} notify={setToast} />}
      {notificationsOpen && <Notifications close={() => setNotificationsOpen(false)} />}
      {composerOpen && <Composer author={authUser.username} communities={communities} initialCommunity={composerCommunity} close={() => setComposerOpen(false)} onCreate={persistPost} />}
      {eventOpen && <EventRegistrationDetail event={eventOpen} close={() => setEventOpen(null)} notify={setToast} onChange={(event) => { setEventOpen(event); setEvents((current) => current.map((item) => item.id === event.id ? event : item)); }} />}
      {activeCommentPost && <CommentThread post={activeCommentPost} user={authUser} close={() => setCommentPostId(null)} onUpdated={(updated) => setPosts((current) => current.map((post) => post.id === updated.id ? updated : post))} notify={setToast} />}
      {profileEditorOpen && <ProfileEditor user={authUser} close={() => setProfileEditorOpen(false)} onUpdated={setAuthUser} notify={setToast} />}
      {toast && <Toast message={toast} />}
    </div>
  );
}

function HomeView({ user, posts, events, communities, setPosts, vote, votePending, onExplore, onEvents, onEvent, openComments, notify }: { user: SessionUser; posts: Post[]; events: CampusEvent[]; communities: Community[]; setPosts: React.Dispatch<React.SetStateAction<Post[]>>; vote: (id: number, direction: 1 | -1) => void; votePending: Set<number>; onExplore: () => void; onEvents: () => void; onEvent: (e: CampusEvent) => void; openComments: (id: number) => void; notify: (s: string) => void }) {
  const [feed, setFeed] = useState("Home");
  const premiumRemaining = Math.max(0, 60 - user.points);
  const invitesRemaining = Math.ceil(premiumRemaining / 10);
  const rewardProgress = Math.min(100, user.points / 60 * 100);

  function save(id: number) {
    setPosts(current => current.map(post => post.id === id ? { ...post, saved: !post.saved } : post));
    notify("Saved to your collection");
  }

  return <div className="home-layout">
    <section className="feed-column">
      <div className="hero-strip">
        <div><span className="eyebrow violet">WEDNESDAY, 26 AUG</span><h1>What&apos;s good, {user.username}? <span>✦</span></h1><p>Your campus has been busy. Here&apos;s the good stuff.</p></div>
        <div className="hero-doodle" aria-hidden="true"><span>SC</span><i>✦</i></div>
      </div>
      <div className="feed-tabs" role="tablist">
        {["Home", "Popular", "New", "Rising", "Top"].map(item => <button role="tab" aria-selected={feed === item} className={feed === item ? "active" : ""} key={item} onClick={() => setFeed(item)}>{item}</button>)}
      </div>
      <button className="quick-compose" onClick={() => document.querySelector<HTMLButtonElement>(".create-button")?.click()}><Avatar text={user.username} image={user.avatarUrl} color="#FF5C8A" /><span>Share something with campus...</span><ImagePlus size={19} /><Link2 size={19} /></button>
      <div className="feed-list">
        {posts.map((post, index) => <PostCard key={post.id} post={post} index={index} vote={vote} votePending={votePending.has(post.id)} save={save} openComments={openComments} notify={notify} />)}
      </div>
    </section>
    <aside className="right-rail">
      <div className="rail-card events-rail">
        <div className="section-heading"><div><span className="eyebrow pink">DON&apos;T MISS OUT</span><h2>Happening soon</h2></div><button onClick={onEvents}>View all <ArrowRight size={15} /></button></div>
        {events.slice(0, 3).map(event => <button className="mini-event" key={event.id} onClick={() => onEvent(event)}><span><b>{event.day}</b><small>{event.month}</small></span><div><b>{event.title}</b><small><Clock3 size={13} /> {event.time} · {event.location}</small></div></button>)}
        {!events.length && <p className="rail-empty">Events published by campus creators will appear here.</p>}
      </div>
      <div className="rail-card progress-card">
        <div className="section-heading"><div><span className="eyebrow cyan">LEVEL UP</span><h2>Your rewards</h2></div><Gift size={24} /></div>
        <div className="points-row"><span><b>{user.points}</b><small>points</small></span><span>{premiumRemaining ? `${premiumRemaining} to Premium` : "Premium unlocked"}</span></div>
        <div className="progress"><i style={{ width: `${rewardProgress}%` }} /></div>
        <p>{premiumRemaining ? `Invite ${invitesRemaining} more verified ${invitesRemaining === 1 ? "friend" : "friends"} to unlock 30 days of Premium.` : "You reached the Premium reward milestone."}</p>
        <button onClick={() => { navigator.clipboard?.writeText(user.referralCode); notify("Referral code copied"); }}><Copy size={16} /> Copy referral code</button>
      </div>
      <div className="rail-card communities-rail">
        <div className="section-heading"><div><span className="eyebrow lime">TRENDING NOW</span><h2>Communities</h2></div></div>
        {communities.slice(0, 4).map((community, index) => <div className="community-line" key={community.id}><i>{index + 1}</i><Avatar text={community.emoji} image={community.iconUrl} color={community.color} /><span><b>{community.name}</b><small>{community.members} members</small></span><TrendingUp size={17} /></div>)}
        <button className="text-button" onClick={onExplore}>Explore all communities <ArrowRight size={16} /></button>
      </div>
    </aside>
  </div>;
}

function PostCard({ post, index, vote, votePending, save, openComments, notify }: { post: Post; index: number; vote: (id: number, d: 1 | -1) => void; votePending: boolean; save: (id: number) => void; openComments: (id: number) => void; notify: (s: string) => void }) {
  const postImages = post.images?.length ? post.images : post.image ? [post.image] : [];
  return <article className={`post-card post-${index + 1} ${post.id < 0 ? "is-pending" : ""}`}>
    <div className="post-meta"><Avatar text={post.community.slice(2, 4)} color={post.accent} size={34} /><div><b>{post.community}</b><span>posted by {post.author} · {post.time}</span></div>{post.flair && <em>{post.flair}</em>}<IconButton label="Post options"><Ellipsis size={19} /></IconButton></div>
    <h2>{post.title}</h2>
    {post.body && <p>{post.body}</p>}
    {postImages.length > 0 && <div className={`post-image gallery-${Math.min(postImages.length, 6)}`}>{postImages.slice(0, 6).map((image, imageIndex) => <span className="gallery-image" key={`${post.id}-${imageIndex}`}><Image src={image} alt={postImages.length > 1 ? `Attachment ${imageIndex + 1} for ${post.title}` : `Attachment for ${post.title}`} fill sizes="(max-width: 900px) 100vw, 650px" unoptimized={image.startsWith("data:") || image.startsWith("/api/")} />{imageIndex === 5 && postImages.length > 6 && <b>+{postImages.length - 6}</b>}</span>)}</div>}
    {post.poll && <div className="poll">{post.poll.map(item => <button key={item.label} onClick={() => notify(`Voted for ${item.label}`)}><i style={{ width: `${item.percent}%` }} /><span>{item.label}</span><b>{item.percent}%</b></button>)}<small>642 votes · 2 days left</small></div>}
    <div className="post-actions">
      <div className="vote-control"><button disabled={votePending} className={post.voted === 1 ? "up active" : "up"} onClick={() => vote(post.id, 1)} aria-label="Upvote">↑</button><b>{formatNumber(post.votes)}</b><button disabled={votePending} className={post.voted === -1 ? "down active" : "down"} onClick={() => vote(post.id, -1)} aria-label="Downvote">↓</button></div>
      <button onClick={() => openComments(post.id)} aria-label={`Open ${post.comments} comments`}><MessageCircle size={18} />{post.comments} <span>comments</span></button>
      <button onClick={() => save(post.id)} className={post.saved ? "is-saved" : ""}><Bookmark size={18} fill={post.saved ? "currentColor" : "none"} /><span>{post.saved ? "Saved" : "Save"}</span></button>
      <button onClick={() => { navigator.clipboard?.writeText(`https://smartcampus.local/post/${post.id}`); notify("Post link copied"); }}><Share2 size={18} /><span>Share</span></button>
    </div>
  </article>;
}

function CommentThread({ post, user, close, onUpdated, notify }: { post: Post; user: SessionUser; close: () => void; onUpdated: (post: Post) => void; notify: (message: string) => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const comments = post.commentItems || [];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return setError("Write a reply before posting.");
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your reply could not be posted.");
      onUpdated(result.data.post as Post);
      setDraft("");
      notify("Reply posted");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your reply could not be posted.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="overlay comment-overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="comment-thread" role="dialog" aria-modal="true" aria-labelledby="comment-thread-title">
      <header><div><span className="eyebrow violet">{post.community} · DISCUSSION</span><h2 id="comment-thread-title">Join the conversation</h2></div><IconButton label="Close comments" onClick={close}><X size={20} /></IconButton></header>
      <div className="comment-scroll">
        <article className="comment-original"><div><Avatar text={post.community.slice(2, 4)} color={post.accent} size={36} /><span><b>{post.author}</b><small>{post.time}</small></span></div><h3>{post.title}</h3>{post.body && <p>{post.body}</p>}</article>
        <div className="comment-heading"><span><MessageCircle size={17} /><b>{post.comments}</b> {post.comments === 1 ? "reply" : "replies"}</span><small>Newest campus replies appear here</small></div>
        <div className="comment-list">
          {comments.length ? comments.map((comment) => <article className="comment-item" key={comment.id}><Avatar text={comment.author} color={comment.userId === user.id ? "#C6FF3E" : "#5FD7FF"} size={34} /><div><header><b>{comment.author}</b>{comment.userId === post.userId && <em>OP</em>}<time>{relativeTime(comment.createdAt)}</time></header><p>{comment.body}</p></div></article>) : <div className="comment-empty"><MessageCircle size={25} /><b>No stored replies yet</b><p>{post.comments ? "Earlier activity was counted before reply storage was enabled. Start the live thread below." : "Be the first person to reply to this post."}</p></div>}
        </div>
      </div>
      <form className="comment-form" onSubmit={submit}><Avatar text={user.username} image={user.avatarUrl} color="#FF5C8A" size={34} /><label><span className="sr-only">Write a reply</span><textarea autoFocus value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} maxLength={1_000} rows={2} placeholder={`Reply as ${user.username}…`} />{error && <small className="comment-error">{error}</small>}</label><button type="submit" disabled={busy || !draft.trim()}>{busy ? "Posting…" : <><Send size={16} /> Reply</>}</button><span className="comment-count">{draft.length}/1000</span></form>
    </section>
  </div>;
}

function relativeTime(createdAt: number) {
  const elapsed = Math.max(0, Date.now() - createdAt);
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

function ExploreView({ items, setItems, posts, setPosts, vote, votePending, notify, onMembership, onEvents, openComments, openComposer }: { items: Community[]; setItems: React.Dispatch<React.SetStateAction<Community[]>>; posts: Post[]; setPosts: React.Dispatch<React.SetStateAction<Post[]>>; vote: (id: number, direction: 1 | -1) => void; votePending: Set<number>; notify: (s: string) => void; onMembership: (community: Community) => Promise<void>; onEvents: () => void; openComments: (id: number) => void; openComposer: (community?: string) => void }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const filtered = items.filter(item => item.name.includes(query.toLowerCase()));
  const selectedCommunity = items.find(item => item.name === selectedName);
  if (selectedCommunity) return <CommunityDetail key={selectedCommunity.id} posts={posts} setPosts={setPosts} vote={vote} votePending={votePending} community={selectedCommunity} notify={notify} openComments={openComments} openComposer={() => openComposer(selectedCommunity.name)} goBack={() => setSelectedName(null)} toggleMembership={() => void onMembership(selectedCommunity)} onUpdated={(updated) => setItems((current) => current.map((item) => item.id === updated.id ? updated : item))} />;
  return <div className="content-page">
    <section className="page-hero explore-hero"><div><span className="eyebrow lime">FIND YOUR PEOPLE</span><h1>Campus is better together.</h1><p>Clubs, obsessions, niche questions and the people who get it.</p></div><span className="hero-sticker">COME<br />HANG<br />OUT <i>→</i></span></section>
    <div className="explore-toolbar"><label><Search size={20} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search communities" /></label><div className="toolbar-actions"><button className="outline-button" onClick={onEvents}><CalendarDays size={19} /> Browse events</button><button className="primary-action" onClick={() => setCreating(true)}><Plus size={19} /> Create community</button></div></div>
    <div className="category-chips">{["All", "Campus life", "Creative", "Tech", "Sports", "Culture", "Food"].map((x, i) => <button className={i === 0 ? "active" : ""} key={x}>{x}</button>)}</div>
    <div className="community-grid">{filtered.map((item, index) => <article key={item.id} style={{ "--accent": item.color } as React.CSSProperties}>
      <button className="community-card-link" aria-label={`Open ${item.name}`} onClick={() => setSelectedName(item.name)} />
      <div className="community-art">{item.bannerUrl ? <Image src={item.bannerUrl} alt={`${item.name} banner`} fill sizes="370px" unoptimized /> : <><span>{item.emoji}</span><i>{index % 2 ? "✦ ✦" : "〰 〰"}</i></>}</div><Avatar text={item.emoji} image={item.iconUrl} color={item.color} size={54} />
      <h2>{item.name}</h2><p>{item.description}</p>
      <div><span><Users size={16} /> {item.members}</span><button className={item.joined ? "joined" : ""} onClick={() => void onMembership(item)}>{item.joined ? <><Check size={16} /> Joined</> : "Join"}</button></div>
    </article>)}</div>
    {creating && <CreateCommunityModal existingNames={items.map(item => item.name)} close={() => setCreating(false)} onCreate={(community) => { setItems(current => [community, ...current]); setCreating(false); setQuery(""); notify(`${community.name} is live — you’re the first member!`); }} />}
  </div>;
}

function CommunityDetail({ community, posts, setPosts, vote, votePending, goBack, toggleMembership, notify, openComments, openComposer, onUpdated }: { community: Community; posts: Post[]; setPosts: React.Dispatch<React.SetStateAction<Post[]>>; vote: (id: number, direction: 1 | -1) => void; votePending: Set<number>; goBack: () => void; toggleMembership: () => void; notify: (message: string) => void; openComments: (id: number) => void; openComposer: () => void; onUpdated: (community: Community) => void }) {
  const [sort, setSort] = useState("Hot");
  const [brandingOpen, setBrandingOpen] = useState(false);
  const communityPosts = posts.filter(post => post.communityId === community.id);

  function save(id: number) {
    setPosts(current => current.map(post => post.id === id ? { ...post, saved: !post.saved } : post));
    notify("Saved to your collection");
  }

  return <div className="content-page community-detail-page">
    <button className="back-button" onClick={goBack}><ArrowRight size={17} /> Back to communities</button>
    <section className="community-detail-hero" style={{ "--community-color": community.color } as React.CSSProperties}>
      <div className={`community-detail-pattern ${community.bannerUrl ? "has-image" : ""}`}>{community.bannerUrl ? <Image src={community.bannerUrl} alt={`${community.name} banner`} fill sizes="1120px" unoptimized /> : <>〰 &nbsp; ✦ &nbsp; 〰 &nbsp; ✦</>}</div>
      <div className="community-detail-identity"><Avatar text={community.emoji} image={community.iconUrl} color={community.color} size={84} /><div><span className="eyebrow lime">{community.privacy || "public"} community</span><h1>{community.name}</h1><p>{community.description}</p></div><div className="community-detail-actions">{community.role === "ADMIN" && <button className="branding-button" onClick={() => setBrandingOpen(true)}><Settings size={17} /> Branding</button>}<button className={community.joined ? "joined" : ""} onClick={toggleMembership}>{community.joined ? <><Check size={17} /> Joined</> : <><Plus size={17} /> Join community</>}</button><button onClick={openComposer}><Plus size={17} /> Create post</button></div></div>
    </section>
    <div className="community-stats"><span><b>{community.members}</b><small>Members</small></span><span><b>{communityPosts.length}</b><small>Posts</small></span><span><b>{communityPosts.reduce((total, post) => total + post.votes, 0).toLocaleString()}</b><small>Community karma</small></span></div>
    <div className="community-feed-layout"><section><div className="community-feed-head"><div><span className="eyebrow violet">COMMUNITY FEED</span><h2>Latest from {community.name}</h2></div><div className="category-chips">{["Hot", "New", "Top"].map(item => <button className={sort === item ? "active" : ""} onClick={() => setSort(item)} key={item}>{item}</button>)}</div></div>{communityPosts.length ? <div className="feed-list">{communityPosts.map((post, index) => <PostCard key={post.id} post={post} index={index} vote={vote} votePending={votePending.has(post.id)} save={save} openComments={openComments} notify={notify} />)}</div> : <div className="community-empty"><span>{community.emoji}</span><h3>Be the first to post here.</h3><p>This community is fresh. Start the conversation and set the tone.</p><button onClick={openComposer}><Plus size={17} /> Create the first post</button></div>}</section><aside className="community-about"><span className="eyebrow cyan">ABOUT</span><h3>{community.name}</h3><p>{community.description}</p><div><b>Created</b><span>August 2026</span></div><div><b>Visibility</b><span>{community.privacy || "Public"}</span></div><button><ShieldCheck size={17} /> Community rules</button></aside></div>
    {brandingOpen && <CommunityBrandingModal community={community} close={() => setBrandingOpen(false)} onUpdated={onUpdated} notify={notify} />}
  </div>;
}

function CommunityBrandingModal({ community, close, onUpdated, notify }: { community: Community; close: () => void; onUpdated: (community: Community) => void; notify: (message: string) => void }) {
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState("");
  const [bannerPreview, setBannerPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

  useEffect(() => () => { if (iconPreview) URL.revokeObjectURL(iconPreview); }, [iconPreview]);
  useEffect(() => () => { if (bannerPreview) URL.revokeObjectURL(bannerPreview); }, [bannerPreview]);

  function chooseImage(kind: "icon" | "banner", file?: File) {
    if (!file) return;
    setError("");
    if (!supportedTypes.has(file.type)) return setError("Choose a JPG, PNG, or WebP image.");
    const limit = kind === "icon" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > limit) return setError(`${kind === "icon" ? "Community icons" : "Community banners"} must be ${kind === "icon" ? "2" : "5"} MB or smaller.`);
    const preview = URL.createObjectURL(file);
    if (kind === "icon") {
      setIconFile(file);
      setIconPreview(preview);
    } else {
      setBannerFile(file);
      setBannerPreview(preview);
    }
  }

  async function upload(kind: "icon" | "banner", file: File) {
    const form = new FormData();
    form.set(kind, file);
    const data = await requestJson<{ community: Community; imageUrl: string }>(`/api/communities/${community.id}/${kind}`, { method: "POST", body: form });
    if (!data?.community) throw new Error(`The server did not return the updated community ${kind}.`);
    onUpdated(data.community);
    return data.community;
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!iconFile && !bannerFile) return setError("Choose an icon, a banner, or both before saving.");
    setBusy(true);
    setError("");
    try {
      if (bannerFile) await upload("banner", bannerFile);
      if (iconFile) await upload("icon", iconFile);
      notify("Community branding updated");
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update community branding.");
    } finally {
      setBusy(false);
    }
  }

  const visibleIcon = iconPreview || community.iconUrl;
  const visibleBanner = bannerPreview || community.bannerUrl;

  return <div className="overlay community-branding-overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <form className="creation-modal community-branding-modal" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="community-branding-title">
      <header><div><span className="eyebrow cyan">COMMUNITY SETTINGS</span><h2 id="community-branding-title">Brand {community.name}</h2><p>Give your community a recognizable icon and banner.</p></div><IconButton label="Close branding settings" onClick={close}><X size={20} /></IconButton></header>
      <div className="branding-preview" style={{ "--branding-color": community.color } as React.CSSProperties}>
        <label className="banner-upload-zone">{visibleBanner ? <Image src={visibleBanner} alt="Community banner preview" fill sizes="680px" unoptimized /> : <span><ImagePlus size={28} /><b>Banner image</b><small>Wide 3:1 preview · JPG, PNG or WebP · max 5 MB</small></span>}<em><ImagePlus size={15} /> {bannerFile || community.bannerUrl ? "Change banner" : "Upload banner"}</em><input className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseImage("banner", event.target.files?.[0])} /></label>
        <label className="icon-upload-zone">{visibleIcon ? <Image src={visibleIcon} alt="Community icon preview" fill sizes="112px" unoptimized /> : <span>{community.emoji}</span>}<em><ImagePlus size={14} /> Icon</em><input className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseImage("icon", event.target.files?.[0])} /></label>
      </div>
      <div className="branding-specs"><div><b>Community icon</b><small>Square 1:1 image · maximum 2 MB</small></div><div><b>Community banner</b><small>Recommended 1500 × 500 · maximum 5 MB</small></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="draft-button" onClick={close} disabled={busy}>Cancel</button><button className="post-button" type="submit" disabled={busy || (!iconFile && !bannerFile)}>{busy ? <><LoaderCircle className="spin" size={17} /> Saving…</> : <>Save branding <ArrowRight size={17} /></>}</button></footer>
    </form>
  </div>;
}

function EventsView({ events, communities, defaultCampus, onEvent, onCreated, notify }: { events: CampusEvent[]; communities: Community[]; defaultCampus: string; onEvent: (e: CampusEvent) => void; onCreated: (event: CampusEvent) => void; notify: (message: string) => void }) {
  const [filter, setFilter] = useState("All");
  const [creating, setCreating] = useState(false);
  const filtered = filter === "All" ? events : events.filter(event => event.category === filter);
  return <div className="content-page">
    <section className="page-hero events-hero"><div><span className="eyebrow pink">GET OUT THERE</span><h1>Plans worth leaving your room for.</h1><p>From tiny workshops to very loud nights.</p></div><div className="ticket-doodle"><span>ADMIT<br />ONE</span><b>SC-0826</b></div></section>
    <div className="events-toolbar"><div className="category-chips">{["All", "Music", "Tech", "Culture", "Sports"].map(x => <button className={filter === x ? "active" : ""} onClick={() => setFilter(x)} key={x}>{x}</button>)}</div><div className="toolbar-actions"><button className="outline-button"><CalendarDays size={18} /> This month <ChevronDown size={15} /></button><button className="primary-action" onClick={() => setCreating(true)}><Plus size={18} /> Create event</button></div></div>
    <div className="event-grid">{filtered.map(event => <article key={event.id} onClick={() => onEvent(event)} tabIndex={0} onKeyDown={e => e.key === "Enter" && onEvent(event)}><div className="event-image"><Image src={event.imageUrl} alt="" fill sizes="(max-width: 700px) 100vw, 420px" unoptimized={event.imageUrl.startsWith("/api/")} /><span>{event.isCreator ? "YOUR EVENT" : event.isEventAdmin ? "ADMIN" : event.category}</span><div><b>{event.day}</b><small>{event.month}</small></div></div><div className="event-copy"><h2>{event.title}</h2><p><Clock3 size={16} /> {event.month} {event.day} · {event.time}</p><p><MapPin size={16} /> {event.location}</p><div><span className="face-stack"><i>KA</i><i>ZO</i><i>MI</i></span><small>{event.going} going{event.waitlisted ? ` · ${event.waitlisted} waitlisted` : ""}</small><button>View event <ArrowRight size={16} /></button></div></div></article>)}</div>
    {!filtered.length && <div className="events-empty"><CalendarDays size={31} /><h2>No events here yet</h2><p>Publish the first event in this category.</p></div>}
    {creating && <CreateEventModal communities={communities} defaultCampus={defaultCampus} close={() => setCreating(false)} onCreate={(event) => { onCreated(event); setCreating(false); setFilter("All"); notify("Event published to the global campus feed"); }} />}
  </div>;
}

function CreateCommunityModal({ close, onCreate, existingNames }: { close: () => void; onCreate: (community: Community) => void; existingNames: string[] }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("✨");
  const [color, setColor] = useState("#6C3BFF");
  const [privacy, setPrivacy] = useState<"public" | "restricted" | "private">("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (slug.length < 3) return setError("Community names need at least 3 letters or numbers.");
    if (description.trim().length < 12) return setError("Add a short description so people know what this community is about.");
    if (existingNames.includes(`c/${slug}`)) return setError("That community name is already taken.");
    setBusy(true);
    setError("");
    try {
      const data = await requestJson<{ community: Community }>("/api/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: slug, description: description.trim(), emoji: emoji.trim() || "✨", color, privacy }),
      });
      if (!data?.community) throw new Error("The server did not return the new community.");
      onCreate(data.community);
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : "Could not create this community.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && close()}>
    <form className="creation-modal community-creation" onSubmit={submit} aria-label="Create a community">
      <header><div><span className="eyebrow cyan">BUILD YOUR CORNER</span><h2>Create a community</h2><p>Start a space for the people, ideas, or oddly specific thing you care about.</p></div><IconButton label="Close" onClick={close}><X size={20} /></IconButton></header>
      <div className="community-preview" style={{ "--preview-color": color } as React.CSSProperties}><span>{emoji || "✨"}</span><div><small>YOUR NEW COMMUNITY</small><b>c/{slug || "community-name"}</b></div><i>✦</i></div>
      <label className="field"><span>Community name</span><div className="slug-input"><b>c/</b><input autoFocus value={name} onChange={event => { setName(event.target.value); setError(""); }} placeholder="design-nerds" maxLength={30} required /></div><small>Letters, numbers, and hyphens. This can&apos;t be changed later.</small></label>
      <label className="field"><span>Description</span><textarea value={description} onChange={event => { setDescription(event.target.value); setError(""); }} rows={3} maxLength={180} placeholder="What will people find here?" required /><small>{description.length}/180</small></label>
      <div className="form-row"><label className="field emoji-field"><span>Icon</span><input value={emoji} onChange={event => setEmoji(event.target.value)} maxLength={3} aria-label="Community emoji" /></label><fieldset className="field color-field"><legend>Sticker color</legend><div>{["#6C3BFF", "#22D3EE", "#FF5C8A", "#C7FF32", "#FFB629"].map(item => <button type="button" aria-label={`Use ${item}`} aria-pressed={color === item} className={color === item ? "selected" : ""} style={{ background: item }} onClick={() => setColor(item)} key={item}>{color === item && <Check size={15} />}</button>)}</div></fieldset></div>
      <fieldset className="privacy-options"><legend>Who can join?</legend>{([
        ["public", "Public", "Anyone can view, post, and join."],
        ["restricted", "Restricted", "Anyone can view; approved members can post."],
        ["private", "Private", "Only invited members can view and participate."],
      ] as const).map(([value, title, copy]) => <button type="button" className={privacy === value ? "selected" : ""} onClick={() => setPrivacy(value)} key={value}><i>{privacy === value && <Check size={13} />}</i><span><b>{title}</b><small>{copy}</small></span></button>)}</fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="draft-button" onClick={close} disabled={busy}>Cancel</button><button className="post-button" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} /> Creating…</> : <>Create community <ArrowRight size={17} /></>}</button></footer>
    </form>
  </div>;
}

function formItemId() {
  return globalThis.crypto.randomUUID();
}

function RegistrationFormBuilder({ fields, onChange }: { fields: CustomFormField[]; onChange: (fields: CustomFormField[]) => void }) {
  function add(type: CustomFormField["type"]) {
    const shared = { id: formItemId(), label: "", required: false };
    const field: CustomFormField = type === "select"
      ? { ...shared, type, options: [{ id: formItemId(), label: "Option 1", value: formItemId() }, { id: formItemId(), label: "Option 2", value: formItemId() }] }
      : type === "number" ? { ...shared, type }
      : type === "checkbox" ? { ...shared, type }
      : { ...shared, type, placeholder: "" };
    onChange([...fields, field]);
  }

  function update(id: string, changes: Partial<CustomFormField>) {
    onChange(fields.map((field) => field.id === id ? { ...field, ...changes } as CustomFormField : field));
  }

  function updateOption(field: Extract<CustomFormField, { type: "select" }>, optionId: string, label: string) {
    update(field.id, { options: field.options.map((option) => option.id === optionId ? { ...option, label } : option) } as Partial<CustomFormField>);
  }

  return <section className="form-builder">
    <header><div><span className="eyebrow violet">REGISTRATION FORM</span><h3>Ask attendees what you need</h3><p>Build a lightweight form. Required answers are checked before an RSVP is accepted.</p></div><b>{fields.length}/30</b></header>
    {fields.length > 0 && <div className="form-builder-list">{fields.map((field, index) => <article key={field.id}>
      <div className="form-builder-question-head"><span>{index + 1}</span><b>{field.type.replace("_", " ")}</b><button type="button" onClick={() => onChange(fields.filter((item) => item.id !== field.id))} aria-label={`Remove question ${index + 1}`}><X size={15} /></button></div>
      <label className="field"><span>Question</span><input value={field.label} onChange={event => update(field.id, { label: event.target.value })} maxLength={120} placeholder={field.type === "checkbox" ? "I agree to the event guidelines" : "What would you like to ask?"} required /></label>
      {(field.type === "short_text" || field.type === "long_text") && <label className="field"><span>Placeholder <em>Optional</em></span><input value={field.placeholder || ""} onChange={event => update(field.id, { placeholder: event.target.value })} maxLength={160} placeholder="Helpful example or hint" /></label>}
      {field.type === "number" && <div className="form-row"><label className="field"><span>Minimum <em>Optional</em></span><input type="number" value={field.min ?? ""} onChange={event => update(field.id, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></label><label className="field"><span>Maximum <em>Optional</em></span><input type="number" value={field.max ?? ""} onChange={event => update(field.id, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></label></div>}
      {field.type === "select" && <div className="builder-options"><span>Dropdown options</span>{field.options.map((option, optionIndex) => <div key={option.id}><input value={option.label} onChange={event => updateOption(field, option.id, event.target.value)} maxLength={120} aria-label={`Option ${optionIndex + 1}`} required /><button type="button" disabled={field.options.length <= 2} onClick={() => update(field.id, { options: field.options.filter((item) => item.id !== option.id) } as Partial<CustomFormField>)} aria-label={`Remove option ${optionIndex + 1}`}><X size={14} /></button></div>)}<button type="button" disabled={field.options.length >= 50} onClick={() => update(field.id, { options: [...field.options, { id: formItemId(), label: `Option ${field.options.length + 1}`, value: formItemId() }] } as Partial<CustomFormField>)}><Plus size={14} /> Add option</button></div>}
      <label className="builder-required"><input type="checkbox" checked={field.required} onChange={event => update(field.id, { required: event.target.checked })} /><span>Required question</span></label>
    </article>)}</div>}
    {!fields.length && <div className="form-builder-empty"><Plus size={22} /><b>No custom questions yet</b><small>Attendees can RSVP with one tap, or you can add questions below.</small></div>}
    <div className="form-builder-tools"><span>Add question</span><div>{([ ["short_text", "Short text"], ["long_text", "Long text"], ["number", "Number"], ["select", "Dropdown"], ["checkbox", "Checkbox"] ] as const).map(([type, label]) => <button type="button" onClick={() => add(type)} disabled={fields.length >= 30} key={type}><Plus size={14} /> {label}</button>)}</div></div>
  </section>;
}

function CreateEventModal({ communities, defaultCampus, close, onCreate }: { communities: Community[]; defaultCampus: string; close: () => void; onCreate: (event: CampusEvent) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Music");
  const [date, setDate] = useState(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [time, setTime] = useState("18:00");
  const [location, setLocation] = useState("");
  const [directionsUrl, setDirectionsUrl] = useState("");
  const [capacity, setCapacity] = useState("100");
  const [community, setCommunity] = useState("None");
  const [campus, setCampus] = useState(defaultCampus);
  const [linkPost, setLinkPost] = useState(true);
  const [customFormFields, setCustomFormFields] = useState<CustomFormField[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const coverInput = useRef<HTMLInputElement>(null);
  const defaultImages: Record<string, string> = { Music: "/indie-night.svg", Tech: "/build-weird.svg", Culture: "/thrift-market.svg", Sports: "/run-club.svg", Other: "/campus-rain.svg" };
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minimumDate = tomorrow.toISOString().slice(0, 10);

  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  function chooseCover(file?: File) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) return setError("Choose a JPG, PNG, or WebP image.");
    if (file.size > 5 * 1024 * 1024) return setError("Event images must be 5 MB or smaller.");
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCover(file);
    setCoverPreview(URL.createObjectURL(file));
    setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = new Date(`${date}T${time}`);
    const eventCapacity = Number(capacity);
    if (!title.trim() || !location.trim() || !date) return setError("Add a title, date, and venue before publishing.");
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return setError("Choose a future date and time.");
    if (!Number.isInteger(eventCapacity) || eventCapacity < 1) return setError("Capacity must be a positive whole number.");
    setBusy(true);
    setError("");
    try {
      let imageUrl = defaultImages[category] || "/campus-rain.svg";
      if (cover) {
        const form = new FormData();
        form.append("image", cover);
        const uploaded = await requestJson<{ imageUrl: string }>("/api/events/images", { method: "POST", body: form });
        if (!uploaded?.imageUrl) throw new Error("The image server did not return a URL.");
        imageUrl = uploaded.imageUrl;
      }
      const data = await requestJson<{ event: CampusEvent }>("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), category, location: location.trim(), venueName: location.trim(), venueAddress: location.trim(), directionsUrl: directionsUrl.trim(), campus, community, startsAt: start.toISOString(), capacity: eventCapacity, imageUrl, customFormSchema: { version: 1, fields: customFormFields } }),
      });
      if (!data?.event) throw new Error("The event server did not return the published event.");
      onCreate(data.event);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Could not publish this event.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && close()}>
    <form className="creation-modal event-creation" onSubmit={submit} aria-label="Create an event">
      <header><div><span className="eyebrow pink">MAKE PLANS HAPPEN</span><h2>Create an event</h2><p>Publish it to campus and manage RSVPs from one place.</p></div><IconButton label="Close" onClick={close}><X size={20} /></IconButton></header>
      <div className="event-form-banner"><Image src={coverPreview || defaultImages[category] || "/campus-rain.svg"} alt="Event cover preview" fill sizes="640px" unoptimized={Boolean(coverPreview)} /><span>{category}</span><input ref={coverInput} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseCover(event.target.files?.[0])} /><button type="button" onClick={() => coverInput.current?.click()}><ImagePlus size={17} /> {cover ? "Change cover" : "Upload cover"}</button></div>
      <label className="field"><span>Event title</span><input autoFocus value={title} onChange={event => { setTitle(event.target.value); setError(""); }} maxLength={90} placeholder="Give people a reason to show up" required /></label>
      <label className="field"><span>Description</span><textarea value={description} onChange={event => { setDescription(event.target.value); setError(""); }} rows={3} maxLength={2000} placeholder="Tell campus what to expect" /><small>{description.length}/2000</small></label>
      <div className="form-row"><label className="field"><span>Category</span><select value={category} onChange={event => setCategory(event.target.value)}>{["Music", "Tech", "Culture", "Sports", "Other"].map(item => <option key={item}>{item}</option>)}</select></label><label className="field"><span>Capacity</span><input type="number" min="1" max="10000" value={capacity} onChange={event => setCapacity(event.target.value)} required /></label></div>
      <div className="form-row"><label className="field"><span>Date</span><input type="date" min={minimumDate} value={date} onChange={event => { setDate(event.target.value); setError(""); }} required /></label><label className="field"><span>Start time</span><input type="time" value={time} onChange={event => setTime(event.target.value)} required /></label></div>
      <label className="field"><span>Venue</span><div className="icon-input"><MapPin size={17} /><input value={location} onChange={event => { setLocation(event.target.value); setError(""); }} placeholder="e.g. Main Auditorium" required /></div></label>
      <label className="field directions-field"><span>Google Maps directions link <em>Optional</em></span><div className="icon-input"><Link2 size={17} /><input type="url" inputMode="url" value={directionsUrl} onChange={event => { setDirectionsUrl(event.target.value); setError(""); }} placeholder="https://maps.app.goo.gl/..." maxLength={2048} /></div><small>In Google Maps, open the venue, tap Share, and paste the link here.</small></label>
      <CampusPicker value={campus} onChange={setCampus} label="Host campus" required />
      <label className="field"><span>Community</span><select value={community} onChange={event => setCommunity(event.target.value)}><option>None</option>{communities.map(item => <option key={item.id}>{item.name}</option>)}</select></label>
      <label className="check-field"><input type="checkbox" checked={linkPost} onChange={event => setLinkPost(event.target.checked)} /><span><b>Create an event post</b><small>{community === "None" ? "Share it to the campus feed when published." : `Share it in ${community} when published.`}</small></span></label>
      <RegistrationFormBuilder fields={customFormFields} onChange={setCustomFormFields} />
      <div className="disclosure"><ShieldCheck size={19} /><p>Attendees will see that their verified email and RSVP details are shared with you as the organizer.</p></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="draft-button" onClick={close} disabled={busy}>Cancel</button><button className="post-button" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} /> Publishing…</> : <>Publish event <ArrowRight size={17} /></>}</button></footer>
    </form>
  </div>;
}

function RewardsView({ user, notify }: { user: SessionUser; notify: (s: string) => void }) {
  const [claimed, setClaimed] = useState(false);
  const premiumRemaining = Math.max(0, 60 - user.points);
  const invitesRemaining = Math.ceil(premiumRemaining / 10);
  const referralCount = Math.floor(user.points / 10);
  const rewardProgress = Math.min(100, user.points / 60 * 100);
  return <div className="content-page rewards-page">
    <section className="rewards-hero"><div><span className="eyebrow lime">REFER · EARN · REPEAT</span><h1>Good friends<br />bring rewards.</h1><p>You&apos;ve earned <b>{user.points} points</b> so far. {premiumRemaining ? `${invitesRemaining} more verified ${invitesRemaining === 1 ? "invite unlocks" : "invites unlock"} Smart Campus Premium.` : "You have unlocked the Premium reward milestone."}</p><button onClick={() => { navigator.clipboard?.writeText(user.referralCode); notify("Referral code copied"); }}><Copy size={18} /> Copy referral code</button><button onClick={() => { navigator.clipboard?.writeText(`Join me on IB Smart Campus with referral code ${user.referralCode}`); notify("Referral message copied"); }}><Share2 size={18} /> Copy message</button></div><div className="reward-burst"><span>{user.points}</span><small>POINTS</small><i>✦</i></div></section>
    <div className="rewards-grid">
      <section className="reward-card journey"><div className="section-heading"><div><span className="eyebrow violet">YOUR JOURNEY</span><h2>{premiumRemaining ? "Next stop: Premium" : "Premium milestone reached"}</h2></div><b>{user.points} / 60</b></div><div className="big-progress"><i style={{ width: `${rewardProgress}%` }} /><span style={{ left: `${rewardProgress}%` }}>YOU</span></div><div className="milestones"><span className={user.points >= 10 ? "done" : ""}><i>{user.points >= 10 ? <Check size={15} /> : null}</i><b>10</b><small>Early bird</small></span><span className={user.points >= 30 ? "done" : ""}><i>{user.points >= 30 ? <Check size={15} /> : null}</i><b>30</b><small>Connector</small></span><span className={user.points >= 60 ? "done" : ""}><i>{user.points >= 60 ? <Check size={15} /> : <Trophy size={16} />}</i><b>60</b><small>Premium</small></span><span className={user.points >= 100 ? "done" : ""}><i>{user.points >= 100 ? <Check size={15} /> : <Star size={16} />}</i><b>100</b><small>Legend</small></span></div></section>
      <section className="reward-card voucher"><span className="eyebrow pink">{user.points >= 60 ? "READY TO CLAIM" : "LOCKED FOR NOW"}</span><Gift size={38} /><h2>30 days Premium</h2><p>Custom profile flair, priority event access and a shiny badge.</p><button disabled={user.points < 60 || claimed} onClick={() => setClaimed(true)}>{claimed ? "Claimed" : user.points >= 60 ? "Claim reward" : "Unlock at 60 points"}</button></section>
      <section className="reward-card invite-card"><span className="eyebrow cyan">YOUR UNIQUE CODE</span><div className="referral-code-display"><small>SHARE THIS REFERRAL CODE</small><strong>{user.referralCode}</strong></div><button onClick={() => { navigator.clipboard?.writeText(user.referralCode); notify("Referral code copied"); }}><Copy size={17} /> Copy code</button></section>
      <section className="reward-card activity"><div className="section-heading"><div><span className="eyebrow violet">REFERRAL ACTIVITY</span><h2>Your invites</h2></div></div><div><Avatar text="IB" color="#6C3BFF" /><span><b>{referralCount ? `${referralCount} verified ${referralCount === 1 ? "referral" : "referrals"}` : "No verified referrals yet"}</b><small>Each successful referral earns you 10 points.</small></span><strong>{user.points ? `+${user.points}` : "0"}</strong></div></section>
    </div>
  </div>;
}

function ChatView({ user, notify, onDiscover }: { user: SessionUser; notify: (s: string) => void; onDiscover: () => void }) {
  const [mode, setMode] = useState<"chats" | "requests">("chats");
  const [inbox, setInbox] = useState<DirectConversation[]>([]);
  const [chatRequests, setChatRequests] = useState<ChatRequestView[]>([]);
  const [followRequests, setFollowRequests] = useState<FollowRequestView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const endRef = useRef<HTMLDivElement>(null);

  const refreshInbox = useCallback(async () => {
    try {
      const [conversationData, chatData, followData] = await Promise.all([
        requestJson<{ conversations: DirectConversation[] }>("/api/conversations", { cache: "no-store" }),
        requestJson<{ requests: ChatRequestView[] }>("/api/chat-requests", { cache: "no-store" }),
        requestJson<{ requests: FollowRequestView[] }>("/api/follows/requests", { cache: "no-store" }),
      ]);
      const nextInbox = conversationData?.conversations || [];
      setInbox(nextInbox);
      setChatRequests(chatData?.requests || []);
      setFollowRequests(followData?.requests || []);
      setSelectedId((current) => nextInbox.some((item) => item.id === current) ? current : nextInbox[0]?.id || "");
    } catch (loadError) {
      notify(loadError instanceof Error ? loadError.message : "Could not load messages.");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshInbox(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshInbox]);

  const selected = inbox.find((item) => item.id === selectedId);
  const visibleInbox = inbox.filter((item) => item.otherUser.username.toLowerCase().includes(filter.trim().toLowerCase()));
  const requestCount = chatRequests.length + followRequests.length;

  async function send() {
    const message = draft.trim();
    if (!selected || !message) return;
    setBusyIds((current) => new Set(current).add(selected.id));
    try {
      const data = await requestJson<{ message: DirectConversation["messages"][number] }>(`/api/conversations/${selected.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }),
      });
      if (!data?.message) throw new Error("The server did not return your message.");
      setInbox((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, messages: [...conversation.messages, data.message], updatedAt: data.message.createdAt } : conversation));
      setDraft("");
      window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
    } catch (sendError) {
      notify(sendError instanceof Error ? sendError.message : "Could not send your message.");
    } finally {
      setBusyIds((current) => { const next = new Set(current); next.delete(selected.id); return next; });
    }
  }

  async function resolveRequest(kind: "chat" | "follow", id: string, decision: "accepted" | "rejected") {
    setBusyIds((current) => new Set(current).add(id));
    try {
      await requestJson(`/api/${kind === "chat" ? "chat-requests" : "follows/requests"}/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      notify(`${kind === "chat" ? "Message" : "Follow"} request ${decision}`);
      await refreshInbox();
      if (kind === "chat" && decision === "accepted") setMode("chats");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "Could not update the request.");
    } finally {
      setBusyIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  }

  return <div className={`chat-page ${mode === "requests" ? "requests-mode" : ""}`}>
    <aside className="conversation-list">
      <div className="chat-list-head"><div><span className="eyebrow cyan">STAY CLOSE</span><h1>Messages</h1></div><IconButton label="Find people" onClick={onDiscover}><UserPlus size={21} /></IconButton></div>
      <nav className="inbox-tabs" aria-label="Message inbox"><button className={mode === "chats" ? "active" : ""} onClick={() => setMode("chats")}><MessageCircle size={15} /> Chats</button><button className={mode === "requests" ? "active" : ""} onClick={() => setMode("requests")}><Inbox size={15} /> Requests {requestCount > 0 && <i>{requestCount}</i>}</button></nav>
      {mode === "chats" && <><label><Search size={18} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search messages" /></label>{visibleInbox.map((item) => { const last = item.messages.at(-1); return <button className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)} key={item.id}><Avatar text={item.otherUser.username} image={item.otherUser.avatarUrl} color="#6C3BFF" size={45} /><span><b>{item.otherUser.username}</b><small>{last?.body || "Conversation started"}</small></span><em>{relativeTime(item.updatedAt)}</em></button>; })}{!loading && !visibleInbox.length && <div className="conversation-empty"><MessageCircle size={24} /><b>No conversations yet</b><small>Find someone and send one thoughtful request.</small></div>}</>}
      {mode === "requests" && <div className="request-sidebar-summary"><Inbox size={26} /><b>{requestCount} pending</b><small>Review requests in the main panel.</small></div>}
    </aside>

    {mode === "requests" ? <section className="thread request-thread"><header><button className="mobile-back-to-chats" onClick={() => setMode("chats")}><ArrowRight size={17} /> Chats</button><div><b>Requests</b><small>Only you can accept or reject these</small></div></header><div className="request-inbox">
      <div className="request-section-heading"><div><span className="eyebrow violet">MESSAGE REQUESTS</span><h2>New conversations</h2></div><b>{chatRequests.length}</b></div>
      {chatRequests.map((request) => <article className="request-card" key={request.id}><Avatar text={request.sender.username} image={request.sender.avatarUrl} color="#6C3BFF" size={48} /><div><header><b>{request.sender.username}</b><span>{request.sender.isPrivate ? <><LockKeyhole size={12} /> Private</> : <><Globe2 size={12} /> Public</>}</span></header><p>{request.initialMessage}</p><small>{relativeTime(request.createdAt)}</small></div><footer><button disabled={busyIds.has(request.id)} onClick={() => resolveRequest("chat", request.id, "rejected")}>Reject</button><button disabled={busyIds.has(request.id)} onClick={() => resolveRequest("chat", request.id, "accepted")}><Check size={15} /> Accept</button></footer></article>)}
      {!loading && !chatRequests.length && <div className="request-empty"><MessageSquare size={27} /><b>No message requests</b><p>New requests and their one initial message will appear here.</p></div>}
      <div className="request-section-heading follow-heading"><div><span className="eyebrow cyan">FOLLOW REQUESTS</span><h2>Private profile requests</h2></div><b>{followRequests.length}</b></div>
      {followRequests.map((request) => <article className="request-card follow-request-card" key={request.id}><Avatar text={request.sender.username} image={request.sender.avatarUrl} color="#22D3EE" size={48} /><div><header><b>{request.sender.username}</b></header><p>Wants to follow your private profile.</p><small>{relativeTime(request.createdAt)}</small></div><footer><button disabled={busyIds.has(request.id)} onClick={() => resolveRequest("follow", request.id, "rejected")}>Reject</button><button disabled={busyIds.has(request.id)} onClick={() => resolveRequest("follow", request.id, "accepted")}><UserCheck size={15} /> Accept</button></footer></article>)}
      {!loading && !followRequests.length && <div className="request-empty compact"><UserPlus size={25} /><b>No follow requests</b></div>}
    </div></section> : selected ? <section className="thread"><header><Avatar text={selected.otherUser.username} image={selected.otherUser.avatarUrl} color="#6C3BFF" size={42} /><div><b>{selected.otherUser.username}</b><small>{selected.otherUser.isPrivate ? "Private profile" : "Connected on Smart Campus"}</small></div><button className="thread-request-button" onClick={() => setMode("requests")}><Inbox size={17} />{requestCount > 0 && <i>{requestCount}</i>}</button><IconButton label="Conversation details"><Menu size={20} /></IconButton></header><div className="message-scroll"><div className="day-marker"><span>Conversation</span></div><div className="thread-start"><Avatar text={selected.otherUser.username} image={selected.otherUser.avatarUrl} color="#6C3BFF" size={58} /><h2>{selected.otherUser.username}</h2><p>You accepted a connection request. You can now message each other.</p></div>{selected.messages.map((message) => <div className={`bubble-row ${message.senderId === user.id ? "mine" : ""}`} key={message.id}>{message.senderId !== user.id && <Avatar text={selected.otherUser.username} image={selected.otherUser.avatarUrl} color="#6C3BFF" size={29} />}<div className="message-bubble">{message.body}</div><time>{relativeTime(message.createdAt)}</time></div>)}<div ref={endRef} /></div><footer><IconButton label="Add attachment"><Plus size={21} /></IconButton><label><textarea rows={1} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={`Message ${selected.otherUser.username}`} /></label><button className="send-button" disabled={!draft.trim() || busyIds.has(selected.id)} onClick={() => void send()}><Send size={19} /></button></footer></section> : <section className="thread empty-thread"><button className="thread-request-button empty-request-button" onClick={() => setMode("requests")}><Inbox size={18} /> Requests {requestCount > 0 && <i>{requestCount}</i>}</button><MessageCircle size={46} /><h2>Your conversations live here</h2><p>Search for a campus user and send one initial message to connect.</p><button className="primary-action" onClick={onDiscover}><UserPlus size={17} /> Find people</button></section>}
  </div>;
}

function ProfileView({ user, dashboard, theme, toggleTheme, privacyPending, onPrivacyChange, onRewards, onEdit, onLogout }: { user: SessionUser; dashboard: UserDashboard | null; theme: string; toggleTheme: () => void; privacyPending: boolean; onPrivacyChange: (isPrivate: boolean) => void; onRewards: () => void; onEdit: () => void; onLogout: () => void }) {
  const metric = (value?: number) => value === undefined ? "—" : value.toLocaleString();
  return <div className="content-page profile-page">
    <section className="profile-banner"><div className="profile-pattern">✦ &nbsp; 〰 &nbsp; ★ &nbsp; 〰 &nbsp; ✦</div><div className="profile-identity"><Avatar text={user.username} image={user.avatarUrl} color="#FF5C8A" size={92} /><div><span className="eyebrow lime">CAMPUS CONNECTOR</span><h1>{user.username} <ShieldCheck size={24} fill="#22D3EE" /></h1><p>{user.email} · {user.campus || `ID ${user.id.slice(0, 8)}`}</p></div><button onClick={onEdit}><Settings size={18} /> Edit profile</button></div></section>
    <div className="profile-stats"><div><b>{metric(dashboard?.karma)}</b><small>Karma</small></div><div><b>{metric(dashboard?.postCount)}</b><small>Posts</small></div><div><b>{metric(dashboard?.followers)}</b><small>Followers</small></div><div><b>{metric(dashboard?.streak)}</b><small>Day streak</small></div></div>
    <div className="profile-content"><section><span className="eyebrow violet">ABOUT ME</span><h2>{user.about || "Your campus story starts here. Add a few lines about yourself from Edit profile."}</h2><div className="profile-tags"><span>🎨 Design</span><span>📸 Photography</span><span>☕ Chai</span><span>🎧 Indie music</span></div><div className="profile-own-posts"><span className="eyebrow pink">YOUR POSTS</span>{dashboard?.posts.length ? dashboard.posts.slice(0, 3).map((post) => <article key={post.id}><div><b>{post.title}</b><small>{post.community} · {post.time}</small></div><span>{post.votes.toLocaleString()} karma</span></article>) : <p>You haven&apos;t posted anything yet.</p>}</div></section><aside><span className="eyebrow cyan">PREFERENCES</span><button onClick={onRewards}><Gift size={20} /><span><b>Rewards & Premium</b><small>{user.points} points · {Math.max(0, 60 - user.points)} to your next reward</small></span><ArrowRight size={18} /></button><button onClick={toggleTheme}>{theme === "light" ? <Moon size={20} /> : <Sun size={20} />}<span><b>{theme === "light" ? "Dark mode" : "Light mode"}</b><small>Change your campus vibe</small></span><i /></button><button onClick={onEdit}><KeyRound size={20} /><span><b>Password & email</b><small>{user.hasPassword ? "Password login enabled" : "Add an alternative login method"}</small></span><ArrowRight size={18} /></button><button className="privacy-row" role="switch" aria-checked={user.isPrivate} disabled={privacyPending} onClick={() => onPrivacyChange(!user.isPrivate)}>{user.isPrivate ? <LockKeyhole size={20} /> : <Globe2 size={20} />}<span><b>Private profile</b><small>{user.isPrivate ? "Follow requests require your approval" : "Anyone can follow you instantly"}</small></span><i className={user.isPrivate ? "on" : ""} /></button><button className="logout-row" onClick={onLogout}><LogOut size={20} /><span><b>Log out</b><small>End this session on every layer</small></span><ArrowRight size={18} /></button></aside></div>
  </div>;
}

function SearchPanel({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState("");
  const [chatTarget, setChatTarget] = useState<UserSearchResult | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await requestJson<{ users: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal });
        setResults(data?.users || []);
      } catch (searchError) {
        if (!controller.signal.aborted) notify(searchError instanceof Error ? searchError.message : "Could not search users.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, notify]);

  async function follow(user: UserSearchResult) {
    setActionId(user.id);
    try {
      const data = await requestJson<{ follow: { status: "pending" | "accepted" } }>("/api/follows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: user.id }) });
      if (!data?.follow) throw new Error("The server did not return the follow status.");
      setResults((current) => current.map((item) => item.id === user.id ? { ...item, followStatus: data.follow.status } : item));
      notify(data.follow.status === "accepted" ? `You now follow ${user.username}` : `Follow request sent to ${user.username}`);
    } catch (followError) {
      notify(followError instanceof Error ? followError.message : "Could not follow this user.");
    } finally {
      setActionId("");
    }
  }

  function chatLabel(status: UserSearchResult["chatStatus"]) {
    if (status === "pending_sent") return "Request sent";
    if (status === "pending_received") return "Reply in inbox";
    if (status === "rejected") return "Unavailable";
    if (status === "connected") return "Connected";
    return "Chat request";
  }

  return <><div className="overlay search-overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="search-panel people-search-panel" role="dialog" aria-modal="true" aria-label="Find people"><label><Search size={22} /><input autoFocus value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (!value.trim()) { setResults([]); setLoading(false); } }} maxLength={50} placeholder="Search people by username" /><kbd>ESC</kbd></label>{query.trim() ? <div className="search-results people-results"><span className="eyebrow violet">PEOPLE</span>{results.map((user) => <article className="user-search-result" key={user.id}><Avatar text={user.username} image={user.avatarUrl} color={user.isPrivate ? "#FF5C8A" : "#6C3BFF"} size={48} /><div className="user-result-copy"><header><b>{user.username}</b><span>{user.isPrivate ? <><LockKeyhole size={12} /> Private</> : <><Globe2 size={12} /> Public</>}</span></header><p>{user.about || "New to Smart Campus."}</p></div><div className="user-result-actions"><button disabled={actionId === user.id || user.followStatus !== "none"} onClick={() => void follow(user)}>{user.followStatus === "accepted" ? <UserCheck size={15} /> : <UserPlus size={15} />}{user.followStatus === "none" ? "Follow" : user.followStatus === "pending" ? "Requested" : user.followStatus === "accepted" ? "Following" : "Declined"}</button><button disabled={user.chatStatus !== "none"} onClick={() => setChatTarget(user)}><MessageCircle size={15} />{chatLabel(user.chatStatus)}</button></div></article>)}{loading && <div className="search-status"><LoaderCircle className="spin" size={20} /> Searching campus…</div>}{!loading && !results.length && <div className="search-status"><Users size={25} /><b>No matching users</b><small>Try the beginning of their username.</small></div>}</div> : <div className="search-empty people-search-empty"><Users size={30} /><b>Find your people</b><span>Search by username to follow someone or send one chat request.</span></div>}<button className="close-search" onClick={close}><X size={20} /></button></section></div>{chatTarget && <ChatRequestModal target={chatTarget} close={() => setChatTarget(null)} sent={() => { setResults((current) => current.map((item) => item.id === chatTarget.id ? { ...item, chatStatus: "pending_sent" } : item)); setChatTarget(null); notify(`Chat request sent to ${chatTarget.username}`); }} />}</>;
}

function ChatRequestModal({ target, close, sent }: { target: UserSearchResult; close: () => void; sent: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return setError("Write one initial message before sending.");
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/chat-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientId: target.id, message }) });
      sent();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send your chat request.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="overlay chat-request-overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}><form className="chat-request-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="chat-request-title"><header><Avatar text={target.username} image={target.avatarUrl} color="#6C3BFF" size={48} /><div><span className="eyebrow cyan">ONE MESSAGE</span><h2 id="chat-request-title">Message {target.username}</h2></div><IconButton label="Close" onClick={close}><X size={19} /></IconButton></header><p>Introduce yourself with one message. You cannot send another unless {target.username} accepts.</p><label><span>Initial message</span><textarea autoFocus required rows={5} maxLength={1000} value={message} onChange={(event) => { setMessage(event.target.value); setError(""); }} placeholder="Hey! I saw we’re both into…" /><small>{message.length} / 1000</small></label>{error && <p className="form-error" role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancel</button><button disabled={busy || !message.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} Send request</button></footer></form></div>;
}

function Notifications({ close }: { close: () => void }) {
  const [read, setRead] = useState<number[]>([]);
  const items = [["AA", "Aarav replied to your comment", "“Gate 3 momos and it’s not even close.”", "2m"], ["DC", "Design Club Core", "Mira sent a new message", "8m"], ["🎤", "Open Mic Night is tomorrow", "Doors open at 6:00 PM", "1h"], ["🎁", "You earned 10 points!", "riya.reads joined from your invite", "1d"]];
  return <><button className="drawer-scrim" onClick={close} aria-label="Close notifications" /><aside className="notification-drawer"><header><div><span className="eyebrow pink">WHAT&apos;S NEW</span><h2>Notifications</h2></div><IconButton label="Close" onClick={close}><X size={20} /></IconButton></header><div className="notification-actions"><button onClick={() => setRead(items.map((_, i) => i))}><Check size={15} /> Mark all read</button><button>Settings</button></div>{items.map((item, index) => <button className={read.includes(index) ? "read" : ""} key={item[1]} onClick={() => setRead(r => [...r, index])}><Avatar text={item[0]} color={index % 2 ? "#22D3EE" : "#6C3BFF"} /><span><b>{item[1]}</b><small>{item[2]}</small><em>{item[3]}</em></span>{!read.includes(index) && <i />}</button>)}</aside></>;
}

function Composer({ author, close, onCreate, communities, initialCommunity }: { author: string; close: () => void; onCreate: (post: Post) => void; communities: Community[]; initialCommunity: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("Text");
  const [community, setCommunity] = useState(initialCommunity);
  const [uploads, setUploads] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const activeCommunity = communities.some((item) => item.name === community) ? community : communities[0]?.name || community;

  async function addImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    setError("");
    if (!files.length) return;
    const invalid = files.find(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (invalid) return setError(`${invalid.name} is not a JPG, PNG, or WebP image.`);
    const oversized = files.find(file => file.size > 5 * 1024 * 1024);
    if (oversized) return setError(`${oversized.name} is larger than 5 MB.`);
    if (uploads.length + files.length > 6) return setError("You can attach up to 6 images to one post.");
    setUploading(true);
    try {
      const added = await Promise.all(files.map(async file => {
        const form = new FormData();
        form.append("image", file);
        const result = await requestJson<{ imageUrl: string }>("/api/posts/images", { method: "POST", body: form });
        if (!result?.imageUrl) throw new Error("The image server did not return a URL.");
        return { name: file.name, url: result.imageUrl };
      }));
      setUploads(current => [...current, ...added]);
    } catch {
      setError("We couldn’t upload that image. Please try another file.");
    } finally {
      setUploading(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError("Add a title before publishing.");
    if (type === "Image" && !uploads.length) return setError("Choose at least one image for an image post.");
    const selectedCommunity = communities.find(item => item.name === activeCommunity);
    if (!selectedCommunity) return setError("Choose a community before publishing.");
    onCreate({ id: Date.now(), communityId: selectedCommunity.id, community: selectedCommunity.name, accent: selectedCommunity.color, author, time: "now", flair: type === "Image" ? "Photo dump" : type, title: title.trim(), body: body.trim() || undefined, images: uploads.map(upload => upload.url), votes: 0, comments: 0 });
  }

  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && close()}><form className="composer" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Create a post"><header><div><span className="eyebrow violet">SAY SOMETHING</span><h2>Create a post</h2></div><IconButton label="Close" onClick={close}><X size={20} /></IconButton></header><label className="community-select"><span>Post to</span><div><Avatar text={activeCommunity.slice(2, 4)} color={communities.find(item => item.name === activeCommunity)?.color || "#6C3BFF"} size={28} /><select value={activeCommunity} onChange={event => setCommunity(event.target.value)} aria-label="Post community">{communities.map(item => <option key={item.id}>{item.name}</option>)}</select><ChevronDown size={16} /></div></label><div className="composer-types">{["Text", "Image", "Poll", "Link"].map(item => <button type="button" className={type === item ? "active" : ""} onClick={() => { setType(item); setError(""); }} key={item}>{item}</button>)}</div><input autoFocus value={title} onChange={event => { setTitle(event.target.value); setError(""); setDraftSaved(false); }} maxLength={160} placeholder="An interesting title" /><textarea value={body} onChange={event => { setBody(event.target.value); setDraftSaved(false); }} rows={7} placeholder={type === "Poll" ? "Ask your question..." : type === "Link" ? "Paste a link and add some context..." : "What do you want to share? Markdown is supported."} />{type === "Image" && <><label className="upload-zone"><input className="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addImages} /><ImagePlus size={28} /><b>{uploading ? "Uploading…" : uploads.length ? "Add more photos" : "Choose photos to upload"}</b><small>Up to 6 JPG, PNG or WebP images · 5 MB each</small></label>{uploads.length > 0 && <div className="upload-previews">{uploads.map((upload, index) => <div key={`${upload.name}-${index}`}><Image src={upload.url} alt={`Preview of ${upload.name}`} fill sizes="160px" unoptimized /><button type="button" aria-label={`Remove ${upload.name}`} onClick={() => setUploads(current => current.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button><span>{index + 1}</span></div>)}</div>}</>}{error && <p className="form-error" role="alert">{error}</p>}<footer><span>{draftSaved ? "Draft saved" : `${title.length}/160`}</span><button type="button" className="draft-button" onClick={() => { localStorage.setItem("sc-post-draft", JSON.stringify({ title, body, type, community: activeCommunity })); setDraftSaved(true); }}>Save draft</button><button type="submit" className="post-button" disabled={!title.trim() || !communities.length || uploading}>Post <ArrowRight size={17} /></button></footer></form></div>;
}

export function LegacyEventDetail({ event, close, notify, onChange }: { event: CampusEvent; close: () => void; notify: (s: string) => void; onChange: (event: CampusEvent) => void }) {
  const [busy, setBusy] = useState(false);
  const [showAttendees, setShowAttendees] = useState(false);
  const [attendees, setAttendees] = useState<EventAttendee[] | null>(null);
  const nearlyFull = event.going >= event.capacity;

  async function toggleRsvp() {
    if (busy) return;
    setBusy(true);
    try {
      const data = await requestJson<{ event: CampusEvent }>(`/api/events/${event.id}/rsvp`, { method: event.viewerRsvpStatus ? "DELETE" : "POST" });
      if (!data?.event) throw new Error("The server did not return your updated RSVP.");
      onChange(data.event);
      notify(event.viewerRsvpStatus ? "RSVP cancelled" : data.event.viewerRsvpStatus === "waitlisted" ? "You joined the waitlist" : "You’re going!");
      if (event.isCreator && showAttendees) void loadAttendees();
    } catch (rsvpError) {
      notify(rsvpError instanceof Error ? rsvpError.message : "Could not update your RSVP.");
    } finally {
      setBusy(false);
    }
  }

  async function loadAttendees() {
    setShowAttendees(true);
    try {
      const data = await requestJson<{ attendees: EventAttendee[] }>(`/api/events/${event.id}/rsvps`, { cache: "no-store" });
      setAttendees(data?.attendees || []);
    } catch (attendeeError) {
      notify(attendeeError instanceof Error ? attendeeError.message : "Could not load RSVPs.");
      setAttendees([]);
    }
  }

  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}><section className="event-modal" role="dialog" aria-modal="true" aria-label={event.title}><div className="event-modal-image"><Image src={event.imageUrl} alt="" fill sizes="680px" unoptimized={event.imageUrl.startsWith("/api/")} /><IconButton label="Close" onClick={close}><X size={20} /></IconButton><span>{event.isCreator ? "YOUR EVENT" : event.category}</span></div><div className="event-modal-copy"><span className="eyebrow pink">{event.month} {event.day} · {event.time}</span><h2>{event.title}</h2><p className="event-location"><MapPin size={18} /> <span><b>{event.venueName}</b><small>{event.venueAddress} · {event.campus}</small></span>{event.directionsUrl && <a href={event.directionsUrl} target="_blank" rel="noreferrer" aria-label="Open Google Maps directions"><ExternalLink size={15} /> Directions</a>}</p><p>{event.description || "The details are set. Bring your campus energy and show up for the people making it happen."}</p><div className="capacity-row"><div><Users size={19} /><span><b>{event.going} going</b><small>{Math.max(0, event.capacity - event.going)} spots left{event.waitlisted ? ` · ${event.waitlisted} waitlisted` : ""}</small></span></div><div className="progress"><i style={{ width: `${Math.min(100, event.going / event.capacity * 100)}%` }} /></div></div><div className="disclosure"><ShieldCheck size={19} /><p>Your verified email and RSVP details will be shared only with this event&apos;s organizer for event management.</p></div>{event.isCreator && <div className="creator-event-actions"><button type="button" onClick={() => showAttendees ? setShowAttendees(false) : void loadAttendees()}><Users size={17} /> {showAttendees ? "Hide RSVPs" : "View RSVPs"}</button><a href={`/api/events/${event.id}/rsvps/export`} download><Download size={17} /> Export CSV</a></div>}{showAttendees && event.isCreator && <section className="attendee-dashboard"><header><div><span className="eyebrow cyan">CREATOR DASHBOARD</span><h3>RSVP attendees</h3></div><b>{attendees?.length ?? "…"}</b></header>{attendees === null ? <div className="attendee-loading"><LoaderCircle className="spin" size={20} /> Loading verified attendees…</div> : attendees.length ? <div className="attendee-list">{attendees.map((attendee) => <div key={attendee.rsvpId}><Avatar text={attendee.username} color="#6C3BFF" size={35} /><span><b>{attendee.username}</b><small>{attendee.email}</small></span><em>{attendee.status}</em></div>)}</div> : <p className="attendee-empty">No RSVPs yet.</p>}</section>}<button className={event.viewerRsvpStatus ? "rsvp-button going" : "rsvp-button"} disabled={busy} onClick={() => void toggleRsvp()}>{busy ? <><LoaderCircle className="spin" size={20} /> Updating…</> : event.viewerRsvpStatus ? <><Check size={20} /> {event.viewerRsvpStatus === "waitlisted" ? "Waitlisted" : "Going"}</> : <><TicketCheck size={20} /> {nearlyFull ? "Join waitlist" : "RSVP now"}</>}</button></div></section></div>;
}
