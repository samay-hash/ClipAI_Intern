FROM python:3.10-slim

# Install system dependencies including FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory and permissions first
WORKDIR /app

# Hugging Face Spaces require running as a non-root user
RUN useradd -m -u 1000 user && chown -R user:user /app
USER user
ENV PATH="/home/user/.local/bin:$PATH"

# Copy requirements and install them
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY --chown=user . .

# Create necessary directories
RUN mkdir -p uploads outputs temp

# HF uses 7860
EXPOSE 7860
CMD uvicorn main:app --host 0.0.0.0 --port 7860
