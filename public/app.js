const socket = io();
let currentUser = null;
let currentProject = null;
let isRegisterMode = false;

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

// Socket.io Real-time Event Listeners
socket.on('task_updated', (data) => {
    if (currentProject && currentProject._id === data.projectId) {
        loadBoard(data.projectId);
        showToast(`Real-time update: Task ${data.action}`);
    }
});

async function checkSession() {
    const res = await fetch('/api/session');
    const data = await res.json();
    const navActions = document.getElementById('nav-actions');

    if (data.loggedIn) {
        currentUser = data.user;
        navActions.innerHTML = `
            <span style="margin-right:1rem; font-weight:600;"><i class="fa-solid fa-user"></i> ${currentUser.username}</span>
            <button class="btn btn-primary" onclick="logout()">Logout</button>
        `;
        closeModal('auth-modal');
        loadProjects();
    } else {
        openModal('auth-modal');
    }
}

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

    // Connect user socket to the project's real-time room
    socket.emit('join_project', currentProject._id);

    loadProjects();
    loadBoard(id);
}

async function loadBoard(projectId) {
    const res = await fetch(`/api/projects/${projectId}/tasks`);
    const tasks = await res.json();

    const cols = { todo: [], in_progress: [], done: [] };
    tasks.forEach(t => cols[t.status].push(t));

    ['todo', 'in_progress', 'done'].forEach(status => {
        const colEl = document.getElementById(`col-${status}`);
        colEl.innerHTML = cols[status].map(t => `
            <div class="task-card" onclick="openTaskDetail('${t._id}')">
                <div style="font-weight:700; margin-bottom:0.4rem;">${t.title}</div>
                <div class="task-footer">
                    <span><i class="fa-solid fa-user-tag"></i> ${t.assignee ? t.assignee.username : 'Unassigned'}</span>
                    <span><i class="fa-regular fa-comments"></i> ${t.comments.length}</span>
                </div>
            </div>
        `).join('');
    });
}

function openCreateTaskModal(status) {
    document.getElementById('task-status-input').value = status;
    const select = document.getElementById('task-assignee-select');
    select.innerHTML = `<option value="">Unassigned</option>` + currentProject.members.map(m => `
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
    selectProject(newProj._id);
}

async function openTaskDetail(taskId) {
    const res = await fetch(`/api/tasks/${taskId}`);
    const task = await res.json();

    const container = document.getElementById('task-detail-content');
    container.innerHTML = `
        <h3 style="margin-bottom:1rem;">${task.title}</h3>
        <div class="input-group">
            <label>Move Status</label>
            <select onchange="updateTaskStatus('${task._id}', this.value)">
                <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
                <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
            </select>
        </div>
        <hr style="margin: 1rem 0; border: none; border-top: 1px solid var(--border);">
        <h4 style="margin-bottom:0.5rem;">Comments</h4>
        <div style="max-height: 200px; overflow-y: auto; margin-bottom: 1rem;">
            ${task.comments.map(c => `
                <div class="comment-box">
                    <div class="comment-header">${c.username}</div>
                    <div>${c.text}</div>
                </div>
            `).join('')}
        </div>
        <form onsubmit="postComment(event, '${task._id}')">
            <div class="input-group">
                <input type="text" id="comment-text" placeholder="Write a comment..." required>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Add Comment</button>
        </form>
    `;
    openModal('task-detail-modal');
}

async function updateTaskStatus(taskId, status) {
    await fetch(`/api/tasks/${taskId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });
    loadBoard(currentProject._id);
}

async function postComment(e, taskId) {
    e.preventDefault();
    const text = document.getElementById('comment-text').value;
    await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });
    openTaskDetail(taskId);
    loadBoard(currentProject._id);
}

// Modal and Auth Utilities
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-title').innerText = isRegisterMode ? 'Register Account' : 'Welcome to TaskFlow';
    document.getElementById('auth-submit-btn').innerText = isRegisterMode ? 'Sign Up' : 'Log In';
    document.getElementById('auth-toggle-btn').innerText = isRegisterMode ? 'Already registered? Log In' : 'New user? Register';
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

    if (res.ok) {
        checkSession();
    } else {
        const err = await res.json();
        showToast(err.error || 'Authentication error');
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
}

function showToast(msg) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}