// // backend/server.js
// require("dotenv").config()
// const express = require("express")
// const http = require("http")
// const { Server } = require("socket.io")
// const mongoose = require("mongoose")
// const cors = require("cors")

// const Poll = require("./models/Poll")
// const Student = require("./models/Student")

// const app = express()
// const server = http.createServer(app)

// // Configure CORS for Socket.io and Express
// // IMPORTANT: Replace "http://localhost:3000" with your actual frontend URL in production
// const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000"

// const io = new Server(server, {
//   cors: {
//     origin: FRONTEND_URL,
//     methods: ["GET", "POST"],
//     credentials: true,
//   },
//   transports: ["websocket", "polling"], // Explicitly define transports
//   pingTimeout: 60000, // How long client can be unresponsive before disconnect
//   pingInterval: 25000, // How often server pings client
//   reconnectionAttempts: 5, // Number of attempts before giving up
//   reconnectionDelay: 1000, // How long to wait before next reconnection attempt
// })

// app.use(
//   cors({
//     origin: FRONTEND_URL,
//     credentials: true,
//   }),
// )
// app.use(express.json()) // For parsing JSON body

// const PORT = process.env.PORT || 4000
// const MONGODB_URI = process.env.MONGODB_URI

// // MongoDB Connection
// mongoose
//   .connect(MONGODB_URI)
//   .then(() => console.log("MongoDB connected successfully"))
//   .catch((err) => console.error("MongoDB connection error:", err))

// // Global variable to hold the current active poll
// let currentActivePoll = null
// let pollTimer = null // To manage the countdown
// let answeredStudentsCount = 0 // To track how many students have answered the current poll

// // Utility function to get active students
// const getActiveStudents = async () => {
//   try {
//     // Only return students who are not kicked AND have a non-null socketId
//     const students = await Student.find({ 
//       kickedAt: null,
//       isActive: true,
//       socketId: { $ne: null } 
//     });
//     console.log('Active students:', students.length);
//     return students;
//   } catch (error) {
//     console.error('Error getting active students:', error);
//     return [];
//   }
// }

// // Emit updated student list to all teachers
// const emitStudentListUpdate = async () => {
//   try {
//     // Get all students that are not kicked and are active
//     const students = await Student.find({
//       kickedAt: null,
//       isActive: true
//     });
    
//     // Emit the filtered list to all connected clients
//     io.emit("studentListUpdate", students);
//   } catch (error) {
//     console.error("Error emitting student list update:", error);
//   }
// };

// // Socket.io Logic
// io.on("connection", async (socket) => {
//   // Log connection, useful for debugging immediate disconnects
//   console.log(`User connected: ${socket.id}`)

//   // If socket.id was recovered (meaning it's a reconnection from a temporary disconnect)
//   if (socket.recovered) {
//     console.log(`Socket recovered connection: ${socket.id}`)
//   }

//   // Emit current student list to the newly connected socket
//   try {
//     const activeStudents = await getActiveStudents();
//     socket.emit("studentListUpdate", activeStudents);
//   } catch (error) {
//     console.error('Error sending initial student list:', error);
//   }

//   // --- Student Events ---
//   socket.on("studentJoin", async (data) => {
//     try {
//       // Check if student was previously kicked
//       const existingStudent = await Student.findOne({ 
//         studentId: data.studentId,
//         $or: [
//           { kickedAt: { $ne: null } },
//           { isActive: false }
//         ]
//       });

//       if (existingStudent) {
//         socket.emit("error", { 
//           message: "You have been removed from this session and cannot rejoin." 
//         });
//         socket.disconnect(true);
//         return;
//       }

//       // If not kicked, proceed with join
//       let student = await Student.findOne({ studentId: data.studentId });
      
//       if (student) {
//         student.socketId = socket.id;
//         student.name = data.name;
//         student.isActive = true;
//         student.lastSeen = new Date();
//         student.kickedAt = null; // Ensure kickedAt is null for active students
//         await student.save();
//       } else {
//         student = await Student.create({
//           studentId: data.studentId,
//           name: data.name,
//           socketId: socket.id,
//           isActive: true,
//           lastSeen: new Date(),
//           kickedAt: null
//         });
//       }

//       // Store student ID in socket for reference
//       socket.studentId = data.studentId;
      
//       // Emit updated student list
//       await emitStudentListUpdate();
      
//     } catch (error) {
//       console.error("Error handling student join:", error);
//       socket.emit("error", { message: "Failed to join session." });
//     }
//   })

//   socket.on("submitAnswer", async ({ pollId, studentId, answer }) => {
//     // Ensure studentId on the socket matches the submitted studentId to prevent spoofing
//     if (socket.studentId !== studentId) {
//       console.warn(
//         `Socket ID mismatch for submitAnswer. Socket's studentId: ${socket.studentId}, Submitted studentId: ${studentId}`,
//       )
//       socket.emit("error", { message: "Authentication mismatch for submitting answer." })
//       return
//     }

//     if (!currentActivePoll || currentActivePoll._id.toString() !== pollId) {
//       console.log(`Attempted to answer inactive or wrong poll: ${pollId}`)
//       socket.emit("error", { message: "No active poll or wrong poll ID." })
//       return
//     }

//     try {
//       const student = await Student.findOne({ studentId })
//       if (!student || student.hasAnswered) {
//         console.log(`Student ${studentId} already answered or not found for this poll.`)
//         socket.emit("error", { message: "You have already answered this poll or are not a valid student." })
//         return
//       }

//       // Find the option and increment its vote count
//       const optionIndex = currentActivePoll.options.findIndex((opt) => opt.text === answer)
//       console.log("optionIndex", optionIndex);
//       if (optionIndex !== -1) {
//         currentActivePoll.options[optionIndex].votes++
//         console.log("currentActivePoll", currentActivePoll);
//         await currentActivePoll.save() // Save the updated poll document

//         student.hasAnswered = true // Mark student as answered for this poll
//         await student.save()
//         answeredStudentsCount++ // Increment global counter

//         // Calculate total votes and percentages
//         const totalVotes = currentActivePoll.options.reduce((sum, opt) => sum + opt.votes, 0)
//         const optionsWithStats = currentActivePoll.options.map((opt) => ({
//           text: opt.text,
//           votes: opt.votes,
//           isCorrect: opt.isCorrect,
//           percentage: Math.round((opt.votes / totalVotes) * 100)
//         }))

//         console.log("optionsWithStats", optionsWithStats);

//         // Emit updated poll results to all clients
//         io.emit("pollUpdate", {
//           poll: {
//             _id: currentActivePoll._id,
//             question: currentActivePoll.question,
//             options: optionsWithStats,
//             duration: currentActivePoll.duration,
//             startTime: currentActivePoll.startTime,
//             status: currentActivePoll.status
//           },
//           totalVoters: totalVotes,
//           answeredCount: answeredStudentsCount,
//           totalStudents: (await getActiveStudents()).length
//         })

//         // Update the student's status for the teacher's list
//         await emitStudentListUpdate()

//         console.log(`Student ${student.name} (${studentId}) answered: ${answer}`)
//       } else {
//         console.warn(`Submitted answer '${answer}' not found in poll options.`)
//         socket.emit("error", { message: "Invalid answer option." })
//       }
//     } catch (error) {
//       console.error("Error submitting answer:", error)
//       socket.emit("error", { message: "Failed to submit answer due to server error." })
//     }
//   })

//   // --- Teacher Events ---
//   socket.on("createPoll", async (pollData) => {
//     if (currentActivePoll && currentActivePoll.status === "active") {
//       socket.emit("error", { message: "A poll is already active. Please wait for it to complete or end it." })
//       return
//     }

//     try {
//       // Reset hasAnswered for all non-kicked students for the new poll
//       await Student.updateMany(
//         { kickedAt: null, isActive: true }, 
//         { $set: { hasAnswered: false } }
//       );
//       answeredStudentsCount = 0; // Reset answered count for new poll

//       const newPoll = new Poll({
//         question: pollData.question,
//         options: pollData.options.map((opt) => ({
//           text: opt.text,
//           isCorrect: opt.isCorrect,
//           votes: 0, // Initialize votes to 0 for a new poll
//         })),
//         duration: pollData.duration,
//         status: "active",
//         startTime: Date.now(), // Record start time for client-side countdown
//       })
//       await newPoll.save()
//       currentActivePoll = newPoll

//       // Clear any previous timer
//       if (pollTimer) {
//         clearTimeout(pollTimer)
//       }

//       // Set a timer to automatically complete the poll
//       pollTimer = setTimeout(async () => {
//         await endPoll(currentActivePoll._id)
//       }, pollData.duration * 1000) // Convert seconds to milliseconds

//       // Emit the new poll to all connected clients
//       io.emit("newPoll", {
//         poll: {
//           _id: newPoll._id,
//           question: newPoll.question,
//           options: newPoll.options.map((opt) => ({ text: opt.text, isCorrect: opt.isCorrect })), // Students don't need votes initially
//           duration: newPoll.duration,
//           startTime: newPoll.startTime,
//         },
//         status: "active",
//       })

//       // Immediately send current live results to teachers (initialized to 0)
//       io.emit("pollUpdate", {
//         poll: currentActivePoll,
//         answeredCount: answeredStudentsCount,
//         totalStudents: (await getActiveStudents()).length,
//       })

//       // Update student list to reflect 'hasAnswered: false' for newly active students
//       await emitStudentListUpdate()

//       console.log(`New poll created: "${newPoll.question}"`)
//     } catch (error) {
//       console.error("Error creating poll:", error)
//       socket.emit("error", { message: "Failed to create poll." })
//     }
//   })

//   socket.on("endPoll", async (pollId) => {
//     try {
//       await endPoll(pollId)
//     } catch (error) {
//       console.error("Error handling endPoll event:", error)
//       socket.emit("error", { message: "Failed to end poll." })
//     }
//   })

//   socket.on("kickStudent", async ({ studentId }) => {
//     console.log("Kicking student:", studentId);
//     try {
//       // Update the student's status in the database
//       const student = await Student.findOneAndUpdate(
//         { studentId },
//         { 
//           $set: { 
//             socketId: undefined,
//             isActive: false,
//             kickedAt: new Date()
//           } 
//         },
//         { new: true }
//       );

//       if (!student) {
//         throw new Error("Student not found");
//       }

//       // Emit kick event to the specific student
//       const studentSocket = Array.from(io.sockets.sockets.values())
//         .find(s => s.id === student.socketId);
      
//       if (studentSocket) {
//         studentSocket.emit("studentKicked", { studentId });
//         studentSocket.disconnect(true);
//       }

//       // Update the active students list for all clients
//       await emitStudentListUpdate();

//       // Send confirmation to the teacher
//       socket.emit("studentKicked", { success: true, studentId });
//     } catch (error) {
//       console.error("Error kicking student:", error);
//       socket.emit("error", { message: "Failed to kick student." });
//     }
//   });

//   // --- Chat Events ---
//   socket.on("sendMessage", (messageData) => {
//     io.emit("chatMessage", {
//       sender: messageData.sender,
//       message: messageData.message,
//       timestamp: new Date().toLocaleTimeString(),
//     })
//   })

//   // --- Disconnect Event ---
//   socket.on("disconnect", async (reason) => {
//     console.log(`User disconnected: ${socket.id}, Reason: ${reason}`);
//     try {
//       // Find the student by their socketId and update their status
//       const student = await Student.findOne({ socketId: socket.id });
      
//       if (student) {
//         // Only update socketId, preserve other student data
//         await Student.updateOne(
//           { socketId: socket.id },
//           { 
//             $set: { 
//               socketId: null, 
//               lastSeen: new Date(),
//               isActive: false 
//             } 
//           }
//         );

//         // Re-emit updated student list to all clients
//         await emitStudentListUpdate();
//       }
//     } catch (error) {
//       console.error("Error handling disconnect:", error);
//     }
//   });
// })

// // Helper function to end a poll
// async function endPoll(pollId) {
//   if (!currentActivePoll || currentActivePoll._id.toString() !== pollId.toString()) {
//     console.warn(`Attempted to end inactive or wrong poll: ${pollId}`)
//     return
//   }
//   if (pollTimer) {
//     clearTimeout(pollTimer)
//     pollTimer = null
//   }

//   currentActivePoll.status = "completed"
//   currentActivePoll.completedAt = new Date()
//   await currentActivePoll.save()

//   // Calculate percentages for the final results
//   const totalVotes = currentActivePoll.options.reduce((sum, opt) => sum + opt.votes, 0)
//   const finalResults = {
//     ...currentActivePoll.toObject(),
//     options: currentActivePoll.options.map((opt) => ({
//       ...opt.toObject(),
//       percentage: totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0,
//     })),
//     totalVoters: totalVotes,
//   }

//   io.emit("pollEnded", finalResults) // Inform all clients the poll is over with final results
//   currentActivePoll = null // Clear the active poll
//   answeredStudentsCount = 0 // Reset for next poll

//   // After poll ends, reset hasAnswered for all students for next poll cycle
//   await Student.updateMany({}, { $set: { hasAnswered: false } })
//   await emitStudentListUpdate() // Update teacher's list

//   console.log(`Poll ${pollId} completed.`)
//   return finalResults
// }

// // Basic API route for past polls (for frontend to fetch initial history)
// app.get("/api/polls/history", async (req, res) => {
//   try {
//     const pastPolls = await Poll.find({ status: "completed" }).sort({ createdAt: -1 })
//     res.json(pastPolls)
//   } catch (error) {
//     console.error("Error fetching past polls:", error)
//     res.status(500).json({ message: "Failed to fetch past polls." })
//   }
// })

// // Start the server
// server.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`)
// })

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
  try {
    // Only return students who are not kicked AND have a non-null socketId
    const students = await Student.find({
      kickedAt: null,
      isActive: true,
      socketId: { $ne: null },
    })
    console.log("Active students:", students.length)
    return students
  } catch (error) {
    console.error("Error getting active students:", error)
    return []
  }
}

// Emit updated student list to all teachers
const emitStudentListUpdate = async () => {
  try {
    // Get all students that are not kicked and are active
    const students = await Student.find({
      kickedAt: null,
      isActive: true,
    })

    // Emit the filtered list to all connected clients
    io.emit("studentListUpdate", students)
  } catch (error) {
    console.error("Error emitting student list update:", error)
  }
}

// Socket.io Logic
io.on("connection", async (socket) => {
  // Log connection, useful for debugging immediate disconnects
  console.log(`User connected: ${socket.id}`)

  // If socket.id was recovered (meaning it's a reconnection from a temporary disconnect)
  if (socket.recovered) {
    console.log(`Socket recovered connection: ${socket.id}`)
  }

  // Emit current student list to the newly connected socket
  try {
    const activeStudents = await getActiveStudents()
    socket.emit("studentListUpdate", activeStudents)
  } catch (error) {
    console.error("Error sending initial student list:", error)
  }

  // --- Student Events ---
  socket.on("studentJoin", async (data) => {
    try {
      // Check if student was previously kicked
      const existingStudent = await Student.findOne({
        studentId: data.studentId,
        $or: [{ kickedAt: { $ne: null } }, { isActive: false }],
      })

      if (existingStudent) {
        socket.emit("error", {
          message: "You have been removed from this session and cannot rejoin.",
        })
        socket.disconnect(true)
        return
      }

      // If not kicked, proceed with join
      let student = await Student.findOne({ studentId: data.studentId })

      if (student) {
        student.socketId = socket.id
        student.name = data.name
        student.isActive = true
        student.lastSeen = new Date()
        student.kickedAt = null // Ensure kickedAt is null for active students
        await student.save()
      } else {
        student = await Student.create({
          studentId: data.studentId,
          name: data.name,
          socketId: socket.id,
          isActive: true,
          lastSeen: new Date(),
          kickedAt: null,
        })
      }

      // Store student ID in socket for reference
      socket.studentId = data.studentId

      // Emit updated student list
      await emitStudentListUpdate()
    } catch (error) {
      console.error("Error handling student join:", error)
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
      console.log("optionIndex", optionIndex)
      if (optionIndex !== -1) {
        currentActivePoll.options[optionIndex].votes++
        console.log("currentActivePoll", currentActivePoll)
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
          percentage: Math.round((opt.votes / totalVotes) * 100),
        }))

        console.log("optionsWithStats", optionsWithStats)

        // Emit updated poll results to all clients
        io.emit("pollUpdate", {
          poll: {
            _id: currentActivePoll._id,
            question: currentActivePoll.question,
            options: optionsWithStats,
            duration: currentActivePoll.duration,
            startTime: currentActivePoll.startTime,
            status: currentActivePoll.status,
          },
          totalVoters: totalVotes,
          answeredCount: answeredStudentsCount,
          totalStudents: (await getActiveStudents()).length,
        })

        // Update the student's status for the teacher's list
        await emitStudentListUpdate()

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
      // Reset hasAnswered for all non-kicked students for the new poll
      await Student.updateMany({ kickedAt: null, isActive: true }, { $set: { hasAnswered: false } })
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
      await emitStudentListUpdate()

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
    console.log("Kicking student:", studentId)
    try {
      // First, find the student to get their current socketId
      const student = await Student.findOne({ studentId })

      if (!student) {
        throw new Error("Student not found")
      }

      // Find the student's socket BEFORE updating the database
      const studentSocket = Array.from(io.sockets.sockets.values()).find((s) => s.studentId === studentId)

      // Emit kick event to the specific student FIRST
      if (studentSocket) {
        studentSocket.emit("studentKicked", { studentId })
        // Give a small delay to ensure the message is sent before disconnect
        setTimeout(() => {
          studentSocket.disconnect(true)
        }, 100)
      }

      // Now update the student's status in the database
      await Student.findOneAndUpdate(
        { studentId },
        {
          $set: {
            socketId: null,
            isActive: false,
            kickedAt: new Date(),
          },
        },
        { new: true },
      )

      // Update the active students list for all clients
      await emitStudentListUpdate()

      // Send confirmation to the teacher
      socket.emit("studentKicked", { success: true, studentId })

      console.log(`Student ${studentId} has been kicked successfully`)
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
      const student = await Student.findOne({ socketId: socket.id })

      if (student) {
        // Only update socketId, preserve other student data
        await Student.updateOne(
          { socketId: socket.id },
          {
            $set: {
              socketId: null,
              lastSeen: new Date(),
              isActive: false,
            },
          },
        )

        // Re-emit updated student list to all clients
        await emitStudentListUpdate()
      }
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
  await emitStudentListUpdate() // Update teacher's list

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

