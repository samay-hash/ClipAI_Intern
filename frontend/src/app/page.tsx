"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// On Amplify, uploads must go directly to backend (avoids Amplify/CloudFront body limits).
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

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
  const [maxBroll, setMaxBroll] = useState(8);
  const [brollMoments, setBrollMoments] = useState<any[]>([]);
  const [qualityReport, setQualityReport] = useState<any>(null);

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
      formData.append("maxBroll", maxBroll.toString());

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
              
              // Track B-Roll moments as they get detected
              if (pollData.broll_moments) {
                setBrollMoments(pollData.broll_moments);
              }
              
              if (pollData.progress === 100 && pollData.result) {
                 clearInterval(pollInterval);
                 setSegmentCount(pollData.result.transcript_segments || 0);
                 if (pollData.result.broll_moments) setBrollMoments(pollData.result.broll_moments);
                 if (pollData.result.quality_report) setQualityReport(pollData.result.quality_report);
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
  }, [language, captionStyle, enableBroll, style, maxBroll, history]);


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
    setBrollMoments([]);
    setQualityReport(null);
  };

  const deleteHistoryItem = (index: number) => {
    const newHistory = history.filter((_, i) => i !== index);
    setHistory(newHistory);
    localStorage.setItem("clipai_history", JSON.stringify(newHistory));
  };

  return (
    <main className="flex-1">
      <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300" style={{ background: 'transparent' }}>
        <div className="max-w-[1600px] mx-auto px-10 h-24 flex items-center justify-between">
          {/* Logo - Left */}
          <div className="flex items-center cursor-pointer group" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <span className="font-black text-xl tracking-[0.25em] uppercase text-white">
              CLIP AI
            </span>
          </div>

          {/* Nav Links - Center */}
          <div className="hidden md:flex items-center gap-8">
            <button 
              onClick={() => uploadRef.current?.scrollIntoView({ behavior: "smooth" })} 
              className="text-[12px] font-black tracking-[0.2em] text-white/60 hover:text-white transition-all uppercase"
            >
              EDITOR
            </button>
            <span className="text-white/10 text-xl font-thin">/</span>
            <button 
              onClick={() => document.getElementById('gallery')?.scrollIntoView({ behavior: "smooth" })} 
              className="text-[12px] font-black tracking-[0.2em] text-white/60 hover:text-white transition-all uppercase"
            >
              GALLERY
            </button>
            <span className="text-white/10 text-xl font-thin">/</span>
            <a 
              href="#how-it-works" 
              className="text-[12px] font-black tracking-[0.2em] text-white/60 hover:text-white transition-all uppercase"
            >
              HOW IT WORKS
            </a>
          </div>

          {/* Action - Right */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => uploadRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="px-8 py-3 rounded-full text-[11px] font-black tracking-[0.2em] text-black border-none shadow-[0_10px_25px_rgba(250,204,21,0.2)] transition-all hover:scale-105 hover:shadow-[0_15px_35px_rgba(250,204,21,0.3)] uppercase"
              style={{ background: 'linear-gradient(to right, #FACC15, #EAB308)' }}
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>


      {/* ─── Hero Section ─── */}
      <section id="hero" className="pt-40 pb-20 px-6 relative overflow-hidden min-h-[90vh] flex flex-col justify-center">
        {/* Background images with opacity */}
        <div className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: 'url(/10099.jpg)' }}></div>
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.1)_0%,rgba(0,0,0,0.5)_100%)] bg-black/30"></div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          {/* Heading */}
          <h1 className="animate-fade-in-up stagger-2 text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.08] mb-6">
            AI Video Editor
            <br />
            <span style={{ color: '#EAB308' }}>in Seconds</span>
          </h1>

          {/* Subheading */}
          <p className="animate-fade-in-up stagger-3 text-lg sm:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto mb-10 leading-relaxed text-white/80">
            Upload your video and let AI edit it automatically.
            <br className="hidden sm:block" />
            Auto captions, smart processing, clean output — effortlessly.
          </p>

          {/* CTA */}
          <div className="animate-fade-in-up stagger-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => uploadRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="text-base px-8 py-4 rounded-xl text-black font-bold flex items-center gap-2 transition-transform hover:scale-105 shadow-lg"
              style={{ background: 'linear-gradient(to right, #FACC15, #EAB308)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
      <section ref={uploadRef} id="upload" className="section px-6 py-24 relative overflow-hidden">
        <div className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: 'url(/10039.jpg)' }}></div>
        <div className="absolute inset-0 -z-10 bg-black/95"></div>
        <div className="max-w-2xl mx-auto relative z-10">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Upload Your Video</h2>
            <p className="text-[var(--text-secondary)]">Drop your video or paste a URL</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mb-8">
             <div className="flex-1 relative group">
               <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full p-4 rounded-2xl border border-white/10 bg-white/5 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#FACC15] transition-all pr-10 hover:bg-white/10 text-white/80">
                  <option value="auto">Auto-detect Language</option>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
               </select>
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-60"><polyline points="6 9 12 15 18 9" /></svg>
             </div>
             <div className="flex-1 relative group">
               <select value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value)} className="w-full p-4 rounded-2xl border border-white/10 bg-white/5 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#FACC15] transition-all pr-10 hover:bg-white/10 text-white/80">
                  <option value="clean">Clean (White)</option>
                  <option value="hormozi">Action (Yellow & Bold)</option>
                  <option value="none">No Captions</option>
               </select>
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-60"><polyline points="6 9 12 15 18 9" /></svg>
             </div>
             <div className="flex-1 relative group">
               <select value={enableBroll.toString()} onChange={(e) => setEnableBroll(e.target.value === 'true')} className="w-full p-4 rounded-2xl border border-white/10 bg-white/5 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#FACC15] transition-all pr-10 hover:bg-white/10 text-white/80">
                  <option value="true">Auto AI B-Roll: ON</option>
                  <option value="false">Auto AI B-Roll: OFF</option>
               </select>
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-60"><polyline points="6 9 12 15 18 9" /></svg>
             </div>
             <div className="flex-1 relative group">
               <select value={style} onChange={(e) => setStyle(e.target.value)} disabled={!enableBroll} className={`w-full p-4 rounded-2xl border border-white/10 bg-white/5 text-sm appearance-none cursor-pointer focus:outline-none focus:border-[#FACC15] transition-all pr-10 hover:bg-white/10 text-white/80 ${!enableBroll ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <option value="cinematic">Style: Cinematic / Vlog</option>
                  <option value="hyper-realistic cyberpunk">Style: Cyberpunk</option>
                  <option value="anime aesthetic">Style: Anime / 2D</option>
               </select>
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-60"><polyline points="6 9 12 15 18 9" /></svg>
             </div>
          </div>

          {/* B-Roll Moments Slider */}
          {enableBroll && (
            <div className="mb-8 p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="url(#gradIcon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <defs><linearGradient id="gradIcon" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#6C5CE7"/><stop offset="100%" stopColor="#00D2FF"/></linearGradient></defs>
                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" />
                  </svg>
                  B-Roll Moments
                </label>
                <span className="text-lg font-black gradient-text">{maxBroll} clips</span>
              </div>
              <div className="relative z-20 w-full py-2">
                <input 
                  type="range" 
                  min="3" 
                  max="25" 
                  step="1"
                  value={maxBroll} 
                  onChange={(e) => setMaxBroll(parseInt(e.target.value))}
                  className="w-full relative z-30 cursor-pointer pointer-events-auto"
                  style={{ pointerEvents: 'auto' }}
                />
              </div>
              <div className="flex justify-between text-[10px] mt-2 font-medium" style={{ color: 'var(--text-muted)' }}>
                <span>Subtle (3)</span>
                <span>Balanced (8)</span>
                <span>Heavy (15)</span>
                <span>Maximum (25)</span>
              </div>
            </div>
          )}

          {status === "idle" || status === "error" ? (
            <>
              <label
                htmlFor="video-upload"
                className={`block drop-zone p-12 sm:p-16 text-center ${dragActive ? "drag-active" : ""}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <input
                  id="video-upload"
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-msvideo,video/webm"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = '';
                  }}
                />
                <div className="relative z-10 flex flex-col items-center">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center relative group" style={{ background: 'var(--accent-light)' }}>
                    <div className="absolute inset-0 rounded-2xl opacity-50 group-hover:opacity-100 transition-opacity" style={{ background: 'var(--accent-gradient)', filter: 'blur(15px)' }}></div>
                    <div className="relative z-10 w-full h-full flex items-center justify-center rounded-2xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-accent)' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent-2)]">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-xl font-bold mb-2 cursor-pointer">
                    {dragActive ? <span className="gradient-text">Drop it right here!</span> : "Drag & drop your video"}
                  </p>
                  <p className="text-sm text-[var(--text-muted)] mb-4 cursor-pointer">
                    or click to browse files
                  </p>
                  <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)] pointer-events-none">
                    <span className="px-2 py-1 rounded bg-[var(--bg-secondary)]">MP4</span>
                    <span className="px-2 py-1 rounded bg-[var(--bg-secondary)]">MOV</span>
                    <span className="px-2 py-1 rounded bg-[var(--bg-secondary)]">AVI</span>
                    <span className="px-2 py-1 rounded bg-[var(--bg-secondary)]">WebM</span>
                    <span className="text-[var(--text-muted)]">• Max 500MB</span>
                  </div>
                </div>
              </label>
              
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
                           if (result.success && result.job_id) {
                             setStatusText("Downloading video...");
                             // Poll for status (same as file upload)
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
                                   const newHistory = [{
                                     id: result.job_id,
                                     name: externalUrl.split('/').pop() || "Video from URL",
                                     url: finalUrl,
                                     date: new Date().toLocaleDateString()
                                   }, ...history];
                                   setHistory(newHistory);
                                   localStorage.setItem("clipai_history", JSON.stringify(newHistory));
                                 } else if (pollData.step === "Failed") {
                                   clearInterval(pollInterval);
                                   throw new Error(pollData.error || "AI Processing Failed");
                                 }
                               } catch(e) { console.error(e); }
                             }, 1500);
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
                <div className="mt-6 space-y-3 animate-fade-in">
                  <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                    <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                      {statusText}
                    </p>
                  </div>
                  
                  {/* Live B-Roll Moments Tracker */}
                  {brollMoments.length > 0 && (
                    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/></svg>
                        B-Roll Moments Detected ({brollMoments.length})
                      </p>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {brollMoments.map((m: any, i: number) => (
                          <div key={i} className="flex items-center gap-3 text-xs p-2 rounded-lg bg-[var(--bg-primary)]">
                            <span className="font-mono text-[var(--accent)] flex-shrink-0">{Number(m.start).toFixed(1)}s</span>
                            <span className="font-medium flex-1 truncate">&quot;{m.keyword}&quot;</span>
                            {m.reason && <span className="text-[var(--text-muted)] truncate max-w-[150px]">{m.reason}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

              {/* AI Quality Report removed as requested */}
              {/* B-Roll Timeline */}
              {brollMoments.length > 0 && (
                <div className="mt-4 p-6 glow-card bg-[var(--bg-elevated)] border-[var(--border-accent)] animate-fade-in">
                  <h4 className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-4 flex items-center gap-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent)]"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/></svg>
                    B-Roll Timeline ({brollMoments.length})
                  </h4>
                  <div className="space-y-2">
                    {brollMoments.map((m: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 text-xs p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] shadow-sm">
                        <span className="w-7 h-7 rounded-full text-white flex items-center justify-center font-bold flex-shrink-0" style={{ background: 'var(--accent-gradient)' }}>{i+1}</span>
                        <span className="font-mono text-[var(--accent-2)] flex-shrink-0 font-semibold bg-[rgba(0,210,255,0.1)] px-2 py-1 rounded">{Number(m.start).toFixed(1)}s – {Number(m.end).toFixed(1)}s</span>
                        <span className="font-medium flex-1 truncate text-white">&quot;{m.keyword}&quot;</span>
                        {m.fetched !== undefined && (
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase ${m.fetched ? 'bg-[var(--success-light)] text-[var(--success)] border border-[rgba(34,197,94,0.3)]' : 'bg-[#3f1616] text-[var(--danger)] border border-[rgba(239,68,68,0.3)]'}`}>
                            {m.fetched ? '✓ Synced' : '✗ Failed'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section id="features" className="section px-6 relative py-32">
        <div className="absolute inset-0 bg-cover bg-center -z-20" style={{ backgroundImage: 'url(/10039.jpg)' }}></div>
        <div className="absolute inset-0 bg-black/95 -z-10"></div>
        <div className="max-w-5xl mx-auto z-10 relative">
          <div className="text-center mb-16 relative">
            <span className="inline-block text-[var(--accent-2)] text-sm font-bold tracking-widest uppercase mb-3 px-3 py-1 bg-[rgba(0,210,255,0.1)] rounded-full">Pro Features</span>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-4">Everything you need</h2>
            <p className="text-[var(--text-secondary)] max-w-xl mx-auto text-lg pt-2">
              Transform raw footage into high-retention cinematic content instantly.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-16">
            {/* Feature 1 */}
            <div className="group transition-all hover:-translate-y-2 duration-500">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-8 bg-[#FACC15]/10 group-hover:bg-[#FACC15]/20 transition-all">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black mb-4 text-white uppercase italic tracking-tighter">Hyper <span className="text-[#FACC15]">Captions</span></h3>
              <p className="text-sm text-white/50 leading-relaxed font-medium group-hover:text-white/70 transition-colors">
                Whisper-level speech recognition with customizable dynamic styles designed for TikTok, Reels, and Shorts.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group transition-all hover:-translate-y-2 duration-500">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-8 bg-[#FACC15]/10 group-hover:bg-[#FACC15]/20 transition-all">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                  <line x1="7" y1="2" x2="7" y2="22" />
                  <line x1="17" y1="2" x2="17" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                </svg>
              </div>
              <h3 className="text-2xl font-black mb-4 text-white uppercase italic tracking-tighter">Cinematic <span className="text-[#FACC15]">B-Roll</span></h3>
              <p className="text-sm text-white/50 leading-relaxed font-medium group-hover:text-white/70 transition-colors">
                Context-aware LLaMA analysis finds perfect stock footage exactly when you speak about it, fully automated.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group transition-all hover:-translate-y-2 duration-500">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-8 bg-[#FACC15]/10 group-hover:bg-[#FACC15]/20 transition-all">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black mb-4 text-white uppercase italic tracking-tighter">Lightning <span className="text-[#FACC15]">Fast</span></h3>
              <p className="text-sm text-white/50 leading-relaxed font-medium group-hover:text-white/70 transition-colors">
                Optimized pipeline using FFmpeg and Whisper delivers your edited video in minutes, not hours. Runs locally.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="section px-6 relative py-32">
        <div className="absolute inset-0 bg-cover bg-center -z-20" style={{ backgroundImage: 'url(/10039.jpg)' }}></div>
        <div className="absolute inset-0 bg-black/95 -z-10"></div>
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
                  <div className="w-24 h-24 mx-auto mb-5 rounded-2xl bg-[#FACC15]/5 flex items-center justify-center text-white/40 group-hover:text-[#FACC15] transition-all">
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
      <section className="section px-6 relative py-32">
        <div className="absolute inset-0 bg-cover bg-center -z-20" style={{ backgroundImage: 'url(/10039.jpg)' }}></div>
        <div className="absolute inset-0 bg-black/95 -z-10"></div>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="inline-block px-3 py-1 bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-full text-xs font-mono font-bold tracking-widest uppercase mb-4 shadow-sm">AI Core Engine</span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Inside the AI Pipeline</h2>
            <p className="text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
              Step-by-step breakdown of how the Python backend processes your video with AI logic.
            </p>
          </div>

          <div className="relative py-10 overflow-hidden">
              <div className="hidden lg:block absolute top-[40%] left-[10%] right-[10%] h-[2px] bg-white/5 -z-0 rounded-full"></div>
              
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
      <section className="section px-6 relative py-32">
        <div className="absolute inset-0 bg-cover bg-center -z-20" style={{ backgroundImage: 'url(/10039.jpg)' }}></div>
        <div className="absolute inset-0 bg-black/95 -z-10 text-center"></div>
        <div className="max-w-3xl mx-auto text-center">
          <div className="py-12 sm:py-16 relative">
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

      {/* ─── Gallery Section ─── */}
      {history.length > 0 && (
        <section id="gallery" className="section px-6 py-32 relative overflow-hidden">
          <div className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: 'url(/10039.jpg)' }}></div>
          <div className="absolute inset-0 -z-10 bg-black/95"></div>
          
          <div className="max-w-7xl mx-auto relative z-10">
            <div className="text-center mb-16">
              <span className="inline-block text-[#FACC15] text-sm font-black tracking-[0.2em] uppercase mb-3">Portfolio</span>
              <h2 className="text-4xl font-black text-white mb-4 uppercase italic tracking-tighter">Your <span className="text-[#FACC15]">Creations</span></h2>
              <div className="w-20 h-1 bg-[#FACC15] mx-auto rounded-full"></div>
            </div>

            <div className="grid md:grid-cols-3 gap-16">
              {history.map((item, i) => (
                <div key={i} className="group relative transition-all hover:-translate-y-2 duration-500">
                  <button 
                    onClick={() => deleteHistoryItem(i)} 
                    className="absolute top-4 right-4 p-2.5 rounded-xl bg-black/50 text-white/20 hover:text-red-500 hover:bg-white transition-all z-20 shadow-xl opacity-0 group-hover:opacity-100"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                  
                  <div className="relative z-10">
                    <h3 className="font-bold text-lg truncate mb-1 text-white pr-10">{item.name}</h3>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 font-black mb-6">{item.date}</p>
                    
                    <div className="rounded-[2rem] overflow-hidden border border-white/5 aspect-video relative shadow-2xl">
                      <video src={item.url} controls className="w-full h-full object-cover bg-black" />
                    </div>

                    <a href={item.url} download className="mt-8 w-full flex items-center justify-center gap-2 text-[11px] font-black tracking-widest text-black bg-[#FACC15] py-4 rounded-2xl transition-all hover:shadow-[0_20px_40px_rgba(250,204,21,0.2)] hover:scale-[1.02] uppercase italic">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download This Creation
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── Footer ─── */}
      <footer className="py-10 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center -z-20" style={{ backgroundImage: 'url(/10039.jpg)' }}></div>
        <div className="absolute inset-0 bg-black/95 -z-10"></div>
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 relative z-10">
          <div className="flex items-center">
            <span className="font-black text-sm tracking-[0.2em] uppercase text-white/40">
              CLIP AI
            </span>
          </div>
          <p className="text-[10px] font-bold tracking-widest text-white/30 uppercase">
            © {new Date().getFullYear()} ClipAI. Built with AI, FFmpeg & Whisper.
          </p>
        </div>
      </footer>
    </main>
  );
}
