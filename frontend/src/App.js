import React, { useState, useRef, useEffect } from "react";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState("video");
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [blurEnabled, setBlurEnabled] = useState(false);
  const [skipEnabled, setSkipEnabled] = useState(false);
  const videoRef = useRef(null);

  const handleFileChange = (e) => setFile(e.target.files[0]);

  const handleSubmit = async () => {
    if (!file && activeTab !== "url") {
      alert("Please select a file!");
      return;
    }
    setLoading(true);
    setResult(null);

    try {
      let response;
      if (activeTab === "video") {
        const formData = new FormData();
        formData.append("file", file);
        response = await fetch("http://127.0.0.1:8000/upload", {
          method: "POST",
          body: formData,
        });
      } else if (activeTab === "image") {
        const formData = new FormData();
        formData.append("file", file);
        response = await fetch("http://127.0.0.1:8000/upload-image", {
          method: "POST",
          body: formData,
        });
      } else if (activeTab === "url") {
        const formData = new FormData();
        formData.append("url", url);
        response = await fetch("http://127.0.0.1:8000/analyze-url", {
          method: "POST",
          body: formData,
        });
      }

      const data = await response.json();
      setResult(data);

      if (activeTab === "video") {
        setVideoURL(URL.createObjectURL(file));
      }
    } catch (error) {
      console.error(error);
      alert("Error analyzing content!");
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "nsfw_report.json";
    link.click();
  };

  // Auto skip NSFW timestamps
  useEffect(() => {
    if (!videoRef.current || !result?.nsfw_results || !skipEnabled) return;
    const video = videoRef.current;
    const nsfwTimes = result.nsfw_results.map((r) => r.timestamp);

    const onTimeUpdate = () => {
      const currentTime = video.currentTime;
      const nextNSFW = nsfwTimes.find((t) => Math.abs(t - currentTime) < 0.5);
      if (nextNSFW) {
        video.currentTime = Math.min(currentTime + 1.0, video.duration);
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [skipEnabled, result]);

  // Dynamic blur filter
  useEffect(() => {
    if (!videoRef.current || !result?.nsfw_results) return;
    const video = videoRef.current;
    const nsfwTimes = result.nsfw_results.map((r) => r.timestamp);
    const interval = setInterval(() => {
      if (!blurEnabled) {
        video.style.filter = "none";
        return;
      }
      const currentTime = video.currentTime;
      const isNSFW = nsfwTimes.some((t) => Math.abs(t - currentTime) < 0.5);
      video.style.filter = isNSFW ? "blur(15px)" : "none";
    }, 300);
    return () => clearInterval(interval);
  }, [blurEnabled, result]);

  const handleDownloadSafeVideo = async () => {
    if (!file) {
      alert("Upload a video first!");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("http://127.0.0.1:8000/generate-safe-video", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to generate safe video");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "safe_preview.mp4";
      a.click();
    } catch (err) {
      console.error(err);
      alert("Error generating safe video!");
    }
  };

  const renderVideoResults = () => {
    if (!result?.nsfw_results) {
      return <p className="safe-text">✅ No NSFW content detected in video.</p>;
    }
    return (
      <table className="result-table">
        <thead>
          <tr>
            <th>Timestamp (s)</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {result.nsfw_results.map((f, i) => (
            <tr key={i} className={f.confidence > 0.8 ? "unsafe-row" : "safe-row"}>
              <td>{f.timestamp}</td>
              <td>{(f.confidence * 100).toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="App">
      <h1 className="app-title">🧠 NSFW Detector</h1>

      <div className="tabs">
        {["video", "image", "url"].map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? "active" : ""}`}
            onClick={() => {
              setActiveTab(tab);
              setFile(null);
              setUrl("");
              setResult(null);
              setBlurEnabled(false);
              setSkipEnabled(false);
            }}
          >
            {tab === "video" ? "🎥 Video" : tab === "image" ? "🖼️ Image" : "🌐 URL"}
          </button>
        ))}
      </div>

      <div className="upload-box">
        {activeTab === "url" ? (
          <input
            type="text"
            placeholder="Enter image/video URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="url-input"
          />
        ) : (
          <input type="file" onChange={handleFileChange} />
        )}
        <button onClick={handleSubmit} className="upload-btn">
          Analyze
        </button>
      </div>

      {loading && (
        <div className="loading-box">
          <div className="spinner"></div>
          <p>Analyzing content...</p>
        </div>
      )}

      {result && !loading && (
        <div className="results-box">
          <div className="results-header">
            <h2>📊 Detection Results</h2>
            <button className="download-btn" onClick={downloadReport}>
              ⬇️ Download Report
            </button>
          </div>

          {result.filename && <p><b>File:</b> {result.filename}</p>}
          {result.duration_seconds && (
            <p><b>Duration:</b> {result.duration_seconds.toFixed(1)} sec</p>
          )}

          {activeTab === "video" && videoURL && (
            <div className="video-center">
              <button
                className="preview-btn"
                onClick={() =>
                  document.getElementById("video-preview").classList.toggle("hidden")
                }
              >
                🎬 Toggle Preview
              </button>

              <video
                id="video-preview"
                ref={videoRef}
                src={videoURL}
                width="400"
                controls
                className="hidden"
              ></video>

              {result.nsfw_results?.length > 0 && (
                <div className="nsfw-controls">
                  <button
                    className={`nsfw-btn ${blurEnabled ? "active" : ""}`}
                    onClick={() => setBlurEnabled(!blurEnabled)}
                  >
                    🙈 {blurEnabled ? "Unblur NSFW" : "Blur NSFW"}
                  </button>
                  <button
                    className={`nsfw-btn ${skipEnabled ? "active" : ""}`}
                    onClick={() => setSkipEnabled(!skipEnabled)}
                  >
                    ⛔ {skipEnabled ? "Stop Skipping" : "Skip NSFW Segments"}
                  </button>
                  <button className="safe-video-btn" onClick={handleDownloadSafeVideo}>
                    🧩 Download Safe Preview Video
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "video"
            ? renderVideoResults()
            : activeTab === "image"
            ? result.result?.some(
                (r) => r.label === "nsfw" && r.score > 0.6
              ) ? (
                <p className="unsafe-text">🚨 NSFW content detected in image!</p>
              ) : (
                <p className="safe-text">✅ Image is safe.</p>
              )
            : (
                <pre
                  style={{
                    textAlign: "left",
                    background: "#f9fafb",
                    padding: "1rem",
                  }}
                >
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
        </div>
      )}
    </div>
  );
}

export default App;
