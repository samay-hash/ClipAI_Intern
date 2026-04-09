<div align="center">

<!-- Animated Header Banner -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:16a34a,100:22d3ee&height=220&section=header&text=ClipAI&fontSize=80&fontColor=ffffff&fontAlignY=35&desc=Generative%20AI%20B-Roll%20Video%20Engine&descSize=18&descAlignY=55&animation=fadeIn" width="100%"/>

<br/>

<!-- Animated Typing -->

<a href="https://git.io/typing-svg"><img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1000&color=16A34A&center=true&vCenter=true&multiline=true&repeat=true&width=700&height=80&lines=Upload+a+Video+%E2%86%92+AI+Generates+B-Roll+%E2%86%92+Get+Final+Cut;LLaMA+3+%7C+Stable+Diffusion+XL+%7C+FFmpeg+%7C+Groq+Whisper" alt="Typing SVG" /></a>

<br/><br/>

<!-- Badges -->

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)](https://ffmpeg.org)
[![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

<br/>

[![Render](https://img.shields.io/badge/Deployed_on-Render-46E3B7?style=flat-square&logo=render)](https://clipai-intern.onrender.com)
[![Vercel](https://img.shields.io/badge/Frontend_on-Vercel-000?style=flat-square&logo=vercel)](https://clip-ai-intern.vercel.app)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/samay-hash/ClipAI_Intern?style=flat-square&color=gold)](https://github.com/samay-hash/ClipAI_Intern)

</div>

---

## 🧬 What is ClipAI?

**ClipAI** is an **end-to-end AI-powered autonomous video editing pipeline** that transforms raw talking-head videos into professional, engagement-ready shorts — completely hands-free.

It uses cutting-edge **Large Language Models (LLaMA-3)**, **Text-to-Image Diffusion (Stable Diffusion XL)**, and **FFmpeg hardware compositing** to:

- 🎤 **Transcribe** your video using Groq Whisper
- 🧠 **Analyze context** via LLaMA-3.3-70B to find visually interesting moments
- 🎨 **Generate cinematic B-Roll** images matching the speaker's words
- 🎬 **Composite everything** with zoompan animations, fades, and subtitle burns
- ☁️ **Deliver** the final cut via Cloudinary CDN

> 💡 **Why Generative AI instead of Stock APIs?**
>
> Stock footage APIs (like Pexels) return generic results. If a speaker says _"A glowing coffee cup next to a 1980s computer,"_ stock APIs return plain coffee images. Our **Stable Diffusion pipeline** generates **pixel-perfect, context-aware** visuals that match exactly what the speaker describes — achieving **100% semantic relevance**.

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        ClipAI Pipeline                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐    ┌───────────┐    ┌──────────────────────────┐  │
│   │ Next.js │───▶│  Node.js  │───▶│   FastAPI (Python)        │  │
│   │ Client  │    │   Proxy   │    │                          │  │
│   │ :3000   │    │   :5001   │    │  ┌────────────────────┐  │  │
│   └─────────┘    └───────────┘    │  │ 1. FFmpeg Extract   │  │  │
│        ▲                          │  │ 2. Groq Whisper     │  │  │
│        │                          │  │ 3. LLaMA-3 Analysis │  │  │
│        │         ┌───────────┐    │  │ 4. SDXL Image Gen   │  │  │
│        └─────────│ Cloudinary│◀───│  │ 5. FFmpeg Composite │  │  │
│                  │    CDN    │    │  └────────────────────┘  │  │
│                  └───────────┘    └──────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🤖 AI-Powered Pipeline

- **Groq Whisper** — Lightning-fast speech transcription
- **LLaMA-3.3 70B** — Context-aware prompt generation
- **Stable Diffusion XL** — Photorealistic B-roll image synthesis
- **FFmpeg** — Hardware-accelerated video compositing

</td>
<td width="50%">

### 🎨 User Controls

- 🔄 **Auto B-Roll Toggle** — Enable/disable AI generation
- 🎭 **Style Selection** — Cinematic / Cyberpunk / Anime
- 🌍 **Multi-language** — Auto-detect or manual language select
- 📊 **Real-time Progress** — Live step-by-step status tracking

</td>
</tr>
<tr>
<td width="50%">

### ⚡ Performance

- 🔁 **Async Processing** — Background task execution
- 📡 **Polling Architecture** — No timeout on heavy renders
- 📐 **Resolution Match** — Zero aspect-ratio distortion
- 🎞️ **Cinematic Effects** — Zoompan, fade-in/out, blur

</td>
<td width="50%">

### 🚀 Production Ready

- ☁️ **Cloudinary CDN** — Global edge video delivery
- 🐳 **Docker Support** — One-command AI service deploy
- 🔒 **Env-based Config** — Secure API key management
- 📱 **Responsive UI** — Works on all screen sizes

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

<div align="center">

|        Layer         |            Technology             |                Purpose                |
| :------------------: | :-------------------------------: | :-----------------------------------: |
|   🖥️ **Frontend**    |     Next.js 14 + Tailwind CSS     |  Responsive UI with real-time status  |
| 🔌 **Backend Proxy** |    Node.js + Express + Multer     |  File upload buffering & API routing  |
|   🧠 **AI Engine**   |         Python + FastAPI          |      Core pipeline orchestration      |
| 🗣️ **Transcription** |         Groq Whisper API          |    Speech-to-text with timestamps     |
|      💬 **LLM**      |       LLaMA-3.3-70B (Groq)        | Context analysis & prompt engineering |
|   🎨 **Image Gen**   | Stable Diffusion XL (HuggingFace) |    Text-to-image B-roll generation    |
| 🎬 **Video Engine**  |              FFmpeg               |  Compositing, transitions, subtitles  |
|      ☁️ **CDN**      |            Cloudinary             |    Cloud storage & video delivery     |

</div>

---

## 🔄 AI Pipeline Deep Dive

```mermaid
graph LR
    A[📹 Upload Video] --> B[🎵 Extract Audio]
    B --> C[🗣️ Groq Whisper<br/>Transcription]
    C --> D[🧠 LLaMA-3 70B<br/>Context Analysis]
    D --> E[🎨 Stable Diffusion XL<br/>Image Generation]
    E --> F[🎬 FFmpeg Compositing<br/>Zoompan + Subtitles]
    F --> G[☁️ Cloudinary Upload]
    G --> H[✅ Final Video Ready]

    style A fill:#f97316,stroke:#ea580c,color:#fff
    style B fill:#f59e0b,stroke:#d97706,color:#fff
    style C fill:#10b981,stroke:#059669,color:#fff
    style D fill:#3b82f6,stroke:#2563eb,color:#fff
    style E fill:#a855f7,stroke:#9333ea,color:#fff
    style F fill:#ec4899,stroke:#db2777,color:#fff
    style G fill:#06b6d4,stroke:#0891b2,color:#fff
    style H fill:#22c55e,stroke:#16a34a,color:#fff
```

### Step-by-Step Breakdown

| Step |        Process        |      Technology       | What Happens                         |
| :--: | :-------------------: | :-------------------: | :----------------------------------- |
|  1️⃣  | **Audio Extraction**  |   FFmpeg subprocess   | Video → `.mp3` audio file extracted  |
|  2️⃣  |   **Transcription**   |   Groq Whisper API    | Audio → timestamped text segments    |
|  3️⃣  | **Context Analysis**  |     LLaMA-3.3-70B     | Transcript → cinematic image prompts |
|  4️⃣  | **B-Roll Generation** |  Stable Diffusion XL  | Prompts → photorealistic images      |
|  5️⃣  | **Motion Animation**  |    FFmpeg zoompan     | Static images → animated video clips |
|  6️⃣  |    **Compositing**    | FFmpeg filter_complex | Overlay B-roll + burn SRT subtitles  |
|  7️⃣  |  **Cloud Delivery**   |    Cloudinary API     | Upload → global CDN URL returned     |

---

## 🚀 Quick Start

### Prerequisites

```
✅ Node.js v18+
✅ Python 3.9+
✅ FFmpeg (in system PATH)
```

### 1. Clone the Repository

```bash
git clone https://github.com/samay-hash/ClipAI_Intern.git
cd ClipAI_Intern
```

### 2. Configure Environment Variables

<details>
<summary>📁 <b>ai-service/.env</b> (click to expand)</summary>

```env
# Sarvam API — for speech-to-text / Hindi captions
SARVAM_API_KEY="sk_..."

# Groq API — for LLaMA-3 and Whisper
GROQ_API_KEY="gsk_..."

# Hugging Face — for Stable Diffusion XL
HF_API_KEY="hf_..."

# Cloudinary — for video cloud storage
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

</details>

<details>
<summary>📁 <b>backend/.env</b> (click to expand)</summary>

```env
PORT=5001
AI_SERVICE_URL="http://localhost:8000"
```

</details>

### 3. Start All Services

> ⚠️ Run each in a **separate terminal**

```bash
# Terminal 1: AI Engine (Python)
cd ai-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
# → Running on http://localhost:8000
```

```bash
# Terminal 2: Backend Proxy (Node.js)
cd backend
npm install
npm run dev
# → Running on http://localhost:5001
```

```bash
# Terminal 3: Frontend (Next.js)
cd frontend
npm install
npm run dev
# → Running on http://localhost:3000
```

### 4. Open & Use

Navigate to **http://localhost:3000** → Upload a video → Watch AI magic happen! ✨

---

## 🌐 Deployment

<table>
<tr>
<td align="center" width="33%">

#### 🎨 Frontend

**Vercel**

[![Deploy](https://img.shields.io/badge/Live-clip--ai--intern.vercel.app-000?style=for-the-badge&logo=vercel)](https://clip-ai-intern.vercel.app)

```
Root: frontend/
Env: NEXT_PUBLIC_API_URL
```

</td>
<td align="center" width="33%">

#### 🔌 Backend

**Render (Node.js)**

[![Deploy](https://img.shields.io/badge/Live-clipai--intern--1.onrender.com-46E3B7?style=for-the-badge&logo=render)](https://clipai-intern-1.onrender.com)

```
Root: backend/
Env: AI_SERVICE_URL
```

</td>
<td align="center" width="33%">

#### 🧠 AI Engine

**Render (Docker)**

[![Deploy](https://img.shields.io/badge/Live-clipai--intern.onrender.com-46E3B7?style=for-the-badge&logo=render)](https://clipai-intern.onrender.com)

```
Root: ai-service/
Runtime: Docker
```

</td>
</tr>
</table>

---

## 📁 Project Structure

```
ClipAI_Intern/
├── 🎨 frontend/                 # Next.js 14 + Tailwind CSS
│   ├── src/app/page.tsx         # Main UI (upload, progress, gallery)
│   ├── src/app/globals.css      # Design system (CSS variables)
│   └── package.json
│
├── 🔌 backend/                  # Node.js Express Proxy
│   ├── server.js                # Upload handling, AI service proxy
│   └── package.json
│
├── 🧠 ai-service/               # Python FastAPI AI Engine
│   ├── main.py                  # Core pipeline (Whisper → LLaMA → SDXL → FFmpeg)
│   ├── Dockerfile               # Docker config for Render deployment
│   └── requirements.txt         # Python dependencies
│
└── 📄 README.md                 # You are here!
```

---

## 🤝 Contributing

Contributions are welcome! Here's how to get involved:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m 'Add amazing feature'`
4. **Push** to the branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### Ideas for Contribution

| Area | Idea                                           | Difficulty |
| :--: | :--------------------------------------------- | :--------: |
|  🎨  | Add more visual styles (Watercolor, Pixel Art) |  🟢 Easy   |
|  🔊  | Add background music overlay                   | 🟡 Medium  |
|  📊  | Redis/Celery job queue for scaling             | 🟡 Medium  |
|  🎥  | AI video generation (instead of images)        |  🔴 Hard   |
|  🌐  | Multi-language subtitle support                | 🟡 Medium  |

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

### ⭐ Star this repo if you found it useful!

<br/>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:16a34a,100:22d3ee&height=120&section=footer&animation=fadeIn" width="100%"/>

<br/>

**Built with ❤️ using AI, FFmpeg & Whisper**

[![GitHub](https://img.shields.io/badge/GitHub-samay--hash-181717?style=for-the-badge&logo=github)](https://github.com/samay-hash)

</div>
