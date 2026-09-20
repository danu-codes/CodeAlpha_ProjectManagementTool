const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'codealpha_taskflow_secure_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://dstarlord07_db_user:iLpI3i76CAzicQjn@cluster0.rrrupsd.mongodb.net/?appName=Cluster0';
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('⚡ TaskFlow Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- SCHEMAS ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email:    { type: String, required: true, unique: true },
    password: { type: String, required: true }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const notificationSchema = new mongoose.Schema({
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message:   { type: String, required: true },
    read:      { type: Boolean, default: false }
}, { timestamps: true });
const Notification = mongoose.model('Notification', notificationSchema);

const commentSchema = new mongoose.Schema({
    author:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    text:     { type: String, required: true }
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
    title:       { type: String, required: true },
    description: { type: String },
    status:      { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
    assignee:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    project:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    comments:    [commentSchema]
}, { timestamps: true });
const Task = mongoose.model('Task', taskSchema);

const projectSchema = new mongoose.Schema({
    title:       { type: String, required: true },
    description: { type: String },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });
const Project = mongoose.model('Project', projectSchema);

function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized access.' });
    next();
}

// Helper to send real-time notification
async function createAndSendNotification(recipientId, senderId, message) {
    if (!recipientId) return;
    const notif = await Notification.create({ recipient: recipientId, sender: senderId, message });
    io.to(recipientId.toString()).emit('new_notification', notif);
}

// --- API ROUTES ---

// Registration & Login
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const email = req.body.email || `${username}@taskflow.local`;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ username, email, password: hashedPassword });
        req.session.userId = user._id;
        res.status(201).json({ _id: user._id, username: user.username, email: user.email });
    } catch (err) {
        res.status(500).json({ error: 'User registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        req.session.userId = user._id;
        res.json({ _id: user._id, username: user.username, email: user.email });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/session', async (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    const user = await User.findById(req.session.userId).select('-password');
    res.json({ loggedIn: true, user });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

// Notifications
app.get('/api/notifications', requireAuth, async (req, res) => {
    const notifs = await Notification.find({ recipient: req.session.userId }).sort({ createdAt: -1 });
    res.json(notifs);
});

app.put('/api/notifications/read', requireAuth, async (req, res) => {
    await Notification.updateMany({ recipient: req.session.userId, read: false }, { read: true });
    res.json({ success: true });
});

// Projects & Inviting Members
app.get('/api/projects', requireAuth, async (req, res) => {
    const projects = await Project.find({ members: req.session.userId })
        .populate('members', 'username email')
        .populate('createdBy', 'username');
    res.json(projects);
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
    const project = await Project.findById(req.params.id).populate('members', 'username email');
    res.json(project);
});

app.post('/api/projects', requireAuth, async (req, res) => {
    const project = await Project.create({
        title: req.body.title,
        createdBy: req.session.userId,
        members: [req.session.userId]
    });
    res.status(201).json(await project.populate('members createdBy', 'username email'));
});

// Invite member by username
app.post('/api/projects/:projectId/invite', requireAuth, async (req, res) => {
    try {
        const { username } = req.body;
        const userToInvite = await User.findOne({ username });
        if (!userToInvite) return res.status(404).json({ error: 'User not found' });

        const project = await Project.findById(req.params.projectId);
        if (project.members.includes(userToInvite._id)) {
            return res.status(400).json({ error: 'User already in project' });
        }

        project.members.push(userToInvite._id);
        await project.save();

        const currentUser = await User.findById(req.session.userId);
        await createAndSendNotification(
            userToInvite._id,
            req.session.userId,
            `${currentUser.username} invited you to project "${project.title}"`
        );

        res.json(await project.populate('members', 'username email'));
    } catch (err) {
        res.status(500).json({ error: 'Failed to invite member' });
    }
});

// Tasks & Assignee Updates
app.get('/api/projects/:projectId/tasks', requireAuth, async (req, res) => {
    const tasks = await Task.find({ project: req.params.projectId }).populate('assignee', 'username');
    res.json(tasks);
});

app.get('/api/tasks/:id', requireAuth, async (req, res) => {
    const task = await Task.findById(req.params.id).populate('assignee', 'username');
    res.json(task);
});

app.post('/api/tasks', requireAuth, async (req, res) => {
    const { title, projectId, status, assignee } = req.body;
    const task = await Task.create({
        title,
        status: status || 'todo',
        project: projectId,
        assignee: assignee || null
    });

    if (assignee) {
        const currentUser = await User.findById(req.session.userId);
        await createAndSendNotification(
            assignee,
            req.session.userId,
            `${currentUser.username} assigned you a task: "${title}"`
        );
    }

    io.to(projectId).emit('task_updated', { projectId, action: 'created' });
    res.status(201).json(await task.populate('assignee', 'username'));
});

// Update Task (Status + Edit Assignee)
app.put('/api/tasks/:taskId', requireAuth, async (req, res) => {
    try {
        const { status, assignee } = req.body;
        const oldTask = await Task.findById(req.params.taskId);
        
        const updateData = {};
        if (status) updateData.status = status;
        if (assignee !== undefined) updateData.assignee = assignee || null;

        const updatedTask = await Task.findByIdAndUpdate(req.params.taskId, updateData, { new: true })
            .populate('assignee', 'username');

        // Notify if assignee changed
        if (assignee && String(oldTask.assignee) !== String(assignee)) {
            const currentUser = await User.findById(req.session.userId);
            await createAndSendNotification(
                assignee,
                req.session.userId,
                `${currentUser.username} assigned you to task: "${updatedTask.title}"`
            );
        }

        io.to(updatedTask.project.toString()).emit('task_updated', { projectId: updatedTask.project, action: 'updated' });
        res.json(updatedTask);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});

app.post('/api/tasks/:taskId/comments', requireAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const task = await Task.findById(req.params.taskId);

    task.comments.push({ author: user._id, username: user.username, text: req.body.text });
    await task.save();

    io.to(task.project.toString()).emit('task_updated', { projectId: task.project, action: 'commented' });
    res.json(task);
});

// --- DELETE PROJECT (Only project creator) ---
app.delete('/api/projects/:projectId', requireAuth, async (req, res) => {
    try {
        const project = await Project.findById(req.params.projectId);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Authorization check: Only creator can delete
        if (project.createdBy.toString() !== req.session.userId) {
            return res.status(403).json({ error: 'Access denied: Only the project creator can delete this project.' });
        }

        // Delete all associated tasks first, then delete the project
        await Task.deleteMany({ project: project._id });
        await Project.findByIdAndDelete(project._id);

        io.to(project._id.toString()).emit('project_deleted', { projectId: project._id });
        res.json({ message: 'Project and associated tasks deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// --- DELETE TASK (Only project creator) ---
app.delete('/api/tasks/:taskId', requireAuth, async (req, res) => {
    try {
        const task = await Task.findById(req.params.taskId);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        // Fetch project to verify creator ownership
        const project = await Project.findById(task.project);
        if (!project) return res.status(404).json({ error: 'Associated project not found' });

        // Authorization check: Only project creator can delete tasks
        if (project.createdBy.toString() !== req.session.userId) {
            return res.status(403).json({ error: 'Access denied: Only the project creator can delete tasks.' });
        }

        await Task.findByIdAndDelete(req.params.taskId);

        io.to(project._id.toString()).emit('task_updated', { projectId: project._id, action: 'deleted' });
        res.json({ message: 'Task deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// Socket Rooms
io.on('connection', (socket) => {
    socket.on('user_login', (userId) => socket.join(userId));
    socket.on('join_project', (projectId) => socket.join(projectId));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 TaskFlow running on http://localhost:${PORT}`));