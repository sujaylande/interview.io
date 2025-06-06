// backend/server.js
require("dotenv").config()
const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const mongoose = require("mongoose")
const cors = require("cors")

const Poll = require("./models/Poll")
const Student = require("./models/Student")

const app = express()
const server = http.createServer(app)

// Configure CORS for Socket.io and Express
// IMPORTANT: Replace "http://localhost:3000" with your actual frontend URL in production
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000"

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // Explicitly define transports
  pingTimeout: 60000, // How long client can be unresponsive before disconnect
  pingInterval: 25000, // How often server pings client
  reconnectionAttempts: 5, // Number of attempts before giving up
  reconnectionDelay: 1000, // How long to wait before next reconnection attempt
})

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
)
app.use(express.json()) // For parsing JSON body

const PORT = process.env.PORT || 4000
const MONGODB_URI = process.env.MONGODB_URI

// MongoDB Connection
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err))

// Global variable to hold the current active poll
let currentActivePoll = null
let pollTimer = null // To manage the countdown
let answeredStudentsCount = 0 // To track how many students have answered the current poll

// Utility function to get active students
const getActiveStudents = async () => {
  // Only return students who are not kicked AND have a non-null socketId (meaning they are currently connected)
  return await Student.find({ kicked: false, socketId: { $ne: null } })
}

// Emit updated student list to all teachers
const emitStudentListUpdate = async () => {
  const activeStudents = await getActiveStudents()
  io.emit("studentListUpdate", activeStudents)
}

// Socket.io Logic
io.on("connection", async (socket) => {
  // Log connection, useful for debugging immediate disconnects
  console.log(`User connected: ${socket.id}`)

  // If socket.id was recovered (meaning it's a reconnection from a temporary disconnect)
  if (socket.recovered) {
    console.log(`Socket recovered connection: ${socket.id}`)
  }

  // --- Student Events ---
  socket.on("studentJoin", async ({ name, studentId }) => {
    try {
      // Attach studentId to the socket for easy lookup later (e.g., in kickStudent)
      socket.studentId = studentId

      let student = await Student.findOne({ studentId })
      if (student) {
        // Update existing student's socketId, lastSeen, and reset kicked status on reconnect
        student.socketId = socket.id
        student.lastSeen = new Date()
        student.kicked = false // Reset kicked status on reconnect
        await student.save()
        console.log(`Existing student reconnected/joined: ${name} (${studentId}) with socket ${socket.id}`)
      } else {
        // Create new student record
        student = new Student({
          socketId: socket.id,
          studentId, // This is the persistent ID from frontend localStorage
          name,
          hasAnswered: false,
          kicked: false,
        })
        await student.save()
        console.log(`New student joined: ${name} (${studentId}) with socket ${socket.id}`)
      }

      // Send initial poll state to the joining client
      if (currentActivePoll && currentActivePoll.status === "active") {
        socket.emit("newPoll", {
          poll: {
            _id: currentActivePoll._id,
            question: currentActivePoll.question,
            options: currentActivePoll.options.map((opt) => ({ text: opt.text, isCorrect: opt.isCorrect })), // Don't send votes initially to students
            duration: currentActivePoll.duration,
            startTime: currentActivePoll.startTime, // Send start time for accurate countdown on client
          },
          status: "active",
        })
      } else {
        socket.emit("newPoll", { poll: null, status: "no_active_poll" })
      }

      // Emit updated student list to all connected teachers
      emitStudentListUpdate()
    } catch (error) {
      console.error("Error handling studentJoin:", error)
      socket.emit("error", { message: "Failed to join session." })
    }
  })

  socket.on("submitAnswer", async ({ pollId, studentId, answer }) => {
    // Ensure studentId on the socket matches the submitted studentId to prevent spoofing
    if (socket.studentId !== studentId) {
      console.warn(
        `Socket ID mismatch for submitAnswer. Socket's studentId: ${socket.studentId}, Submitted studentId: ${studentId}`,
      )
      socket.emit("error", { message: "Authentication mismatch for submitting answer." })
      return
    }

    if (!currentActivePoll || currentActivePoll._id.toString() !== pollId) {
      console.log(`Attempted to answer inactive or wrong poll: ${pollId}`)
      socket.emit("error", { message: "No active poll or wrong poll ID." })
      return
    }

    try {
      const student = await Student.findOne({ studentId })
      if (!student || student.hasAnswered) {
        console.log(`Student ${studentId} already answered or not found for this poll.`)
        socket.emit("error", { message: "You have already answered this poll or are not a valid student." })
        return
      }

      // Find the option and increment its vote count
      const optionIndex = currentActivePoll.options.findIndex((opt) => opt.text === answer)
      console.log("optionIndex", optionIndex);
      if (optionIndex !== -1) {
        currentActivePoll.options[optionIndex].votes++
        console.log("currentActivePoll", currentActivePoll);
        await currentActivePoll.save() // Save the updated poll document

        student.hasAnswered = true // Mark student as answered for this poll
        await student.save()
        answeredStudentsCount++ // Increment global counter

        // Calculate total votes and percentages
        const totalVotes = currentActivePoll.options.reduce((sum, opt) => sum + opt.votes, 0)
        const optionsWithStats = currentActivePoll.options.map((opt) => ({
          text: opt.text,
          votes: opt.votes,
          isCorrect: opt.isCorrect,
          percentage: Math.round((opt.votes / totalVotes) * 100)
        }))

        console.log("optionsWithStats", optionsWithStats);

        // Emit updated poll results to all clients
        io.emit("pollUpdate", {
          poll: {
            _id: currentActivePoll._id,
            question: currentActivePoll.question,
            options: optionsWithStats,
            duration: currentActivePoll.duration,
            startTime: currentActivePoll.startTime,
            status: currentActivePoll.status
          },
          totalVoters: totalVotes,
          answeredCount: answeredStudentsCount,
          totalStudents: (await getActiveStudents()).length
        })

        // Update the student's status for the teacher's list
        emitStudentListUpdate()

        console.log(`Student ${student.name} (${studentId}) answered: ${answer}`)
      } else {
        console.warn(`Submitted answer '${answer}' not found in poll options.`)
        socket.emit("error", { message: "Invalid answer option." })
      }
    } catch (error) {
      console.error("Error submitting answer:", error)
      socket.emit("error", { message: "Failed to submit answer due to server error." })
    }
  })

  // --- Teacher Events ---
  socket.on("createPoll", async (pollData) => {
    if (currentActivePoll && currentActivePoll.status === "active") {
      socket.emit("error", { message: "A poll is already active. Please wait for it to complete or end it." })
      return
    }

    try {
      // Reset hasAnswered for all *currently connected* students for the new poll
      await Student.updateMany({ socketId: { $ne: null }, kicked: false }, { $set: { hasAnswered: false } })
      answeredStudentsCount = 0 // Reset answered count for new poll

      const newPoll = new Poll({
        question: pollData.question,
        options: pollData.options.map((opt) => ({
          text: opt.text,
          isCorrect: opt.isCorrect,
          votes: 0, // Initialize votes to 0 for a new poll
        })),
        duration: pollData.duration,
        status: "active",
        startTime: Date.now(), // Record start time for client-side countdown
      })
      await newPoll.save()
      currentActivePoll = newPoll

      // Clear any previous timer
      if (pollTimer) {
        clearTimeout(pollTimer)
      }

      // Set a timer to automatically complete the poll
      pollTimer = setTimeout(async () => {
        await endPoll(currentActivePoll._id)
      }, pollData.duration * 1000) // Convert seconds to milliseconds

      // Emit the new poll to all connected clients
      io.emit("newPoll", {
        poll: {
          _id: newPoll._id,
          question: newPoll.question,
          options: newPoll.options.map((opt) => ({ text: opt.text, isCorrect: opt.isCorrect })), // Students don't need votes initially
          duration: newPoll.duration,
          startTime: newPoll.startTime,
        },
        status: "active",
      })

      // Immediately send current live results to teachers (initialized to 0)
      io.emit("pollUpdate", {
        poll: currentActivePoll,
        answeredCount: answeredStudentsCount,
        totalStudents: (await getActiveStudents()).length,
      })

      // Update student list to reflect 'hasAnswered: false' for newly active students
      emitStudentListUpdate()

      console.log(`New poll created: "${newPoll.question}"`)
    } catch (error) {
      console.error("Error creating poll:", error)
      socket.emit("error", { message: "Failed to create poll." })
    }
  })

  socket.on("endPoll", async (pollId) => {
    try {
      await endPoll(pollId)
    } catch (error) {
      console.error("Error handling endPoll event:", error)
      socket.emit("error", { message: "Failed to end poll." })
    }
  })

  socket.on("kickStudent", async ({ studentId }) => {
    try {
      const student = await Student.findOne({ studentId })
      if (!student) {
        console.warn(`Attempted to kick non-existent student: ${studentId}`)
        socket.emit("error", { message: "Student not found." })
        return
      }

      // Mark student as kicked in the database
      student.kicked = true
      student.socketId = null // Clear the socket ID
      await student.save()

      console.log(`Student ${studentId} marked as kicked in DB.`)

      // Find the active socket for this student and disconnect it
      const connectedSockets = await io.fetchSockets()
      const targetSocket = connectedSockets.find((s) => s.studentId === studentId)

      if (targetSocket) {
        // Notify the student they've been kicked before disconnecting
        targetSocket.emit("studentKicked", { message: "You have been removed from this session by the teacher." })
        targetSocket.disconnect(true) // Force disconnect
        console.log(`Socket for student ${studentId} disconnected.`)
      }

      // Update student list for all teachers
      emitStudentListUpdate()

      // Send confirmation to the teacher
      socket.emit("studentKicked", { success: true, studentId })
    } catch (error) {
      console.error("Error kicking student:", error)
      socket.emit("error", { message: "Failed to kick student." })
    }
  })

  // --- Chat Events ---
  socket.on("sendMessage", (messageData) => {
    io.emit("chatMessage", {
      sender: messageData.sender,
      message: messageData.message,
      timestamp: new Date().toLocaleTimeString(),
    })
  })

  // --- Disconnect Event ---
  socket.on("disconnect", async (reason) => {
    console.log(`User disconnected: ${socket.id}, Reason: ${reason}`)
    try {
      // Find the student by their socketId and update their status
      // Set socketId to null to indicate they are no longer actively connected via this socket
      await Student.updateOne({ socketId: socket.id }, { $set: { socketId: null, lastSeen: new Date() } })

      // Re-emit updated student list to teachers
      emitStudentListUpdate()
    } catch (error) {
      console.error("Error handling disconnect:", error)
    }
  })
})

// Helper function to end a poll
async function endPoll(pollId) {
  if (!currentActivePoll || currentActivePoll._id.toString() !== pollId.toString()) {
    console.warn(`Attempted to end inactive or wrong poll: ${pollId}`)
    return
  }
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }

  currentActivePoll.status = "completed"
  currentActivePoll.completedAt = new Date()
  await currentActivePoll.save()

  // Calculate percentages for the final results
  const totalVotes = currentActivePoll.options.reduce((sum, opt) => sum + opt.votes, 0)
  const finalResults = {
    ...currentActivePoll.toObject(),
    options: currentActivePoll.options.map((opt) => ({
      ...opt.toObject(),
      percentage: totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0,
    })),
    totalVoters: totalVotes,
  }

  io.emit("pollEnded", finalResults) // Inform all clients the poll is over with final results
  currentActivePoll = null // Clear the active poll
  answeredStudentsCount = 0 // Reset for next poll

  // After poll ends, reset hasAnswered for all students for next poll cycle
  await Student.updateMany({}, { $set: { hasAnswered: false } })
  emitStudentListUpdate() // Update teacher's list

  console.log(`Poll ${pollId} completed.`)
  return finalResults
}

// Basic API route for past polls (for frontend to fetch initial history)
app.get("/api/polls/history", async (req, res) => {
  try {
    const pastPolls = await Poll.find({ status: "completed" }).sort({ createdAt: -1 })
    res.json(pastPolls)
  } catch (error) {
    console.error("Error fetching past polls:", error)
    res.status(500).json({ message: "Failed to fetch past polls." })
  }
})

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
