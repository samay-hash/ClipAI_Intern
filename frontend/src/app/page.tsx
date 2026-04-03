"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

type Status = "idle" | "uploading" | "processing" | "complete" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [segmentCount, setSegmentCount] = useState(0);
  
  // New Assignment Features
  const [enableBroll, setEnableBroll] = useState(true);
  const [style, setStyle] = useState("cinematic");
  const [statusText, setStatusText] = useState("Initializing...");
  const [captionStyle, setCaptionStyle] = useState("clean");
  const [language, setLanguage] = useState("auto");
  const [externalUrl, setExternalUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"editor" | "gallery">("editor");
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("clipai_history");
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLDivElement>(null);



  // Scroll to result when complete
  useEffect(() => {
    if (status === "complete" && resultRef.current) {
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }, [status]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFile = useCallback(async (file: File) => {
    const validTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
    if (!validTypes.includes(file.type)) {
      setErrorMsg("Please upload a valid video file (MP4, MOV, AVI, WebM)");
      setStatus("error");
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      setErrorMsg("File too large. Maximum size is 500MB.");
      setStatus("error");
      return;
    }

    setFileName(file.name);
    setFileSize(formatSize(file.size));
    setStatus("uploading");
    setProgress(0);
    setErrorMsg("");
    setVideoUrl("");

    try {
      // Upload phase
      const formData = new FormData();
      formData.append("video", file);
      formData.append("language", language);
      formData.append("captionStyle", captionStyle);
      formData.append("enableBroll", enableBroll.toString());
      formData.append("style", style);

      // Simulate upload progress
      const uploadInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 15, 95));
      }, 200);

      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });

      clearInterval(uploadInterval);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed");
      }

      const result = await response.json();

      if (result.success && result.job_id) {
        setStatus("processing");
        setProgress(5);
        setStatusText("Processing started in background");
        
        // Start long-polling for real-time accurate status
        const pollInterval = setInterval(async () => {
           try {
              const pollRes = await fetch(`${API_URL}/api/status/${result.job_id}`);
              const pollData = await pollRes.json();
              
              setProgress(pollData.progress || 10);
              setStatusText(pollData.step || "Processing...");
              
              if (pollData.progress === 100 && pollData.result) {
                 clearInterval(pollInterval);
                 setSegmentCount(pollData.result.transcript_segments || 0);
                 const finalUrl = pollData.result.video_url.startsWith("http") ? pollData.result.video_url : `${API_URL}${pollData.result.video_url}`;
                 setVideoUrl(finalUrl);
                 setStatus("complete");
                 
                 // Save to gallery
                 const newHistory = [{
                   id: result.job_id,
                   name: file.name,
                   url: finalUrl,
                   date: new Date().toLocaleDateString()
                 }, ...history];
                 setHistory(newHistory);
                 localStorage.setItem("clipai_history", JSON.stringify(newHistory));
              } else if (pollData.step === "Failed") {
                 clearInterval(pollInterval);
                 throw new Error(pollData.error || "AI Processing Failed");
              }
           } catch(e) {
              console.error(e);
           }
        }, 1500);

      } else {
        throw new Error(result.error || "Processing initialization failed");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(message);
      setStatus("error");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files?.[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    },
    [handleFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  const reset = () => {
    setStatus("idle");
    setProgress(0);
    setErrorMsg("");
    setVideoUrl("");
    setFileName("");
    setFileSize("");
    setSegmentCount(0);
  };

  return (
    <main className="flex-1">
      {/* ─── Navbar ─── */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <span className="font-bold text-lg tracking-tight">ClipAI</span>
          </div>
          <div className="hidden sm:flex items-center gap-8 text-sm text-[var(--text-secondary)]">
            <button onClick={() => setActiveTab("editor")} className={activeTab === "editor" ? "text-[var(--accent)] font-semibold" : "hover:text-[var(--text-primary)]"}>Editor</button>
            <button onClick={() => setActiveTab("gallery")} className={activeTab === "gallery" ? "text-[var(--accent)] font-semibold" : "hover:text-[var(--text-primary)]"}>Gallery</button>
            <a href="#how-it-works" className="hover:text-[var(--text-primary)] transition-colors">How It Works</a>
            <button
              onClick={() => { setActiveTab("editor"); uploadRef.current?.scrollIntoView({ behavior: "smooth" }); }}
              className="btn-primary !py-2 !px-5 !text-sm"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {activeTab === "gallery" ? (
        <section className="pt-32 pb-20 px-6 max-w-6xl mx-auto min-h-screen">
          <h2 className="text-3xl font-bold mb-8">Your Projects</h2>
          {history.length === 0 ? (
            <p className="text-[var(--text-secondary)]">No videos processed yet.</p>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {history.map((item, i) => (
                <div key={i} className="card p-4 overflow-hidden group">
                  <h3 className="font-medium truncate mb-2">{item.name}</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-3">{item.date}</p>
                  <video src={item.url} controls className="w-full h-40 object-cover rounded-lg bg-black/5" />
                  <a href={item.url} download className="mt-4 block text-center text-sm font-medium text-[var(--accent)] bg-[var(--accent-light)] py-2 rounded-lg">Download</a>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
      {/* ─── Hero Section ─── */}
      <section className="pt-40 pb-20 px-6 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-gradient-to-b from-[var(--accent-glow)] to-transparent opacity-60 blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-10 w-24 h-24 rounded-full bg-[var(--accent-light)] opacity-40 animate-float pointer-events-none" />
        <div className="absolute top-60 left-10 w-16 h-16 rounded-full bg-[var(--accent-light)] opacity-30 animate-float pointer-events-none" style={{ animationDelay: "1s" }} />

        <div className="max-w-4xl mx-auto text-center relative">
          {/* Badge */}
          <div className="animate-fade-in-up stagger-1 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--accent-light)] text-[var(--accent-hover)] text-sm font-medium mb-8">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Powered by AI
          </div>

          {/* Heading */}
          <h1 className="animate-fade-in-up stagger-2 text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.08] mb-6">
            AI Video Editor
            <br />
            <span className="gradient-text">in Seconds</span>
          </h1>

          {/* Subheading */}
          <p className="animate-fade-in-up stagger-3 text-lg sm:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto mb-10 leading-relaxed">
            Upload your video and let AI edit it automatically.
            <br className="hidden sm:block" />
            Auto captions, smart processing, clean output — effortlessly.
          </p>

          {/* CTA */}
          <div className="animate-fade-in-up stagger-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => uploadRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="btn-primary text-base px-8 py-4"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload Video
            </button>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm font-medium"
            >
              See how it works
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
          </div>

          {/* Stats */}
          <div className="animate-fade-in-up stagger-5 mt-16 flex items-center justify-center gap-10 sm:gap-16 text-sm text-[var(--text-secondary)]">
            <div className="flex flex-col items-center">
              <span className="text-2xl font-bold text-[var(--text-primary)]">100%</span>
              <span>Free & Local</span>
            </div>
            <div className="w-px h-10 bg-[var(--border)]" />
            <div className="flex flex-col items-center">
              <span className="text-2xl font-bold text-[var(--text-primary)]">AI</span>
              <span>Auto Captions</span>
            </div>
            <div className="w-px h-10 bg-[var(--border)]" />
            <div className="flex flex-col items-center">
              <span className="text-2xl font-bold text-[var(--text-primary)]">Fast</span>
              <span>Processing</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Upload Section ─── */}
      <section ref={uploadRef} id="upload" className="section px-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Upload Your Video</h2>
            <p className="text-[var(--text-secondary)]">Drop your video or paste a URL</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mb-8">
             <select value={language} onChange={(e) => setLanguage(e.target.value)} className="flex-1 p-3 rounded-xl border border-[var(--border)] bg-transparent text-sm">
                <option value="auto">Auto-detect Language</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
             </select>
             <select value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value)} className="flex-1 p-3 rounded-xl border border-[var(--border)] bg-transparent text-sm">
                <option value="clean">Clean (White)</option>
                <option value="hormozi">Action (Yellow & Bold)</option>
             </select>
             <select value={enableBroll.toString()} onChange={(e) => setEnableBroll(e.target.value === 'true')} className="flex-1 p-3 rounded-xl border border-[var(--border)] bg-transparent text-sm">
                <option value="true">Auto AI B-Roll: ON</option>
                <option value="false">Auto AI B-Roll: OFF (Captions Only)</option>
             </select>
             <select value={style} onChange={(e) => setStyle(e.target.value)} disabled={!enableBroll} className={`flex-1 p-3 rounded-xl border border-[var(--border)] bg-transparent text-sm ${!enableBroll ? 'opacity-50' : ''}`}>
                <option value="cinematic">Style: Cinematic / Vlog</option>
                <option value="hyper-realistic cyberpunk">Style: Cyberpunk</option>
                <option value="anime aesthetic">Style: Anime / 2D</option>
             </select>
          </div>

          {status === "idle" || status === "error" ? (
            <>
              <div
                className={`drop-zone p-12 sm:p-16 text-center ${dragActive ? "drag-active" : ""}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-msvideo,video/webm"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <div className="relative z-10">
                  <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold mb-2">
                    {dragActive ? "Drop your video here" : "Drag & drop your video"}
                  </p>
                  <p className="text-sm text-[var(--text-muted)] mb-4">
                    or click to browse files
                  </p>
                  <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                    <span className="px-2 py-1 rounded bg-[var(--bg-secondary)]">MP4</span>
                    <span className="px-2 py-1 rounded bg-[var(--bg-secondary)]">MOV</span>
                    <span className="px-2 py-1 rounded bg-[var(--bg-secondary)]">AVI</span>
                    <span className="px-2 py-1 rounded bg-[var(--bg-secondary)]">WebM</span>
                    <span className="text-[var(--text-muted)]">• Max 500MB</span>
                  </div>
                </div>
              </div>
              
              <div className="mt-4 flex items-center gap-3">
                <div className="h-px bg-[var(--border)] flex-1"></div>
                <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">OR</span>
                <div className="h-px bg-[var(--border)] flex-1"></div>
              </div>

              <div className="mt-4 flex gap-2">
                <input 
                  type="url" 
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="Paste a public video URL (.mp4)" 
                  className="flex-1 p-3 rounded-xl border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:border-[var(--accent)]"
                />
                <button 
                  onClick={async () => {
                     if(externalUrl) {
                        setStatus("processing");
                        setProgress(15);
                        setErrorMsg("");
                        try {
                           const response = await fetch(`${API_URL}/api/upload-url`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                 videoUrl: externalUrl,
                                 language, captionStyle, enableBroll, style
                              })
                           });
                           if (!response.ok) throw new Error("Failed to process URL");
                           const result = await response.json();
                           if (result.success) {
                             setProgress(100);
                             setSegmentCount(result.transcript_segments || 0);
                             const finalUrl = result.video_url.startsWith("http") ? result.video_url : `${API_URL}${result.video_url}`;
                             setVideoUrl(finalUrl);
                             setStatus("complete");
                             
                             const newHistory = [{
                               id: result.job_id,
                               name: externalUrl.split('/').pop() || "Video from URL",
                               url: finalUrl,
                               date: new Date().toLocaleDateString()
                             }, ...history];
                             setHistory(newHistory);
                             localStorage.setItem("clipai_history", JSON.stringify(newHistory));
                           }
                        } catch(err) {
                           setErrorMsg("Error processing URL");
                           setStatus("error");
                        }
                     }
                  }}
                  className="btn-primary !py-2 !px-4 !rounded-xl"
                >Process URL</button>
              </div>
              {status === "error" && (
                <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-100 flex items-start gap-3 animate-fade-in">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-red-800">{errorMsg}</p>
                    <button onClick={reset} className="text-sm text-red-600 hover:text-red-800 mt-1 underline underline-offset-2">
                      Try again
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : status === "uploading" || status === "processing" ? (
            <div className="card p-8 sm:p-10 animate-fade-in">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{fileName}</p>
                  <p className="text-sm text-[var(--text-muted)]">{fileSize}</p>
                </div>
              </div>

              <div className="progress-bar mb-3">
                <div className="progress-fill" style={{ width: `${Math.round(progress)}%` }} />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {status === "uploading" ? (
                    <span className="status-chip processing">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin-slow">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Uploading...
                    </span>
                  ) : (
                    <span className="status-chip processing">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin-slow">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      AI Processing...
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium text-[var(--text-muted)]">{Math.round(progress)}%</span>
              </div>

              {status === "processing" && (
                <div className="mt-6 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-light)] animate-fade-in">
                  <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    {statusText}
                  </p>
                </div>
              )}
            </div>
          ) : status === "complete" ? (
            <div ref={resultRef} className="card p-8 sm:p-10 animate-slide-up border-[var(--accent)] border-opacity-30" style={{ borderColor: "rgba(34, 197, 94, 0.2)" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-[var(--accent-light)] flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Video Ready!</h3>
                  <p className="text-sm text-[var(--text-muted)]">{segmentCount} caption segments generated</p>
                </div>
              </div>

              {/* Video preview */}
              <div className="rounded-xl overflow-hidden bg-black mb-6">
                <video
                  src={videoUrl}
                  controls
                  className="w-full max-h-[400px] object-contain"
                  preload="metadata"
                />
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href={videoUrl}
                  download
                  className="btn-primary flex-1 justify-center"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download Video
                </a>
                <button
                  onClick={reset}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all text-sm font-medium"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Process Another
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ─── Features Section ─── */}
      <section id="features" className="section px-6 bg-[var(--bg-secondary)]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <span className="inline-block text-[var(--accent)] text-sm font-semibold tracking-wide uppercase mb-3">Features</span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Everything you need</h2>
            <p className="text-[var(--text-secondary)] max-w-xl mx-auto">
              Simple yet powerful AI tools to transform your raw footage into polished content
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="card group">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent-light)] flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Auto Captions</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                AI-powered speech recognition generates accurate subtitles and burns them directly into your video. Clean, readable, professional.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="card group">
              <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                  <line x1="7" y1="2" x2="7" y2="22" />
                  <line x1="17" y1="2" x2="17" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <line x1="2" y1="7" x2="7" y2="7" />
                  <line x1="2" y1="17" x2="7" y2="17" />
                  <line x1="17" y1="7" x2="22" y2="7" />
                  <line x1="17" y1="17" x2="22" y2="17" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Smart B-Roll</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Intelligent scene detection identifies key moments. Future updates will auto-insert relevant B-roll footage seamlessly.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="card group">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Fast Processing</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Optimized pipeline using FFmpeg and Whisper delivers your edited video in minutes, not hours. Runs entirely on your machine.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="section px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <span className="inline-block text-[var(--accent)] text-sm font-semibold tracking-wide uppercase mb-3">How it works</span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Three simple steps</h2>
            <p className="text-[var(--text-secondary)] max-w-xl mx-auto">
              From raw footage to polished video in just a few clicks
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Upload Video",
                desc: "Drag and drop or select your video file. We support MP4, MOV, AVI, and WebM formats.",
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                ),
              },
              {
                step: "02",
                title: "AI Processes",
                desc: "Our AI extracts audio, generates a transcript with Whisper, and creates beautiful captions.",
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                ),
              },
              {
                step: "03",
                title: "Download Result",
                desc: "Preview your captioned video and download the final result. It's that simple.",
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                ),
              },
            ].map((item, i) => (
              <div key={i} className="relative text-center group">
                {/* Connector line */}
                {i < 2 && (
                  <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px bg-[var(--border)] z-0" />
                )}
                <div className="relative z-10">
                  <div className="w-24 h-24 mx-auto mb-5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-light)] flex items-center justify-center text-[var(--text-secondary)] group-hover:border-[var(--accent)] group-hover:text-[var(--accent)] transition-all group-hover:shadow-lg">
                    {item.icon}
                  </div>
                  <span className="inline-block text-xs font-bold text-[var(--accent)] tracking-widest uppercase mb-2">
                    Step {item.step}
                  </span>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      
      {/* ─── Developer Architecture ─── */}
      <section className="section px-6 border-t border-[var(--border-light)] bg-black/[0.02] dark:bg-white/[0.02]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="inline-block px-3 py-1 bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-full text-xs font-mono font-bold tracking-widest uppercase mb-4 shadow-sm">AI Core Engine</span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Inside the AI Pipeline</h2>
            <p className="text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
              Step-by-step breakdown of how the Python backend processes your video with AI logic.
            </p>
          </div>

          <div className="relative p-6 sm:p-10 rounded-3xl bg-[var(--bg-primary)] border border-[var(--border)] overflow-hidden shadow-xl">
              <div className="hidden lg:block absolute top-[40%] left-[10%] right-[10%] h-[3px] bg-gradient-to-r from-[var(--text-muted)] via-purple-500/50 to-[var(--text-muted)] opacity-20 -z-0 rounded-full"></div>
              
              <div className="flex flex-col lg:flex-row items-center justify-between gap-6 relative z-10 w-full px-2">
                 
                 {/* Node 1 */}
                 <div className="flex flex-col items-center w-full lg:w-1/5 group cursor-default">
                    <div className="w-16 h-16 mb-4 rounded-xl bg-orange-50/50 dark:bg-orange-900/10 border border-orange-500/30 flex items-center justify-center transition-transform group-hover:-translate-y-1 relative">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse"></div>
                    </div>
                    <h4 className="font-semibold text-[13px] mb-1">1. Audio Extract</h4>
                    <p className="text-[11px] text-[var(--text-muted)] text-center">FFmpeg Subprocess</p>
                 </div>
                 
                 <div className="hidden lg:block w-4 text-[var(--border-light)]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
                 
                 {/* Node 2 */}
                 <div className="flex flex-col items-center w-full lg:w-1/5 group cursor-default">
                    <div className="w-16 h-16 mb-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-500/30 flex items-center justify-center transition-transform group-hover:-translate-y-1">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                    </div>
                    <h4 className="font-semibold text-[13px] mb-1">2. Transcribe</h4>
                    <p className="text-[11px] text-[var(--text-muted)] text-center">Groq Whisper API</p>
                 </div>
                 
                 <div className="hidden lg:block w-4 text-[var(--border-light)]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>

                 {/* Node 3 */}
                 <div className="flex flex-col items-center w-full lg:w-1/5 group cursor-default">
                    <div className="w-16 h-16 mb-4 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-500/30 flex items-center justify-center transition-transform group-hover:-translate-y-1">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <h4 className="font-semibold text-[13px] mb-1 text-center">3. Context Analysis</h4>
                    <p className="text-[11px] text-[var(--text-muted)] text-center">LLaMA-3 70B</p>
                 </div>
                 
                 <div className="hidden lg:block w-4 text-[var(--border-light)]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>

                 {/* Node 4 */}
                 <div className="flex flex-col items-center w-full lg:w-1/5 group cursor-default">
                    <div className="w-16 h-16 mb-4 rounded-xl bg-purple-50/50 dark:bg-purple-900/10 border border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.2)] flex items-center justify-center transition-transform group-hover:-translate-y-1 relative">
                        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse"></div>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A855F7" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>
                    <h4 className="font-semibold text-[13px] mb-1">4. Image Gen</h4>
                    <p className="text-[11px] text-[var(--text-muted)] text-center">Stable Diffusion XL</p>
                 </div>
                 
                 <div className="hidden lg:block w-4 text-[var(--border-light)]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>

                 {/* Node 5 */}
                 <div className="flex flex-col items-center w-full lg:w-1/5 group cursor-default">
                    <div className="w-16 h-16 mb-4 rounded-xl bg-pink-50/50 dark:bg-pink-900/10 border border-pink-500/30 flex items-center justify-center transition-transform group-hover:-translate-y-1">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EC4899" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>
                    </div>
                    <h4 className="font-semibold text-[13px] mb-1">5. Compositing</h4>
                    <p className="text-[11px] text-[var(--text-muted)] text-center">FFmpeg Video Burn</p>
                 </div>

              </div>
          </div>
        </div>
      </section>

      {/* ─── CTA Section ─── */}
      <section className="section px-6 bg-[var(--bg-secondary)]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="card p-12 sm:p-16 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-glow)] to-transparent opacity-50" />
            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Ready to edit your video?
              </h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-lg mx-auto">
                No signup required. No watermarks. Just upload your video and let AI do the magic.
              </p>
              <button
                onClick={() => uploadRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="btn-primary text-base px-8 py-4"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Start Editing — Free
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="py-10 px-6 border-t border-[var(--border-light)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[var(--accent)] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <span className="font-semibold text-sm">ClipAI</span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            © {new Date().getFullYear()} ClipAI. Built with AI, FFmpeg & Whisper.
          </p>
        </div>
      </footer>
      </>
      )}
    </main>
  );
}
