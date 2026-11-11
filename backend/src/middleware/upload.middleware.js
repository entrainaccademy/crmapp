const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Private secure storage directory - NOT served as public static files
const privateRecordingsDir = path.join(__dirname, '../../storage/recordings');
if (!fs.existsSync(privateRecordingsDir)) {
  fs.mkdirSync(privateRecordingsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, privateRecordingsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.m4a';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `rec-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Allow all standard audio formats
  if (
    file.mimetype.startsWith('audio/') ||
    file.mimetype === 'video/mp4' ||
    file.mimetype === 'application/octet-stream' ||
    file.originalname.match(/\.(m4a|mp3|wav|webm|aac|ogg|3gp)$/i)
  ) {
    cb(null, true);
  } else {
    cb(new Error('Only audio recordings are supported.'), false);
  }
};

const audioUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB max
  },
});

module.exports = {
  audioUpload,
};

