const socket = io({
    transports: ['websocket', 'polling'], // Fallback to polling if WebSockets fail
    reconnection: true,                  // Enable auto-reconnection
    reconnectionAttempts: 10,            // Number of attempts before giving up
    reconnectionDelay: 1000,             // How long to wait before first attempt (1s)
    reconnectionDelayMax: 5000,          // Maximum delay between attempts (5s)
    timeout: 20000                        // Connection timeout (20s)
});

let currentUser = null;
let currentProject = null;
let isRegisterMode = false;

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

// --- REAL-TIME SOCKET LISTENERS ---

// --- SOCKET LIFECYCLE HANDLERS ---

// Fired when successfully connected (or re-connected)
socket.on('connect', () => {
    console.log('⚡ Socket connected:', socket.id);

    // 1. Re-authenticate active user session if present
    if (currentUser && currentUser._id) {
        socket.emit('user_login', currentUser._id);
    }

    // 2. Re-join current active project room
    if (currentProject && currentProject._id) {
        socket.emit('join_project', currentProject._id);
        // Refresh board to fetch any updates missed while offline
        loadBoard(currentProject._id);
    }
});

// Fired when disconnected (e.g., server restart or network failure)
socket.on('disconnect', (reason) => {
    console.warn('⚠️ Socket disconnected:', reason);

    if (reason === 'io server disconnect') {
        // Disconnected manually by the server -> reconnect manually
        socket.connect();
    } else {
        // Disconnected due to network issues -> auto-reconnect will kick in
        showToast('Lost connection to server. Reconnecting...');
    }
});

// Fired on each reconnection attempt
socket.io.on('reconnect_attempt', (attempt) => {
    console.log(`🔄 Attempting to reconnect (${attempt})...`);
});

// Fired when reconnection is successful
socket.io.on('reconnect', (attemptNumber) => {
    showToast('🟢 Reconnected to server!');
});

// Fired if all reconnection attempts fail
socket.io.on('reconnect_failed', () => {
    showToast('❌ Unable to reconnect to server. Please refresh the page.');
});

// Handle connection errors (e.g., 400 Bad Request polling errors)
socket.on('connect_error', (error) => {
    console.error('Socket Connection Error:', error.message);
});

socket.on('task_updated', (data) => {
    if (currentProject && currentProject._id === data.projectId) {
        loadBoard(data.projectId);
    }
});

socket.on('new_notification', (notif) => {
    showToast(`🔔 ${notif.message}`);
    loadNotifications();
});

socket.on('project_deleted', (data) => {
    if (currentProject && currentProject._id === data.projectId) {
        currentProject = null;
        document.getElementById('kanban-board').style.display = 'none';
        document.getElementById('btn-invite-member').style.display = 'none';
        document.getElementById('btn-delete-project').style.display = 'none';
        document.getElementById('current-project-title').innerText = 'Select or Create a Project';
        document.getElementById('project-members').innerHTML = '';
        showToast('This project was deleted by the owner.');
        loadProjects();
    }
});

// --- AUTH & SESSION ---

async function checkSession() {
    try {
        const res = await fetch('/api/session');
        const data = await res.json();
        const navActions = document.getElementById('nav-actions');

        if (data.loggedIn) {
            currentUser = data.user;
            socket.emit('user_login', currentUser._id);

            navActions.innerHTML = `
                <div style="position:relative;">
                    <button class="btn btn-sm" onclick="toggleNotifDropdown()">
                        <i class="fa-solid fa-bell"></i>
                        <span id="notif-badge" style="background:red; color:white; border-radius:50%; padding:2px 6px; font-size:0.7rem; display:none;"></span>
                    </button>
                    <div id="notif-dropdown" style="display:none; position:absolute; right:0; top:35px; background:white; border:1px solid #ccc; width:280px; max-height:300px; overflow-y:auto; box-shadow:0 4px 6px rgba(0,0,0,0.1); z-index:100; border-radius:6px; padding:0.5rem;"></div>
                </div>
                <span><i class="fa-solid fa-user"></i> ${currentUser.username}</span>
                <button class="btn btn-primary btn-sm" onclick="logout()">Logout</button>
            `;

            closeModal('auth-modal');
            loadProjects();
            loadNotifications();
        } else {
            openModal('auth-modal');
        }
    } catch (err) {
        showToast('Failed to verify session');
    }
}

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-title').innerText = isRegisterMode ? 'Register' : 'Welcome';
    document.getElementById('auth-submit-btn').innerText = isRegisterMode ? 'Sign Up' : 'Log In';
}

async function handleAuth(e) {
    e.preventDefault();
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;
    const endpoint = isRegisterMode ? '/api/register' : '/api/login';

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    if (res.ok) checkSession();
    else showToast((await res.json()).error);
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
}

// --- NOTIFICATIONS ---

async function loadNotifications() {
    const res = await fetch('/api/notifications');
    const notifs = await res.json();

    const unread = notifs.filter(n => !n.read).length;
    const badge = document.getElementById('notif-badge');
    if (badge) {
        badge.innerText = unread;
        badge.style.display = unread > 0 ? 'inline' : 'none';
    }

    const dropdown = document.getElementById('notif-dropdown');
    if (dropdown) {
        dropdown.innerHTML = notifs.length ? notifs.map(n => `
            <div style="padding:0.4rem; border-bottom:1px solid #eee; font-size:0.85rem; ${!n.read ? 'font-weight:bold;' : ''}">
                ${n.message}
            </div>
        `).join('') : '<div style="font-size:0.85rem; color:#666;">No notifications</div>';
    }
}

async function toggleNotifDropdown() {
    const dropdown = document.getElementById('notif-dropdown');
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';

    if (!isVisible) {
        await fetch('/api/notifications/read', { method: 'PUT' });
        loadNotifications();
    }
}

// --- PROJECTS ---

async function loadProjects() {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    const list = document.getElementById('projects-list');

    list.innerHTML = projects.map(p => `
        <li class="project-item ${currentProject && currentProject._id === p._id ? 'active' : ''}" onclick="selectProject('${p._id}')">
            <i class="fa-solid fa-folder"></i> ${p.title}
        </li>
    `).join('');

    if (projects.length > 0 && !currentProject) {
        selectProject(projects[0]._id);
    }
}

async function selectProject(id) {
    const res = await fetch(`/api/projects/${id}`);
    currentProject = await res.json();

    document.getElementById('current-project-title').innerText = currentProject.title;
    document.getElementById('kanban-board').style.display = 'grid';
    document.getElementById('btn-invite-member').style.display = 'inline-block';

    // Verify Project Ownership
    const ownerId = currentProject.createdBy?._id || currentProject.createdBy;
    const isOwner = String(ownerId) === String(currentUser._id);
    document.getElementById('btn-delete-project').style.display = isOwner ? 'inline-block' : 'none';

    // Render Member Pills
    const membersPills = document.getElementById('project-members');
    membersPills.innerHTML = (currentProject.members || []).map(m => `
        <span style="background:#e0e0e0; padding:2px 8px; border-radius:12px; font-size:0.8rem; margin-right:4px;">
            <i class="fa-solid fa-user"></i> ${m.username || 'User'}
        </span>
    `).join('');

    // Highlight active sidebar item
    document.querySelectorAll('.project-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('onclick')?.includes(id));
    });

    socket.emit('join_project', currentProject._id);
    loadBoard(id);
}

async function handleCreateProject(e) {
    e.preventDefault();
    const title = document.getElementById('project-name-input').value;
    const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
    });
    const newProj = await res.json();
    closeModal('create-project-modal');
    document.getElementById('project-name-input').value = '';
    await loadProjects();
    selectProject(newProj._id);
}

async function handleDeleteProject() {
    if (!currentProject) return;
    if (!confirm(`Are you sure you want to delete "${currentProject.title}" and all its tasks?`)) return;

    const res = await fetch(`/api/projects/${currentProject._id}`, {
        method: 'DELETE'
    });

    if (res.ok) {
        showToast('Project deleted successfully');
        const deletedId = currentProject._id;
        currentProject = null;

        document.getElementById('kanban-board').style.display = 'none';
        document.getElementById('btn-invite-member').style.display = 'none';
        document.getElementById('btn-delete-project').style.display = 'none';
        document.getElementById('current-project-title').innerText = 'Select or Create a Project';
        document.getElementById('project-members').innerHTML = '';

        await loadProjects();
    } else {
        const err = await res.json();
        showToast(err.error || 'Failed to delete project');
    }
}

async function handleInviteMember(e) {
    e.preventDefault();
    const username = document.getElementById('invite-username-input').value;

    const res = await fetch(`/api/projects/${currentProject._id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    });

    if (res.ok) {
        showToast(`Member ${username} invited!`);
        closeModal('invite-member-modal');
        document.getElementById('invite-username-input').value = '';
        selectProject(currentProject._id);
    } else {
        const err = await res.json();
        showToast(err.error || 'Failed to invite user');
    }
}

// --- KANBAN BOARD & TASKS ---

async function loadBoard(projectId) {
    const res = await fetch(`/api/projects/${projectId}/tasks`);
    const tasks = await res.json();

    const cols = { todo: [], in_progress: [], done: [] };
    tasks.forEach(t => { if (cols[t.status]) cols[t.status].push(t); });

    ['todo', 'in_progress', 'done'].forEach(status => {
        const colEl = document.getElementById(`col-${status}`);
        colEl.innerHTML = cols[status].map(t => `
            <div class="task-card" onclick="openTaskDetail('${t._id}')">
                <div style="font-weight:700; margin-bottom:0.4rem;">${t.title}</div>
                <div class="task-footer">
                    <span><i class="fa-solid fa-user-tag"></i> ${t.assignee ? t.assignee.username : 'Unassigned'}</span>
                </div>
            </div>
        `).join('');
    });
}

function openCreateTaskModal(status) {
    document.getElementById('task-status-input').value = status;
    const select = document.getElementById('task-assignee-select');
    select.innerHTML = `<option value="">Unassigned</option>` + (currentProject.members || []).map(m => `
        <option value="${m._id}">${m.username}</option>
    `).join('');
    openModal('create-task-modal');
}

async function handleCreateTask(e) {
    e.preventDefault();
    const title = document.getElementById('task-title-input').value;
    const status = document.getElementById('task-status-input').value;
    const assignee = document.getElementById('task-assignee-select').value;

    await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProject._id, title, status, assignee })
    });

    closeModal('create-task-modal');
    document.getElementById('task-title-input').value = '';
    loadBoard(currentProject._id);
}

async function openTaskDetail(taskId) {
    const res = await fetch(`/api/tasks/${taskId}`);
    const task = await res.json();

    const ownerId = currentProject.createdBy?._id || currentProject.createdBy;
    const isOwner = String(ownerId) === String(currentUser._id);

    const container = document.getElementById('task-detail-content');
    container.innerHTML = `
        <h3>${task.title}</h3>
        <div class="input-group" style="margin-top:1rem;">
            <label>Move Status</label>
            <select id="edit-task-status" onchange="updateTaskDetails('${task._id}')">
                <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
                <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
            </select>
        </div>
        <div class="input-group">
            <label>Edit Assignee</label>
            <select id="edit-task-assignee" onchange="updateTaskDetails('${task._id}')">
                <option value="">Unassigned</option>
                ${(currentProject.members || []).map(m => `
                    <option value="${m._id}" ${task.assignee && task.assignee._id === m._id ? 'selected' : ''}>${m.username}</option>
                `).join('')}
            </select>
        </div>
        ${isOwner ? `
            <hr style="margin: 1rem 0; border: none; border-top: 1px solid var(--border);" />
            <button class="btn btn-block" style="background:#ef4444; color:white;" onclick="handleDeleteTask('${task._id}')">
                <i class="fa-solid fa-trash"></i> Delete Task
            </button>
        ` : ''}
    `;
    openModal('task-detail-modal');
}

async function updateTaskDetails(taskId) {
    const status = document.getElementById('edit-task-status').value;
    const assignee = document.getElementById('edit-task-assignee').value;

    await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, assignee })
    });

    showToast('Task updated successfully');
    loadBoard(currentProject._id);
}

async function handleDeleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this task?')) return;

    const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE'
    });

    if (res.ok) {
        showToast('Task deleted successfully');
        closeModal('task-detail-modal');
        loadBoard(currentProject._id);
    } else {
        const err = await res.json();
        showToast(err.error || 'Failed to delete task');
    }
}

// --- UTILITY FUNCTIONS ---

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function showToast(msg) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}