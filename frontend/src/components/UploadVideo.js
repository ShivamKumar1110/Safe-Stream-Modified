import React, { useState } from "react";
import axios from "axios";

const UploadVideo = ({ setResults, setLoading }) => {
  const [file, setFile] = useState(null);

  const handleUpload = async () => {
    if (!file) return alert("Please select a video first!");

    setLoading(true);
    setResults(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await axios.post("http://127.0.0.1:8000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // Store both backend results and the actual video blob
      setResults({ ...response.data, fileBlob: file });
    } catch (error) {
      alert("Upload failed! Check console for details.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upload-box">
      <input
        type="file"
        accept="video/*"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <button onClick={handleUpload} className="upload-btn">
        🚀 Upload & Analyze
      </button>
    </div>
  );
};

export default UploadVideo;
