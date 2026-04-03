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


load_dotenv()
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

def transcribe_audio_groq(audio_path: str) -> list:
    try:
        if not groq_client: return []
        with open(audio_path, "rb") as f:
            transcription = groq_client.audio.transcriptions.create(
                file=(os.path.basename(audio_path), f.read()),
                model="whisper-large-v3-turbo",
                response_format="verbose_json"
            )
        return transcription.segments if hasattr(transcription, "segments") else []
    except Exception as e:
        print(f"Transcription error: {e}")
        return []

def get_broll_keywords(segments: list, style: str = "cinematic") -> list:
    if not segments or not groq_client: return []
    full_text = " ".join([seg["text"] if isinstance(seg, dict) else getattr(seg, "text") for seg in segments])
    
    prompt = f"""
    You are an AI video editor that suggests B-roll video search keywords.
    Analyze the transcript below and identify the most contextually relevant moments where a visual change (B-roll) is necessary.
    Extract between 1 to 4 moments depending strictly on the transcript's length.
    For each moment, provide a very concise 1-3 word video search keyword (e.g., "dense forest", "coding room", "city sunset").
    Determine the exact start and end time (in seconds) to insert this B-roll so it aligns with the spoken words. Make each clip last exactly 3.0 to 4.0 seconds.
    Return ONLY a raw valid JSON array. Example: [{{"keyword": "dense forest", "start_time": 2.0, "end_time": 5.5}}]
    {full_text}
    """
    
    try:
        response = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile", temperature=0
        )
        content = response.choices[0].message.content
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if match: return json.loads(match.group(0))
        return []
    except Exception as e:
        print(f"B-roll generation error: {e}")
        return []

def generate_ai_broll_image(prompt: str, download_path: str) -> bool:
    HF_API_KEY = os.getenv("HF_API_KEY")
    if not HF_API_KEY:
        print("HF API Key required for Generative AI B-rolls!")
        return False
        
    API_URL = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0"
    headers = {"Authorization": f"Bearer {HF_API_KEY}"}
    payload = {"inputs": prompt}
    
    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=40)
        if response.status_code == 200:
            with open(download_path, "wb") as f:
                f.write(response.content)
            return True
        else:
            print(f"HF Generation Failed: {response.text}")
            return False
    except Exception as e:
        print(f"HF Error: {e}")
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
            target_res = f"{target_w}x{target_h}"
        
        for i, clip in enumerate(broll_info):
            is_image = clip['path'].lower().endswith(('.png', '.jpg', '.jpeg'))
            duration = clip['end'] - clip['start']
            
            if is_image:
                inputs.extend(["-loop", "1", "-t", str(duration), "-i", clip['path']])
            else:
                inputs.extend(["-i", clip['path']])
                
            # If BGM is used, our videos start at input 2, otherwise 1
            vid_idx = i + (2 if bgm_idx != -1 else 1)
            start_t, end_t = clip['start'], clip['end']
            
            # Scale B-roll to exactly match the target resolution, padding/cropping dynamically if necessary
            if is_image:
                # Add cinematic slow zoom (zoompan) to AI images and match dynamically discovered resolution
                filter_complex.append(
                    f"[{vid_idx}:v]scale={target_w}:-1,zoompan=z='min(zoom+0.0015,1.5)':d={int(25*duration)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={target_res}[v{vid_idx}cropped];"
                )
            else:
                filter_complex.append(
                    f"[{vid_idx}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,crop={target_w}:{target_h}[v{vid_idx}cropped];"
                )
            new_overlay = f"[ov{vid_idx}]"
            filter_complex.append(
                f"{overlay_chain}[v{vid_idx}cropped]overlay=enable='between(t,{start_t},{end_t})':eof_action=pass{new_overlay};"
            )
            overlay_chain = new_overlay
        
        # Get video duration for fade effects
        duration = 0.0
        try:
            dur_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", main_video]
            duration = float(subprocess.check_output(dur_cmd).decode().strip())
        except:
            pass
        fade_filter = f",fade=t=in:st=0:d=1:color=white,fade=t=out:st={duration-1}:d=1:color=black" if duration > 3.0 else ""
        
        if os.path.exists(srt_path):
            escaped_srt = srt_path.replace("\\", "/").replace(":", "\\\\:")
            style = "FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,MarginV=30"
            filter_complex.append(f"{overlay_chain}subtitles='{escaped_srt}':force_style='{style}'{fade_filter}[vout]")
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
        cmd = ["ffmpeg", "-y"] + inputs + ["-filter_complex", fc_str, "-map", "[vout]"] + audio_map + ["-c:a", "aac", "-c:v", "libx264", "-preset", "fast", output_path]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            print(f"FFmpeg FAILED stderr: {result.stderr.decode()[-800:]}")
        return result.returncode == 0
    except Exception as e:
        print("Burn error:", e)
        return False

job_states = {}

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    return job_states.get(job_id, {"step": "Uploading video...", "progress": 0})

@app.get("/health")
async def health_check(): return {"status": "ok"}

def run_pipeline(job_id, in_vid, aud_file, srt_file, out_vid, enable_broll: bool = True, style: str = "cinematic"):
    try:
        job_states[job_id] = {"step": "Extracting Audio...", "progress": 15}
        print(f"[{job_id}] 1. Extracting audio...")
        extract_audio(in_vid, aud_file)
            
        job_states[job_id] = {"step": "Transcribing with AI...", "progress": 30}
        print(f"[{job_id}] 2. Transcribing with fast Groq API...")
        segments = transcribe_audio_groq(aud_file)
        seg_count = len(segments) if segments else 0
            
        downloaded = []
        if enable_broll:
            job_states[job_id] = {"step": f"Generating {style.title()} Prompts...", "progress": 45}
            print(f"[{job_id}] 3. Detecting B-Roll keywords with LLaMA...")
            brolls = get_broll_keywords(segments, style)
            
            for i, br in enumerate(brolls):
                kw = br.get("prompt") or br.get("keyword") 
                if not kw: continue
                
                job_states[job_id] = {"step": f"Fetching B-Roll {i+1}...", "progress": 50 + (i*5)}
                p_vid = str(TEMP_DIR / f"{job_id}_br_{i}.mp4")
                p_img = str(TEMP_DIR / f"{job_id}_br_{i}.jpg")
                
                print(f"[{job_id}] 4a. Fetching Pexels B-Roll Video for '{kw[:30]}...'")
                if fetch_pexels_video(kw, p_vid):
                    downloaded.append({"path": p_vid, "start": br.get("start_time"), "end": br.get("end_time")})
                else:
                    print(f"[{job_id}] 4b. Pexels failing... Falling back to AI Image Generator for '{kw[:30]}...'")
                    job_states[job_id] = {"step": f"Synthesizing Fallback B-Roll {i+1}...", "progress": 52 + (i*5)}
                    enhanced_prompt = f"A {style} highly detailed 4k cinematic shot of {kw}, photorealistic, stunning"
                    if generate_ai_broll_image(enhanced_prompt, p_img):
                        downloaded.append({"path": p_img, "start": br.get("start_time"), "end": br.get("end_time")})
                
        job_states[job_id] = {"step": "Designing Subtitles...", "progress": 70}
        print(f"[{job_id}] 5. Designing SRT Subtitles...")
        generate_srt(segments, srt_file)
        
        job_states[job_id] = {"step": "Applying Audio Mix...", "progress": 85}
        bgm_path = str(TEMP_DIR / f"bgm_{style}.mp3")
        print(f"[{job_id}] 6. Downloading Background Music...")
        download_bgm(bgm_path, style)
        
        job_states[job_id] = {"step": "Rendering Magical Video...", "progress": 90}
        print(f"[{job_id}] 7. Rendering final magical video with FFmpeg...")
        if downloaded:
            success = burn_complex_video(in_vid, srt_file, downloaded, out_vid, bgm_path)
        else:
            # Fallback: just burn subtitles & bgm
            success = burn_complex_video(in_vid, srt_file, [], out_vid, bgm_path)
            
        if not success: raise Exception("FFmpeg Rendering Failed")
        
        # Upload final video to Cloudinary
        job_states[job_id] = {"step": "Uploading to Cloud...", "progress": 95}
        video_url = f"/api/video/{job_id}"  # fallback local URL
        if CLOUDINARY_CLOUD_NAME:
            try:
                print(f"[{job_id}] 7. Uploading final video to Cloudinary...")
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
        
        job_states[job_id] = {
            "step": "Complete!", 
            "progress": 100, 
            "result": {
                "success": True, 
                "job_id": job_id, 
                "video_url": video_url, 
                "transcript_segments": seg_count
            }
        }
        print(f"[{job_id}] ✅ Video is Ready!")
    except Exception as e:
        print(f"[{job_id}] ❌ CRITICAL FAIL: {e}")
        job_states[job_id] = {"step": "Failed", "progress": 0, "error": str(e)}

@app.post("/process")
async def process_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...), 
    enable_broll: bool = Form(True), 
    style: str = Form("cinematic")
):
    job_id = str(uuid.uuid4())[:8]
    job_states[job_id] = {"step": "Initializing...", "progress": 5}
    ext = Path(file.filename).suffix or ".mp4"
    in_vid, aud_file, srt_file, out_vid = str(UPLOAD_DIR / f"{job_id}{ext}"), str(TEMP_DIR / f"{job_id}.mp3"), str(TEMP_DIR / f"{job_id}.srt"), str(OUTPUT_DIR / f"{job_id}.mp4")
    
    try:
        content = await file.read()
        with open(in_vid, "wb") as f: f.write(content)
        # Run heavy pipeline processing async so we can poll status later!
        background_tasks.add_task(run_pipeline, job_id, in_vid, aud_file, srt_file, out_vid, enable_broll, style)
        return {"success": True, "job_id": job_id, "message": "Processing started in background"}
    except Exception as e:
        job_states[job_id] = {"step": "Failed", "progress": 0}
        raise HTTPException(status_code=500, detail=str(e))

class UrlRequest(BaseModel):
    url: str

@app.post("/process-url")
async def process_video_url(req: UrlRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())[:8]
    job_states[job_id] = {"step": "Downloading video...", "progress": 5}
    
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
            job_states[job_id] = {"step": "Failed", "progress": 0, "error": str(e)}
    
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
