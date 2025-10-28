from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import moviepy.editor as mp
import cv2, os, json, mimetypes, requests

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    import random
    filename = file.filename
    temp_path = f"temp_{filename}"
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    clip = mp.VideoFileClip(temp_path)
    duration = clip.duration
    # Simulated detection output
    results = [{"timestamp": t, "confidence": round(random.uniform(0.7, 1.0), 3)}
               for t in range(0, int(duration), 2)]
    with open("last_results.json", "w") as fp:
        json.dump(results, fp)
    return {"filename": filename, "duration_seconds": duration, "nsfw_results": results}

@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    return {"result": [{"label": "nsfw", "score": 0.92}]}

@app.post("/analyze-url")
async def analyze_url(url: str = Form(...)):
    try:
        r = requests.get(url, stream=True)
        if r.status_code != 200:
            return {"error": "Could not fetch file from URL"}
        ctype = r.headers.get("Content-Type", "").lower()
        if "image" in ctype or "video" in ctype:
            return {"message": "✅ Media fetched successfully", "content_type": ctype}
        else:
            return {"error": f"Unsupported file type: {ctype}"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/generate-safe-video")
async def generate_safe_video(file: UploadFile = File(...)):
    input_path = f"temp_{file.filename}"
    output_path = f"safe_{file.filename}"
    with open(input_path, "wb") as f:
        f.write(await file.read())

    if os.path.exists("last_results.json"):
        with open("last_results.json") as f:
            nsfw_results = json.load(f)
        nsfw_times = [r["timestamp"] for r in nsfw_results if r["confidence"] > 0.8]
    else:
        nsfw_times = []

    video = mp.VideoFileClip(input_path)

    def blur_frame(get_frame, t):
        frame = get_frame(t)
        if any(abs(t - ts) < 0.5 for ts in nsfw_times):
            return cv2.GaussianBlur(frame, (51, 51), 30)
        return frame

    processed = video.fl(blur_frame)
    processed.write_videofile(output_path, codec="libx264", audio_codec="aac", verbose=False, logger=None)

    return FileResponse(output_path, media_type="video/mp4", filename="safe_preview.mp4")
