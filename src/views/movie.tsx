"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  Play,
  Plus,
  Star,
  Trash2,
  Pencil,
  Users,
  Youtube,
  Calendar,
  Clock,
  Film,
  Loader2,
  AlertCircle,
  ChevronDown,
  Check,
  Zap,
  Maximize2,
  Minimize2,
  Sparkles,
  Bot,
  Subtitles,
  Pause,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useNavigate } from "@/stores/router";
import { useAuthStore } from "@/stores/auth-store";
import { useI18n } from "@/i18n";
import { UserAvatar } from "@/components/cinema/user-avatar";
import { StarRating, RatingInput } from "@/components/cinema/star-rating";
import { SubtitleSelector } from "@/components/cinema/subtitle-selector";
import { SubtitleOverlay } from "@/components/cinema/subtitle-overlay";
import { AiLoadingOverlay } from "@/components/cinema/ai-loading-overlay";

export interface ServerConfig {
  name: string;
  url: string;
  sandbox?: boolean | string;
}

interface MovieDetail {
  id: string;
  tmdbId: number | null;
  archiveId: string | null;
  title: string;
  poster: string | null;
  backdrop: string | null;
  description: string | null;
  year: number | null;
  rating: number | null;
  genre: string | null;
  runtime: number | null;
  source: string;
  videoUrl: string | null;
  trailerUrl: string | null;
  avgRating: number | null;
  reviewCount: number;
}

interface Review {
  id: string;
  content: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
  user: { id: string; username: string; avatar: string | null };
}

interface Watchlist {
  id: string;
  name: string;
  items: { movieId: string }[];
}

export function MovieView({ id }: { id: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const movie = useQuery<MovieDetail>({
    queryKey: ["movie", id],
    queryFn: async () => {
      const r = await api.get<MovieDetail>(`/api/movies/${id}`);
      if (!r.success || !r.data) throw new Error(r.error || "Movie not found");
      return r.data;
    },
    retry: false,
  });

  const reviews = useQuery<Review[]>({
    queryKey: ["movie-reviews", movie.data?.id],
    queryFn: async () => {
      const r = await api.get<Review[]>(`/api/movies/${movie.data!.id}/reviews`);
      return r.data || [];
    },
    enabled: !!movie.data?.id,
  });

  const watchlists = useQuery<Watchlist[]>({
    queryKey: ["watchlists"],
    queryFn: async () => {
      const r = await api.get<Watchlist[]>("/api/watchlists");
      return r.data || [];
    },
    enabled: !!user,
  });

  const [activeModal, setActiveModal] = useState<"watch" | "stream" | "trailer" | null>(null);
  const [activeServerIdx, setActiveServerIdx] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const iframeRetryCount = useRef(0);
  const [subtitleTrackUrl, setSubtitleTrackUrl] = useState<string | null>(null);
  const [activeSubTitle, setActiveSubTitle] = useState<string | null>(null);
  const [autoSubLoading, setAutoSubLoading] = useState(false);
  const [embedCurrentTime, setEmbedCurrentTime] = useState<number>(0);
  const [embedIsPlaying, setEmbedIsPlaying] = useState<boolean>(true);
  const [isLiveSynced, setIsLiveSynced] = useState<boolean>(false);
  const [jumpMinuteInput, setJumpMinuteInput] = useState<string>("");
  const autoSubFetchingRef = useRef<string | null>(null);

  // Clock ticker when player is running without iframe live sync
  useEffect(() => {
    if (activeModal !== "stream" || !embedIsPlaying || isLiveSynced) return;
    const interval = setInterval(() => {
      setEmbedCurrentTime((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeModal, embedIsPlaying, isLiveSynced]);

  const formatPlayerTime = (seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const remainingSec = s % 60;
    const h = Math.floor(m / 60);
    const remainingMin = m % 60;
    if (h > 0) {
      return `${h}:${remainingMin.toString().padStart(2, "0")}:${remainingSec.toString().padStart(2, "0")}`;
    }
    return `${remainingMin.toString().padStart(2, "0")}:${remainingSec.toString().padStart(2, "0")}`;
  };

  const parseTimeStringToSeconds = (input: string): number | null => {
    const clean = input.trim().replace(/：/g, ":");
    if (!clean) return null;
    const parts = clean.split(":").map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 1) {
      return parts[0] * 60;
    }
    return null;
  };

  // Reset player & subtitle states on movie id change
  useEffect(() => {
    setSubtitleTrackUrl(null);
    setActiveSubTitle(null);
    setAutoSubLoading(false);
    autoSubFetchingRef.current = null;
    setEmbedCurrentTime(0);
    setEmbedIsPlaying(true);
    setIsLiveSynced(false);
    setActiveServerIdx(0);
  }, [id]);

  // Reset sync status on server change
  useEffect(() => {
    setIsLiveSynced(false);
  }, [activeServerIdx]);

  // Auto-fetch best Persian subtitle when stream opens (always runs if subtitleTrackUrl is null)
  useEffect(() => {
    const currentMovie = movie.data;
    if (!currentMovie || (!activeModal || (activeModal !== "watch" && activeModal !== "stream"))) return;
    if (subtitleTrackUrl) return;

    const fetchKey = `${currentMovie.id || currentMovie.tmdbId || currentMovie.title}`;
    if (autoSubFetchingRef.current === fetchKey) return;
    autoSubFetchingRef.current = fetchKey;

    setAutoSubLoading(true);

    const params = new URLSearchParams({
      action: "auto",
      q: currentMovie.title || "",
    });
    if (currentMovie.tmdbId) params.set("tmdbId", String(currentMovie.tmdbId));
    if ((currentMovie as any).imdbId) params.set("imdbId", (currentMovie as any).imdbId);
    if (currentMovie.year) params.set("year", String(currentMovie.year));

    fetch(`/api/subtitles?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.vtt) {
          const blob = new Blob([data.vtt], { type: "text/vtt" });
          const blobUrl = URL.createObjectURL(blob);
          setSubtitleTrackUrl(blobUrl);
          const name = data.subtitle?.title || "Persian Subtitle";
          setActiveSubTitle(name);
          toast.success("زیرنویس فارسی هماهنگ به صورت خودکار بارگذاری شد ✨", {
            description: name,
          });
        }
      })
      .catch((err) => {
        console.warn("[Movie] Auto subtitle error:", err);
      })
      .finally(() => {
        setAutoSubLoading(false);
      });
  }, [activeModal, movie.data?.id, movie.data?.tmdbId, movie.data?.title, subtitleTrackUrl]);
  const modalRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    const el = modalRef.current;
    if (!el) return;
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => setIsMaximized((v) => !v));
      } else if ((el as any).webkitRequestFullscreen) {
        (el as any).webkitRequestFullscreen();
      } else {
        setIsMaximized((v) => !v);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => setIsMaximized(false));
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else {
        setIsMaximized(false);
      }
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsMaximized(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
    };
  }, []);

  // Intercept SmashyStream and player actions (Watch Party, Bookmark, Search, Like) to route to our site
  useEffect(() => {
    if (!activeModal || activeModal !== "stream") return;

    const currentMovie = movie.data;

    const handleWatchPartyAction = async () => {
      if (!user) {
        toast.error("برای ساخت اتاق واچ پارتی لطفاً ابتدا وارد حساب کاربری خود شوید.");
        navigate("/login");
        return;
      }
      if (!currentMovie) return;

      toast.info("در حال ایجاد و انتقال به اتاق واچ پارتی سینما...");
      try {
        const res = await api.post<{ id: string }>("/api/rooms", {
          name: `واچ پارتی: ${currentMovie.title}`,
          description: `تماشای گروهی و هم‌زمان فیلم ${currentMovie.title}`,
          movieId: currentMovie.id,
          isPublic: true,
        });
        if (res.data?.id) {
          setActiveModal(null);
          navigate(`/room/${res.data.id}`);
        }
      } catch (err: any) {
        console.error("Watch party creation error:", err);
        toast.error("خطا در ایجاد اتاق واچ پارتی سینما");
      }
    };

    const handleBookmarkAction = async () => {
      if (!user) {
        toast.error("برای افزودن به لیست تماشا ابتدا وارد حساب کاربری شوید.");
        return;
      }
      if (!currentMovie) return;

      try {
        let userLists = watchlists.data || [];
        let targetListId: string | undefined = userLists[0]?.id;

        if (!targetListId) {
          const createRes = await api.post<{ id: string }>("/api/watchlists", { name: "لیست من" });
          targetListId = createRes.data?.id;
        }

        if (targetListId) {
          await api.post(`/api/watchlists/${targetListId}/movies`, { movieId: currentMovie.id });
          qc.invalidateQueries({ queryKey: ["watchlists"] });
          toast.success(`فیلم «${currentMovie.title}» به لیست تماشای شما اضافه شد!`);
        }
      } catch (err) {
        toast.error("خطا در افزودن به لیست تماشا");
      }
    };

    // 1. PostMessage Event Listener
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;
      const rawData = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
      const lower = rawData.toLowerCase();

      // Check for Watch Party keywords
      if (
        lower.includes("watchparty") || 
        lower.includes("watch_party") || 
        lower.includes("create_room") || 
        lower.includes("party")
      ) {
        handleWatchPartyAction();
      }
      // Check for Bookmark / Watchlist keywords
      else if (lower.includes("bookmark") || lower.includes("favorite") || lower.includes("watchlist")) {
        handleBookmarkAction();
      }
      // Check for Search keywords
      else if (lower.includes("search") && !lower.includes("subtitle")) {
        setActiveModal(null);
        navigate("/movies");
      }
      // Check for Like / Review keywords
      else if (lower.includes("like") || lower.includes("review")) {
        setActiveModal(null);
        const reviewSection = document.getElementById("reviews-section");
        if (reviewSection) {
          reviewSection.scrollIntoView({ behavior: "smooth" });
        }
      }

      // Check for player timeupdate / seek / play / pause events from iframe (VidLink, HTML5 postMessage, etc.)
      try {
        let payload = event.data;
        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch {}
        }
        if (payload && typeof payload === "object") {
          const eventData = payload.type === "PLAYER_EVENT" && payload.data ? payload.data : payload;
          const evType = (eventData.event || eventData.type || payload.event || payload.type || "").toString().toLowerCase();

          const tVal =
            eventData.currentTime ??
            eventData.time ??
            eventData.position ??
            eventData.seconds ??
            payload.currentTime ??
            payload.time;

          if (typeof tVal === "number" && !isNaN(tVal) && tVal >= 0) {
            setEmbedCurrentTime(tVal);
            setIsLiveSynced(true);
          }

          if (evType === "pause") {
            setEmbedIsPlaying(false);
          } else if (evType === "play" || evType === "playing") {
            setEmbedIsPlaying(true);
          } else if (evType === "seeked" && typeof tVal === "number" && !isNaN(tVal) && tVal >= 0) {
            setEmbedCurrentTime(tVal);
            setIsLiveSynced(true);
          }
        }
      } catch {}
    };

    // 2. Override window.open to catch popup links from embed servers
    const originalOpen = window.open;
    window.open = function (url?: string | URL, target?: string, features?: string) {
      const urlStr = url ? url.toString().toLowerCase() : "";
      // Handle SmashyStream actions → route to our site
      if (
        urlStr.includes("watchparty") || 
        urlStr.includes("watch_party") || 
        urlStr.includes("smashy") || 
        urlStr.includes("party") || 
        urlStr.includes("room")
      ) {
        handleWatchPartyAction();
        return null;
      }
      if (urlStr.includes("bookmark") || urlStr.includes("favorite")) {
        handleBookmarkAction();
        return null;
      }
      // Block ad popups from embed servers (allow only same-site URLs)
      const currentHost = window.location.hostname;
      try {
        const popupHost = new URL(url?.toString() || "", window.location.href).hostname;
        if (popupHost !== currentHost) {
          console.log("[Ad Blocker] Blocked popup:", urlStr.substring(0, 80));
          return null;
        }
      } catch { /* invalid URL, block it */ return null; }
      return originalOpen.apply(this, arguments as any);
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.open = originalOpen;
    };
  }, [activeModal, user, movie.data, watchlists.data, qc, navigate]);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState<string | null>(null);

  const runAiServerFinder = async () => {
    if (!movie.data) return;
    setAiLoading(true);
    setAiRecommendation(null);
    try {
      const tmdb = movie.data.tmdbId || movie.data.id;
      const imdb = (movie.data as any).imdbId || "";
      const title = movie.data.title;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(`/api/movies/ai-server-finder?tmdbId=${tmdb}&imdbId=${imdb}&title=${encodeURIComponent(title)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        if (data.aiRecommendation) {
          setAiRecommendation(data.aiRecommendation);
        }
        if (data.recommendedServer?.name) {
          const recName = data.recommendedServer.name.toLowerCase();
          const targetIdx = allServers.findIndex((s) => s.name.toLowerCase().includes(recName) || recName.includes(s.name.toLowerCase()));
          if (targetIdx !== -1) {
            setActiveServerIdx(targetIdx);
          } else if (typeof data.recommendedIndex === "number" && data.recommendedIndex < allServers.length) {
            setActiveServerIdx(data.recommendedIndex);
          }
        }
      } else {
        toast.error("AI Server Finder موقتاً در دسترس نیست. از دکمه Next Server استفاده کنید.");
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        toast.error("جستجوی هوشمند سرور timeout شد. سرور بعدی رو امتحان کنید.");
      } else {
        console.error("AI Server Finder error:", err);
        toast.error("خطا در جستجوی هوشمند سرور. از دکمه Next Server استفاده کنید.");
      }
    } finally {
      setAiLoading(false);
    }
  };

  const [reviewContent, setReviewContent] = useState("");
  const [reviewRating, setReviewRating] = useState(7);
  const [editingId, setEditingId] = useState<string | null>(null);

  const myReview = reviews.data?.find((r) => r.user.id === user?.id);
  const [prevReviewId, setPrevReviewId] = useState<string | null>(null);

  // Sync form state when myReview loads or editing target changes (render-time pattern)
  if (myReview && !editingId && myReview.id !== prevReviewId) {
    setPrevReviewId(myReview.id);
    setReviewContent(myReview.content);
    setReviewRating(myReview.rating);
  }

  const submitReview = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return api.put(`/api/reviews/${editingId}`, {
          content: reviewContent,
          rating: reviewRating,
        });
      }
      return api.post(`/api/movies/${movie.data!.id}/reviews`, {
        content: reviewContent,
        rating: reviewRating,
      });
    },
    onSuccess: () => {
      toast.success(editingId ? t("movie.updateReview") : t("movie.postReview"));
      setEditingId(null);
      setReviewContent("");
      setReviewRating(7);
      qc.invalidateQueries({ queryKey: ["movie-reviews", movie.data?.id] });
      qc.invalidateQueries({ queryKey: ["movie", id] });
    },
    onError: (e: unknown) => {
      const err = e as { error?: string };
      toast.error(err.error || t("error"));
    },
  });

  const deleteReview = useMutation({
    mutationFn: (rid: string) => api.del(`/api/reviews/${rid}`),
    onSuccess: () => {
      toast.success(t("movie.deleteReview"));
      setEditingId(null);
      setReviewContent("");
      qc.invalidateQueries({ queryKey: ["movie-reviews", movie.data?.id] });
      qc.invalidateQueries({ queryKey: ["movie", id] });
    },
  });

  const addToWatchlist = useMutation({
    mutationFn: (listId: string) =>
      api.post(`/api/watchlists/${listId}/movies`, { movieId: movie.data!.id }),
    onSuccess: () => {
      toast.success(t("watchlist.added"));
      qc.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });

  const startWatchParty = useMutation({
    mutationFn: () =>
      api
        .post<{ id: string }>("/api/rooms", {
          name: `${movie.data!.title} — Watch Party`,
          movieId: movie.data!.id,
          isPublic: true,
        })
        .then((r) => r.data!),
    onSuccess: (data) => {
      navigate(`/room/${data.id}`);
    },
    onError: () => {
      toast.error(t("error"));
    },
  });

  // ── Derived values (computed before early returns for Rules of Hooks compliance) ──
  let m = movie.data ?? null;
  const trailerKey = m?.trailerUrl
    ? m.trailerUrl.split("v=")[1]?.split("&")[0]
    : null;

  // determine watch embed url
  let watchEmbed: string | null = null;
  if (m?.videoUrl) {
    if (m.source === "ARCHIVE" || m.videoUrl.includes("archive.org")) {
      const aid = m.archiveId || m.videoUrl.split("/").pop();
      watchEmbed = `https://archive.org/embed/${aid}`;
    } else if (m.source === "YOUTUBE" || m.videoUrl.includes("youtube.com") || m.videoUrl.includes("youtu.be")) {
      const ytId = m.videoUrl.includes("youtu.be")
        ? m.videoUrl.split("/").pop()
        : m.videoUrl.split("v=")[1]?.split("&")[0] || m.videoUrl.split("/embed/")[1]?.split("?")[0];
      watchEmbed = `https://www.youtube.com/embed/${ytId}`;
    } else if (m.source === "VIMEO" || m.videoUrl.includes("vimeo.com")) {
      const vimId = m.videoUrl.split("/video/")[1]?.split("?")[0] || m.videoUrl.split("/").pop();
      watchEmbed = `https://player.vimeo.com/video/${vimId}`;
    } else {
      watchEmbed = m.videoUrl;
    }
  }

  const allServers: ServerConfig[] = [];

  const defaultSandbox = "allow-same-origin allow-scripts allow-presentation allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation allow-downloads";

  if (m?.tmdbId) {
    allServers.push(
      { name: "AutoEmbed (کیفیت اصلی Full HD ✨)", url: `https://autoembed.co/movie/tmdb/${m.tmdbId}`, sandbox: false },
      { name: "2Embed (کیفیت اصلی 1080p BluRay 💎)", url: `https://www.2embed.cc/embed/tmdb/movie?id=${m.tmdbId}`, sandbox: false },
      { name: "VidSrc.to (سرور پرسرعت و پایدار ⚡)", url: `https://vidsrc.to/embed/movie/${m.tmdbId}`, sandbox: false },
      { name: "SmashyStream (سرور چند سورس HQ 🎬)", url: `https://embed.smashystream.com/playere.php?tmdb=${m.tmdbId}`, sandbox: false },
      { name: "VidLink Pro (هماهنگ خودکار با زیرنویس)", url: `https://vidlink.pro/movie/${m.tmdbId}?primaryColor=f59e0b&secondaryColor=18181b&icons=default`, sandbox: false },
      { name: "VidZee (سرور پشتیبان سراسری 📺)", url: `https://player.vidzee.wtf/embed/movie/${m.tmdbId}`, sandbox: false },
    );
  }

  if (watchEmbed) {
    allServers.push({ name: "Archive / Direct", url: watchEmbed });
  }

  const activeServer = allServers[activeServerIdx] || allServers[0];
  const activeServerUrl = activeServer?.url || null;

  const handleSelectBestQuality = () => {
    // Look for top quality servers in priority: AutoEmbed, 2Embed, VidSrc, SmashyStream
    const qualityPriority = ["AutoEmbed", "2Embed", "VidSrc", "SmashyStream"];
    for (const qName of qualityPriority) {
      const targetIdx = allServers.findIndex((s) => s.name.toLowerCase().includes(qName.toLowerCase()));
      if (targetIdx !== -1 && targetIdx !== activeServerIdx) {
        setIframeLoaded(false);
        setIframeError(false);
        setActiveServerIdx(targetIdx);
        toast.success(`سرور با کیفیت برتر 1080p فعال شد ✨`, {
          description: allServers[targetIdx].name,
        });
        return;
      }
    }
    handleNextServer();
  };

  const handleNextServer = useCallback(() => {
    if (allServers.length === 0) return;
    setIframeLoaded(false);
    setIframeError(false);
    setActiveServerIdx((prev) => (prev + 1) % allServers.length);
    toast.info("در حال بارگذاری سرور بعدی...");
  }, [allServers.length]);

  // Reset retry counter when modal opens
  useEffect(() => {
    if (activeModal === "stream") {
      iframeRetryCount.current = 0;
      setIframeLoaded(false);
      setIframeError(false);
    }
  }, [activeModal]);

  // ── Early returns (all hooks are above) ──
  if (movie.isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Skeleton className="h-64 sm:h-80 w-full rounded-2xl mb-6" />
        <div className="grid md:grid-cols-3 gap-6">
          <Skeleton className="aspect-[2/3] rounded-xl" />
          <div className="md:col-span-2 space-y-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!movie.data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <AlertCircle className="size-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">{t("error")}</p>
      </div>
    );
  }

  // movie.data is guaranteed non-null after early returns above
  m = movie.data;

  return (
    <div>
      {/* Backdrop */}
      <div className="relative h-56 sm:h-80 w-full overflow-hidden border-b border-border">
        {m.backdrop ? (
          <Image
            src={m.backdrop}
            alt={m.title}
            fill
            unoptimized
            className="object-cover"
            sizes="100vw"
            priority
          />
        ) : (
          <div className="size-full bg-gradient-to-br from-red-950/40 via-card to-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-4 -mt-24 sm:-mt-32 relative z-10">
        <div className="grid md:grid-cols-3 gap-6">
          {/* Poster + actions */}
          <div>
            <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-border shadow-2xl bg-card max-w-xs mx-auto md:mx-0">
              {m.poster ? (
                <Image
                  src={m.poster}
                  alt={m.title}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="(max-width: 768px) 60vw, 240px"
                  priority
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <Film className="size-12 text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 mt-4 max-w-xs mx-auto md:mx-0">
              {allServers.length > 0 && (
                <Button className="bg-red-600 hover:bg-red-700 w-full" onClick={() => setActiveModal("stream")}>
                  <Play className="size-4 me-2" /> {t("movie.watchNow")}
                </Button>
              )}

              {m.trailerUrl && trailerKey && (
                <Button variant="outline" className="w-full" onClick={() => setActiveModal("trailer")}>
                  <Youtube className="size-4 me-2" /> {t("movie.trailer")}
                </Button>
              )}

              {activeModal === "stream" && activeServerUrl && typeof document !== "undefined" && createPortal(
                <div className="fixed inset-0 z-[999999]" dir="ltr">
                  {/* Backdrop */}
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setActiveModal(null)} />
                  {/* Player container */}
                  <div ref={modalRef} className={isMaximized ? "fixed inset-0 z-[1000000] w-screen h-screen bg-black flex flex-col overflow-hidden" : "fixed inset-2 sm:inset-4 md:inset-6 z-[1000000] bg-black/95 rounded-2xl overflow-hidden flex flex-col border border-white/20 shadow-2xl"} dir="ltr">
                      {/* Premium Stream Header Bar */}
                      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 bg-zinc-950/95 border-b border-white/10 backdrop-blur-md gap-2 shrink-0">
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                          </span>
                          <span className="font-bold text-xs sm:text-sm text-white uppercase tracking-wider">Stream Player</span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {allServers.length > 1 && (
                            <>
                              {/* Server Selector Dropdown */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs bg-zinc-900/90 border-white/20 text-white hover:bg-white/10 gap-1.5 px-3 rounded-lg max-w-[170px] sm:max-w-[260px] justify-between shadow-sm"
                                  >
                                    <span className="text-red-400 font-semibold shrink-0">Server:</span>
                                    <span className="truncate">{allServers[activeServerIdx]?.name || "Select"}</span>
                                    <ChevronDown className="size-3.5 text-white/50 shrink-0" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64 bg-zinc-900/95 backdrop-blur-xl border-white/15 text-white p-1 shadow-2xl z-[100]">
                                  {allServers.map((srv, idx) => (
                                    <DropdownMenuItem
                                      key={idx}
                                      className={`text-xs p-2 rounded-md cursor-pointer flex items-center justify-between ${activeServerIdx === idx ? "bg-red-600 text-white font-medium" : "hover:bg-white/10 text-white/80"}`}
                                      onClick={() => setActiveServerIdx(idx)}
                                    >
                                      <span className="truncate">{srv.name}</span>
                                      {activeServerIdx === idx && <Check className="size-3.5 shrink-0 ms-1 text-white" />}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>

                              {/* Best Quality (1080p BluRay) Button */}
                              <Button
                                size="sm"
                                className="h-8 text-xs bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 text-black font-semibold gap-1 px-2.5 rounded-lg shadow-md shrink-0 border border-yellow-400/40"
                                onClick={handleSelectBestQuality}
                                title="انتخاب خودکار سرور با کیفیت برتر (1080p BluRay/Full HD)"
                              >
                                <Sparkles className="size-3.5 fill-black text-black" />
                                <span className="hidden sm:inline">کیفیت برتر (1080p)</span>
                              </Button>

                              {/* AI Smart Server Finder Button */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs bg-purple-950/80 border-purple-500/40 text-purple-200 hover:bg-purple-900/60 gap-1.5 px-2.5 rounded-lg font-medium shadow-md shrink-0"
                                onClick={runAiServerFinder}
                                disabled={aiLoading}
                                title="تست هوشمند پینگ و سلامت سرورها با AI"
                              >
                                {aiLoading ? (
                                  <Loader2 className="size-3.5 animate-spin text-purple-400" />
                                ) : (
                                  <Sparkles className="size-3.5 text-purple-400 fill-purple-400/30" />
                                )}
                                <span className="hidden sm:inline">AI Finder</span>
                              </Button>

                              {/* Smart Next Server Button */}
                              <Button
                                size="sm"
                                className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white gap-1 px-2.5 rounded-lg font-medium shadow-md shrink-0"
                                onClick={handleNextServer}
                                title="تغییر به سرور بعدی"
                              >
                                <Zap className="size-3.5 fill-current text-yellow-300 shrink-0" />
                                <span className="hidden sm:inline">Next Server</span>
                              </Button>
                            </>
                          )}

                          {/* Subtitle & Fullscreen Buttons */}
                          <SubtitleSelector
                            title={m.title}
                            tmdbId={m.tmdbId}
                            imdbId={(m as any).imdbId}
                            year={m.year}
                            onSubtitleReady={(vttUrl, info) => {
                              setSubtitleTrackUrl(vttUrl);
                              if (info?.title) setActiveSubTitle(info.title);
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0 bg-zinc-900/90 border-white/20 text-white hover:bg-white/10 shrink-0"
                            onClick={toggleFullscreen}
                            title={isMaximized ? "Exit Fullscreen" : "Fullscreen"}
                          >
                            {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-white/70 hover:text-white hover:bg-red-600/80 shrink-0 rounded-lg ms-0.5"
                            onClick={() => setActiveModal(null)}
                            title="بستن پنجره پخش (Close)"
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Video Container - Always fills exact available vertical space without clipping */}
                      <div className="flex-1 min-h-0 w-full bg-black relative flex items-center justify-center overflow-hidden">
                        {aiLoading && (
                          <AiLoadingOverlay recommendation={aiRecommendation} />
                        )}

                        <div className="absolute inset-0 flex items-center justify-center -z-10">
                          <Loader2 className="size-8 animate-spin text-red-600/50" />
                        </div>
                        <iframe
                          key={activeServerUrl}
                          src={activeServerUrl}
                          className="size-full absolute inset-0 border-0"
                          allowFullScreen={true}
                          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
                          onLoad={() => { setIframeLoaded(true); setIframeError(false); }}
                          onError={() => { setIframeError(true); handleNextServer(); }}
                        />
                        {/* Loading indicator with optional Next Server button */}
                        {!iframeLoaded && !iframeError && (
                          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/90 p-4 text-center">
                            <Loader2 className="size-10 animate-spin text-red-500 mb-3" />
                            <p className="text-white text-sm font-medium" dir="rtl">در حال اتصال به {allServers[activeServerIdx]?.name}...</p>
                            <p className="text-white/50 text-xs mt-1.5" dir="rtl">اگر تصویر تا چند لحظه دیگر پخش نشد، سرور دیگری را انتخاب کنید</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-3 text-xs border-white/20 bg-zinc-900 text-white hover:bg-white/10 gap-1.5"
                              onClick={handleNextServer}
                            >
                              <Zap className="size-3 text-yellow-400" />
                              تست سرور بعدی
                            </Button>
                          </div>
                        )}
                        {/* All servers failed */}
                        {iframeError && iframeRetryCount.current >= allServers.length && (
                          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/95 p-6">
                            <AlertCircle className="size-12 text-red-500 mb-4" />
                            <p className="text-white text-base font-bold mb-2" dir="rtl">هیچ سروری پاسخ نداد</p>
                            <p className="text-white/70 text-sm text-center mb-4" dir="rtl">
                              احتمالاً سرورها توسط اینترنت شما فیلتر شده‌اند. از VPN استفاده کنید و دوباره تلاش کنید.
                            </p>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="bg-red-600 hover:bg-red-700 text-white"
                                onClick={() => { iframeRetryCount.current = 0; setIframeLoaded(false); setIframeError(false); setActiveServerIdx(0); }}
                              >
                                تلاش مجدد
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-white/20 text-white hover:bg-white/10"
                                onClick={handleNextServer}
                              >
                                سرور بعدی
                              </Button>
                            </div>
                          </div>
                        )}
                        <SubtitleOverlay
                          vttUrl={subtitleTrackUrl}
                          subtitleLabel={activeSubTitle}
                          currentTime={embedCurrentTime}
                          isPlaying={embedIsPlaying}
                          totalDuration={(m?.runtime || 120) * 60}
                          isLiveSynced={isLiveSynced}
                          serverName={activeServer?.name}
                          onTimeChange={(t) => setEmbedCurrentTime(t)}
                          onSwitchToLiveServer={() => {
                            const vidlinkIdx = allServers.findIndex((s) => s.name.includes("VidLink"));
                            if (vidlinkIdx !== -1) {
                              setActiveServerIdx(vidlinkIdx);
                              toast.success("به سرور VidLink Pro (هماهنگ خودکار) منتقل شدید ⚡");
                            }
                          }}
                        />
                      </div>

                      {/* Dedicated Cinema Multimedia & Timeline Control Bar */}
                      <div className="bg-zinc-950/95 border-t border-white/10 px-3 sm:px-4 py-2 flex flex-col gap-1.5 shrink-0 select-none shadow-2xl backdrop-blur-xl" dir="rtl">
                        {/* Row 1: Play/Pause, Live Time Display, Timeline Scrubber, Sync Badge */}
                        <div className="flex items-center gap-2.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="size-8 p-0 text-white hover:bg-white/10 shrink-0 rounded-full"
                            onClick={() => setEmbedIsPlaying((p) => !p)}
                            title={embedIsPlaying ? "توقف زیرنویس و تایمر" : "شروع / ادامه پخش زیرنویس"}
                          >
                            {embedIsPlaying ? (
                              <Pause className="size-4 text-amber-400 fill-amber-400/30" />
                            ) : (
                              <Play className="size-4 text-green-400 fill-green-400/30" />
                            )}
                          </Button>

                          {/* Time Badge (دقیقه چنده) */}
                          <div className="flex items-center gap-1.5 shrink-0 font-mono text-xs text-white" dir="ltr">
                            <span className="font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                              {formatPlayerTime(embedCurrentTime)}
                            </span>
                            <span className="text-white/40">/</span>
                            <span className="text-white/60">{formatPlayerTime((m?.runtime || 120) * 60)}</span>
                            <span className="text-[11px] text-amber-200/80 ms-1 hidden sm:inline" dir="rtl">
                              (دقیقه {Math.floor(embedCurrentTime / 60)})
                            </span>
                          </div>

                          {/* Interactive Timeline Scrubber */}
                          <div className="flex-1 min-w-0 flex items-center relative" dir="ltr">
                            <input
                              type="range"
                              min={0}
                              max={(m?.runtime || 120) * 60}
                              step={1}
                              value={embedCurrentTime}
                              onChange={(e) => {
                                setEmbedCurrentTime(Number(e.target.value));
                              }}
                              className="w-full accent-amber-500 cursor-pointer h-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-all"
                              title="جابجایی در طول فیلم و هماهنگی زیرنویس"
                            />
                          </div>

                          {/* Live Sync Status indicator */}
                          <div className="shrink-0 flex items-center gap-1 text-[11px]">
                            {isLiveSynced ? (
                              <span className="flex items-center gap-1 text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="hidden md:inline">همگام خودکار با پلیر ⚡</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-zinc-300 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                                <Clock className="size-3 text-amber-400" />
                                <span className="hidden md:inline">کنترل دستی زیرنویس</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Row 2: Quick Jump Buttons (-1m, -10s, +10s, +1m) + Jump to Minute Form + Subtitle Title */}
                        <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                          {/* Quick Seek Buttons */}
                          <div className="flex items-center gap-1" dir="ltr">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px] bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200 rounded"
                              onClick={() => setEmbedCurrentTime((t) => Math.max(0, t - 60))}
                              title="۱ دقیقه به عقب"
                            >
                              -1m
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px] bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200 rounded"
                              onClick={() => setEmbedCurrentTime((t) => Math.max(0, t - 10))}
                              title="۱۰ ثانیه به عقب"
                            >
                              -10s
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px] bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200 rounded"
                              onClick={() => setEmbedCurrentTime((t) => Math.min((m?.runtime || 120) * 60, t + 10))}
                              title="۱۰ ثانیه به جلو"
                            >
                              +10s
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px] bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200 rounded"
                              onClick={() => setEmbedCurrentTime((t) => Math.min((m?.runtime || 120) * 60, t + 60))}
                              title="۱ دقیقه به جلو"
                            >
                              +1m
                            </Button>
                          </div>

                          {/* Jump to exact minute input */}
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const sec = parseTimeStringToSeconds(jumpMinuteInput);
                              if (sec !== null && sec >= 0) {
                                setEmbedCurrentTime(sec);
                                setJumpMinuteInput("");
                                toast.success(`پرش به زمان ${formatPlayerTime(sec)}`);
                              } else {
                                toast.error("زمان وارد شده نامعتبر است (مثال: 41 یا 1:34:09)");
                              }
                            }}
                            className="flex items-center gap-1.5"
                          >
                            <span className="text-zinc-400 text-[11px] hidden sm:inline">پرش مستقیم:</span>
                            <Input
                              value={jumpMinuteInput}
                              onChange={(e) => setJumpMinuteInput(e.target.value)}
                              placeholder="دقیقه (مثلاً 41 یا 1:34:09)"
                              className="h-6 w-28 text-center font-mono text-[11px] bg-zinc-900 border-zinc-700 text-white p-0 rounded"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              className="h-6 px-2.5 text-[11px] bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded"
                            >
                              برو
                            </Button>
                          </form>

                          {/* Active Subtitle Name */}
                          <div className="flex items-center gap-2 text-zinc-400 text-[11px] truncate max-w-sm">
                            {activeSubTitle ? (
                              <span className="truncate text-zinc-300">
                                زیرنویس: <strong className="text-amber-300 font-normal">{activeSubTitle}</strong>
                              </span>
                            ) : (
                              <span className="text-zinc-500">زیرنویس خودکار فعال است</span>
                            )}
                          </div>
                        </div>
                      </div>
                      </div>
                      </div>,
                      document.body
                      )}

                  {activeModal === "trailer" && trailerKey && typeof document !== "undefined" && createPortal(
                  <div className="fixed inset-0 z-[999999]" dir="ltr">
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setActiveModal(null)} />
                  <div className="fixed inset-4 sm:inset-8 md:inset-12 lg:inset-16 z-[1000000] bg-black/95 rounded-2xl overflow-hidden border border-white/20 shadow-2xl flex flex-col">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-950/90 border-b border-white/10 shrink-0">
                    <span className="text-xs text-white/70 font-semibold">Trailer</span>
                    <button className="text-white/70 hover:text-white text-lg px-2" onClick={() => setActiveModal(null)}>✕</button>
                  </div>
                  <div className="flex-1 min-h-0 relative">
                    <iframe
                      src={`https://www.youtube.com/embed/${trailerKey}`}
                      className="size-full border-0 absolute inset-0"
                      allowFullScreen
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    />
                  </div>
                  </div>
                  </div>,
                  document.body
                  )}

              {user ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full">
                        <Plus className="size-4 me-2" /> {t("movie.addToList")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-56">
                      {watchlists.data?.length ? (
                        watchlists.data.map((wl) => (
                          <DropdownMenuItem
                            key={wl.id}
                            onClick={() => addToWatchlist.mutate(wl.id)}
                            disabled={wl.items.some((it) => it.movieId === m.id)}
                          >
                            {wl.items.some((it) => it.movieId === m.id) ? "✓ " : ""}
                            {wl.name}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <DropdownMenuItem onClick={() => navigate("/watchlist")}>
                          {t("watchlist.noLists")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => startWatchParty.mutate()}
                    disabled={startWatchParty.isPending}
                  >
                    {startWatchParty.isPending ? (
                      <Loader2 className="size-4 me-2 animate-spin" />
                    ) : (
                      <Users className="size-4 me-2" />
                    )}
                    {t("movie.startWatchParty")}
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {/* Info */}
          <div className="md:col-span-2">
            <h1 className="text-3xl sm:text-4xl font-bold mb-3">{m.title}</h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-4">
              {m.year && (
                <span className="flex items-center gap-1">
                  <Calendar className="size-4" /> {m.year}
                </span>
              )}
              {m.runtime && (
                <span className="flex items-center gap-1">
                  <Clock className="size-4" /> {t("movie.runtime", { min: m.runtime })}
                </span>
              )}
              {m.genre && <Badge variant="secondary">{m.genre}</Badge>}
              {m.source === "ARCHIVE" && (
                <Badge className="bg-emerald-600 hover:bg-emerald-700">Free to watch</Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-6 mb-6">
              {m.rating && (
                <div className="flex items-center gap-2">
                  <div className="size-12 rounded-full bg-card border border-border flex items-center justify-center font-bold text-primary">
                    {m.rating.toFixed(1)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>TMDB</div>
                    <div>{t("movie.rating")}</div>
                  </div>
                </div>
              )}
              {m.avgRating && (
                <div className="flex flex-col items-center">
                  <StarRating value={m.avgRating} size={20} />
                  <span className="text-xs text-muted-foreground mt-1">
                    {m.avgRating.toFixed(1)} · {t("movie.reviewsCount", { count: m.reviewCount })}
                  </span>
                </div>
              )}
            </div>

            {m.description && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-2">{t("movie.overview")}</h2>
                <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                  {m.description}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Reviews */}
        <div className="mt-12 grid lg:grid-cols-3 gap-8">
          {/* Write review */}
          <div className="lg:col-span-1">
            <Card className="p-5 sticky top-20">
              <h2 className="font-semibold mb-3">
                {myReview || editingId ? t("movie.editReview") : t("movie.writeReview")}
              </h2>
              {!user ? (
                <p className="text-sm text-muted-foreground">{t("movie.loginToReview")}</p>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      {t("movie.yourRating")}
                    </label>
                    <RatingInput value={reviewRating} onChange={setReviewRating} />
                  </div>
                  <Textarea
                    value={reviewContent}
                    onChange={(e) => setReviewContent(e.target.value)}
                    placeholder={t("movie.reviewPlaceholder")}
                    className="mb-3 min-h-24"
                  />
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 bg-red-600 hover:bg-red-700"
                      disabled={!reviewContent.trim() || submitReview.isPending}
                      onClick={() => submitReview.mutate()}
                    >
                      {submitReview.isPending && <Loader2 className="size-4 me-2 animate-spin" />}
                      {editingId ? t("movie.updateReview") : t("movie.postReview")}
                    </Button>
                    {myReview && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditingId(myReview.id);
                          setReviewContent(myReview.content);
                          setReviewRating(myReview.rating);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* Reviews list */}
          <div className="lg:col-span-2">
            <h2 className="font-semibold mb-4">
              {t("movie.reviews")} ({reviews.data?.length ?? 0})
            </h2>
            {reviews.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            ) : reviews.data?.length ? (
              <div className="space-y-3">
                {reviews.data.map((r) => (
                  <Card key={r.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <button onClick={() => navigate(`/profile/${r.user.username}`)}>
                        <UserAvatar username={r.user.username} avatar={r.user.avatar} size={40} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => navigate(`/profile/${r.user.username}`)}
                            className="font-medium text-sm hover:text-primary"
                          >
                            {r.user.username}
                          </button>
                          <StarRating value={r.rating} size={12} />
                          <span className="text-xs text-muted-foreground">
                            {r.rating.toFixed(0)}/10
                          </span>
                          {r.updatedAt !== r.createdAt && (
                            <span className="text-xs text-muted-foreground italic">
                              {t("review.edited")}
                            </span>
                          )}
                          {r.user.id === user?.id && (
                            <div className="ms-auto flex gap-1">
                              <button
                                onClick={() => {
                                  setEditingId(r.id);
                                  setReviewContent(r.content);
                                  setReviewRating(r.rating);
                                  window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                                className="text-muted-foreground hover:text-primary p-1"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                onClick={() => deleteReview.mutate(r.id)}
                                className="text-muted-foreground hover:text-destructive p-1"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          )}
                          {user?.role === "ADMIN" && r.user.id !== user?.id && (
                            <button
                              onClick={() => deleteReview.mutate(r.id)}
                              className="ms-auto text-muted-foreground hover:text-destructive p-1"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                        <p className="text-sm mt-1.5 whitespace-pre-line">{r.content}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                {t("movie.noReviews")}
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
