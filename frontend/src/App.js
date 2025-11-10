import React, { useState, useRef, useEffect } from "react";
import "./App.css";

function App() {
  // constants
  const NSFW_THRESHOLD = 0.6; // one source of truth for UI thresholds

  // app state
  const [activeTab, setActiveTab] = useState("video"); // "video" | "image" | "url"
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [objectUrl, setObjectUrl] = useState(null); // for revoking
  const [blurEnabled, setBlurEnabled] = useState(false);
  const [skipEnabled, setSkipEnabled] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const videoRef = useRef(null);

  // handle file input
  const handleFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    // revoke old object url if any
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
      setVideoURL(null);
      setShowPreview(false);
    }
    setFile(f);
  };

  // main submit
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

      if (!response) throw new Error("No request was made");
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || "Server returned an error");
      }

      const data = await response.json();
      setResult(data);

      // if video upload, create object URL for preview (and revoke previous one)
      if (activeTab === "video" && file) {
        // revoke previous
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          setObjectUrl(null);
        }
        const localUrl = URL.createObjectURL(file);
        setVideoURL(localUrl);
        setObjectUrl(localUrl);
        setShowPreview(true);
      } else {
        // no video preview in other tabs
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          setObjectUrl(null);
        }
        setVideoURL(null);
        setShowPreview(false);
      }
    } catch (error) {
      console.error(error);
      alert("Error analyzing content: " + (error.message || ""));
    } finally {
      setLoading(false);
    }
  };

  // download JSON report
  const downloadReport = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    const u = URL.createObjectURL(blob);
    link.href = u;
    link.download = "nsfw_report.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(u);
  };

  // download safe video (calls backend generate-safe-video)
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
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Failed to generate safe video");
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "safe_preview.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      alert("Error generating safe video: " + (err.message || ""));
    }
  };

  // cleanup object URL on unmount or when objectUrl changes
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  // Skip logic — prefers server-provided segments; otherwise uses timestamps
  useEffect(() => {
    if (!videoRef.current || !result?.nsfw_results || !skipEnabled) return;
    const video = videoRef.current;
    // server may return result.nsfw_segments as array of [start,end]
    const segments = result.nsfw_segments || null;
    const timestamps = (result.nsfw_results || []).map((r) => r.timestamp).sort((a, b) => a - b);

    const onTimeUpdate = () => {
      const t = video.currentTime;

      if (segments && segments.length) {
        // if currently inside an NSFW segment, jump to end + small epsilon
        for (const seg of segments) {
          const start = seg[0];
          const end = seg[1];
          if (t >= start && t <= end) {
            video.currentTime = Math.min(end + 0.05, video.duration);
            return;
          }
        }
      } else if (timestamps.length) {
        // find a timestamp very near current time
        // prefer jumping forward to avoid loops
        const near = timestamps.find((ts) => Math.abs(ts - t) < 0.5);
        if (near != null) {
          const next = Math.min(near + 1.0, video.duration);
          if (next > t + 0.05) video.currentTime = next;
          return;
        }
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [skipEnabled, result]);

  // Blur logic — prefers segments, polls at modest interval
  useEffect(() => {
    if (!videoRef.current || !result?.nsfw_results) return;
    const video = videoRef.current;
    const segments = result.nsfw_segments || null;
    const timestamps = (result.nsfw_results || []).map((r) => r.timestamp);

    const check = () => {
      if (!blurEnabled) {
        video.style.filter = "none";
        return;
      }
      const t = video.currentTime;
      let isNSFW = false;
      if (segments && segments.length) {
        isNSFW = segments.some(([s, e]) => t >= s && t <= e);
      } else {
        isNSFW = timestamps.some((ts) => Math.abs(ts - t) < 0.5);
      }
      video.style.filter = isNSFW ? "blur(15px)" : "none";
    };

    const id = setInterval(check, 250); // 250ms polling
    return () => {
      clearInterval(id);
      if (video) video.style.filter = "none";
    };
  }, [blurEnabled, result]);

  // render table rows for video results
  const renderVideoResults = () => {
    if (!result?.nsfw_results || result.nsfw_results.length === 0) {
      return <p className="safe-text">✅ No NSFW content detected in video.</p>;
    }

    return (
      <table className="result-table">
        <thead>
          <tr>
            <th>Timestamp (s)</th>
            <th>Confidence</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          {result.nsfw_results.map((f, i) => {
            const label = f.label || (f.confidence >= NSFW_THRESHOLD ? "nsfw" : "normal");
            const unsafe = label === "nsfw" || f.confidence > 0.8;
            return (
              <tr key={i} className={unsafe ? "unsafe-row" : "safe-row"}>
                <td>{f.timestamp}</td>
                <td>{(f.confidence * 100).toFixed(2)}%</td>
                <td style={{ textTransform: "uppercase" }}>{label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  // Helper: UI when analyzing URLs (server returns content_type only)
  const renderUrlResult = () => {
    if (!result) return null;
    if (result.error) {
      return <p className="unsafe-text">Error: {result.error}</p>;
    }
    if (result.content_type) {
      return (
        <div style={{ textAlign: "left" }}>
          <p>
            <b>Fetched content-type:</b> {result.content_type}
          </p>
          <p>
            The server did not analyze the remote media. If you want full NSFW analysis, download the file and upload it (or use a backend route that fetches and submits to the model).
          </p>
          <pre style={{ textAlign: "left", background: "#f9fafb", padding: "1rem" }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      );
    }
    return <pre style={{ textAlign: "left", background: "#f9fafb", padding: "1rem" }}>{JSON.stringify(result, null, 2)}</pre>;
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
              // reset relevant state
              setActiveTab(tab);
              setFile(null);
              setUrl("");
              setResult(null);
              setBlurEnabled(false);
              setSkipEnabled(false);
              setShowPreview(false);
              // revoke previous object URL if exists
              if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                setObjectUrl(null);
                setVideoURL(null);
              }
            }}
          >
            {tab === "video" ? "🎥 Video" : tab === "image" ? "🖼️ Image" : "🌐 URL"}
          </button>
        ))}
      </div>

      <div className="upload-box">
        {activeTab === "url" ? (
          <input type="text" placeholder="Enter image/video URL" value={url} onChange={(e) => setUrl(e.target.value)} className="url-input" />
        ) : (
          <input type="file" onChange={handleFileChange} accept={activeTab === "image" ? "image/*" : "video/*"} />
        )}
        <button onClick={handleSubmit} className="upload-btn" disabled={loading}>
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
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button className="download-btn" onClick={downloadReport}>
                ⬇️ Download Report
              </button>
            </div>
          </div>

          {result.filename && (
            <p>
              <b>File:</b> {result.filename}
            </p>
          )}
          {result.duration_seconds != null && typeof result.duration_seconds === "number" && (
            <p>
              <b>Duration:</b> {result.duration_seconds.toFixed(1)} sec
            </p>
          )}

          {activeTab === "video" && videoURL && (
            <div className="video-center">
              <button className="preview-btn" onClick={() => setShowPreview((s) => !s)}>
                🎬 {showPreview ? "Hide Preview" : "Toggle Preview"}
              </button>

              <div style={{ marginTop: "0.75rem" }}>
                <video id="video-preview" ref={videoRef} src={videoURL} width="400" controls style={{ display: showPreview ? "block" : "none" }}></video>
              </div>

              {result.nsfw_results?.length > 0 && (
                <div className="nsfw-controls">
                  <button className={`nsfw-btn ${blurEnabled ? "active" : ""}`} onClick={() => setBlurEnabled((b) => !b)}>
                    🙈 {blurEnabled ? "Unblur NSFW" : "Blur NSFW"}
                  </button>
                  <button className={`nsfw-btn ${skipEnabled ? "active" : ""}`} onClick={() => setSkipEnabled((s) => !s)}>
                    ⛔ {skipEnabled ? "Stop Skipping" : "Skip NSFW Segments"}
                  </button>
                  <button className="safe-video-btn" onClick={handleDownloadSafeVideo}>
                    🧩 Download Safe Preview Video
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "video" ? (
            renderVideoResults()
          ) : activeTab === "image" ? (
            // image result: backend may return structure like { result: [{label, score}, ...] }
            result.result?.some((r) => r.label === "nsfw" && r.score > NSFW_THRESHOLD) ? (
              <p className="unsafe-text">🚨 NSFW content detected in image!</p>
            ) : (
              <p className="safe-text">✅ Image is safe.</p>
            )
          ) : (
            renderUrlResult()
          )}
        </div>
      )}
    </div>
  );
}

export default App;
