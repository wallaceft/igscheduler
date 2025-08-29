require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const stream = require('stream');
const { query } = require('./db');
const { Queue } = require('bullmq');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configura S3 Client para Cloudflare R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Bucket R2
const BUCKET_NAME = process.env.R2_BUCKET;

// Fila Redis com BullMQ
const publishQueue = new Queue('publishQueue', {
  connection: process.env.REDIS_URL,
});

// Multer upload temporário
const upload = multer({ dest: 'tmp/' });

// Criar tabela caso não exista
(async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      instagram_id TEXT,
      page_token TEXT,
      video_key TEXT,
      caption TEXT,
      scheduled_at TIMESTAMP,
      status TEXT DEFAULT 'pending',
      creation_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
})();

// Função upload para R2
async function uploadToR2(key, filePath, contentType) {
  const fileStream = fs.createReadStream(filePath);
  const uploadParams = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileStream,
    ContentType: contentType,
  };
  await s3.send(new PutObjectCommand(uploadParams));
}

// Função para pegar o arquivo do R2 (como stream)
async function getObjectFromR2(key) {
  const getObjectParams = {
    Bucket: BUCKET_NAME,
    Key: key,
  };
  return s3.send(new GetObjectCommand(getObjectParams));
}

// Rota upload e agendamento individual
app.post('/api/schedule-single', upload.single('video'), async (req, res) => {
  try {
    const { instagramId, pageAccessToken, scheduleAt, caption } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Vídeo obrigatório' });

    const key = `${Date.now()}_${file.originalname}`;
    await uploadToR2(key, file.path, file.mimetype);
    fs.unlinkSync(file.path);

    const result = await query(
      `INSERT INTO jobs (instagram_id, page_token, video_key, caption, scheduled_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [instagramId, pageAccessToken, key, caption || '', scheduleAt]
    );

    await publishQueue.add('publish', { jobId: result.rows[0].id });

    res.json({ success: true, job: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Rota upload múltiplos vídeos + agendamento
app.post('/api/schedule-bulk', upload.array('videos', 50), async (req, res) => {
  try {
    const { instagramId, pageAccessToken, startDate, caption } = req.body;
    const files = req.files;
    if (!files || files.length === 0)
      return res.status(400).json({ error: 'Nenhum vídeo enviado' });

    const fixedHours = ['08:00', '11:00', '14:00', '17:00', '20:00'];
    const base = new Date(startDate);
    let created = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const [hh, mm] = fixedHours[i % fixedHours.length].split(':');
      const dayOffset = Math.floor(i / fixedHours.length);
      const sched = new Date(base);
      sched.setDate(base.getDate() + dayOffset);
      sched.setHours(+hh, +mm, 0, 0);

      const key = `${Date.now()}_${file.originalname}`;
      await uploadToR2(key, file.path, file.mimetype);
      fs.unlinkSync(file.path);

      const result = await query(
        `INSERT INTO jobs (instagram_id, page_token, video_key, caption, scheduled_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [instagramId, pageAccessToken, key, caption || '', sched]
      );

      await publishQueue.add('publish', { jobId: result.rows[0].id });
      created++;
    }

    res.json({ success: true, created });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Lista de perfis conectados
app.get('/api/accounts', async (_req, res) => {
  try {
    const resp = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: {
        access_token: process.env.GLOBAL_ACCESS_TOKEN,
        fields: 'access_token,instagram_business_account{username,id}',
      },
    });

    const accounts = resp.data.data
      .filter((p) => p.instagram_business_account)
      .map((p) => ({
        username: p.instagram_business_account.username,
        instagramId: p.instagram_business_account.id,
        pageAccessToken: p.access_token,
      }));

    res.json({ accounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lista agendamentos
app.get('/api/scheduled', async (_req, res) => {
  const result = await query('SELECT * FROM jobs ORDER BY scheduled_at');
  res.json({ scheduled: result.rows });
});

// Proxy para baixar vídeo do R2
app.get('/r2/:key', async (req, res) => {
  try {
    const obj = await getObjectFromR2(req.params.key);
    if (!obj) return res.status(404).send('Not found');
    res.setHeader('Content-Type', obj.ContentType || 'application/octet-stream');
    obj.Body.pipe(res);
  } catch (error) {
    res.status(500).send('Error serving file');
  }
});

// Start do servidor
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
