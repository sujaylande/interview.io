// backend/models/Student.js
const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    socketId: { type: String, required: true }, // Current Socket.io ID
    studentId: { type: String, required: true, unique: true }, // Persistent ID (e.g., UUID from frontend)
    name: { type: String, required: true },
    lastSeen: { type: Date, default: Date.now },
    hasAnswered: { type: Boolean, default: false }, // For current active poll
    kicked: { type: Boolean, default: false } // If teacher kicks them out
});

module.exports = mongoose.model('Student', StudentSchema);