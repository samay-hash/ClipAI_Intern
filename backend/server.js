const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const FormData = require("form-data");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5001;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

// AWS Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const S3_BUCKET = process.env.S3_BUCKET;

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 1. Get Presigned URL for Direct S3 Upload
app.get("/api/get-presigned-url", async (req, res) => {
  try {
    const fileName = req.query.fileName;
    const fileType = req.query.fileType;
    if (!fileName || !fileType) {
      return res.status(400).json({ error: "fileName and fileType are required" });
    }

    const key = `uploads/${Date.now()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    res.json({ uploadUrl, key });
  } catch (error) {
    console.error("❌ Presigned URL error:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// 2. Notify Backend to process file already in S3
app.post("/api/process-s3", async (req, res) => {
  try {
    const { s3Key, language, captionStyle, enableBroll, style, maxBroll } = req.body;
    if (!s3Key) return res.status(400).json({ error: "s3Key is required" });

    console.log(`🚀 Starting AI processing for S3 key: ${s3Key}`);

    const aiResponse = await fetch(`${AI_SERVICE_URL}/process-s3`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        s3_key: s3Key,
        s3_bucket: S3_BUCKET,
        language: language || 'auto',
        caption_style: captionStyle || 'clean',
        enable_broll: enableBroll === false ? false : true,
        style: style || 'cinematic',
        max_broll: maxBroll || 8
      }),
      timeout: 600000,
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json().catch(() => ({}));
      throw new Error(errorData.detail || "AI service processing failed");
    }

    const result = await aiResponse.json();
    res.json({
      success: true,
      job_id: result.job_id,
      message: result.message,
    });
  } catch (error) {
    console.error("❌ Process S3 error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not supported. Use: ${allowed.join(", ")}`));
    }
  },
});

// Deprecated upload route (kept for legacy but direct S3 is preferred)
app.post("/api/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    console.log(`📁 File received locally: ${req.file.filename} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);

    const formData = new FormData();
    formData.append("file", fs.createReadStream(req.file.path));
    formData.append("enable_broll", req.body.enableBroll === 'false' ? 'False' : 'True');
    formData.append("style", req.body.style || 'cinematic');
    formData.append("language", req.body.language || 'auto');
    formData.append("caption_style", req.body.captionStyle || 'clean');
    formData.append("max_broll", req.body.maxBroll || '8');

    const aiResponse = await fetch(`${AI_SERVICE_URL}/process`, {
      method: "POST",
      body: formData,
      headers: formData.getHeaders(),
      timeout: 600000,
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json().catch(() => ({}));
      throw new Error(errorData.detail || "AI service processing failed");
    }

    const result = await aiResponse.json();
    fs.unlink(req.file.path, () => {});

    res.json({
      success: true,
      job_id: result.job_id,
      message: result.message,
      video_url: result.video_url,
    });
  } catch (error) {
    console.error("❌ Upload error:", error.message);
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: error.message || "Failed to process video" });
  }
});

app.post("/api/upload-url", async (req, res) => {
  try {
    const { videoUrl, language, captionStyle, brollApproach } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "No URL provided" });

    const aiResponse = await fetch(`${AI_SERVICE_URL}/process-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl, language, caption_style: captionStyle }),
      timeout: 600000, 
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json().catch(() => ({}));
      throw new Error(errorData.detail || "AI service URL processing failed");
    }

    const result = await aiResponse.json();
    res.json({ success: true, job_id: result.job_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/status/:jobId", async (req, res) => {
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/status/${req.params.jobId}`);
    if (aiRes.ok) {
      res.json(await aiRes.json());
    } else {
      res.json({ step: "Connecting...", progress: 0 });
    }
  } catch (error) {
    res.json({ step: "Connecting...", progress: 0 });
  }
});

app.get("/api/video/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const key = `outputs/magical_${jobId}.mp4`;

    // Try to stream from S3 first
    if (S3_BUCKET) {
      try {
        const { GetObjectCommand } = require("@aws-sdk/client-s3");
        const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
        const { Body, ContentType } = await s3Client.send(command);
        
        res.setHeader("Content-Type", ContentType || "video/mp4");
        Body.pipe(res);
        return;
      } catch (e) {
        console.log(`ℹ️ Video not in S3 yet, falling back to AI service for ${jobId}`);
      }
    }

    // Fallback to AI Service Proxy
    const aiResponse = await fetch(`${AI_SERVICE_URL}/video/${jobId}`);
    if (!aiResponse.ok) return res.status(404).json({ error: "Video not found" });
    res.setHeader("Content-Type", "video/mp4");
    aiResponse.body.pipe(res);
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve video" });
  }
});

app.get("/api/health", async (req, res) => {
  let aiStatus = "offline";
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/health`, { timeout: 3000 });
    const data = await aiRes.json();
    aiStatus = data.status;
  } catch {}
  res.json({ status: "ok", ai_service: aiStatus });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Backend running on http://localhost:${PORT}`);
  console.log(`📡 AI Service at ${AI_SERVICE_URL}\n`);
});

