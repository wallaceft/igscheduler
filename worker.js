require('dotenv').config();
const { Worker } = require('bullmq');
const { query } = require('./db');
const axios = require('axios');

const connection = process.env.REDIS_URL;

const worker = new Worker(
  'publishQueue',
  async (job) => {
    const { rows } = await query('SELECT * FROM jobs WHERE id=$1', [job.data.jobId]);
    const record = rows[0];
    if (!record) throw new Error('Job não encontrado');

    try {
      const videoUrl = `${process.env.APP_BASE_URL}/r2/${record.video_key}`;

      // Cria container no Instagram
      const createRes = await axios.post(
        `https://graph.facebook.com/v19.0/${record.instagram_id}/media`,
        {
          media_type: 'REELS',
          video_url: videoUrl,
          caption: record.caption,
        },
        {
          params: { access_token: record.page_token },
        }
      );
      const creationId = createRes.data.id;

      // Publica o conteúdo
      await axios.post(
        `https://graph.facebook.com/v19.0/${record.instagram_id}/media_publish`,
        { creation_id: creationId },
        { params: { access_token: record.page_token } }
      );

      // Atualiza status do job
      await query('UPDATE jobs SET status=$1 WHERE id=$2', ['completed', record.id]);
      console.log(`Job ${record.id} publicado com sucesso.`);
    } catch (err) {
      console.error('Erro na publicação:', err.response?.data || err.message);
      await query('UPDATE jobs SET status=$1 WHERE id=$2', ['failed', record.id]);
    }
  },
  {
    connection,
  }
);

worker.on('completed', (job) => {
  console.log(`Trabalho ${job.id} completo.`);
});

worker.on('failed', (job, err) => {
  console.log(`Trabalho ${job.id} falhou: ${err.message}`);
});
