const socket = io();

let currentUser = null;
let currentProject = null;
let allProjects = [];
let activeTasks = [];

// --- INITIALIZATION ---
window.onload = async () => {
    await loadUsers();
    await loadProjects();
};

// --- AUTHENTICATION ---
async function loginUser() {
    const username = document.getElementById('username-input').value.trim();
    const email = document.getElementById('email-input').value.trim();

    if (!username || !email) return alert('Enter username and email');

    const res = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email })
    });
    
    currentUser = await res.json();
    document.getElementById('user-display').innerHTML = `Logged in as: <strong>${currentUser.username}</strong>`;
    document.getElementById('auth-section').style.display = 'none';
    
    await loadUsers();
}

// --- USER & PROJECT DATA ---
async function loadUsers() {
    const res = await fetch('/api/users');
    const users = await res.json();

    const userSelect = document.getElementById('user-select');
    userSelect.innerHTML = '<option value="">Select User to Add...</option>';
    
    users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u._id;
        opt.textContent = `${u.username} (${u.email})`;
        userSelect.appendChild(opt);
    });
}

async function loadProjects() {
    const res = await fetch('/api/projects');
    allProjects = await res.json();
    renderProjectsList();
}

function renderProjectsList() {
    const container = document.getElementById('projects-list');
    container.innerHTML = '';

    allProjects.forEach(p => {
        const div = document.createElement('div');
        div.className = 'project-item';
        div.textContent = p.name;
        div.onclick = () => selectProject(p._id);
        container.appendChild(div);
    });
}

async function createProject() {
    const name = document.getElementById('new-project-name').value.trim();
    if (!name) return alert('Enter project name');
    if (!currentUser) return alert('Please log in first');

    await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, userId: currentUser._id })
    });

    document.getElementById('new-project-name').value = '';
}

async function selectProject(projectId) {
    currentProject = allProjects.find(p => p._id === projectId);
    
    document.getElementById('active-project-card').style.display = 'block';
    document.getElementById('task-form-card').style.display = 'block';
    document.getElementById('kanban-board').style.display = 'grid';
    document.getElementById('current-project-title').textContent = currentProject.name;

    renderMembers();
    populateAssigneeDropdown();
    await loadTasks();
}

function renderMembers() {
    const container = document.getElementById('project-members-badges');
    container.innerHTML = currentProject.members
        .map(m => `<span class="badge">👤 ${m.username}</span>`)
        .join('');
}

function populateAssigneeDropdown() {
    const select = document.getElementById('task-assignee');
    select.innerHTML = '<option value="">Assign To...</option>';
    currentProject.members.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m._id;
        opt.textContent = m.username;
        select.appendChild(opt);
    });
}

async function addMemberToProject() {
    const userId = document.getElementById('user-select').value;
    if (!userId || !currentProject) return alert('Select a user first');

    await fetch(`/api/projects/${currentProject._id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
}

// --- TASK MANAGEMENT ---
async function loadTasks() {
    if (!currentProject) return;
    const res = await fetch(`/api/projects/${currentProject._id}/tasks`);
    activeTasks = await res.json();
    renderTasks();
}

async function createTask() {
    const title = document.getElementById('task-title').value.trim();
    const assignedTo = document.getElementById('task-assignee').value;

    if (!title || !currentProject) return alert('Task title required');

    await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title,
            projectId: currentProject._id,
            assignedTo: assignedTo || null
        })
    });

    document.getElementById('task-title').value = '';
}

async function updateTaskStatus(taskId, newStatus) {
    await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
    });
}

function renderTasks() {
    const todoList = document.getElementById('todo-list');
    const inProgressList = document.getElementById('inprogress-list');
    const doneList = document.getElementById('done-list');

    todoList.innerHTML = '';
    inProgressList.innerHTML = '';
    doneList.innerHTML = '';

    activeTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'task-card';
        
        const assignee = task.assignedTo ? task.assignedTo.username : 'Unassigned';
        card.innerHTML = `
            <strong>${task.title}</strong>
            <small>Assigned to: ${assignee}</small>
            <div class="status-actions">
                ${task.status !== 'To Do' ? `<button onclick="updateTaskStatus('${task._id}', 'To Do')">← To Do</button>` : ''}
                ${task.status !== 'In Progress' ? `<button onclick="updateTaskStatus('${task._id}', 'In Progress')">In Progress</button>` : ''}
                ${task.status !== 'Done' ? `<button onclick="updateTaskStatus('${task._id}', 'Done')">Done →</button>` : ''}
            </div>
        `;

        if (task.status === 'To Do') todoList.appendChild(card);
        else if (task.status === 'In Progress') inProgressList.appendChild(card);
        else if (task.status === 'Done') doneList.appendChild(card);
    });
}

// --- REAL-TIME SOCKET LISTENERS ---
socket.on('project:created', (project) => {
    allProjects.push(project);
    renderProjectsList();
});

socket.on('project:updated', (updatedProject) => {
    const index = allProjects.findIndex(p => p._id === updatedProject._id);
    if (index !== -1) allProjects[index] = updatedProject;
    
    if (currentProject && currentProject._id === updatedProject._id) {
        currentProject = updatedProject;
        renderMembers();
        populateAssigneeDropdown();
    }
    renderProjectsList();
});

socket.on('task:created', (task) => {
    if (currentProject && task.project === currentProject._id) {
        activeTasks.push(task);
        renderTasks();
    }
});

socket.on('task:updated', (updatedTask) => {
    if (currentProject && updatedTask.project === currentProject._id) {
        const index = activeTasks.findIndex(t => t._id === updatedTask._id);
        if (index !== -1) activeTasks[index] = updatedTask;
        renderTasks();
    }
});