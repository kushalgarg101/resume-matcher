"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, MessageSquare, UserCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import ProfileForm from "@/components/ProfileForm";
import ChatPanel from "@/components/ChatPanel";
import {
  getConversation,
  sendChatMessage,
  ChatMessage,
} from "@/lib/api";

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);
  const [initChat, setInitChat] = useState(true);
  const [mobileTab, setMobileTab] = useState<"profile" | "chat">("profile");

  // Ref to avoid stale closure in handleSend — always the latest conversationId
  const conversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // Load existing conversation
  useEffect(() => {
    if (!user) return;
    let active = true;
    getConversation()
      .then((res) => {
        if (!active) return;
        if (res.conversation) {
          setConversationId(res.conversation.id);
          conversationIdRef.current = res.conversation.id;
          setMessages(res.messages);
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setInitChat(false); });
    return () => { active = false; };
  }, [user]);

  const handleSend = useCallback(
    async (text: string) => {
      if (initChat) return null;

      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const res = await sendChatMessage(text, conversationIdRef.current ?? undefined);
        conversationIdRef.current = res.conversation_id;
        setConversationId(res.conversation_id);
        setMessages((prev) => [...prev, res.message]);
        setProfileComplete(res.profile_complete);
        return {
          message: res.message,
          conversationId: res.conversation_id,
          profileComplete: res.profile_complete,
        };
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
        return null;
      }
    },
    [initChat]
  );

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="container animate-fade-in py-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Your Profile</h1>
          <p className="text-sm text-muted-foreground">
            Edit your profile or chat with the career assistant
          </p>
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-muted p-1 sm:hidden">
        <button
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mobileTab === "profile" ? "bg-card shadow-sm" : "text-muted-foreground"
          }`}
          onClick={() => setMobileTab("profile")}
        >
          <UserCircle className="h-4 w-4" />
          Profile
        </button>
        <button
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mobileTab === "chat" ? "bg-card shadow-sm" : "text-muted-foreground"
          }`}
          onClick={() => setMobileTab("chat")}
        >
          <MessageSquare className="h-4 w-4" />
          Chat
        </button>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col gap-6 sm:flex-row">
        {/* Left: Profile Form */}
        <div className={`flex-1 ${mobileTab === "chat" ? "hidden sm:block" : ""}`}>
          <ProfileForm />
        </div>

        {/* Right: Chat Panel */}
        <div className={`w-full sm:w-[380px] lg:w-[420px] shrink-0 ${mobileTab === "profile" ? "hidden sm:block" : ""}`}>
          <div className="sticky top-20 h-[calc(100vh-8rem)]">
            <ChatPanel
              conversationId={conversationId}
              messages={messages}
              profileComplete={profileComplete}
              onSend={handleSend}
              initializing={initChat}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
