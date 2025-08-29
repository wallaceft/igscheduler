// public/index.js

function showResult(id, message, type) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = `result ${type}`;
  el.style.display = 'block';
  setTimeout(() => (el.style.display = 'none'), 4000);
}

async function loadProfiles() {
  console.log('> Buscando /api/accounts');
  try {
    const res = await fetch('/api/accounts');
    const { accounts } = await res.json();
    console.log('>> contas:', accounts);
    ['bulkProfile','singleProfile'].forEach(selectId => {
      const sel = document.getElementById(selectId);
      sel.innerHTML = '<option value="">Selecione perfil</option>';
      accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = JSON.stringify(acc);
        opt.textContent = '@' + acc.username;
        sel.appendChild(opt);
      });
    });
  } catch (err) {
    console.error('Erro fetching accounts:', err);
    ['bulkProfile','singleProfile'].forEach(id => {
      document.getElementById(id).innerHTML = '<option>Erro ao carregar</option>';
    });
  }
}

async function loadScheduled() {
  console.log('> Carregando agendamentos...');
  const res = await fetch('/api/scheduled');
  const { scheduled } = await res.json();
  const list = document.getElementById('scheduledList');
  if (!scheduled.length) {
    list.textContent = 'Nenhum agendamento';
    return;
  }
  list.innerHTML = scheduled.map(job => `
    <div class="schedule-item">
      <span>@${job.username}</span>
      <span>${new Date(job.datetime).toLocaleString()}</span>
      <span class="status-badge status-${job.status}">${job.status}</span>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  loadProfiles();
  loadScheduled();
  document.getElementById('bulkForm').addEventListener('submit', async e => {
    e.preventDefault();
    const sel = document.getElementById('bulkProfile').value;
    if (!sel) return showResult('bulkResult','Selecione perfil','error');
    const acc = JSON.parse(sel);
    const date = document.getElementById('bulkDate').value;
    const files = document.getElementById('bulkFiles').files;
    if (!date||!files.length) return showResult('bulkResult','Preencha campos','error');
    const form = new FormData();
    form.append('username', acc.username);
    form.append('instagramId', acc.instagramId);
    form.append('pageAccessToken', acc.pageAccessToken);
    form.append('startDate', date);
    form.append('caption', document.getElementById('bulkCaption').value);
    Array.from(files).forEach(f => form.append('videos', f));
    const res = await fetch('/api/schedule-fixed',{method:'POST',body:form});
    const data = await res.json();
    if (res.ok) showResult('bulkResult','✔ Criados '+data.created,'success'), loadScheduled();
    else showResult('bulkResult','❌ '+data.error,'error');
  });
  document.getElementById('singleForm').addEventListener('submit', async e => {
    e.preventDefault();
    const sel = document.getElementById('singleProfile').value;
    if (!sel) return showResult('singleResult','Selecione perfil','error');
    const acc = JSON.parse(sel);
    const dt = document.getElementById('singleDatetime').value;
    const file = document.getElementById('singleFile').files[0];
    if (!dt||!file) return showResult('singleResult','Preencha campos','error');
    const form = new FormData();
    form.append('username', acc.username);
    form.append('instagramId', acc.instagramId);
    form.append('pageAccessToken', acc.pageAccessToken);
    form.append('scheduleAt', dt);
    form.append('caption', document.getElementById('singleCaption').value);
    form.append('video', file);
    const res = await fetch('/api/schedule-single',{method:'POST',body:form});
    const data = await res.json();
    if (res.ok) showResult('singleResult','✔ Agendado','success'), loadScheduled();
    else showResult('singleResult','❌ '+data.error,'error');
  });
  document.getElementById('refreshBtn').addEventListener('click', loadScheduled);
});
