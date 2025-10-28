from moviepy.editor import VideoFileClip
import traceback
try:
    clip = VideoFileClip(r"C:\Users\kshiv\OneDrive\Pictures\1416529-sd_640_360_30fps.mov")
    print("✅ Success! Duration:", clip.duration, "seconds | Resolution:", clip.size)
    clip.close()
except Exception as e:
    print("❌ Error analyzing content:", e)
    traceback.print_exc()
