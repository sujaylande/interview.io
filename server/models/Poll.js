// backend/models/Poll.js
const mongoose = require('mongoose');

const VoteSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    studentName: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const OptionSchema = new mongoose.Schema({
    text: { type: String, required: true },
    votes: { type: Number, default: 0 },
    isCorrect: { type: Boolean, default: false },
    studentVotes: [VoteSchema] // Track which students voted for this option
});

const PollSchema = new mongoose.Schema({
    question: { type: String, required: true },
    options: [OptionSchema],
    duration: { type: Number, default: 60 }, // in seconds
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    totalStudentsVoted: { type: Number, default: 0 }, // Track total unique students who voted
    uniqueVoters: [String] // Array of student IDs who have voted
}, {
    timestamps: true
});

// Method to add a vote
PollSchema.methods.addVote = function(optionText, studentId, studentName) {
    console.log('Adding vote:', { optionText, studentId, studentName });
    
    const option = this.options.find(opt => opt.text === optionText);
    if (!option) {
        console.log('Option not found:', optionText);
        return false;
    }

    // Check if student has already voted
    const hasVoted = this.uniqueVoters.includes(studentId);
    if (!hasVoted) {
        // Add student to unique voters
        this.uniqueVoters.push(studentId);
        this.totalStudentsVoted += 1;
        console.log('New voter added, total:', this.totalStudentsVoted);
    } else {
        // Remove previous vote if exists
        this.options.forEach(opt => {
            opt.studentVotes = opt.studentVotes.filter(vote => vote.studentId !== studentId);
            opt.votes = opt.studentVotes.length;
        });
        console.log('Previous vote removed for student:', studentId);
    }

    // Add new vote
    option.studentVotes.push({ studentId, studentName, timestamp: new Date() });
    option.votes = option.studentVotes.length;
    console.log('Vote added to option:', { text: option.text, votes: option.votes });

    return true;
};

// Method to get results with percentages
PollSchema.methods.getResults = function() {
    console.log('Calculating results...');
    console.log('Total voters:', this.totalStudentsVoted);
    
    const totalVoters = this.totalStudentsVoted || 0;
    const results = {
        question: this.question,
        totalVoters,
        options: this.options.map(option => {
            const votes = option.votes || 0;
            const percentage = totalVoters > 0 ? ((votes / totalVoters) * 100).toFixed(1) : '0.0';
            
            console.log('Option results:', {
                text: option.text,
                votes,
                percentage,
                totalVoters
            });
            
            return {
                text: option.text,
                votes,
                percentage: parseFloat(percentage),
                isCorrect: option.isCorrect,
                studentVotes: option.studentVotes
            };
        }),
        status: this.status,
        duration: this.duration,
        createdAt: this.createdAt,
        completedAt: this.completedAt
    };

    console.log('Final results:', results);
    return results;
};

module.exports = mongoose.model('Poll', PollSchema);