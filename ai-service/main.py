import os
import uuid
import subprocess
import json
import re
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import requests
import yt_dlp
import cloudinary
import cloudinary.uploader
import cloudinary.api
from groq import Groq
from pymongo import MongoClient

load_dotenv()
MONGODB_URI = os.getenv("MONGODB_URI")
db_client = MongoClient(MONGODB_URI) if MONGODB_URI else None
jobs_collection = db_client["clipai"]["job_states"] if db_client else None

job_states_mem = {}

def update_job_state(job_id: str, state_data: dict):
    if jobs_collection is not None:
        jobs_collection.update_one({"job_id": job_id}, {"$set": state_data}, upsert=True)
    else:
        job_states_mem[job_id] = state_data

def get_job_state(job_id: str, default=None):
    if jobs_collection is not None:
        state = jobs_collection.find_one({"job_id": job_id}, {"_id": 0})
        return state if state else default
    return job_states_mem.get(job_id, default)



GROQ_API_KEY = os.getenv("GROQ_API_KEY")
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")

CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET")

if all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET]):
    cloudinary.config(
        cloud_name = CLOUDINARY_CLOUD_NAME,
        api_key = CLOUDINARY_API_KEY,
        api_secret = CLOUDINARY_API_SECRET,
        secure = True
    )

groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

app = FastAPI(title="AI Video Editor Service")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
TEMP_DIR = BASE_DIR / "temp"

for d in [UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR]:
    d.mkdir(exist_ok=True)

def extract_audio(video_path: str, audio_path: str) -> bool:
    try:
        # Extract audio as highly compressed MP3 to avoid Groq's 25MB limit
        cmd = ["ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame", "-q:a", "5", "-ar", "16000", "-ac", "1", audio_path, "-y"]
        return subprocess.run(cmd, capture_output=True).returncode == 0
    except: return False

def urdu_to_devanagari(text: str) -> str:
    """Convert Urdu/Nastaliq script to approximate Devanagari transliteration."""
    # If no Arabic/Urdu unicode chars, return as-is
    if not any('\u0600' <= c <= '\u06FF' for c in text):
        return text
    # Urdu → Devanagari character map
    mapping = {
        'ا': 'अ', 'آ': 'आ', 'ب': 'ब', 'پ': 'प', 'ت': 'त', 'ٹ': 'ट',
        'ث': 'स', 'ج': 'ज', 'چ': 'च', 'ح': 'ह', 'خ': 'ख', 'د': 'द',
        'ڈ': 'ड', 'ذ': 'ज़', 'ر': 'र', 'ڑ': 'ड़', 'ز': 'ज़', 'ژ': 'झ',
        'س': 'स', 'ش': 'श', 'ص': 'स', 'ض': 'ज़', 'ط': 'त', 'ظ': 'ज़',
        'ع': 'अ', 'غ': 'ग़', 'ف': 'फ', 'ق': 'क', 'ک': 'क', 'گ': 'ग',
        'ل': 'ल', 'م': 'म', 'ن': 'न', 'ں': 'न', 'و': 'व', 'ہ': 'ह',
        'ھ': 'ह', 'ی': 'य', 'ے': 'े', 'ئ': 'य', 'ء': '', 'ؤ': 'व',
        'ِ': 'ि', 'َ': 'ा', 'ُ': 'ु', 'ّ': '', 'ْ': '', '۔': '।',
    }
    result = ""
    for char in text:
        result += mapping.get(char, char)
    return result

def transcribe_audio_groq(audio_path: str, language: str = None) -> list:
    try:
        if not groq_client: return []
        lang_map = {
            "english": "en", "hindi": "hi", "spanish": "es",
            "french": "fr", "german": "de", "portuguese": "pt",
            "arabic": "ar", "japanese": "ja", "korean": "ko",
            "chinese": "zh", "russian": "ru", "auto": None
        }
        whisper_lang = lang_map.get((language or "").lower(), None)
        
        # Use better (non-turbo) model for Hindi — turbo confuses Hindi/Urdu script
        model = "whisper-large-v3" if whisper_lang == "hi" else "whisper-large-v3-turbo"
        
        extra = {}
        if whisper_lang:
            extra["language"] = whisper_lang
        if whisper_lang == "hi":
            extra["prompt"] = "हिंदी देवनागरी लिपि में लिखें।"
        
        with open(audio_path, "rb") as f:
            transcription = groq_client.audio.transcriptions.create(
                file=(os.path.basename(audio_path), f.read()),
                model=model,
                response_format="verbose_json",
                **extra
            )
        
        segments = transcription.segments if hasattr(transcription, "segments") else []
        
        # Post-process: if Hindi selected but Urdu script came out, convert it
        if whisper_lang == "hi" and segments:
            for seg in segments:
                if isinstance(seg, dict):
                    seg["text"] = urdu_to_devanagari(seg.get("text", ""))
                else:
                    try:
                        seg.text = urdu_to_devanagari(getattr(seg, "text", ""))
                    except:
                        pass
        
        return segments
    except Exception as e:
        print(f"Transcription error: {e}")
        return []


def validate_broll_timestamps(brolls: list, segments: list, video_duration: float = None) -> list:
    """Validate and fix B-roll timestamps against real Whisper segment timings."""
    if not segments: return brolls
    
    # Build a map of real spoken-word timestamps from Whisper
    seg_times = []
    for seg in segments:
        st = seg.get("start") if isinstance(seg, dict) else getattr(seg, "start", 0)
        en = seg.get("end") if isinstance(seg, dict) else getattr(seg, "end", 0)
        seg_times.append((float(st), float(en)))
    
    max_time = max(t[1] for t in seg_times) if seg_times else 60.0
    if video_duration and video_duration > 0:
        max_time = min(max_time, video_duration)
    
    validated = []
    last_end = 0.0
    for br in brolls:
        start = float(br.get("start_time", 0))
        end = float(br.get("end_time", start + 3.5))
        duration = end - start
        
        # Clamp duration between 2.5s and 5.0s
        duration = max(2.5, min(5.0, duration))
        
        # Ensure no overlap with previous B-roll
        if start < last_end + 0.5:
            start = last_end + 0.5
        
        # Don't exceed video length
        end = start + duration
        if end > max_time:
            break
        
        br["start_time"] = round(start, 2)
        br["end_time"] = round(end, 2)
        last_end = end
        validated.append(br)
    
    return validated

def get_broll_keywords(segments: list, style: str = "cinematic", max_broll: int = 8) -> list:
    if not segments or not groq_client: return []
    
    # Build timed transcript so LLaMA knows EXACT word timings
    timed_lines = []
    for seg in segments:
        st = seg.get("start") if isinstance(seg, dict) else getattr(seg, "start", 0)
        en = seg.get("end") if isinstance(seg, dict) else getattr(seg, "end", 0)
        txt = seg.get("text") if isinstance(seg, dict) else getattr(seg, "text", "")
        timed_lines.append(f"[{float(st):.1f}s - {float(en):.1f}s]: {txt.strip()}")
    
    timed_transcript = "\n".join(timed_lines)
    
    prompt = f"""You are an expert AI video editor. Analyze this TIMED transcript and select exactly {max_broll} key visual moments for B-roll insertion.

RULES:
1. Each B-roll MUST align with the EXACT timestamp where that topic is spoken (use the timestamps provided).
2. Duration: each clip should be 2.5 to 4.5 seconds long (vary naturally).
3. Keywords must be 1-3 word cinematic search terms (e.g. "coding laptop", "ocean waves", "city skyline").
4. No two B-rolls should overlap. Maintain at least 0.5s gap between them.
5. Spread B-rolls evenly across the video — don't cluster them all at the start.
6. Return ONLY a JSON object.

Example: {{"brolls": [{{"keyword": "coding laptop", "start_time": 2.0, "end_time": 5.5, "reason": "Speaker mentions programming"}}, ...]}}

Timed Transcript:
{timed_transcript}"""
    
    try:
        response = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            temperature=0.2,
            response_format={"type": "json_object"}
        )
        content = response.choices[0].message.content
        data = json.loads(content)
        brolls = data.get("brolls", [])
        
        # Validate timestamps against real Whisper timings
        brolls = validate_broll_timestamps(brolls, segments)
        
        # Limit to max requested
        return brolls[:max_broll]
    except Exception as e:
        print(f"B-roll generation error: {e}")
        return []

def generate_ai_broll_image_hf(prompt: str, download_path: str) -> bool:
    HF_API_KEY = os.getenv("HF_API_KEY")
    if not HF_API_KEY:
        print("HF API Key required for Generative AI B-rolls!")
        return False
        
    API_URL = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0"
    headers = {"Authorization": f"Bearer {HF_API_KEY}"}
    payload = {"inputs": prompt}
    
    try:
        # Reduced timeout so if model loads too slow, it falls back to Pollinations faster
        response = requests.post(API_URL, headers=headers, json=payload, timeout=20)
        if response.status_code == 200:
            with open(download_path, "wb") as f:
                f.write(response.content)
            return True
        else:
            print(f"HF Generation Failed (Status {response.status_code})")
            return False
    except Exception as e:
        print(f"HF Error: {e}")
        return False

def generate_ai_broll_image_pollinations(prompt: str, download_path: str) -> bool:
    import urllib.parse
    enhanced_prompt = f"{prompt}, cinematic, masterpiece, highly detailed, 8k resolution"
    encoded_prompt = urllib.parse.quote(enhanced_prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=1920&height=1080&nologo=true&seed=42"
    
    try:
        response = requests.get(url, timeout=30)
        if response.status_code == 200:
            with open(download_path, "wb") as f:
                f.write(response.content)
            return True
        else:
            print(f"Pollinations Generation Failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"Pollinations API Error: {e}")
        return False
def fetch_pexels_video(keyword: str, download_path: str) -> bool:
    PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")
    if not PEXELS_API_KEY:
        print("Pexels API Key required for fetching videos!")
        return False
    def _search(q):
        url = f"https://api.pexels.com/videos/search?query={q}&per_page=1&orientation=landscape"
        return requests.get(url, headers={"Authorization": PEXELS_API_KEY}, timeout=20).json()
    try:
        response = _search(keyword)
        videos = response.get("videos")
        # Fallback to single word if multi-word search yields 0 videos
        if not videos and " " in keyword:
            fallback_word = keyword.split()[-1]
            print(f"Pexels found 0 for '{keyword}', retrying with '{fallback_word}'...")
            response = _search(fallback_word)
            videos = response.get("videos")
            
        if videos and len(videos) > 0:
            video_files = videos[0].get("video_files", [])
            hd_files = [v for v in video_files if v["quality"] == "hd" and v.get("width", 0) >= 1920]
            selected_file = hd_files[0]["link"] if hd_files else video_files[0]["link"]
            
            vid_res = requests.get(selected_file, stream=True)
            with open(download_path, "wb") as f:
                for chunk in vid_res.iter_content(chunk_size=1024*1024):
                    if chunk: f.write(chunk)
            return True
        else:
            print(f"No Pexels videos found for '{keyword}'")
            return False
    except Exception as e:
        print(f"Pexels Error: {e}")
        return False

def fetch_pexels_image(keyword: str, download_path: str) -> bool:
    PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")
    if not PEXELS_API_KEY: return False
    
    url = f"https://api.pexels.com/v1/search?query={keyword}&per_page=1&orientation=landscape"
    try:
        response = requests.get(url, headers={"Authorization": PEXELS_API_KEY}, timeout=15).json()
        photos = response.get("photos")
        if photos and len(photos) > 0:
            img_url = photos[0]["src"]["original"]
            res = requests.get(img_url, stream=True)
            with open(download_path, "wb") as f:
                for chunk in res.iter_content(1024*1024):
                    if chunk: f.write(chunk)
            print(f"✅ Fetched Pexels Image for '{keyword}'")
            return True
        print(f"❌ No Pexels images found for '{keyword}'")
        return False
    except Exception as e:
        print(f"Pexels Image Error: {e}")
        return False

def generate_srt(segments: list, srt_path: str) -> bool:
    if not segments: return False
    try:
        with open(srt_path, "w", encoding="utf-8") as f:
            for i, seg in enumerate(segments, 1):
                st = seg.get("start") if isinstance(seg, dict) else getattr(seg, "start")
                en = seg.get("end") if isinstance(seg, dict) else getattr(seg, "end")
                txt = seg.get("text") if isinstance(seg, dict) else getattr(seg, "text")
                hrs, mins, secs = int(st // 3600), int((st % 3600) // 60), int(st % 60)
                ehrs, emins, esecs = int(en // 3600), int((en % 3600) // 60), int(en % 60)
                
                start = f"{hrs:02d}:{mins:02d}:{secs:02d},{int((st % 1) * 1000):03d}"
                end = f"{ehrs:02d}:{emins:02d}:{esecs:02d},{int((en % 1) * 1000):03d}"
                f.write(f"{i}\n{start} --> {end}\n{txt.strip()}\n\n")
        return True
    except: return False

def download_bgm(output_path: str, style="cinematic"):
    # Extremely soft, relaxing, ambient background tracks
    urls = {
        "cinematic": "https://cdn.pixabay.com/download/audio/2022/02/07/audio_b04ec8d4ac.mp3", # Ambient Relaxing
        "vlog": "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3"     # Chill piano
    }
    target_url = urls.get(style, urls["cinematic"])
    
    # If the user previously downloaded the heavy music, remove it so it downloads the new one
    if os.path.exists(output_path):
        os.remove(output_path)
        
    try:
        res = requests.get(target_url, verify=False, timeout=20)
        if res.status_code == 200:
            with open(output_path, "wb") as f:
                f.write(res.content)
            return True
    except Exception as e:
        print("Failed to download BGM:", e)
        return False
    return True

def get_video_resolution(video_path: str) -> str:
    try:
        cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", video_path]
        return subprocess.check_output(cmd).decode().strip()
    except Exception as e:
        print(f"Failed to get resolution: {e}")
        return "1920x1080" # safe fallback

def burn_complex_video(main_video: str, srt_path: str, broll_info: list, output_path: str, bgm_path: str = None) -> bool:
    try:
        inputs = ["-i", main_video]
        if bgm_path and os.path.exists(bgm_path):
            inputs.extend(["-stream_loop", "-1", "-i", bgm_path])
            bgm_idx = 1
        else:
            bgm_idx = -1
            
        filter_complex = []
        overlay_chain = "[0:v]"
        
        # Dynamically determine the exact resolution of the input video to strictly avoid bounds mismatch
        target_res = get_video_resolution(main_video)
        try:
            target_w, target_h = map(int, target_res.split("x"))
        except:
            target_w, target_h = 1920, 1080
            
        target_w -= target_w % 2
        target_h -= target_h % 2
        target_res = f"{target_w}x{target_h}"
        
        for i, clip in enumerate(broll_info):
            is_image = clip['path'].lower().endswith(('.png', '.jpg', '.jpeg'))
            duration = float(clip['end']) - float(clip['start'])
            if duration <= 0: duration = 3.5
            
            if is_image:
                inputs.extend(["-loop", "1", "-t", str(duration), "-i", clip['path']])
            else:
                inputs.extend(["-t", str(duration), "-i", clip['path']])
                
            # If BGM is used, our videos start at input 2, otherwise 1
            vid_idx = i + (2 if bgm_idx != -1 else 1)
            start_t = float(clip['start'])
            end_t = float(clip['end'])
            
            # Use PTS shifting so the clip is aligned properly in time. 
            # Fades are also mapped to the exact start/end time of the overlay.
            setpts_filter = f"setpts=PTS-STARTPTS+{start_t}/TB"
            # yuva420p for intermediate processing (alpha needed for smooth overlay fading)
            # Final output converts to yuv420p via -pix_fmt flag for mobile compatibility
            fade_fx = f"format=yuva420p,fade=t=in:st={start_t}:d=0.5:alpha=1,fade=t=out:st={max(0, end_t-0.5)}:d=0.5:alpha=1"
            
            if is_image:
                # Add cinematic slow zoom (zoompan) to AI images and match dynamically discovered resolution
                # For images, setpts must come AFTER zoompan generates the stream
                filter_complex.append(
                    f"[{vid_idx}:v]scale={target_res},zoompan=z='min(zoom+0.0015,1.5)':d={int(25*duration)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={target_res},{setpts_filter},{fade_fx}[v{vid_idx}cropped];"
                )
            else:
                # For video clips, we scale, crop, then align PTS and apply fade
                filter_complex.append(
                    f"[{vid_idx}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,crop={target_w}:{target_h},{setpts_filter},{fade_fx}[v{vid_idx}cropped];"
                )
            new_overlay = f"[ov{vid_idx}]"
            filter_complex.append(
                f"{overlay_chain}[v{vid_idx}cropped]overlay=enable='between(t,{start_t},{end_t})':eof_action=pass{new_overlay};"
            )
            overlay_chain = new_overlay
        duration = 0.0
        try:
            dur_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", main_video]
            duration = float(subprocess.check_output(dur_cmd).decode().strip())
        except:
            pass
        fade_filter = f",fade=t=in:st=0:d=1:color=white,fade=t=out:st={max(0, duration-1)}:d=1:color=black" if duration > 3.0 else ""
        
        if os.path.exists(srt_path):
            escaped_srt = srt_path.replace("\\", "/").replace(":", "\\\\:")
            style = "FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,MarginV=30"
            filter_complex.append(f"{overlay_chain}format=yuv420p,subtitles='{escaped_srt}':force_style='{style}'{fade_filter}[vout]")
        else:
            filter_complex.append(f"{overlay_chain}format=yuv420p{fade_filter}[vout]")
             
        fc_str = "".join(filter_complex)
        
        audio_map = []
        if bgm_idx != -1:
            fc_str += f";[0:a]volume=1.0[a1];[{bgm_idx}:a]volume=0.06[a2];[a1][a2]amix=inputs=2:duration=first:dropout_transition=2[aout]"
            audio_map = ["-map", "[aout]"]
        else:
            audio_map = ["-map", "0:a?"]
            
        print(f"FFmpeg filter: {fc_str[:300]}...")
        cmd = [
            "ffmpeg", "-y"
        ] + inputs + [
            "-filter_complex", fc_str,
            "-map", "[vout]"
        ] + audio_map + [
            "-c:v", "libx264",
            "-profile:v", "main",       # Mobile compatible H.264 profile
            "-pix_fmt", "yuv420p",       # Strips alpha — universal mobile support
            "-movflags", "+faststart",   # Allows streaming playback on mobile
            "-c:a", "aac",
            "-b:a", "128k",
            "-preset", "fast",
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            print(f"FFmpeg FAILED stderr: {result.stderr.decode()[-800:]}")
        return result.returncode == 0
    except Exception as e:
        print("Burn error:", e)
        return False



@app.get("/status/{job_id}")
async def get_status(job_id: str):
    return get_job_state(job_id, {"step": "Uploading video...", "progress": 0})

@app.get("/health")
async def health_check(): return {"status": "ok"}

def analyze_quality(segments: list, brolls_used: list, downloaded: list) -> dict:
    """Use LLaMA to analyze output quality (FREE — no Vision API needed)."""
    if not groq_client: return {"quality_score": 70, "analysis": "AI analysis unavailable", "suggestions": []}
    
    full_text = " ".join([seg.get("text") if isinstance(seg, dict) else getattr(seg, "text", "") for seg in segments[:20]])
    
    broll_summary = []
    for i, br in enumerate(brolls_used):
        kw = br.get("keyword", "unknown")
        st = br.get("start_time", 0)
        en = br.get("end_time", 0)
        fetched = i < len(downloaded)
        broll_summary.append(f"  B-Roll {i+1}: '{kw}' at {st}s-{en}s {'✅ fetched' if fetched else '❌ missing'}")
    
    prompt = f"""You are a professional video quality analyst. Analyze this video edit and give a quality report.

Transcript (first 500 chars): {full_text[:500]}

B-Roll Placements:
{chr(10).join(broll_summary)}

Total B-rolls requested: {len(brolls_used)}
Total B-rolls successfully fetched: {len(downloaded)}
Total transcript segments: {len(segments)}

Give a JSON response with:
- "quality_score": 0-100 integer
- "broll_relevance": short assessment of B-roll keyword relevance
- "timing_quality": assessment of B-roll placement timing
- "suggestions": array of 2-3 short improvement suggestions
- "overall": 1 sentence summary"""
    
    try:
        response = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            temperature=0.3,
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"Quality analysis error: {e}")
        return {"quality_score": 75, "analysis": "Analysis failed", "suggestions": []}

def run_pipeline(job_id, in_vid, aud_file, srt_file, out_vid, enable_broll: bool = True, style: str = "cinematic", language: str = None, caption_style: str = "clean", max_broll: int = 8):
    try:
        update_job_state(job_id, {"step": "Extracting Audio...", "progress": 10})
        print(f"[{job_id}] 1. Extracting audio...")
        extract_audio(in_vid, aud_file)
            
        update_job_state(job_id, {"step": "Transcribing with AI...", "progress": 20})
        print(f"[{job_id}] 2. Transcribing with fast Groq API...")
        segments = transcribe_audio_groq(aud_file, language=language)
        seg_count = len(segments) if segments else 0
            
        downloaded = []
        brolls_used = []
        if enable_broll:
            update_job_state(job_id, {"step": f"Generating {style.title()} Prompts ({max_broll} moments)...", "progress": 30})
            print(f"[{job_id}] 3. Detecting {max_broll} B-Roll keywords with LLaMA...")
            brolls = get_broll_keywords(segments, style, max_broll=max_broll)
            brolls_used = brolls  # Store for quality analysis
            
            # Calculate progress per B-roll so it's evenly distributed 30-70%
            progress_per_broll = 40 / max(len(brolls), 1)
            
            for i, br in enumerate(brolls):
                kw = br.get("prompt") or br.get("keyword") 
                if not kw: continue
                
                start_t = float(br.get("start_time", 0))
                end_t = float(br.get("end_time", start_t + 3.5))
                
                current_progress = int(30 + (i * progress_per_broll))
                update_job_state(job_id, {
                    "step": f"Fetching B-Roll {i+1}/{len(brolls)}...",
                    "progress": current_progress,
                    "broll_moments": [
                        {"keyword": b.get("keyword", ""), "start": b.get("start_time", 0), "end": b.get("end_time", 0), "reason": b.get("reason", "")}
                        for b in brolls
                    ]
                })
                p_vid = str(TEMP_DIR / f"{job_id}_br_{i}.mp4")
                p_img = str(TEMP_DIR / f"{job_id}_br_{i}.jpg")
                
                print(f"[{job_id}] 4a. Fetching Pexels B-Roll Video for '{kw[:30]}...'")
                if fetch_pexels_video(kw, p_vid):
                    downloaded.append({"path": p_vid, "start": start_t, "end": end_t})
                else:
                    print(f"[{job_id}] 4b. Video failed! Fetching Pexels Stock Image for '{kw[:30]}...'")
                    if fetch_pexels_image(kw, p_img):
                        downloaded.append({"path": p_img, "start": start_t, "end": end_t})
                    else:
                        print(f"[{job_id}] 4c. Image search failed! Generating HF AI fallback for '{kw[:30]}...'")
                        update_job_state(job_id, {"step": f"Synthesizing AI B-Roll {i+1}/{len(brolls)}...", "progress": current_progress + 2})
                        enhanced_prompt = f"A {style} highly detailed 4k cinematic shot of {kw}, photorealistic, stunning"
                        
                        if generate_ai_broll_image_hf(enhanced_prompt, p_img):
                            downloaded.append({"path": p_img, "start": start_t, "end": end_t})
                        else:
                            print(f"[{job_id}] 4d. HF Failed! Falling back to Pollinations AI for '{kw}'")
                            if generate_ai_broll_image_pollinations(enhanced_prompt, p_img):
                                downloaded.append({"path": p_img, "start": start_t, "end": end_t})
                
        update_job_state(job_id, {"step": "Designing Subtitles...", "progress": 72})
        if caption_style != "none":
            print(f"[{job_id}] 5. Designing SRT Subtitles...")
            generate_srt(segments, srt_file)
        else:
            print(f"[{job_id}] 5. Captions disabled — skipping SRT generation.")
            srt_file = ""
        
        update_job_state(job_id, {"step": "Applying Audio Mix...", "progress": 78})
        bgm_path = str(TEMP_DIR / f"bgm_{style}.mp3")
        print(f"[{job_id}] 6. Downloading Background Music...")
        download_bgm(bgm_path, style)
        
        update_job_state(job_id, {"step": "Rendering Final Video...", "progress": 82})
        print(f"[{job_id}] 7. Rendering final video with FFmpeg...")
        if downloaded:
            success = burn_complex_video(in_vid, srt_file, downloaded, out_vid, bgm_path)
        else:
            success = burn_complex_video(in_vid, srt_file, [], out_vid, bgm_path)
            
        if not success: raise Exception("FFmpeg Rendering Failed")
        
        # AI Quality Analysis (FREE — uses LLaMA)
        update_job_state(job_id, {"step": "AI Quality Analysis...", "progress": 90})
        print(f"[{job_id}] 8. Running AI quality analysis...")
        quality_report = analyze_quality(segments, brolls_used, downloaded)
        print(f"[{job_id}] 📊 Quality Score: {quality_report.get('quality_score', 'N/A')}")
        
        # Upload final video to Cloudinary
        update_job_state(job_id, {"step": "Uploading to Cloud...", "progress": 95})
        video_url = f"/api/video/{job_id}"
        if CLOUDINARY_CLOUD_NAME:
            try:
                print(f"[{job_id}] 9. Uploading final video to Cloudinary...")
                res = cloudinary.uploader.upload_large(
                    out_vid, 
                    resource_type="video",
                    folder="clipai_outputs",
                    public_id=f"magical_{job_id}"
                )
                video_url = res.get("secure_url")
                print(f"[{job_id}] ✅ Uploaded to Cloudinary: {video_url}")
            except Exception as e:
                print(f"[{job_id}] Cloudinary upload failed, using local: {e}")
        
        # Build B-roll moments data for frontend
        broll_moments = []
        for i, br in enumerate(brolls_used):
            broll_moments.append({
                "keyword": br.get("keyword", ""),
                "start": br.get("start_time", 0),
                "end": br.get("end_time", 0),
                "reason": br.get("reason", ""),
                "fetched": i < len(downloaded)
            })
        
        update_job_state(job_id, {
            "step": "Complete!", 
            "progress": 100, 
            "result": {
                "success": True, 
                "job_id": job_id, 
                "video_url": video_url, 
                "transcript_segments": seg_count,
                "broll_moments": broll_moments,
                "quality_report": quality_report
            }
        })
        print(f"[{job_id}] ✅ Video is Ready!")
    except Exception as e:
        print(f"[{job_id}] ❌ CRITICAL FAIL: {e}")
        update_job_state(job_id, {"step": "Failed", "progress": 0, "error": str(e)})

@app.post("/process")
async def process_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...), 
    enable_broll: bool = Form(True), 
    style: str = Form("cinematic"),
    language: str = Form("auto"),
    caption_style: str = Form("clean"),
    max_broll: int = Form(8)
):
    job_id = str(uuid.uuid4())[:8]
    update_job_state(job_id, {"step": "Initializing...", "progress": 5})
    ext = Path(file.filename).suffix or ".mp4"
    in_vid, aud_file, srt_file, out_vid = str(UPLOAD_DIR / f"{job_id}{ext}"), str(TEMP_DIR / f"{job_id}.mp3"), str(TEMP_DIR / f"{job_id}.srt"), str(OUTPUT_DIR / f"{job_id}.mp4")
    
    try:
        content = await file.read()
        with open(in_vid, "wb") as f: f.write(content)
        print(f"[{job_id}] 🎬 caption_style='{caption_style}', max_broll={max_broll}")
        background_tasks.add_task(run_pipeline, job_id, in_vid, aud_file, srt_file, out_vid, enable_broll, style, language, caption_style, max_broll)
        return {"success": True, "job_id": job_id, "message": "Processing started in background"}
    except Exception as e:
        update_job_state(job_id, {"step": "Failed", "progress": 0})
        raise HTTPException(status_code=500, detail=str(e))

class UrlRequest(BaseModel):
    url: str

@app.post("/process-url")
async def process_video_url(req: UrlRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())[:8]
    update_job_state(job_id, {"step": "Downloading video...", "progress": 5})
    
    def url_pipeline():
        in_vid = str(UPLOAD_DIR / f"{job_id}.mp4")
        aud_file = str(TEMP_DIR / f"{job_id}.mp3")
        srt_file = str(TEMP_DIR / f"{job_id}.srt")
        out_vid = str(OUTPUT_DIR / f"{job_id}.mp4")
        try:
            print(f"[{job_id}] 0. Downloading video from URL...")
            ydl_opts = {
                'outtmpl': in_vid,
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'merge_output_format': 'mp4',
                'quiet': True
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([req.url])
            
            run_pipeline(job_id, in_vid, aud_file, srt_file, out_vid)
        except Exception as e:
            print(f"[{job_id}] URL Error: {e}")
            update_job_state(job_id, {"step": "Failed", "progress": 0, "error": str(e)})
    
    background_tasks.add_task(url_pipeline)
    return {"success": True, "job_id": job_id, "message": "URL processing started"}

class S3Request(BaseModel):
    s3_key: str

@app.post("/process-s3")
async def process_video_s3(req: S3Request):
    if not s3_client: raise HTTPException(status_code=500, detail="S3 not configured")
    job_id = str(uuid.uuid4())[:8]
    ext = Path(req.s3_key).suffix or ".mp4"
    in_vid, aud_file, srt_file, out_vid = str(UPLOAD_DIR / f"{job_id}{ext}"), str(TEMP_DIR / f"{job_id}.wav"), str(TEMP_DIR / f"{job_id}.srt"), str(OUTPUT_DIR / f"{job_id}.mp4")
    
    try:
        print(f"[{job_id}] 0. Downloading video from S3...")
        s3_client.download_file(AWS_BUCKET_NAME, req.s3_key, in_vid)
            
        run_pipeline(job_id, in_vid, aud_file, srt_file, out_vid)
        
        print(f"[{job_id}] 7. Uploading final video back to S3...")
        final_s3_key = f"outputs/magical_{job_id}.mp4"
        s3_client.upload_file(
            out_vid, 
            AWS_BUCKET_NAME, 
            final_s3_key,
            ExtraArgs={'ContentType': 'video/mp4'}
        )
        
        # public url formatting
        final_url = f"https://{AWS_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{final_s3_key}"
        
        return {
            "success": True, 
            "job_id": job_id, 
            "video_url": final_url,
            "message": "Processed successfully"
        }
    except Exception as e:
        print(f"S3 Processing Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/video/{job_id}")
async def get_video(job_id: str):
    return FileResponse(str(OUTPUT_DIR / f"{job_id}.mp4"), media_type="video/mp4", filename=f"magical_{job_id}.mp4")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)