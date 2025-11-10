from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import moviepy.editor as mp
import cv2, os, json, mimetypes, requests
import math
import tempfile
from fastapi import HTTPException
from moviepy.editor import VideoFileClip
from transformers import AutoModelForImageClassification, AutoFeatureExtractor
import torch
import numpy as np

model_name = "Falconsai/nsfw_image_detection"
extractor = AutoFeatureExtractor.from_pretrained(model_name)
model = AutoModelForImageClassification.from_pretrained(model_name)
model.eval()

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
    import tempfile
    import numpy as np

    filename = file.filename
    temp_path = f"temp_{filename}"
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    clip = mp.VideoFileClip(temp_path)
    fps = clip.fps or 24
    duration = clip.duration

    frame_interval = max(1, int(fps))  # analyze roughly 1 frame per second
    results = []

    # Iterate through frames
    for i, frame in enumerate(clip.iter_frames(fps=fps)):
        if i % frame_interval != 0:
            continue
        t = i / fps

        # Convert frame (HWC uint8) → model input
        inputs = extractor(images=frame, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            score = probs[0][1].item()  # nsfw class = 1

        # ✅ Only keep frames with confidence ≥ 0.7 (70%)
        if score >= 0.7:
            results.append({
                "timestamp": round(t, 2),
                "confidence": round(score, 3)
            })

    with open("last_results.json", "w") as fp:
        json.dump(results, fp)

    clip.close()
    os.remove(temp_path)

    return {
        "filename": filename,
        "duration_seconds": duration,
        "analyzed_frames": len(results),
        "nsfw_results": results,
    }


from io import BytesIO
from PIL import Image

IMAGE_NSFW_THRESHOLD = 0.7  # 70%

@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """
    Analyze an uploaded image and return NSFW result only if confidence >= IMAGE_NSFW_THRESHOLD.
    """
    # 1) read image bytes and open with PIL
    try:
        content = await file.read()
        img = Image.open(BytesIO(content)).convert("RGB")
    except Exception as e:
        return {"error": f"Could not read uploaded image: {str(e)}"}

    # 2) extract features
    try:
        inputs = extractor(images=img, return_tensors="pt")
    except Exception as e:
        return {"error": f"Feature extractor failed: {str(e)}"}

    # 3) move tensors to model device
    try:
        device = next(model.parameters()).device
    except Exception:
        device = torch.device("cpu")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    # 4) inference
    try:
        with torch.no_grad():
            outputs = model(**inputs)
            # single-label two-class model: softmax -> probabilities
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            # NSFW probability — model mapping is 0: normal, 1: nsfw
            nsfw_score = float(probs[0, 1].cpu().item())
            top_idx = int(probs.argmax(-1).cpu().item())
    except Exception as e:
        return {"error": f"Model inference failed: {str(e)}"}

    # 5) map index -> label (config.id2label keys may be strings)
    id2label = getattr(model.config, "id2label", {}) or {}
    label = id2label.get(str(top_idx), id2label.get(top_idx, "unknown"))

    # 6) return only high-confidence NSFW result
    if nsfw_score >= IMAGE_NSFW_THRESHOLD and str(label).lower() == "nsfw":
        return {"result": [{"label": label, "score": round(nsfw_score, 4)}]}
    else:
        return {
            "result": [],
            "message": f"No NSFW detected above confidence {int(IMAGE_NSFW_THRESHOLD * 100)}%."
        }


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
    # Save uploaded file to temp file
    input_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1])
    input_path = input_tmp.name
    input_tmp.write(await file.read())
    input_tmp.close()

    try:
        # Load last detection results if exists
        if os.path.exists("last_results.json"):
            with open("last_results.json") as f:
                last_results = json.load(f)
            timestamps = [r.get("timestamp", 0) for r in last_results]
            confs = [r.get("confidence", 1.0) for r in last_results]
        else:
            timestamps = []
            confs = None

        # Convert timestamp list -> segments (adjust threshold/pad/merge_gap as needed)
        segments = timestamps_to_segments(timestamps, confs=confs, threshold=0.6, merge_gap=1.0, pad=1.0)

        # Open video and ensure duration exists
        video = VideoFileClip(input_path)
        duration = video.duration if hasattr(video, "duration") else None
        if duration is None:
            raise HTTPException(status_code=400, detail="Could not read video duration")

        # If no segments, return original (or you can return a 'no nsfw' response)
        if not segments:
            # Option: return original file or notify no NSFW found
            return FileResponse(input_path, media_type="video/mp4", filename="safe_preview.mp4")

        # Precompute a function to check membership into segments.
        def in_any_segment(t):
            # t is float seconds
            # micro-optimization: segments list is short, linear scan is fine
            for start, end in segments:
                if start <= t <= end:
                    return True
            return False

        # Define robust frame processing function
        def blur_frame(get_frame, t):
            frame = get_frame(t)  # moviepy gives RGB frame as float or uint8
            # Ensure frame is uint8 numpy array in RGB order
            if frame.dtype != np.dtype("uint8"):
                frame = (frame * 255).astype("uint8")
            # Convert RGB -> BGR for OpenCV operations (if you need color ops)
            bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

            if in_any_segment(t):
                # You can choose to blur entire frame or mask specific regions
                blurred = cv2.GaussianBlur(bgr, (51, 51), 30)
                # Convert back to RGB for moviepy
                out = cv2.cvtColor(blurred, cv2.COLOR_BGR2RGB)
                return out
            else:
                # Return frame unchanged (but ensure dtype and order)
                return frame

        # Apply transform only once: fl() applies per-frame reliably
        processed = video.fl(blur_frame)

        # Write to temp output
        output_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        output_path = output_tmp.name
        output_tmp.close()

        # You may tweak codec options for speed/compatibility
        processed.write_videofile(output_path, codec="libx264", audio_codec="aac", verbose=False, logger=None)

        # Return processed file
        response = FileResponse(output_path, media_type="video/mp4", filename="safe_preview.mp4")

        # Optionally schedule deletion of temp files here (or after response)
        return response

    finally:
        # cleanup the uploaded input file (keep output until served)
        try:
            if os.path.exists(input_path):
                os.remove(input_path)
        except Exception:
            pass
