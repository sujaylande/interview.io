// backend/models/Student.js
const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    socketId: { 
        type: String, 
        required: function() {
            // socketId is only required if the student is not kicked
            return !this.kickedAt;
        }
    },
    studentId: { type: String, required: true, unique: true }, // Persistent ID (e.g., UUID from frontend)
    name: { type: String, required: true },
    lastSeen: { type: Date, default: Date.now },
    hasAnswered: { type: Boolean, default: false }, // For current active poll
    isActive: { type: Boolean, default: true }, // Current connection status
    kickedAt: { type: Date, default: null } // Timestamp when student was kicked, null if not kicked
});

module.exports = mongoose.model('Student', StudentSchema);