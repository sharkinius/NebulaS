const API_BASE = 'https://nebula-bmyh.onrender.com';

const state = {
  accounts: JSON.parse(localStorage.getItem('accounts') || '[]'),
  activeIndex: Number(localStorage.getItem('activeIndex') || '-1'),
  token: null,
  user: null,
  socket: null,
  activeFriend: null,
  messages: [],
  activeGroup: null,
  groupMessages: [],
};

function saveAccounts() {
  localStorage.setItem('accounts', JSON.stringify(state.accounts));
  localStorage.setItem('activeIndex', String(state.activeIndex));
}

function setActiveAccount(index) {
  state.activeIndex = index;
  const acc = state.accounts[index];
  state.token = acc?.token || null;
  state.user = acc?.user || null;
  connectSocket();
  renderAccounts();
  loadFriends();
  loadGroups();
  updateAuthGate();
}

function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  if (!state.token) return;
  state.socket = io(API_BASE, { auth: { token: state.token } });
  state.socket.on('connected', () => console.log('socket connected'));
  state.socket.on('message:new', (msg) => {
    if (
      (msg.fromUserId === state.activeFriend?.id && msg.toUserId === state.user?.id) ||
      (msg.toUserId === state.activeFriend?.id && msg.fromUserId === state.user?.id)
    ) {
      state.messages.push(msg);
      renderMessages();
    }
  });
  state.socket.on('friend:request', loadRequests);
  state.socket.on('friend:accepted', loadFriends);
  state.socket.on('group:created', loadGroups);
  state.socket.on('group:message', (msg) => {
    if (state.activeGroup && msg.groupId === state.activeGroup.id) {
      state.groupMessages.push(msg);
      renderGroupMessages();
    }
  });
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) };
  const res = await fetch(API_BASE + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  if (!res.ok) {
    let msg = 'Ошибка запроса';
    try { const j = await res.json(); msg = j.error || msg; } catch { msg = await res.text(); }
    throw new Error(msg || 'Ошибка запроса');
  }
  return res.json();
}

// Auth
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  try {
    const data = await api('/api/register', { method: 'POST', body: { username, password } });
    document.getElementById('last-registered').textContent = 'Зарегистрирован: ' + data.user.username;
    addAccount(data.user, data.token);
  } catch (err) {
    const msg = String(err.message || err);
    alert(msg.includes('username taken') || msg.includes('занят') ? 'Ник занят' : msg);
  }
  updateAuthGate();
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/api/login', { method: 'POST', body: { username, password } });
    addAccount(data.user, data.token);
  } catch (err) {
    alert('Неверные данные');
  }
  updateAuthGate();
});

function addAccount(user, token) {
  state.accounts.push({ user, token });
  state.activeIndex = state.accounts.length - 1;
  saveAccounts();
  renderAccounts();
  setActiveAccount(state.activeIndex);
}

function renderAccounts() {
  const list = document.getElementById('account-list');
  list.innerHTML = '';
  state.accounts.forEach((acc, idx) => {
    const li = document.createElement('li');
    li.className = 'account-item' + (idx === state.activeIndex ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = acc.user.username;
    if (isOwner(acc.user.username)) {
      const badge = document.createElement('span');
      badge.className = 'badge-owner';
      badge.textContent = 'OWNER';
      li.appendChild(badge);
    }
    li.appendChild(name);
    li.tabIndex = 0;
    li.onclick = () => setActiveAccount(idx);
    list.appendChild(li);
  });
}

document.getElementById('add-account').onclick = () => {
  state.activeIndex = -1;
  state.token = null;
  state.user = null;
  saveAccounts();
  renderAccounts();
  updateAuthGate();
};

// Search and friend requests
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', async () => {
  const q = searchInput.value.trim();
  if (!q) { document.getElementById('search-results').innerHTML=''; return; }
  const results = await api('/api/users/search?q=' + encodeURIComponent(q));
  const ul = document.getElementById('search-results');
  ul.innerHTML = '';
  results
    .filter(u => u.id !== state.user?.id)
    .forEach(u => {
      const li = document.createElement('li');
      li.textContent = u.username;
      const btn = document.createElement('button');
      btn.textContent = 'Добавить';
      btn.onclick = async () => {
        await api('/api/friends/request', { method: 'POST', body: { toUserId: u.id } });
        alert('Заявка отправлена');
      };
      li.appendChild(btn);
      ul.appendChild(li);
    });
});

document.getElementById('refresh-friends').onclick = () => { loadFriends(); loadRequests(); };

async function loadFriends() {
  if (!state.token) return;
  const friends = await api('/api/friends');
  const ul = document.getElementById('friends-list');
  ul.innerHTML = '';
  friends.forEach(f => {
    const li = document.createElement('li');
    li.className = 'friend';
    const name = document.createElement('span');
    name.textContent = f.username;
    if (isOwner(f.username)) {
      const badge = document.createElement('span');
      badge.className = 'badge-owner';
      badge.textContent = 'OWNER';
      li.appendChild(badge);
    }
    const btn = document.createElement('button');
    btn.textContent = 'Открыть чат';
    btn.onclick = () => openChat(f);
    li.appendChild(name);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

async function loadRequests() {
  if (!state.token) return;
  const reqs = await api('/api/friends/requests');
  const ul = document.getElementById('requests-list');
  ul.innerHTML = '';
  reqs.forEach(r => {
    const li = document.createElement('li');
    li.className = 'request-item friend';
    const name = document.createElement('span');
    name.textContent = `${r.fromUsername}`;
    const btn = document.createElement('button');
    btn.textContent = 'Принять';
    btn.onclick = async () => {
      await api('/api/friends/accept', { method: 'POST', body: { fromUserId: r.fromUserId } });
      loadFriends();
      loadRequests();
    };
    li.appendChild(name);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

async function openChat(friend) {
  state.activeFriend = friend;
  state.messages = await api('/api/messages/history/' + friend.id);
  document.getElementById('chat-title').textContent = 'Чат с ' + friend.username;
  renderMessages();
  showSections({ chat: true });
}

function renderMessages() {
  const ul = document.getElementById('messages');
  ul.innerHTML = '';
  state.messages.forEach(m => {
    const li = document.createElement('li');
    li.className = 'message' + (m.fromUserId === state.user?.id ? ' me' : '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const date = new Date(m.createdAt);
    const authorName = (m.fromUserId === state.user?.id ? 'Вы' : state.activeFriend?.username);
    meta.innerHTML = (isOwner(authorName) ? '<span class="badge-owner-inline">OWNER</span> ' : '') + authorName + ' • ' + date.toLocaleTimeString();
    const body = document.createElement('div');
    body.textContent = m.content;
    li.appendChild(meta);
    li.appendChild(body);
    ul.appendChild(li);
  });
  ul.scrollTop = ul.scrollHeight;
}

document.getElementById('message-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.activeFriend) return;
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content) return;
  try {
    await api('/api/messages/send', { method: 'POST', body: { toUserId: state.activeFriend.id, content } });
    // Do not push locally; wait for Socket.IO 'message:new' to avoid duplicates
  } catch (err) {
    alert('Не удалось отправить: ' + err.message);
  }
  input.value = '';
  renderMessages();
});

// Initial render
renderAccounts();
if (state.activeIndex >= 0 && state.accounts[state.activeIndex]) {
  setActiveAccount(state.activeIndex);
}

// Auth gating and sections visibility
function updateAuthGate() {
  const authed = Boolean(state.token && state.user);
  document.getElementById('auth-section').hidden = authed;
  document.getElementById('sidebar').hidden = !authed;
  document.getElementById('search-section').hidden = !authed;
  document.getElementById('chat-section').hidden = !authed || !state.activeFriend;
  document.getElementById('groups-section').hidden = !authed;
  setupMobile(authed);
}

function showSections({ chat = false, groups = false } = {}) {
  if (chat) {
    document.getElementById('chat-section').hidden = false;
  }
  if (groups) {
    document.getElementById('groups-section').hidden = false;
  }
}

// Groups UI
document.getElementById('create-group').onclick = async () => {
  if (!state.token) return alert('Сначала войдите');
  const name = prompt('Название группы:');
  if (!name) return;
  const friendIds = await pickMembers();
  const data = await api('/api/groups/create', { method: 'POST', body: { name, memberIds: friendIds } });
  await loadGroups();
  openGroup({ id: data.id, name: data.name });
};

async function pickMembers() {
  const friends = await api('/api/friends');
  if (friends.length === 0) return [];
  const names = friends.map(f => f.username).join(', ');
  const chosen = prompt('Участники (через запятую), из: ' + names);
  if (!chosen) return [];
  const set = new Set(chosen.split(',').map(s => s.trim()).filter(Boolean));
  const ids = friends.filter(f => set.has(f.username)).map(f => f.id);
  return ids;
}

async function loadGroups() {
  if (!state.token) return;
  const groups = await api('/api/groups');
  const ul = document.getElementById('groups-list');
  ul.innerHTML = '';
  groups.forEach(g => {
    const li = document.createElement('li');
    li.className = 'friend';
    const name = document.createElement('span');
    name.textContent = g.name;
    const btn = document.createElement('button');
    btn.textContent = 'Открыть';
    btn.onclick = () => openGroup(g);
    li.appendChild(name);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

async function openGroup(group) {
  state.activeGroup = group;
  state.groupMessages = await api('/api/groups/history/' + group.id);
  document.getElementById('chat-title').textContent = 'Группа: ' + group.name;
  renderGroupMessages();
  showSections({ groups: true });
}

function renderGroupMessages() {
  const ul = document.getElementById('messages');
  ul.innerHTML = '';
  state.groupMessages.forEach(m => {
    const li = document.createElement('li');
    li.className = 'message' + (m.fromUserId === state.user?.id ? ' me' : '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const date = new Date(m.createdAt);
    const ownerTag = (isOwnerId(m.fromUserId) ? '<span class="badge-owner-inline">OWNER</span> ' : '');
    meta.innerHTML = ownerTag + 'Участник • ' + date.toLocaleTimeString();
    const body = document.createElement('div');
    body.textContent = m.content;
    li.appendChild(meta);
    li.appendChild(body);
    ul.appendChild(li);
  });
  ul.scrollTop = ul.scrollHeight;
}

function isOwner(username) {
  return username === 'Nebula' || username === 'NebulaTest';
}

function isOwnerId(userId) {
  // Try to resolve from accounts list
  const acc = state.accounts.find(a => a.user.id === userId);
  if (acc) return isOwner(acc.user.username);
  // Fallback: cannot resolve without username
  return false;
}

// Mobile detection and sidebar toggle
function setupMobile(authed) {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const bar = document.getElementById('mobile-bar');
  const sidebar = document.getElementById('sidebar');
  if (!authed) {
    bar.hidden = true;
    sidebar.classList.remove('open');
    return;
  }
  bar.hidden = !isMobile;
  const btn = document.getElementById('toggle-sidebar');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (!isMobile) return;
    if (!sidebar.classList.contains('open')) return;
    if (!sidebar.contains(e.target) && e.target !== btn) sidebar.classList.remove('open');
  });
}


