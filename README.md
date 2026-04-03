# 🎬 ClipAI: The Intelligent Auto B-Roll Generator

**ClipAI** is an AI-powered autonomous video editing pipeline that transforms raw talking-head videos into highly engaging, professional shorts. It uses state-of-the-art LLMs and Text-to-Image models to dynamically fetch context, generate cinematic "B-Roll" shots, and stitch everything together smoothly with beautiful transitions, exact-timed subtitles, and Cloudinary media delivery.

---

## 🌟 How It Works (The Magic)

ClipAI operates on our newly introduced **Option B: Generative AI Architecture**.

> **Option B Justification (Why Generative AI instead of Stock APIs?)**
> When evaluating **Option A (Pexels Stock)** vs **Option B (Hugging Face Generative)**, we architecturally committed to Option B. While Stock APIs are vastly cheaper and faster to query, they lack contextual perfection and semantic depth. If the speaker mentions "A glowing coffee cup next to a 1980s computer," stock footage will only return generic office workers or plain coffee imagery. By utilizing *Text-to-Image Generation (Stable Diffusion)* synced with LLM-orchestrated prompt-engineering, the application mathematically ensures a 100% emotional and visual relevance to exactly what the speaker is discussing in real-time. This provides an elevated, hyper-personalized "Vlog" experience that stock retrieval simply cannot replicate, despite the higher computational cost.

1. **Audio Extraction & Whisper:** The video is stripped of audio, which is efficiently converted to `.mp3` format and run through **Groq Whisper** to create accurate transcriptions and segment logic.
2. **LLaMA-3 Contextual Prompting:** The transcript is analyzed by **LLaMA-3.3-70B** (via Groq). The LLM determines the most visually interesting moments in the video and generates highly detailed, cinematic Text-to-Image prompts (e.g. *"A 4K photorealistic cinematic shot of a hacker typing down code"*).
3. **Generative B-Roll Creation:** These prompts are instantly sent to **Hugging Face's Stable Diffusion XL** model, which synthesizes beautiful images based exactly on what the speaker is discussing in the video.
4. **FFmpeg Motion Engine:** Raw images are passed to **FFmpeg**, which converts the image into a video by applying a cinematic **Zoompan animation**. This breathes life into the generative AI, giving it a real "camera zoom" video feel.
5. **Compositing & Subtitles:** FFmpeg composites these B-rolls directly over the user's video at exact timestamps. High-contrast custom SRT subtitles are burned over the footage.
6. **Cinematic Transitions:** An elegant Soft-White Fade-In and Focus-pull blur mimics a DSLR video start transition, ensuring a premium vlog feel.
7. **Cloud Delivery:** The completed cut is pushed dynamically to **Cloudinary** and returned to the Next.js Frontend.

---

## 🛠 Tech Stack

*   **Frontend**: Next.js 14, Tailwind CSS, TypeScript
*   **Backend (Proxy)**: Node.js, Express, Formidable
*   **AI Service / Engine**: Python, FastAPI
*   **AI Inference**: Groq (LLaMA-3, Whisper)
*   **Generative AI**: Hugging Face Inference API / Stable Diffusion
*   **Video Processing**: FFmpeg
*   **Cloud Storage**: Cloudinary

---

## 🚀 Setup & Contribution Guide

If you'd like to run or contribute to this highly automated AI Vlogger pipeline, follow the multi-service setup below.

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (v18+)
- **Python** (3.9+)
- **FFmpeg** (Must be in your system PATH)

### 2. Configure Environment Variables
You will need API keys to run the app. Create `.env` files in their respective folders:

**`ai-service/.env`**
```env
# Groq API for LLM and Whisper
GROQ_API_KEY="gsk_..."

# Hugging Face API for Image/Video Generation
HF_API_KEY="hf_..."

# Cloudinary Storage for Output Uploads
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

**`backend/.env`**
```env
PORT=5001
AI_SERVICE_URL="http://localhost:8000"
```

### 3. Run the Services

You must run all 3 services concurrently to launch the full pipeline.

#### A. AI Service (Python Backend)
```bash
cd ai-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```
*(Runs on port 8000)*

#### B. Upload Proxy Backend (Node.js)
```bash
cd backend
npm install
npm run dev
```
*(Runs on port 5001)*

#### C. Frontend UI (Next.js)
```bash
cd frontend
npm install
npm run dev
```
*(Runs on port 3000)*

---

### 🔥 Development Mode Features
- **To use Stock Footage instead of Gen-AI**: In `ai-service/main.py`, you can easily toggle the prompt and URL fallback to hit the Pexels API instead of Hugging Face.
- **Styling Subs**: Modify the `force_style` inline in the `burn_complex_video` function if you prefer yellow or karaoke-styled subtitles.

---
> Designed with ❤️ by the open-source architect team.
