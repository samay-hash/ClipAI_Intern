const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const FormData = require("form-data");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5001;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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

app.post("/api/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    console.log(`📁 File received locally: ${req.file.filename} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);

    // Send file directly to AI service via FormData
    console.log("🤖 Sending raw video to AI service for processing...");

    const formData = new FormData();
    formData.append("file", fs.createReadStream(req.file.path));
    formData.append("enable_broll", req.body.enableBroll === 'false' ? 'False' : 'True');
    formData.append("style", req.body.style || 'cinematic');

    const aiResponse = await fetch(`${AI_SERVICE_URL}/process`, {
      method: "POST",
      body: formData,
      headers: formData.getHeaders(),
      timeout: 600000, // 10 min timeout for processing
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json().catch(() => ({}));
      throw new Error(errorData.detail || "AI service processing failed");
    }

    const result = await aiResponse.json();
    console.log("✅ Processing complete:", result);

    // Cleanup local uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({
      success: true,
      job_id: result.job_id,
      message: result.message,
      transcript_segments: result.transcript_segments,
      video_url: result.video_url, // Return direct S3 url
    });
  } catch (error) {
    console.error("❌ Upload/process error:", error.message);

    // Cleanup on error
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

    res.status(500).json({
      error: error.message || "Failed to process video",
    });
  }
});

app.post("/api/upload-url", async (req, res) => {
  try {
    const { videoUrl, language, captionStyle, brollApproach } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "No URL provided" });

    console.log(`🔗 Processing URL: ${videoUrl}`);

    const aiResponse = await fetch(`${AI_SERVICE_URL}/process-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl }),
      timeout: 600000, 
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json().catch(() => ({}));
      throw new Error(errorData.detail || "AI service URL processing failed");
    }

    const result = await aiResponse.json();
    console.log("✅ URL Processing complete:", result);

    res.json({
      success: true,
      job_id: result.job_id,
      message: result.message,
      transcript_segments: result.transcript_segments,
      video_url: result.video_url // Return S3 native link directly
    });
  } catch (error) {
    console.error("❌ Upload/process URL error:", error.message);
    res.status(500).json({ error: error.message || "Failed to process URL" });
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
    const aiResponse = await fetch(`${AI_SERVICE_URL}/video/${jobId}`);

    if (!aiResponse.ok) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="edited_${jobId}.mp4"`);
    aiResponse.body.pipe(res);
  } catch (error) {
    console.error("❌ Video fetch error:", error.message);
    res.status(500).json({ error: "Failed to retrieve video" });
  }
});
app.get("/api/health", async (req, res) => {
  let aiStatus = "unknown";
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/health`, { timeout: 3000 });
    const data = await aiRes.json();
    aiStatus = data.status;
  } catch {
    aiStatus = "offline";
  }

  res.json({
    status: "ok",
    service: "backend",
    ai_service: aiStatus,
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Max size: 500MB" });
    }
  }
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 AI Service expected at ${AI_SERVICE_URL}\n`);
});
