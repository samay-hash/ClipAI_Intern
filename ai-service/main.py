import os
import uuid
import subprocess
import json
import re
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
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

# Load Keys
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

def get_broll_keywords(segments: list) -> list:
    if not segments or not groq_client: return []
    full_text = " ".join([seg["text"] if isinstance(seg, dict) else getattr(seg, "text") for seg in segments])
    
    prompt = f"""
    You are an AI video editor that suggests Generative AI Image Prompts.
    Based on the following transcript, pick the 2 most visually interesting and distinct concepts that can be shown as B-roll clips.
    For each, provide a "highly detailed, photorealistic, cinematic prompt" (max 15 words) to use on an AI Image Generator.
    Also, figure out the start and end time (in seconds) to insert this B-roll so it matches nicely with the transcript flow. Make each clip last exactly 3.5 seconds.
    Return ONLY a raw valid JSON array. Example: [{{"prompt": "A cinematic 4k highly detailed shot of a glowing laptop screen", "start_time": 2.0, "end_time": 5.5}}]
    Here is the transcript:
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

def burn_complex_video(main_video: str, srt_path: str, broll_info: list, output_path: str) -> bool:
    try:
        inputs = ["-i", main_video]
        filter_complex = []
        overlay_chain = "[0:v]"
        
        for i, clip in enumerate(broll_info):
            is_image = clip['path'].lower().endswith(('.png', '.jpg', '.jpeg'))
            duration = clip['end'] - clip['start']
            
            if is_image:
                inputs.extend(["-loop", "1", "-t", str(duration), "-i", clip['path']])
            else:
                inputs.extend(["-i", clip['path']])
                
            vid_idx = i + 1
            start_t, end_t = clip['start'], clip['end']
            
            # Scale B-roll to match main video, then crop to exact size
            if is_image:
                # Add cinematic slow zoom (zoompan) to AI images to make them feel like videos
                filter_complex.append(
                    f"[{vid_idx}:v]scale=1920:-1,zoompan=z='min(zoom+0.0015,1.5)':d={int(25*duration)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080[v{vid_idx}cropped];"
                )
            else:
                filter_complex.append(
                    f"[{vid_idx}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[v{vid_idx}cropped];"
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

        # Add subtitles and cool lighting flash effects as the last filter
        # Soft cinematic fade from white 
        fade_filter = f",fade=t=in:st=0:d=1:color=white,fade=t=out:st={duration-1}:d=1:color=black" if duration > 3.0 else ""
        
        if os.path.exists(srt_path):
            escaped_srt = srt_path.replace("\\", "/").replace(":", "\\\\:")
            style = "FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,MarginV=30"
            filter_complex.append(f"{overlay_chain}subtitles='{escaped_srt}':force_style='{style}'{fade_filter}[vout]")
        else:
            filter_complex.append(f"{overlay_chain}format=yuv420p{fade_filter}[vout]")
             
        fc_str = "".join(filter_complex)
        print(f"FFmpeg filter: {fc_str[:300]}...")
        cmd = ["ffmpeg", "-y"] + inputs + ["-filter_complex", fc_str, "-map", "[vout]", "-map", "0:a?", "-c:a", "aac", "-c:v", "libx264", "-preset", "fast", output_path]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            print(f"FFmpeg FAILED stderr: {result.stderr.decode()[-800:]}")
        return result.returncode == 0
    except Exception as e:
        print("Burn error:", e)
        return False

@app.get("/health")
async def health_check(): return {"status": "ok"}

async def run_pipeline(job_id, in_vid, aud_file, srt_file, out_vid):
    print(f"[{job_id}] 1. Extracting audio...")
    extract_audio(in_vid, aud_file)
        
    print(f"[{job_id}] 2. Transcribing with fast Groq API...")
    segments = transcribe_audio_groq(aud_file)
    seg_count = len(segments) if segments else 0
        
    print(f"[{job_id}] 3. Detecting B-Roll keywords with LLaMA...")
    brolls = get_broll_keywords(segments)
    
    downloaded = []
    for i, br in enumerate(brolls):
        # We now look for 'prompt' instead of keyword for Generative AI
        kw = br.get("prompt") or br.get("keyword") 
        if not kw: continue
        p = str(TEMP_DIR / f"{job_id}_br_{i}.jpg")
        print(f"[{job_id}] 4. Generating AI B-Roll Image for '{kw[:30]}...'")
        if generate_ai_broll_image(kw, p):
            downloaded.append({"path": p, "start": br.get("start_time"), "end": br.get("end_time")})
        
    print(f"[{job_id}] 5. Designing SRT Subtitles...")
    generate_srt(segments, srt_file)
    
    print(f"[{job_id}] 6. Rendering magical final video...")
    if downloaded:
        success = burn_complex_video(in_vid, srt_file, downloaded, out_vid)
    else:
        # Fallback: just burn subtitles without B-roll, with cinematic fade
        duration = 0.0
        try:
            duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", in_vid]).decode().strip())
        except: pass
        
        fade_filter = f"fade=t=in:st=0:d=1:color=white,fade=t=out:st={max(0, duration-1)}:d=1:color=black" if duration > 3.0 else ""
        srt_filter = f"subtitles={srt_file}" if os.path.exists(srt_file) else ""
        
        vf_filters = ",".join(filter(bool, [srt_filter, fade_filter]))
        cmd = ["ffmpeg", "-y", "-i", in_vid]
        if vf_filters:
            cmd += ["-vf", vf_filters]
        cmd += ["-c:a", "copy", "-c:v", "libx264", "-preset", "fast", out_vid]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            print(f"FFmpeg stderr: {result.stderr.decode()[-500:]}")
        success = result.returncode == 0
        
    if not success: raise Exception("FFmpeg Rendering Failed")
    
    # Upload final video to Cloudinary
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
    
    print(f"[{job_id}] ✅ Video is Ready!")
    return {"success": True, "job_id": job_id, "video_url": video_url, "transcript_segments": seg_count}

@app.post("/process")
async def process_video(file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix or ".mp4"
    in_vid, aud_file, srt_file, out_vid = str(UPLOAD_DIR / f"{job_id}{ext}"), str(TEMP_DIR / f"{job_id}.mp3"), str(TEMP_DIR / f"{job_id}.srt"), str(OUTPUT_DIR / f"{job_id}.mp4")
    
    try:
        content = await file.read()
        with open(in_vid, "wb") as f: f.write(content)
        return await run_pipeline(job_id, in_vid, aud_file, srt_file, out_vid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class UrlRequest(BaseModel):
    url: str

@app.post("/process-url")
async def process_video_url(req: UrlRequest):
    job_id = str(uuid.uuid4())[:8]
    in_vid, aud_file, srt_file, out_vid = str(UPLOAD_DIR / f"{job_id}.mp4"), str(TEMP_DIR / f"{job_id}.mp3"), str(TEMP_DIR / f"{job_id}.srt"), str(OUTPUT_DIR / f"{job_id}.mp4")
    
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
            
        return await run_pipeline(job_id, in_vid, aud_file, srt_file, out_vid)
    except Exception as e:
        print(f"URL Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
            
        await run_pipeline(job_id, in_vid, aud_file, srt_file, out_vid)
        
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
