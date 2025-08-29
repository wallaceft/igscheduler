require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { R2 } = require('@cloudflare/r2');
const { query } = require('./db');
const { Queue } = require('bullmq');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configura R2
const r2 = new R2({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  accountId: process.env.R2_ACCOUNT_ID,
});
const bucket = r2.bucket(process.env.R2_BUCKET);

// Redis Queue
const publishQueue = new Queue('publishQueue', {
  connection: process.env.REDIS_URL,
});

// Upload local temporário com multer
const upload = multer({ dest: 'tmp/' });

// Criar tabela se não existir
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

// Upload vídeo + agendamento individual
app.post('/api/schedule-single', upload.single('video'), async (req, res) => {
  try {
    const { instagramId, pageAccessToken, scheduleAt, caption } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Vídeo obrigatório' });

    const data = fs.readFileSync(file.path);
    const key = `${Date.now()}_${file.originalname}`;
    await bucket.put(key, data, {
      httpMetadata: { contentType: file.mimetype },
    });
    fs.unlinkSync(file.path);

    const result = await query(
      `
      INSERT INTO jobs (instagram_id, page_token, video_key, caption, scheduled_at)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
      `,
      [instagramId, pageAccessToken, key, caption || '', scheduleAt]
    );

    await publishQueue.add('publish', { jobId: result.rows[0].id });

    res.json({ success: true, job: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Upload múltiplos vídeos + agendamento em massa
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

      const data = fs.readFileSync(file.path);
      const key = `${Date.now()}_${file.originalname}`;
      await bucket.put(key, data, {
        httpMetadata: { contentType: file.mimetype },
      });
      fs.unlinkSync(file.path);

      const result = await query(
        `
        INSERT INTO jobs (instagram_id, page_token, video_key, caption, scheduled_at)
        VALUES ($1,$2,$3,$4,$5) RETURNING *
        `,
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

// Lista perfis conectados
app.get('/api/accounts', async (_req, res) => {
  try {
    const resp = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: {
        access_token: process.env.GLOBAL_ACCESS_TOKEN,
        fields: 'access_token,instagram_business_account{username,id}'
      }
    });

    const accounts = resp.data.data
      .filter((p) => p.instagram_business_account)
      .map((p) => ({
        username: p.instagram_business_account.username,
        instagramId: p.instagram_business_account.id,
        pageAccessToken: p.access_token
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

// Rota para servir arquivos do R2 via proxy
app.get('/r2/:key', async (req, res) => {
  try {
    const obj = await bucket.get(req.params.key);
    if (!obj) return res.status(404).send('Not found');
    res.setHeader('Content-Type', obj.httpMetadata.contentType);
    obj.body.pipe(res);
  } catch (error) {
    res.status(500).send('Error serving file');
  }
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
