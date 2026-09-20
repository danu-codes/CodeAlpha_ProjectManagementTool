const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

app.use(session({
    secret: 'codealpha_taskflow_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Connect to MongoDB Atlas (Reuse your existing Mongo URI)
const MONGO_URI = 'mongodb+srv://dstarlord07_db_user:59PshFBHMLUHiOiS@cluster0.rrrupsd.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('TaskFlow Connected to MongoDB Atlas'))
    .catch(err => console.error('MongoDB Error:', err));

// Schemas
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
}));

const Project = mongoose.model('Project', new mongoose.Schema({
    title: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    comments: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        username: String,
        text: String,
        createdAt: { type: Date, default: Date.now }
    }]
}));

function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Auth required' });
    next();
}

// Socket.io Room Joining
io.on('connection', (socket) => {
    socket.on('join_project', (projectId) => {
        socket.join(projectId);
    });
});

// Auth Routes
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        req.session.userId = user._id;
        res.status(201).json(user);
    } catch (err) {
        res.status(400).json({ error: 'Username taken' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        return res.json(user);
    }
    res.status(400).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

app.get('/api/session', async (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    const user = await User.findById(req.session.userId).select('-password');
    res.json({ loggedIn: true, user });
});

// Project Routes
app.get('/api/projects', requireAuth, async (req, res) => {
    const projects = await Project.find({ members: req.session.userId });
    res.json(projects);
});

app.post('/api/projects', requireAuth, async (req, res) => {
    const project = new Project({
        title: req.body.title,
        owner: req.session.userId,
        members: [req.session.userId]
    });
    await project.save();
    res.status(201).json(project);
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
    const project = await Project.findById(req.params.id).populate('members', 'username');
    res.json(project);
});

// Task Routes
app.get('/api/projects/:id/tasks', requireAuth, async (req, res) => {
    const tasks = await Task.find({ project: req.params.id }).populate('assignee', 'username');
    res.json(tasks);
});

app.post('/api/tasks', requireAuth, async (req, res) => {
    const { projectId, title, status, assignee } = req.body;
    const task = new Task({ project: projectId, title, status, assignee: assignee || null });
    await task.save();

    io.to(projectId).emit('task_updated', { projectId, action: 'created' });
    res.status(201).json(task);
});

app.get('/api/tasks/:id', requireAuth, async (req, res) => {
    const task = await Task.findById(req.params.id);
    res.json(task);
});

app.put('/api/tasks/:id/status', requireAuth, async (req, res) => {
    const task = await Task.findById(req.params.id);
    task.status = req.body.status;
    await task.save();

    io.to(task.project.toString()).emit('task_updated', { projectId: task.project, action: 'status moved' });
    res.json(task);
});

app.post('/api/tasks/:id/comments', requireAuth, async (req, res) => {
    const task = await Task.findById(req.params.id);
    const user = await User.findById(req.session.userId);
    task.comments.push({ user: user._id, username: user.username, text: req.body.text });
    await task.save();

    io.to(task.project.toString()).emit('task_updated', { projectId: task.project, action: 'comment added' });
    res.json(task);
});

const PORT = 3000;
server.listen(PORT, () => console.log(`TaskFlow Server running on http://localhost:${PORT}`));