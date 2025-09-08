// ===== VARIÁVEIS GLOBAIS =====
let products = [];
let chartInstance = null;
let currentTab = 0;
const tabs = ['perfil', 'comportamento', 'conversa-ativacao'];

// ===== BACKEND URLs =====
// Define a base de backend a partir de uma variável global se disponível. Caso
// contrário, use a instância de produção do Pac‑Lead. Remove barras
// consecutivas no final para evitar double-slash nas requisições.
const BACKEND_BASE = (window.__BACKEND_URL__ || 'https://pac-lead-production.up.railway.app').replace(/\/+$/, '');
const VISION_UPLOAD_URL = BACKEND_BASE + '/api/vision/upload';

// Define cabeçalhos padrão utilizados em todas as chamadas à API.
// Os valores de organização e fluxo, bem como o token JWT, são lidos do
// localStorage para que reflitam o usuário autenticado. Se não houver
// valores armazenados (por exemplo, antes do login), os cabeçalhos de
// org e flow são definidos como "1". A chave Authorization só é
// enviada quando um token válido existir.
const defaultHeaders = (() => {
  let orgId = '1';
  let flowId = '1';
  let authHeader;
  try {
    const storedOrg = localStorage.getItem('org_id');
    const storedFlow = localStorage.getItem('flow_id');
    const token = localStorage.getItem('token');
    if (storedOrg) orgId = storedOrg;
    if (storedFlow) flowId = storedFlow;
    if (token) authHeader = `Bearer ${token}`;
  } catch (err) {
    // Se localStorage não estiver acessível, permanecem os valores padrões.
  }
  const headers = {
    'Content-Type': 'application/json',
    'X-Org-ID': orgId,
    'X-Flow-ID': flowId
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  return headers;
})();

// ==== Funções de integração com o backend ====

// Recupera a lista de produtos do backend e preenche a variável global `products`.
// Em seguida atualiza a tabela. Em caso de erro, mantém os produtos atuais.
async function fetchProducts() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/products`, { headers: defaultHeaders });
    if (!res.ok) throw new Error('Falha ao listar produtos');
    const data = await res.json();
    products = data.items.map(p => {
      // converte price_cents para float em reais (assume 100 = 1.00)
      const price = p.price_cents ? (p.price_cents / 100) : 0;
      // monta data URI se houver base64
      let img = null;
      if (p.image_base64) {
        // tenta detectar se já tem prefixo data:, se não, assume png
        if (p.image_base64.startsWith('data:')) {
          img = p.image_base64;
        } else {
          img = `data:image/png;base64,${p.image_base64}`;
        }
      }
      return {
        id: p.id,
        name: p.title,
        description: p.slug || '',
        category: p.category || 'Sem categoria',
        price: price,
        image: img
      };
    });
    updateProductTable();
  } catch (err) {
    console.error(err);
    updateProductTable();
  }
}

// Cria um novo produto no backend. Recebe um objeto contendo `name` e
// opcionalmente `description`. Retorna o objeto criado ou `null` em caso de
// falha.
async function createProductOnBackend(product) {
  try {
    const payload = {
      org_id: Number(defaultHeaders['X-Org-ID']),
      flow_id: Number(defaultHeaders['X-Flow-ID']),
      title: product.name,
      slug: product.description,
      status: 'active',
      // envia a imagem em base64 (sem prefixo data:)
      image_base64: product.imageBase64 || '',
      price_cents: product.priceCents || 0,
      stock: product.stock || 0,
      category: product.category || ''
    };
    const res = await fetch(`${BACKEND_BASE}/api/products`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Falha ao criar produto');
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Remove um produto no backend. Retorna `true` se a operação foi bem sucedida.
async function deleteProductOnBackend(id) {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/products/${id}`, {
      method: 'DELETE',
      headers: defaultHeaders
    });
    if (!res.ok) throw new Error('Falha ao remover produto');
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// Busca o resumo analítico (conversas, leads, vendas, taxa de conversão,
// leads recuperados, melhor horário, produto mais falado) no backend.
async function fetchAnalyticsSummary() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/analytics/summary`, {
      headers: defaultHeaders
    });
    if (!res.ok) throw new Error('Falha ao buscar resumo analítico');
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Busca os produtos mais vendidos (top produtos) no backend.
async function fetchTopProducts() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/analytics/top-products`, {
      headers: defaultHeaders
    });
    if (!res.ok) throw new Error('Falha ao buscar top produtos');
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Busca dados de vendas por hora para alimentar o gráfico de performance.
async function fetchSalesByHour() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/analytics/sales-by-hour`, {
      headers: defaultHeaders
    });
    if (!res.ok) throw new Error('Falha ao buscar vendas por hora');
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Carrega as métricas e gráficos da tela de análise. Atualiza os elementos da
// interface com base nos dados recebidos do backend.
async function loadAnalytics() {
  const summary = await fetchAnalyticsSummary();
  if (summary) {
    const convEl = document.getElementById('conversations-count');
    const leadsEl = document.getElementById('leads-count');
    const salesEl = document.getElementById('sales-count');
    const convRateEl = document.getElementById('conversion-rate');
    if (convEl) convEl.textContent = summary.conversations;
    if (leadsEl) leadsEl.textContent = summary.leads;
    if (salesEl) salesEl.textContent = summary.sales;
    if (convRateEl) convRateEl.textContent = (summary.conversion_rate || 0).toFixed(1) + '%';
    const recoveredEl = document.getElementById('recovered-leads-value');
    const timeEl = document.getElementById('best-time-range');
    const topProductEl = document.getElementById('top-product-name');
    if (recoveredEl) recoveredEl.textContent = summary.recovered_leads;
    if (timeEl) timeEl.textContent = summary.best_time_range;
    if (topProductEl) topProductEl.textContent = summary.top_product;
  }
  // atualiza o gráfico
  await createPerformanceChart();
}

// ===== DADOS EXEMPLO =====
const sampleData = {
  conversations: [
    { id: 1, date: '2023-10-27', lastMessage: 'Olá, gostaria de saber mais sobre...', status: 'Aberta' },
    { id: 2, date: '2023-10-26', lastMessage: 'Qual o valor do frete?', status: 'Fechada' },
    { id: 3, date: '2023-10-25', lastMessage: 'Preciso de ajuda com o produto', status: 'Aberta' },
    { id: 4, date: '2023-10-24', lastMessage: 'Obrigado pelo atendimento!', status: 'Fechada' },
  ],
  leads: [
    { name: 'João Silva', phone: '(11) 98765-4321', lastMessageDate: '2023-10-27', category: 'Lead' },
    { name: 'Maria Oliveira', phone: '(21) 91234-5678', lastMessageDate: '2023-10-26', category: 'Lead Qualificado' },
    { name: 'Carlos Pereira', phone: '(31) 99876-5432', lastMessageDate: '2023-10-25', category: 'Lead Quente' },
    { name: 'Ana Souza', phone: '(41) 98765-1234', lastMessageDate: '2023-10-24', category: 'Prospectivos Clientes' },
    { name: 'Pedro Costa', phone: '(51) 91234-9876', lastMessageDate: '2023-10-23', category: 'Cliente' },
    { name: 'Fernanda Lima', phone: '(85) 99887-6543', lastMessageDate: '2023-10-22', category: 'Lead' },
    { name: 'Roberto Santos', phone: '(62) 98765-4321', lastMessageDate: '2023-10-21', category: 'Lead Qualificado' },
    { name: 'Juliana Rocha', phone: '(47) 91234-5678', lastMessageDate: '2023-10-20', category: 'Lead Quente' },
  ],
  sales: [
    { id: 101, product: 'Smartphone XYZ', value: 1250.00, date: '2023-10-25' },
    { id: 102, product: 'Fone de Ouvido ABC', value: 350.00, date: '2023-10-24' },
    { id: 103, product: 'Notebook Pro', value: 2800.00, date: '2023-10-23' },
    { id: 104, product: 'Smartwatch Elite', value: 899.00, date: '2023-10-22' },
  ],
  satisfaction: [
    { id: 201, rating: 5, comment: 'Atendimento excelente!', date: '2023-10-23' },
    { id: 202, rating: 4, comment: 'Bom, mas poderia ser mais rápido.', date: '2023-10-22' },
    { id: 203, rating: 5, comment: 'Muito satisfeito com o produto.', date: '2023-10-21' },
    { id: 204, rating: 3, comment: 'Atendimento regular.', date: '2023-10-20' },
  ]
};

// ===== SEÇÕES =====
function showSection(sectionId) {
  const sections = document.querySelectorAll('.content-section');
  sections.forEach(section => { section.style.display = 'none'; });
  const targetSection = document.getElementById(sectionId);
  if (targetSection) targetSection.style.display = 'block';
  const navLinks = document.querySelectorAll('.nav-sidebar .nav-link');
  navLinks.forEach(link => { link.classList.remove('active'); });
  const activeLink = document.querySelector(`[onclick="showSection('${sectionId}')"]`);
  if (activeLink) activeLink.classList.add('active');
  if (sectionId === 'analysis') setTimeout(createPerformanceChart, 100);
  // When the company section becomes visible, fetch the existing company data
  if (sectionId === 'company') {
    try {
      loadCompany();
    } catch (_) {}
  }

  // Atualiza a barra de endereços sem recarregar a página para refletir a seção atual.
  try {
    const pathMap = {
      'agent-config': '/agente',
      'analysis': '/analise',
      'products': '/produtos',
      'payments': '/pagamentos',
      'company': '/empresa',
      'users': '/usuarios'
    };
    const newPath = pathMap[sectionId];
    if (newPath && history.pushState) {
      history.pushState(null, '', newPath);
    }
  } catch (_) {
    // falha silenciosa caso o histórico não seja suportado
  }
}

// Atualiza todas as ocorrências de saudação com o nome do usuário
document.addEventListener('DOMContentLoaded', () => {
  try {
    const name = (localStorage.getItem('user_name') || '').toUpperCase();
    document.querySelectorAll('.user-name').forEach(el => {
      el.textContent = name;
    });
  } catch (_) {
    // ignora erros de leitura do localStorage
  }

  // ===== EMPRESA: busca de dados via CNPJ =====
  // Seleciona o botão de busca e o input de CNPJ. Em telas menores o botão
  // possui uma versão compacta, mas ambos recebem o mesmo id para
  // simplificar a captura.
  const cnpjButtons = document.querySelectorAll('.company-cnpj-search-btn');
  const cnpjInput = document.getElementById('company-cnpj');
  if (cnpjButtons.length && cnpjInput) {
    cnpjButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const raw = cnpjInput.value || '';
        const digits = raw.replace(/\D/g, '');
        // Um CNPJ possui 14 dígitos numéricos. Valida antes de consultar.
        if (digits.length !== 14) {
          alert('CNPJ inválido. Digite um número com 14 dígitos.');
          return;
        }
        // Desabilita todos os botões de busca para evitar requisições simultâneas.
        cnpjButtons.forEach(b => b.disabled = true);
        const originalTexts = Array.from(cnpjButtons).map(b => b.textContent);
        cnpjButtons.forEach((b, idx) => {
          // Mantém o ícone em botões compactos e atualiza apenas texto dos demais
          if (!b.classList.contains('d-sm-none')) {
            b.textContent = 'Buscando...';
          }
        });
        try {
          // Consulta a API pública da BrasilAPI para recuperar os dados da empresa.
          const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
          if (!res.ok) throw new Error('Falha na requisição');
          const data = await res.json();
          // Preenche campos do formulário de acordo com a resposta obtida.
          const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = value || '';
          };
          setValue('company-razao', data.razao_social);
          setValue('company-fantasia', data.nome_fantasia);
          // Telefones: compõe com DDD e número, se disponível. Não aplica formatação de máscara.
          if (data.ddd_telefone_1) {
            setValue('company-phone', data.ddd_telefone_1);
          }
          setValue('company-email', data.email);
          // Endereço: logradouro + complemento, se houver.
          const endereco = [data.logradouro, data.complemento].filter(Boolean).join(' ');
          setValue('company-endereco', endereco);
          setValue('company-numero', data.numero);
          setValue('company-bairro', data.bairro);
          setValue('company-cidade', data.municipio);
          setValue('company-cep', data.cep);
          // Seleciona a UF correspondente se existir option.
          const ufSelect = document.getElementById('company-uf');
          if (ufSelect && data.uf) {
            ufSelect.value = data.uf;
          }
        } catch (err) {
          console.error(err);
          alert('Não foi possível buscar os dados do CNPJ.');
        } finally {
          // Restaura estado dos botões
          cnpjButtons.forEach((b, idx) => {
            b.disabled = false;
            if (!b.classList.contains('d-sm-none')) {
              b.textContent = originalTexts[idx] || 'Buscar CNPJ';
            }
          });
        }
      });
    });
  }

  // ===== EMPRESA: ação ao salvar =====
  // No momento não há um endpoint no backend para persistir a empresa. Esta
  // função apenas coleta os dados preenchidos e os imprime no console. Caso
  // necessário, adapte para realizar uma chamada ao backend.
  const saveBtn = document.getElementById('company-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const form = document.getElementById('company-form');
      if (!form) return;
      // Mapeia os campos do formulário para o formato esperado pelo backend
      const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };
      const payload = {
        name: null, // não atualizamos o campo 'name' padrão da org aqui
        tax_id: getVal('company-cnpj').replace(/\D/g, '') || null,
        razao_social: getVal('company-razao') || null,
        nome_fantasia: getVal('company-fantasia') || null,
        inscricao_estadual: getVal('company-insc') || null,
        segmento: getVal('company-segment') || null,
        telefone: getVal('company-phone') || null,
        email: getVal('company-email') || null,
        bairro: getVal('company-bairro') || null,
        endereco: getVal('company-endereco') || null,
        numero: getVal('company-numero') || null,
        cep: getVal('company-cep') || null,
        cidade: getVal('company-cidade') || null,
        uf: getVal('company-uf') || null,
        observacoes: getVal('company-observacoes') || null
      };
      try {
        const res = await fetch(`${BACKEND_BASE}/api/company`, {
          method: 'PUT',
          headers: defaultHeaders,
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Falha ao salvar dados da empresa');
        alert('Dados da empresa salvos com sucesso!');
      } catch (err) {
        console.error(err);
        alert('Não foi possível salvar os dados da empresa.');
      }
    });
  }
});

// Função de logout: limpa dados do usuário e redireciona para a página de login
function logout() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('org_id');
    localStorage.removeItem('flow_id');
    localStorage.removeItem('user_name');
  } catch (_) {}
  window.location.href = 'login.html';
}

// ===== ABAS =====
function nextTab() { if (currentTab < tabs.length - 1) { currentTab++; navigateToTab(tabs[currentTab]); } }
function previousTab() { if (currentTab > 0) { currentTab--; navigateToTab(tabs[currentTab]); } }
function navigateToTab(tabId) {
  currentTab = tabs.indexOf(tabId);
  document.querySelectorAll('.nav-tabs .nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('show','active'));
  const targetTab = document.getElementById(`${tabId}-tab`);
  const targetPane = document.getElementById(tabId);
  if (targetTab && targetPane) { targetTab.classList.add('active'); targetPane.classList.add('show','active'); }
  updateNavigationButtons();
}
function updateNavigationButtons() {
  const prevButtons = document.querySelectorAll('[onclick="previousTab()"]');
  const nextButtons = document.querySelectorAll('[onclick="nextTab()"]');
  prevButtons.forEach(btn => { btn.disabled = currentTab === 0; });
  nextButtons.forEach(btn => { btn.style.display = currentTab === tabs.length - 1 ? 'none' : 'inline-flex'; });
}

// ===== COMPORTAMENTO =====
function toggleWhatsAppConfig() {
  const checkbox = document.getElementById('whatsapp-notification');
  const config = document.getElementById('whatsapp-config');
  if (checkbox && config) config.style.display = checkbox.checked ? 'block' : 'none';
}
function toggleSiteLinkConfig() {
  const checkbox = document.getElementById('site-link');
  const config = document.getElementById('site-link-config');
  if (checkbox && config) config.style.display = checkbox.checked ? 'block' : 'none';
}
function toggleProductLinkConfig() {
  const checkbox = document.getElementById('product-link');
  const config = document.getElementById('product-link-config');
  if (checkbox && config) config.style.display = checkbox.checked ? 'block' : 'none';
}

// Carrega os dados da empresa do backend e preenche o formulário correspondente.
async function loadCompany() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/company`, { headers: defaultHeaders });
    if (!res.ok) throw new Error('Falha ao carregar empresa');
    const data = await res.json();
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };
    // map backend keys to form fields
    setVal('company-razao', data.razao_social || data.name || '');
    setVal('company-fantasia', data.nome_fantasia || '');
    setVal('company-cnpj', data.tax_id || '');
    setVal('company-insc', data.inscricao_estadual || '');
    setVal('company-segment', data.segmento || '');
    setVal('company-phone', data.telefone || '');
    setVal('company-email', data.email || '');
    setVal('company-bairro', data.bairro || '');
    setVal('company-endereco', data.endereco || '');
    setVal('company-numero', data.numero || '');
    setVal('company-cep', data.cep || '');
    setVal('company-cidade', data.cidade || '');
    const ufSelect = document.getElementById('company-uf');
    if (ufSelect && data.uf) {
      ufSelect.value = data.uf;
    }
    setVal('company-observacoes', data.observacoes || '');
  } catch (err) {
    console.error(err);
    // Não exibe alerta pois a empresa pode ainda não existir ou o backend pode não implementar o endpoint
  }
}

// ===== PERFIL =====
function saveProfile() {
  const modal = new bootstrap.Modal(document.getElementById('successModal'));
  modal.show();
}

// ===== MODAIS =====
function openMetricModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    populateModalTable(modalId);
  }
}
function closeMetricModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
  }
}
function populateModalTable(modalId, categoryFilter = 'all') {
  let data, tableBodyId, renderFunction;
  switch (modalId) {
    case 'conversations-modal':
      data = sampleData.conversations;
      tableBodyId = 'conversations-table-body';
      renderFunction = (item) => `
        <tr>
          <td>#${item.id}</td>
          <td>${item.date}</td>
          <td>${item.lastMessage}</td>
          <td><span class="badge badge-${item.status === 'Aberta' ? 'success' : 'secondary'}">${item.status}</span></td>
        </tr>`;
      break;
    case 'leads-modal':
      data = sampleData.leads;
      tableBodyId = 'leads-table-body';
      let filteredLeads = categoryFilter === 'all' ? data : data.filter(lead => lead.category === categoryFilter);
      renderFunction = (item) => {
        let badgeClass = 'badge-secondary';
        switch (item.category) {
          case 'Lead': badgeClass = 'badge-lead'; break;
          case 'Lead Qualificado': badgeClass = 'badge-lead-qualificado'; break;
          case 'Lead Quente': badgeClass = 'badge-lead-quente'; break;
          case 'Prospectivos Clientes': badgeClass = 'badge-prospectivos'; break;
          case 'Cliente': badgeClass = 'badge-cliente'; break;
        }
        return `
          <tr>
            <td>${item.name}</td>
            <td>${item.phone}</td>
            <td>${item.lastMessageDate}</td>
            <td><span class="badge ${badgeClass}">${item.category}</span></td>
          </tr>`;
      };
      data = filteredLeads;
      break;
    case 'sales-modal':
      data = sampleData.sales;
      tableBodyId = 'sales-table-body';
      renderFunction = (item) => `
        <tr>
          <td>#${item.id}</td>
          <td>${item.product}</td>
          <td>R$ ${item.value.toFixed(2)}</td>
          <td>${item.date}</td>
        </tr>`;
      break;
    case 'satisfaction-modal':
      data = sampleData.satisfaction;
      tableBodyId = 'satisfaction-table-body';
      renderFunction = (item) => `
        <tr>
          <td>#${item.id}</td>
          <td>${"⭐".repeat(item.rating)}</td>
          <td>${item.comment}</td>
          <td>${item.date}</td>
        </tr>`;
      break;
    default: return;
  }
  const tableBody = document.getElementById(tableBodyId);
  if (tableBody) tableBody.innerHTML = data.map(renderFunction).join('');
}
function filterTable(modalId, searchTerm) {
  const tableBodyId = modalId.replace('-modal', '-table-body');
  const tableBody = document.getElementById(tableBodyId);
  if (!tableBody) return;
  const rows = tableBody.getElementsByTagName('tr');
  const filter = searchTerm.toUpperCase();
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].getElementsByTagName('td');
    let found = false;
    for (let j = 0; j < cells.length; j++) {
      const cellText = cells[j].textContent || cells[j].innerText;
      if (cellText.toUpperCase().indexOf(filter) > -1) { found = true; break; }
    }
    rows[i].style.display = found ? '' : 'none';
  }
}

// ===== PRODUTOS =====
async function addProduct() {
  const form = document.getElementById("product-form");
  const imgFile = form.querySelector("#product-image").files[0];
  const name = form.querySelector("#product-name").value.trim();
  const price = parseFloat(form.querySelector("#product-price").value);
  const category = form.querySelector("#product-category").value;
  const description = form.querySelector("#product-description").value.trim();

  if (!name) { showNotification("Por favor, insira o nome do produto.", "warning"); return; }
  if (!price || price <= 0) { showNotification("Por favor, insira um preço válido.", "warning"); return; }
  if (!description) { showNotification("Por favor, descreva o produto.", "warning"); return; }

  // Converte imagem para base64 se houver arquivo. Usa Promise para aguardar
  const toBase64 = (file) => new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // result é algo como data:image/png;base64,... Removemos o prefixo
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });

  const imageBase64 = await toBase64(imgFile);
  const product = {
    id: Date.now(),
    name,
    price,
    category: category || "Sem categoria",
    description,
    image: imgFile ? URL.createObjectURL(imgFile) : null,
    // campos para backend
    imageBase64: imageBase64,
    priceCents: Math.round(price * 100),
    stock: 0,
    category: category || "Sem categoria",
  };

  // Envia o produto ao backend
  const created = await createProductOnBackend(product);
  if (created) {
    showNotification("Produto adicionado com sucesso!", "success");
  } else {
    showNotification("Erro ao adicionar produto.", "danger");
  }
  form.reset();
  await fetchProducts();
}
function updateProductTable() {
  const tbody = document.getElementById("product-list");
  if (products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted py-4">
          <i class="fas fa-box-open fa-2x mb-2"></i><br>
          Nenhum produto cadastrado ainda
        </td>
      </tr>`;
    return;
  }
  tbody.innerHTML = products.map(product => `
    <tr>
      <td>
        ${product.image ?
          `<img src="${product.image}" alt="${product.name}" class="product-image">` :
          `<div class="product-placeholder"><i class="fas fa-image"></i></div>`
        }
      </td>
      <td>
        <strong>${product.name}</strong><br>
        <small class="text-muted">${product.description}</small>
      </td>
      <td><span class="badge badge-primary">${product.category}</span></td>
      <td><span class="price-tag">R$ ${product.price.toFixed(2)}</span></td>
      <td><span class="badge badge-success">Ativo</span></td>
      <td>
        <button class="btn btn-sm btn-outline-primary" title="Editar produto"><i class="fas fa-edit"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="removeProduct(${product.id})" title="Remover produto"><i class="fas fa-trash"></i></button>
      </td>
    </tr>
  `).join("");
}
async function removeProduct(productId) {
  if (confirm("Tem certeza que deseja remover este produto?")) {
    const ok = await deleteProductOnBackend(productId);
    if (ok) {
      showNotification("Produto removido com sucesso!", "info");
    } else {
      showNotification("Erro ao remover produto.", "danger");
    }
    await fetchProducts();
  }
}

// ===== NOTIFICAÇÕES =====
function showNotification(message, type = "info") {
  const existingNotification = document.querySelector(".notification");
  if (existingNotification) existingNotification.remove();

  const notification = document.createElement("div");
  notification.className = `notification alert alert-${type} alert-dismissible fade show`;
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 9999; min-width: 300px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;
  notification.innerHTML = `
    <div class="d-flex align-items-center">
      <i class="fas fa-${getNotificationIcon(type)} mr-2"></i>
      <span>${message}</span>
      <button type="button" class="close ml-auto" onclick="this.parentElement.parentElement.remove()">
        <span>&times;</span>
      </button>
    </div>
  `;
  document.body.appendChild(notification);
  setTimeout(() => { if (notification.parentElement) notification.remove(); }, 5000);
}
function getNotificationIcon(type) {
  const icons = { success: "check-circle", warning: "exclamation-triangle", danger: "exclamation-circle", info: "info-circle" };
  return icons[type] || "info-circle";
}

// ===== GRÁFICO =====
async function createPerformanceChart() {
  const ctx = document.getElementById("performanceChart");
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();
  // tenta carregar dados reais de vendas por hora. Caso falhe, usa dados de exemplo.
  let labels = [];
  let conversions = [];
  let leadsData = [];
  try {
    const res = await fetchSalesByHour();
    if (res && Array.isArray(res.items) && res.items.length > 0) {
      labels = res.items.map(item => {
        const d = new Date(item.t);
        // exibe dia/mês e hora:minuto
        return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      });
      conversions = res.items.map(item => Number(item.c));
      // gera um valor aproximado de leads proporcional às conversões
      leadsData = conversions.map(c => Math.round(c * 1.5));
    } else {
      // fallback para dados de exemplo
      labels = ["Semana 1","Semana 2","Semana 3","Semana 4","Semana 5","Semana 6"];
      conversions = [12,19,8,15,22,18];
      leadsData = [8,12,15,10,18,14];
    }
  } catch (err) {
    console.error(err);
    labels = ["Semana 1","Semana 2","Semana 3","Semana 4","Semana 5","Semana 6"];
    conversions = [12,19,8,15,22,18];
    leadsData = [8,12,15,10,18,14];
  }
  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Conversões",
          data: conversions,
          borderColor: "#007bff",
          backgroundColor: "rgba(0, 123, 255, 0.1)",
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#007bff",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: "Leads",
          data: leadsData,
          borderColor: "#28a745",
          backgroundColor: "rgba(40, 167, 69, 0.1)",
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#28a745",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { family: "Inter", size: 12 },
            color: "#ffffff"
          }
        },
        tooltip: {
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          titleColor: "#ffffff",
          bodyColor: "#ffffff",
          borderColor: "#007bff",
          borderWidth: 1,
          cornerRadius: 8,
          displayColors: true,
          intersect: false,
          mode: "index"
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: "Inter", size: 11 }, color: "#a0a0a0" }
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255, 255, 255, 0.1)" },
          ticks: { font: { family: "Inter", size: 11 }, color: "#a0a0a0" }
        }
      },
      interaction: { intersect: false, mode: "index" },
      elements: { point: { hoverBackgroundColor: "#ffffff" } }
    }
  });
}

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', function() {
  loadAgentConfig();
  updateNavigationButtons();
  document.querySelectorAll('.nav-tabs .nav-link').forEach(tab => {
    tab.addEventListener('click', function(e) {
      e.preventDefault();
      const targetId = this.getAttribute('data-bs-target').replace('#', '');
      navigateToTab(targetId);
    });
  });
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) closeMetricModal(e.target.id);
  });
  if (document.getElementById('analysis').style.display !== 'none') {
    // se a seção de análise estiver visível, carrega o gráfico imediatamente
    createPerformanceChart();
  }
  // Carrega dados iniciais de produtos e métricas
  fetchProducts();
  loadAnalytics();
  console.log('Sistema Helsen IA inicializado com sucesso!');
});

// ===== FORM AGENTE =====
function validateAgentForm() {
  const form = document.getElementById("agent-config-form");
  const name = form.querySelector("#agent-name").value.trim();
  if (!name) { showNotification("Por favor, insira o nome do agente.", "warning"); return false; }
  return true;
}
function saveAgentConfig() {
  if (!validateAgentForm()) return;
  const form = document.getElementById("agent-config-form");
  const config = {
    name: form.querySelector("#agent-name").value.trim(),
    communicationStyle: form.querySelector("#communication-style").value,
    sector: form.querySelector("#agent-sector").value,
    profileType: form.querySelector("#agent-profile-type").value,
    profileCustom: form.querySelector("#agent-profile-custom").value.trim()
  };
  localStorage.setItem("agentConfig", JSON.stringify(config));
  showNotification("Configurações salvas com sucesso!", "success");
}
function loadAgentConfig() {
  const savedConfig = localStorage.getItem("agentConfig");
  if (!savedConfig) return;
  try {
    const config = JSON.parse(savedConfig);
    const form = document.getElementById("agent-config-form");
    if (form) {
      form.querySelector("#agent-name").value = config.name || "";
      form.querySelector("#communication-style").value = config.communicationStyle || "";
      form.querySelector("#agent-sector").value = config.sector || "";
      form.querySelector("#agent-profile-type").value = config.profileType || "";
      form.querySelector("#agent-profile-custom").value = config.profileCustom || "";
    }
  } catch (error) {
    console.error("Erro ao carregar configurações:", error);
  }
}

// ===== CHATBOT =====
class Chatbot {
  constructor() {
    this.webhookUrl = BACKEND_BASE + '/api/chat';
    this.isOpen = false;
    this.isTyping = false;
    this.sessionId = this.generateSessionId();
    this.pendingImageFile = null;

    // memória volátil
    this.history = [];
    this.maxHistory = 20;

    this.init();
  }

  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  bindOnce(el, evt, handler) {
    if (!el || !evt || !handler) return;
    const key = `__bound_${evt}`;
    if (el.dataset && el.dataset[key]) return;
    el.addEventListener(evt, handler);
    if (el.dataset) el.dataset[key] = '1';
  }

  init() {
    this.bindEvents();
    this.addInitialMessage();
    this.ensureAttachmentControls();
  }

  ensureAttachmentControls() {
    const container = document.querySelector('.chatbot-input-container');
    if (!container) return;

    let imgBtn = document.getElementById('chatbot-image-btn');
    let imgInput = document.getElementById('chatbot-image-input');
    let preview = document.getElementById('chatbot-attachment-preview');

    if (!imgBtn) {
      imgBtn = document.createElement('button');
      imgBtn.id = 'chatbot-image-btn';
      imgBtn.type = 'button';
      imgBtn.className = 'chatbot-send-btn';
      imgBtn.innerHTML = '<i class="fas fa-image"></i>';
      container.insertBefore(imgBtn, container.firstChild);
    }
    if (!imgInput) {
      imgInput = document.createElement('input');
      imgInput.type = 'file';
      imgInput.id = 'chatbot-image-input';
      imgInput.accept = 'image/*';
      imgInput.style.display = 'none';
      container.appendChild(imgInput);
    }
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'chatbot-attachment-preview';
      preview.style.cssText = 'position:absolute; bottom:68px; right:20px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:8px; padding:8px 10px; display:none; align-items:center; gap:8px; box-shadow:0 4px 12px rgba(0,0,0,.25);';
      preview.innerHTML = '<span style="font-size:.85rem;color:#ddd">Imagem anexada</span> <button type="button" id="chatbot-attachment-remove" class="btn btn-sm btn-outline-secondary" style="padding:.15rem .4rem;">remover</button>';
      const win = document.getElementById('chatbot-window');
      if (win) { win.style.position = 'relative'; win.appendChild(preview); }
    }

    this.bindOnce(imgBtn, 'click', () => imgInput.click());
    this.bindOnce(imgInput, 'change', () => {
      const file = imgInput.files && imgInput.files[0];
      if (!file) return;
      if (!file.type || !file.type.startsWith('image/')) {
        this.addMessage('Arquivo inválido. Selecione uma imagem.', 'bot');
        imgInput.value = '';
        return;
      }
      this.pendingImageFile = file;
      this.showAttachmentPreview();
      this.addImageBubble(URL.createObjectURL(file), 'user');
      imgInput.value = '';
    });
    const removeBtn = document.getElementById('chatbot-attachment-remove');
    this.bindOnce(removeBtn, 'click', () => {
      this.pendingImageFile = null;
      this.hideAttachmentPreview();
    });
  }

  showAttachmentPreview() {
    const el = document.getElementById('chatbot-attachment-preview');
    if (el) el.style.display = 'flex';
  }
  hideAttachmentPreview() {
    const el = document.getElementById('chatbot-attachment-preview');
    if (el) el.style.display = 'none';
  }

  bindEvents() {
    const toggle = document.getElementById('chatbot-toggle');
    const close = document.getElementById('chatbot-close');
    const input = document.getElementById('chatbot-input');
    const sendBtn = document.getElementById('chatbot-send');

    this.bindOnce(toggle, 'click', () => this.toggleChat());
    this.bindOnce(close, 'click', () => this.closeChat());
    this.bindOnce(input, 'keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    this.bindOnce(sendBtn, 'click', () => this.sendMessage());
  }

  toggleChat() {
    const windowEl = document.getElementById('chatbot-window');
    const container = document.querySelector('.chatbot-container');
    if (!windowEl) return;
    if (this.isOpen) {
      windowEl.classList.remove('show');
      this.isOpen = false;
      if (container) container.classList.remove('open');
    } else {
      windowEl.classList.add('show');
      this.isOpen = true;
      if (container) container.classList.add('open');
      setTimeout(() => {
        const input = document.getElementById('chatbot-input');
        if (input) input.focus();
      }, 300);
    }
  }
  openChat(){ if (!this.isOpen) this.toggleChat(); }
  closeChat(){ if (this.isOpen) this.toggleChat(); }

  addInitialMessage(){ /* opcional */ }

  _pushHistory(role, content){
    this.history.push({ role, content, ts: Date.now() });
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
  }
  clearMemory(){ this.history = []; showNotification('Memória do chat limpa.','info'); }

  async sendMessage() {
    const input = document.getElementById('chatbot-input');
    const raw = input.value || '';
    const message = raw.trim();
    if (this.isTyping) return;

    const hasPendingImage = !!this.pendingImageFile;
    if (!message && !hasPendingImage) return;

    // ecoa e limpa IMEDIATAMENTE
    if (message) {
      this.addMessage(message, 'user');
      this._pushHistory('user', message);
    }
    input.value = '';
    input.blur();

    this.showTypingIndicator();

    try {
      if (hasPendingImage) {
        // esconde preview e solta o arquivo ANTES da requisição (some na hora)
        const fileToSend = this.pendingImageFile;
        this.pendingImageFile = null;
        this.hideAttachmentPreview();

        await this.sendImageFile(fileToSend, message || 'Analise a imagem de forma objetiva.');
      } else {
        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            sessionId: this.sessionId,
            history: this.history.slice(-this.maxHistory),
            timestamp: new Date().toISOString()
          })
        });
        if (!response.ok) throw new Error('Erro na resposta do servidor');
        const data = await response.json();

        this.hideTypingIndicator();

        // 🔥 Normaliza diferentes formatos de resposta do backend
        const text =
          (data && (data.reply || data.output || data.message || data.text || data.content
            || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content))) || 'OK.';

        this.addMessage(text, 'bot');
        this._pushHistory('assistant', text);
      }
    } catch (error) {
      console.error('Erro ao enviar:', error);
      this.hideTypingIndicator();
      this.addMessage('Desculpe, ocorreu um erro. Tente novamente em alguns instantes.', 'bot');
      this._pushHistory('assistant', '[erro]');
    }
  }

  addMessage(text, sender) {
    const messagesContainer = document.getElementById('chatbot-messages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;

    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    messageDiv.innerHTML = `
      <div class="message-content">
        <p>${this.escapeHtml(text)}</p>
      </div>
      <div class="message-time">${timeString}</div>
    `;

    messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addImageBubble(src, sender) {
    const messagesContainer = document.getElementById('chatbot-messages');
    if (!messagesContainer) return;
    const wrap = document.createElement('div');
    wrap.className = `message ${sender}-message`;
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    wrap.innerHTML = `
      <div class="message-content">
        <img src="${src}" alt="Imagem" style="max-width:220px; border-radius:8px; display:block;">
      </div>
      <div class="message-time">${timeString}</div>
    `;
    messagesContainer.appendChild(wrap);
    this.scrollToBottom();
  }

  async sendImageFile(file, prompt = 'Analise a imagem de forma objetiva.') {
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('image', file, file.name || 'image.png');
      fd.append('prompt', prompt);
      fd.append('sessionId', this.sessionId);
      fd.append('history', JSON.stringify(this.history.slice(-this.maxHistory)));

      const resp = await fetch(VISION_UPLOAD_URL, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();

      this.hideTypingIndicator();

      if (data && data.image_url) this.addImageBubble(data.image_url, 'bot');

      // 🔥 Normaliza diferentes formatos de resposta do backend
      const text =
        (data && (data.reply || data.output || data.message || data.text || data.content
          || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content))) || 'Imagem recebida.';

      this.addMessage(text, 'bot');
      this._pushHistory('assistant', text);
    } catch (e) {
      console.error(e);
      this.hideTypingIndicator();
      this.addMessage('Erro ao analisar a imagem.', 'bot');
      this._pushHistory('assistant', '[erro imagem]');
    }
  }

  showTypingIndicator() {
    if (this.isTyping) return;
    this.isTyping = true;
    const messagesContainer = document.getElementById('chatbot-messages');
    if (!messagesContainer) return;

    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot-message';
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = `
      <div class="typing-indicator">
        <div class="typing-dots">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    messagesContainer.appendChild(typingDiv);
    this.scrollToBottom();

    const sendBtn = document.getElementById('chatbot-send');
    if (sendBtn) sendBtn.disabled = true;
  }

  hideTypingIndicator() {
    this.isTyping = false;
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) typingIndicator.remove();

    const sendBtn = document.getElementById('chatbot-send');
    if (sendBtn) sendBtn.disabled = false;
  }

  scrollToBottom() {
    const messagesContainer = document.getElementById('chatbot-messages');
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
  updateProductTable();
  updateNavigationButtons();
  window.chatbot = new Chatbot();
});
