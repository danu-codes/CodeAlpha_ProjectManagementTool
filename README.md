# ⚡ TaskFlow - Real-Time Collaborative Kanban Board

TaskFlow is a full-stack, real-time task management application built using **Node.js, Express, Socket.IO, and MongoDB**. It allows team members to create projects, invite collaborators, track task progress on interactive Kanban boards, and receive real-time notifications for task updates and assignments.

---

## 🚀 Features

- **Real-Time Collaboration:** Instant board and notification updates powered by Socket.IO.
- **Kanban Board:** Manage workflow across `To Do`, `In Progress`, and `Done` columns.
- **Project Management:** Create projects, invite team members by username, and set project ownership permissions.
- **Task Assignment & Notifications:** Assign tasks to specific project members with real-time browser alerts and notification logs.
- **Authentication:** Session-based authentication with password hashing using `bcryptjs`.
- **Automatic Reconnection:** Front-end socket listeners designed to seamlessly handle disconnects and server restarts.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js, Socket.IO
- **Database:** MongoDB (with Mongoose ODM)
- **Session Management:** Express-Session
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3, FontAwesome

---

## 📂 Project Structure

```text
taskflow/
├── public/
│   ├── index.html       # Single-page application template
│   ├── app.js           # Front-end logic & Socket.IO client setup
│   └── style.css        # UI styling & layout
├── server.js            # Express server, MongoDB schemas & Socket handlers
├── .env                 # Environment variables (IGNORED BY GIT)
├── .gitignore           # Git ignore file
├── package.json         # Dependencies and scripts
└── README.md            # Documentation