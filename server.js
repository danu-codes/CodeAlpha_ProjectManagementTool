const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- MONGODB CONNECTION ---
// Replace with your MongoDB connection string
const MONGO_URI = 'mongodb+srv://admin:password123@cluster0.abcde.mongodb.net/taskflow_db?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000
})
.then(() => console.log('TaskFlow Connected to MongoDB Atlas'))
.catch(err => console.error('MongoDB Error:', err));

// --- SCHEMAS & MODELS ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email:    { type: String, required: true, unique: true }
});
const User = mongoose.model('User', userSchema);

const taskSchema = new mongoose.Schema({
    title:       { type: String, required: true },
    description: { type: String },
    status:      { type: String, enum: ['To Do', 'In Progress', 'Done'], default: 'To Do' },
    assignedTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    project:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true }
}, { timestamps: true });
const Task = mongoose.model('Task', taskSchema);

const projectSchema = new mongoose.Schema({
    name:        { type: String, required: true },
    description: { type: String },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });
const Project = mongoose.model('Project', projectSchema);


// --- API ROUTES ---

// 1. Register User
app.post('/api/users/register', async (req, res) => {
    try {
        const { username, email } = req.body;
        let user = await User.findOne({ email });
        if (!user) {
            user = await User.create({ username, email });
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'User registration failed' });
    }
});

// 2. Get All Registered Users
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, '_id username email');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// 3. Get All Projects
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await Project.find()
            .populate('members', 'username email')
            .populate('createdBy', 'username');
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// 4. Create Project
app.post('/api/projects', async (req, res) => {
    try {
        const { name, description, userId } = req.body;
        const project = await Project.create({
            name,
            description,
            createdBy: userId,
            members: [userId]
        });
        const populated = await project.populate('members createdBy', 'username email');
        
        io.emit('project:created', populated);
        res.json(populated);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// 5. Add Member to Project
app.post('/api/projects/:projectId/members', async (req, res) => {
    try {
        const { userId } = req.body;
        const project = await Project.findByIdAndUpdate(
            req.params.projectId,
            { $addToSet: { members: userId } },
            { new: true }
        ).populate('members createdBy', 'username email');

        io.emit('project:updated', project);
        res.json(project);
    } catch (err) {
        res.status(500).json({ error: 'Failed to add member' });
    }
});

// 6. Get Tasks for a Project
app.get('/api/projects/:projectId/tasks', async (req, res) => {
    try {
        const tasks = await Task.find({ project: req.params.projectId })
            .populate('assignedTo', 'username');
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// 7. Create Task
app.post('/api/tasks', async (req, res) => {
    try {
        const { title, description, projectId, assignedTo } = req.body;
        const task = await Task.create({
            title,
            description,
            project: projectId,
            assignedTo: assignedTo || null
        });
        const populated = await task.populate('assignedTo', 'username');

        io.emit('task:created', populated);
        res.json(populated);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// 8. Update Task Status (Drag/Move)
app.patch('/api/tasks/:taskId', async (req, res) => {
    try {
        const { status } = req.body;
        const task = await Task.findByIdAndUpdate(
            req.params.taskId,
            { status },
            { new: true }
        ).populate('assignedTo', 'username');

        io.emit('task:updated', task);
        res.json(task);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// --- SOCKET.IO CONNECTION ---
io.on('connection', (socket) => {
    console.log('⚡ Client connected:', socket.id);
    socket.on('disconnect', () => console.log('❌ Client disconnected:', socket.id));
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`TaskFlow Server running on http://localhost:${PORT}`);
});