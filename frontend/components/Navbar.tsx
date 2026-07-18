"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, FileText, LogOut, Plus, Send, UserCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Navbar() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const initial = user?.email?.[0]?.toUpperCase() ?? "U";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary transition-transform group-hover:scale-105">
            <FileText className="h-4 w-4" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Resume Matcher
          </span>
        </Link>

        {user && (
          <div className="flex items-center gap-3 mr-3">
            <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
              <Link href="/jobs">
                <Briefcase className="h-4 w-4" />
                Jobs
              </Link>
            </Button>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/upload">
                <Plus className="h-4 w-4" />
                New Analysis
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="Account menu"
                >
                  <Avatar>
                    <AvatarFallback>{initial}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground border-0">
                  {user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/jobs">
                    <Briefcase className="h-4 w-4" />
                    Browse Jobs
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/upload">
                    <Plus className="h-4 w-4" />
                    New Analysis
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/history">
                    <FileText className="h-4 w-4" />
                    History
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/applications">
                    <Send className="h-4 w-4" />
                    Applications
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserCircle className="h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    try { await signOut(); } catch {}
                    router.replace("/login");
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </header>
  );
}
