const express = require('express');
const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');

const app = express();
app.use(express.json({ limit: '100mb' }));

// CORS 設定
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'ffmpeg-merge-api',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 首頁說明
app.get('/', (req, res) => {
  res.json({
    name: 'FFmpeg Merge API',
    description: '合併圖片和音樂成影片的 API 服務',
    version: '1.0.0',
    endpoints: {
      'GET /health': '健康檢查',
      'POST /api/merge': '合併圖片和音樂',
      'GET /': '此說明頁面'
    },
    usage: {
      endpoint: 'POST /api/merge',
      body: {
        audio_url: 'https://example.com/audio.mp3 (必填)',
        image_data: 'base64_encoded_image_string (必填)',
        duration: 'auto (可選)',
        resolution: '1920x1080 (可選，預設 1920x1080)'
      },
      response: {
        success: true,
        video_data: 'base64_encoded_video_string',
        size: 'bytes',
        size_mb: 'MB',
        processing_time_ms: 'milliseconds'
      }
    },
    author: 'Your Name',
    repository: 'https://github.com/yourusername/ffmpeg-api-service'
  });
});

// 合併 API
app.post('/api/merge', async (req, res) => {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[${requestId}] 📥 收到合併請求`);
  
  try {
  const { 
  audio_url, 
  image_data,      // base64 圖片（可選）
  image_url,       // 圖片 URL（可選）
  duration = 'auto', 
  resolution = '1920x1080' 
} = req.body;

// 驗證參數
if (!audio_url) {
  return res.status(400).json({ 
    success: false,
    error: '缺少參數：audio_url',
    request_id: requestId
  });
}

// image_data 和 image_url 必須提供其中一個
if (!image_data && !image_url) {
  return res.status(400).json({ 
    success: false,
    error: '缺少參數：必須提供 image_data (base64) 或 image_url',
    request_id: requestId
  });
}
    
    // 解析解析度
    const [width, height] = resolution.split('x').map(Number);
    if (!width || !height) {
      return res.status(400).json({
        success: false,
        error: '無效的解析度格式，應為 widthxheight (例如: 1920x1080)',
        request_id: requestId
      });
    }
    
    // 檔案路徑
    const timestamp = Date.now();
    const imagePath = `/tmp/cover_${requestId}.jpg`;
    const audioPath = `/tmp/audio_${requestId}.mp3`;
    const outputPath = `/tmp/output_${requestId}.mp4`;
    
    try {
      // 1. 儲存圖片
      // 處理圖片（支援 URL 或 base64）
let imageBuffer;
if (image_url) {
  console.log(`[${requestId}] 從 URL 下載圖片: ${image_url.substring(0, 50)}...`);
  const imageResponse = await axios.get(image_url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: 50 * 1024 * 1024 // 50MB
  });
  imageBuffer = Buffer.from(imageResponse.data);
} else {
  console.log(`[${requestId}] 從 base64 儲存圖片...`);
  imageBuffer = Buffer.from(image_data, 'base64');
}

await fs.writeFile(imagePath, imageBuffer);
console.log(`[${requestId}] 圖片大小: ${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      
      // 2. 下載音樂
      console.log(`[${requestId}] 🎵 下載音樂: ${audio_url.substring(0, 50)}...`);
      const audioResponse = await axios.get(audio_url, { 
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024 // 100MB
      });
      await fs.writeFile(audioPath, audioResponse.data);
      console.log(`[${requestId}] ✓ 音樂大小: ${(audioResponse.data.length / 1024 / 1024).toFixed(2)} MB`);
      
      // 3. 使用 FFmpeg 合成影片
      console.log(`[${requestId}] 🎬 開始合成影片 (${resolution})...`);
      
      await new Promise((resolve, reject) => {
        const ffmpegArgs = [
          '-loop', '1',
          '-i', imagePath,
          '-i', audioPath,
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-tune', 'stillimage',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-pix_fmt', 'yuv420p',
          '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
          '-shortest',
          '-movflags', '+faststart',
          '-y',
          outputPath
        ];
        
        console.log(`[${requestId}] FFmpeg 命令:`, 'ffmpeg', ffmpegArgs.join(' '));
        
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        
        let stderr = '';
        let lastProgress = 0;
        
        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
          
          // 解析進度
          const timeMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
            
            if (totalSeconds > lastProgress + 5) {
              console.log(`[${requestId}] ⚙️ FFmpeg 進度: ${Math.floor(totalSeconds)}s`);
              lastProgress = totalSeconds;
            }
          }
        });
        
        ffmpeg.on('close', (code) => {
          if (code === 0) {
            console.log(`[${requestId}] ✅ FFmpeg 完成`);
            resolve();
          } else {
            console.error(`[${requestId}] ❌ FFmpeg 失敗 (code ${code})`);
            const errorMsg = stderr.slice(-500);
            console.error(`[${requestId}] 錯誤詳情: ${errorMsg}`);
            reject(new Error(`FFmpeg 失敗 (exit code ${code}): ${errorMsg}`));
          }
        });
        
        ffmpeg.on('error', (err) => {
          console.error(`[${requestId}] ❌ FFmpeg spawn 錯誤:`, err);
          reject(err);
        });
      });
      
      // 4. 讀取影片
      console.log(`[${requestId}] 📖 讀取影片...`);
      const videoBuffer = await fs.readFile(outputPath);
      const stats = await fs.stat(outputPath);
      
      console.log(`[${requestId}] ✓ 影片大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // 5. 清理臨時檔案
      console.log(`[${requestId}] 🧹 清理臨時檔案...`);
      await Promise.all([
        fs.unlink(imagePath).catch(e => console.error(`清理 ${imagePath} 失敗:`, e.message)),
        fs.unlink(audioPath).catch(e => console.error(`清理 ${audioPath} 失敗:`, e.message)),
        
      ]);
      
      const processingTime = Date.now() - startTime;
      console.log(`[${requestId}] 🎉 合成成功，總耗時 ${(processingTime / 1000).toFixed(2)}s`);
      
      // 6. 返回結果
// 不立即刪除影片，而是保存下載信息
const fileName = `video_${requestId}.mp4`;
tempVideos.set(requestId, {
  path: outputPath,
  fileName: fileName,
  timestamp: Date.now()
});

// 返回下載 URL 而不是 base64
res.json({
  success: true,
  download_url: `/api/download/${requestId}`,
  size: stats.size,
  size_mb: parseFloat((stats.size / 1024 / 1024).toFixed(2)),
  processing_time_ms: processingTime,
  processing_time_sec: parseFloat((processingTime / 1000).toFixed(2)),
  resolution: resolution,
  request_id: requestId
});

// 只清理圖片和音樂
await Promise.all([
  fs.unlink(imagePath).catch(() => {}),
  fs.unlink(audioPath).catch(() => {})
]);
      
    } catch (innerError) {
      // 發生錯誤時清理檔案
      console.error(`[${requestId}] ❌ 處理錯誤:`, innerError.message);
      await Promise.all([
        fs.unlink(imagePath).catch(() => {}),
        fs.unlink(audioPath).catch(() => {}),
        fs.unlink(outputPath).catch(() => {})
      ]);
      throw innerError;
    }
    
  } catch (error) {
    console.error(`[${requestId}] ❌ 合成失敗:`, error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      request_id: requestId
    });
  }
});
// ============== 新增：影片臨時存儲和下載功能 ===============

// 存儲臨時影片的 Map
const tempVideos = new Map();

// 定期清理過期影片（5分鐘後刪除）
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of tempVideos.entries()) {
    if (now - data.timestamp > 5 * 60 * 1000) {
      fs.unlink(data.path).catch(() => {});
      tempVideos.delete(id);
      console.log(`[清理] 已刪除過期影片: ${id}`);
    }
  }
}, 60 * 1000); // 每分鐘檢查一次

// 下載影片端點
app.get('/api/download/:requestId', async (req, res) => {
  const { requestId } = req.params;
  
  console.log(`[下載] 請求下載影片: ${requestId}`);
  
  const videoData = tempVideos.get(requestId);
  
  if (!videoData) {
    console.log(`[下載] 影片不存在或已過期: ${requestId}`);
    return res.status(404).json({
      success: false,
      error: '影片不存在或已過期（5分鐘後自動刪除）'
    });
  }
  
  try {
    // 檢查文件是否存在
    const exists = await fs.access(videoData.path).then(() => true).catch(() => false);
    
    if (!exists) {
      tempVideos.delete(requestId);
      console.log(`[下載] 文件已被刪除: ${requestId}`);
      return res.status(404).json({
        success: false,
        error: '影片文件已被刪除'
      });
    }
    
    // 讀取影片
    const videoBuffer = await fs.readFile(videoData.path);
    
    console.log(`[下載] 開始傳送影片: ${requestId}, 大小: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    // 設置響應頭
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${videoData.fileName}"`);
    res.setHeader('Content-Length', videoBuffer.length);
    
    // 發送文件
    res.send(videoBuffer);
    
    // 下載完成後延遲刪除（給時間完成傳輸）
    setTimeout(() => {
      fs.unlink(videoData.path).catch(err => {
        console.error(`[清理] 刪除文件失敗: ${videoData.path}`, err.message);
      });
      tempVideos.delete(requestId);
      console.log(`[清理] 已下載並清理: ${requestId}`);
    }, 2000); // 2秒後清理
    
  } catch (error) {
    console.error(`[下載] 失敗: ${requestId}`, error.message);
    res.status(500).json({
      success: false,
      error: `下載失敗: ${error.message}`
    });
  }
});

// ============== 新增代碼結束 ===============
// 錯誤處理
app.use((err, req, res, next) => {
  console.error('未處理的錯誤:', err);
  res.status(500).json({
    success: false,
    error: '伺服器內部錯誤'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('═'.repeat(60));
  console.log('🎬 FFmpeg 合併服務已啟動');
  console.log('═'.repeat(60));
  console.log(`📍 端口: ${PORT}`);
  console.log(`🏥 健康檢查: http://localhost:${PORT}/health`);
  console.log(`🔧 API 端點: http://localhost:${PORT}/api/merge`);
  console.log(`📚 說明文檔: http://localhost:${PORT}/`);
  console.log('═'.repeat(60));
});
