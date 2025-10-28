import cv2

video_path = r"C:\Users\kshiv\OneDrive\Pictures\1416529-sd_640_360_30fps.mov"
cap = cv2.VideoCapture(video_path)

if not cap.isOpened():
    print("❌ OpenCV failed to open video.")
else:
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"✅ OpenCV opened video! FPS={fps}, Total Frames={frame_count}")

cap.release()
