import React, { useRef, useState } from "react";

const ResultsPanel = ({ results }) => {
  const { filename, duration_seconds, nsfw_timestamps, fileBlob } = results;
  const videoRef = useRef(null);
  const [showVideo, setShowVideo] = useState(false);

  const jumpToTime = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const downloadReport = () => {
    if (!nsfw_timestamps || nsfw_timestamps.length === 0) {
      alert("✅ No NSFW data to download — everything looks clean!");
      return;
    }

    const csvHeader = "Index,Timestamp (sec),Confidence\n";
    const csvRows = nsfw_timestamps
      .map((item, index) => `${index + 1},${item.time_seconds.toFixed(2)},${item.confidence}`)
      .join("\n");

    const blob = new Blob([csvHeader + csvRows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename.replace(/\.[^/.]+$/, "")}_NSFW_Report.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="results-box">
      <div className="results-header">
        <div>
          <h2>📁 {filename}</h2>
          <p>🕒 Duration: {duration_seconds.toFixed(2)} sec</p>
        </div>

        {/* Download Report in Top Right */}
        <button onClick={downloadReport} className="download-btn">
          📥 Download Report
        </button>
      </div>

      <div className="action-buttons">
        {/* Toggle video preview */}
        <button onClick={() => setShowVideo(!showVideo)} className="preview-btn">
          {showVideo ? "❌ Hide Video Preview" : "🎬 Show Video Preview"}
        </button>
      </div>

      {/* Video Preview - Centered */}
      {showVideo && (
        <div className="video-center">
          <video
            ref={videoRef}
            controls
            width="600"
            style={{
              borderRadius: "12px",
              marginTop: "15px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            }}
          >
            <source src={URL.createObjectURL(fileBlob)} type="video/mp4" />
            Your browser does not support video playback.
          </video>
        </div>
      )}

      {/* NSFW Results */}
      {nsfw_timestamps.length === 0 ? (
        <p className="safe-text">✅ No NSFW content detected!</p>
      ) : (
        <>
          <h3>⚠️ NSFW Segments Detected:</h3>
          <table>
            <thead>
              <tr>
                <th>Frames</th>
                <th>Timestamp (sec)</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {nsfw_timestamps.map((item, index) => (
                <tr
                  key={index}
                  onClick={() => {
                    if (showVideo) jumpToTime(item.time_seconds);
                    else alert("🎥 Please open the video preview first!");
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <td>{index + 1}</td>
                  <td>{item.time_seconds.toFixed(2)}</td>
                  <td>{item.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

export default ResultsPanel;
