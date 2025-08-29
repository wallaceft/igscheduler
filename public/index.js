class SchedulerApp {
  constructor() {
    this.stats = {
      completed: 0,
      pending: 0,
      processing: 0,
      profiles: 0,
    };
    this.init();
  }

  init() {
    console.log("🚀 Iniciando IG Scheduler Pro...");
    this.setupEventListeners();
    this.loadProfiles();
    this.loadScheduled();

    // Auto-refresh
    setInterval(() => this.loadScheduled(), 30000);
  }

  setupEventListeners() {
    document
      .getElementById("bulkForm")
      .addEventListener("submit", (e) => this.handleBulkSubmit(e));
    document
      .getElementById("singleForm")
      .addEventListener("submit", (e) => this.handleSingleSubmit(e));
    document
      .getElementById("refreshBtn")
      .addEventListener("click", () => this.loadScheduled());

    this.setupFileInputs();
  }

  setupFileInputs() {
    const fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach((input) => {
      input.addEventListener("change", (e) => {
        const label = e.target.nextElementSibling;
        const fileCount = e.target.files.length;
        const container = e.target.closest(".file-input");

        if (fileCount > 0) {
          container.classList.add("file-selected");
          const text =
            fileCount === 1
              ? `${e.target.files[0].name}`
              : `${fileCount} arquivos selecionados`;
          label.innerHTML = `
            <i class="fas fa-check-circle"></i>
            <div>${text}</div>
            <small>Clique para alterar</small>
          `;
        } else {
          container.classList.remove("file-selected");
          label.innerHTML = `<i class="fas fa-cloud-upload-alt"></i>
            <div>Clique para selecionar vídeos</div>
            <small>Ou arraste e solte aqui</small>`;
        }
      });
    });
  }

  showNotification(elementId, message, type) {
    const el = document.getElementById(elementId);
    const icon = type === "success" ? "check-circle" : "exclamation-triangle";

    el.innerHTML = `
      <i class="fas fa-${icon}"></i>
      ${message}
    `;
    el.className = `notification ${type}`;
    el.style.display = "flex";

    setTimeout(() => {
      el.style.display = "none";
    }, 5000);
  }

  updateStats() {
    document.getElementById("completedCount").textContent = this.stats.completed;
    document.getElementById("pendingCount").textContent = this.stats.pending;
    document.getElementById("processingCount").textContent = this.stats.processing;
    document.getElementById("profilesCount").textContent = this.stats.profiles;
  }

  async loadProfiles() {
    console.log("🔄 Carregando perfis...");

    try {
      const res = await fetch("/api/accounts");

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      if (!data.accounts || !Array.isArray(data.accounts)) {
        throw new Error("Formato de resposta inválido");
      }

      this.stats.profiles = data.accounts.length;
      this.updateStats();

      ["bulkProfile", "singleProfile"].forEach((id) => {
        const sel = document.getElementById(id);
        sel.innerHTML = '<option value="">Selecione um perfil</option>';

        data.accounts.forEach((acc) => {
          if (acc.username && acc.instagramId && acc.pageAccessToken) {
            const opt = document.createElement("option");
            opt.value = JSON.stringify(acc);
            opt.textContent = `@${acc.username}`;
            sel.appendChild(opt);
          }
        });
      });

      console.log(`✅ ${data.accounts.length} perfis carregados`);
    } catch (err) {
      console.error("❌ Erro ao carregar perfis:", err);

      ["bulkProfile", "singleProfile"].forEach((id) => {
        const sel = document.getElementById(id);
        sel.innerHTML = '<option value="">Erro ao carregar perfis</option>';
      });

      this.showNotification("bulkResult", `Erro: ${err.message}`, "error");
    }
  }

  async loadScheduled() {
    try {
      const res = await fetch("/api/scheduled");

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const { scheduled } = await res.json();
      const list = document.getElementById("scheduledList");

      if (!scheduled || scheduled.length === 0) {
        list.innerHTML = `
          <div class="loading">
            <i class="fas fa-inbox"></i> Nenhum agendamento encontrado
          </div>
        `;
        this.stats.pending = 0;
        this.stats.processing = 0;
        this.stats.completed = 0;
        this.updateStats();
        return;
      }

      this.stats.pending = scheduled.filter((j) => j.status === "pending").length;
      this.stats.processing = scheduled.filter(
        (j) => j.status === "awaiting_publish"
      ).length;
      this.stats.completed = scheduled.filter((j) => j.status === "completed").length;
      this.updateStats();

      scheduled.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

      list.innerHTML = scheduled
        .map(
          (job) => `
        <div class="schedule-item">
          <div class="schedule-user">
            <i class="fab fa-instagram"></i> @${job.username}
          </div>
          <div class="schedule-time">
            <i class="fas fa-clock"></i> ${new Date(job.datetime).toLocaleString(
              "pt-BR"
            )}
          </div>
          <div class="status-badge status-${job.status}">
            ${this.getStatusLabel(job.status)}
          </div>
        </div>
      `
        )
        .join("");
    } catch (err) {
      console.error("Erro ao carregar agendamentos:", err);
      document.getElementById("scheduledList").innerHTML = `
        <div class="loading">
          <i class="fas fa-exclamation-triangle"></i> Erro ao carregar agendamentos
        </div>
      `;
    }
  }

  getStatusLabel(status) {
    const labels = {
      pending: "Pendente",
      awaiting_publish: "Processando",
      completed: "Concluído",
      failed: "Falhou",
    };
    return labels[status] || status;
  }

  async handleBulkSubmit(e) {
    e.preventDefault();

    const sel = document.getElementById("bulkProfile").value;
    if (!sel) {
      return this.showNotification("bulkResult", "Selecione um perfil", "error");
    }

    const acc = JSON.parse(sel);
    const date = document.getElementById("bulkDate").value;
    const files = document.getElementById("bulkFiles").files;
    const caption = document.getElementById("bulkCaption").value;

    if (!date || !files.length) {
      return this.showNotification(
        "bulkResult",
        "Preencha todos os campos obrigatórios",
        "error"
      );
    }

    this.showNotification("bulkResult", `Processando ${files.length} vídeo(s)...`, "success");

    const form = new FormData();
    form.append("instagramId", acc.instagramId);
    form.append("pageAccessToken", acc.pageAccessToken);
    form.append("startDate", date);
    form.append("caption", caption);

    Array.from(files).forEach((f) => form.append("videos", f));

    try {
      const res = await fetch("/api/schedule-bulk", { method: "POST", body: form });
      const data = await res.json();

      if (res.ok) {
        this.showNotification(
          "bulkResult",
          `🎉 ${data.created} agendamentos criados com sucesso!`,
          "success"
        );
        this.loadScheduled();
        document.getElementById("bulkForm").reset();
        document.querySelector(".file-input").classList.remove("file-selected");
      } else {
        this.showNotification("bulkResult", `❌ ${data.error}`, "error");
      }
    } catch (err) {
      this.showNotification("bulkResult", `❌ Erro de conexão: ${err.message}`, "error");
    }
  }

  async handleSingleSubmit(e) {
    e.preventDefault();

    const sel = document.getElementById("singleProfile").value;
    if (!sel) {
      return this.showNotification("singleResult", "Selecione um perfil", "error");
    }

    const acc = JSON.parse(sel);
    const dt = document.getElementById("singleDatetime").value;
    const file = document.getElementById("singleFile").files[0];
    const caption = document.getElementById("singleCaption").value;

    if (!dt || !file) {
      return this.showNotification(
        "singleResult",
        "Preencha todos os campos obrigatórios",
        "error"
      );
    }

    this.showNotification("singleResult", "Processando agendamento...", "success");

    const form = new FormData();
    form.append("instagramId", acc.instagramId);
    form.append("pageAccessToken", acc.pageAccessToken);
    form.append("scheduleAt", dt);
    form.append("caption", caption);
    form.append("video", file);

    try {
      const res = await fetch("/api/schedule-single", { method: "POST", body: form });
      const data = await res.json();

      if (res.ok) {
        this.showNotification("singleResult", "🎉 Agendamento criado com sucesso!", "success");
        this.loadScheduled();
        document.getElementById("singleForm").reset();
        document.querySelectorAll(".file-input").forEach((fi) => fi.classList.remove("file-selected"));
      } else {
        this.showNotification("singleResult", `❌ ${data.error}`, "error");
      }
    } catch (err) {
      this.showNotification("singleResult", `❌ Erro de conexão: ${err.message}`, "error");
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new SchedulerApp();
});
