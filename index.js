const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const rooms = {};
const lobbies = {};
const roomResults = {};
const liveCoins = {};
const restarting = {};
const tournamentTimers = {};
const tournamentState = {};

const LOBBY_TIME = 40;
const TOURNAMENT_TIME = 100;

// ------------------- SOCKET CONNECTION -------------------
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("USERNAME", ({ username, avatar, tournamentId }) => {
        if (!lobbies[tournamentId]) {
            lobbies[tournamentId] = {
                users: {},
                waitingUsers: {},
                lobbyTime: LOBBY_TIME,
                lobbyInterval: null,
                gameStarted: false,
                currentRoomId: null,
                roundProcessed: {},
                resultTimeRunning: false
            };
        }

        const lobby = lobbies[tournamentId];

        // Prevent entry during result calculation
        if (lobby.resultTimeRunning) {
            socket.emit("LOBBY_CLOSED", { msg: "Tournament result is being calculated. Please wait!" });
            return;
        }

        // Tournament already started → add to waiting users
        if (lobby.gameStarted) {
            lobby.waitingUsers[username] = { username, avatar, socketId: socket.id };
            socket.join(tournamentId);

            io.to(tournamentId).emit("USER_LIST", { ...lobby.users, ...lobby.waitingUsers });
            socket.emit("WAITING_STATE", { msg: "Tournament in progress. You will enter next round." });

            console.log(username, "joined waiting list");
            return;
        }

        // Add or reconnect user
        lobby.users[username] = { username, avatar, socketId: socket.id, disconnected: false };
        socket.join(tournamentId);

        io.to(tournamentId).emit("USER_LIST", { ...lobby.users, ...lobby.waitingUsers });
        startLobbyTimer(tournamentId);
    });

    socket.on("GET_LOBBY_USERS", ({ tournamentId }) => {
        const lobby = lobbies[tournamentId];
        if (!lobby) return;
        socket.emit("USER_LIST", { ...lobby.users, ...lobby.waitingUsers });
    });

    socket.on("JOIN_ROOM", ({ roomId, username }) => {
        const tournamentId = roomId.split("_ROOM_")[0];
        const lobby = lobbies[tournamentId];

        if (lobby) {
            delete lobby.users[username];
            delete lobby.waitingUsers[username];
            io.to(tournamentId).emit("USER_LIST", { ...lobby.users, ...lobby.waitingUsers });
        }

        if (!rooms[roomId]) rooms[roomId] = { users: {} };
        rooms[roomId].users[username] = { socketId: socket.id };
        socket.join(roomId);

        if (!restarting[roomId]) {
            io.to(roomId).emit("ROOM_USERS", { users: rooms[roomId].users });
        }
    });

    socket.on("TOURNAMENT_PLAYER_RESULT", ({ roomId, username, coins }) => {
        if (!rooms[roomId]) return;

        if (!roomResults[roomId]) roomResults[roomId] = {};
        roomResults[roomId][username] = coins;

        const expected = Object.keys(rooms[roomId].users).length;
        const received = Object.keys(roomResults[roomId]).length;

        if (expected > 0 && received === expected) {
            io.to(roomId).emit("TOURNAMENT_RESULT", roomResults[roomId]);
            const tournamentId = roomId.split("_ROOM_")[0];
            startResultTimer(tournamentId, roomId);
        }
    });

    socket.on("TOURNAMENT_COIN_UPDATE", ({ username, roomId, coins }) => {
        if (!liveCoins[roomId]) liveCoins[roomId] = {};
        liveCoins[roomId][username] = coins;
        io.to(roomId).emit("TOURNAMENT_COIN_UPDATE", { username, coins });

        const tournamentId = roomId.split("_ROOM_")[0];
        const lobby = lobbies[tournamentId];
        if (lobby && lobby.waitingUsers) {
            for (const wUser in lobby.waitingUsers) {
                const s = io.sockets.sockets.get(lobby.waitingUsers[wUser].socketId);
                if (s) s.emit("TOURNAMENT_COIN_UPDATE", { username, coins });
            }
        }
    });

    socket.on("LEAVE_GAME", ({ roomId, username }) => {
        const tournamentId = roomId.split("_ROOM_")[0];
        const lobby = lobbies[tournamentId];

        removeUserEverywhere(username, socket.id);
        socket.leave(roomId);

        if (lobby && lobby.gameStarted && Object.keys(rooms[roomId]?.users || {}).length === 0) {
            console.log("Last user left running tournament → RESET");
            resetTournament(tournamentId);
        }

        io.to(roomId).emit("ROOM_USERS", { users: rooms[roomId]?.users });
    });

    socket.on("LEAVE_LOBBY", ({ tournamentId, username }) => {
        const lobby = lobbies[tournamentId];
        if (!lobby) return;

        if (!lobby.gameStarted) removeUserEverywhere(username, socket.id);
        socket.leave(tournamentId);

        const totalPlayers = Object.keys(lobby.users).length + Object.keys(lobby.waitingUsers).length;
        if (lobby.gameStarted && totalPlayers === 0) resetTournament(tournamentId);

        io.to(tournamentId).emit("USER_LIST", { ...lobby.users, ...lobby.waitingUsers });
    });

    socket.on("disconnect", () => {
        setTimeout(() => {
            removeUserEverywhere(null, socket.id);
        }, 3000);
    });
});

// ------------------- LOBBY TIMER -------------------
function startLobbyTimer(tournamentId) {
    const lobby = lobbies[tournamentId];
    if (!lobby || lobby.lobbyInterval) return;

    lobby.lobbyTime = LOBBY_TIME;
    lobby.lobbyInterval = setInterval(() => {
        lobby.lobbyTime--;
        io.to(tournamentId).emit("LOBBY_TIMER", { time: lobby.lobbyTime });

        if (lobby.lobbyTime <= 0) {
            clearInterval(lobby.lobbyInterval);
            lobby.lobbyInterval = null;
            createMatches(tournamentId);
        }
    }, 1000);
}

// ------------------- MATCH CREATION -------------------
function createMatches(tournamentId) {
    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    lobby.gameStarted = true;
    const usernames = Object.keys(lobby.users);
    const roomId = tournamentId + "_ROOM_1";

    rooms[roomId] = { users: {} };
    lobby.currentRoomId = roomId;
    liveCoins[roomId] = {};
    roomResults[roomId] = {};

    usernames.forEach(username => {
        const user = lobby.users[username];
        const s = io.sockets.sockets.get(user.socketId);
        if (!s) return;
        s.join(roomId);
        rooms[roomId].users[username] = { username, avatar: user.avatar, socketId: user.socketId };
    });

    io.to(roomId).emit("ROOM_USERS", { users: rooms[roomId].users });
    io.to(roomId).emit("MATCH_FOUND", { roomId, players: Object.values(rooms[roomId].users) });
    io.to(tournamentId).emit("USER_LIST", { ...lobby.users, ...lobby.waitingUsers });

    startTournamentTimer(tournamentId);
}

// ------------------- RESULT TIMER -------------------
function startResultTimer(tournamentId, roomId) {
    let resultTime = 15;
    const lobby = lobbies[tournamentId];
    lobby.resultTimeRunning = true;
    io.to(tournamentId).emit("LOBBY_CLOSED");

    const interval = setInterval(() => {
        io.to(roomId).emit("RESULT_TIMER", { resultTime });
        resultTime--;

        if (resultTime < 0) {
            clearInterval(interval);
            lobby.resultTimeRunning = false;

            const finalScores = roomResults[roomId] || {};
            const ranking = Object.keys(finalScores)
                .sort((a, b) => finalScores[b] - finalScores[a])
                .map((username, index) => ({ username, rank: index + 1 }));

            io.to(roomId).emit("PRIZE_RANK", ranking);
            io.to(tournamentId).emit("PRIZE_RANK", ranking);
            io.to(roomId).emit("LOBBY_OPEN");
            io.to(tournamentId).emit("LOBBY_OPEN");

            startTournamentAgain(tournamentId, roomId);
        }
    }, 1000);
}

// ------------------- TOURNAMENT RESTART -------------------
function startTournamentAgain(tournamentId, roomId) {
    console.log("Restarting tournament in SAME ROOM:", roomId);

    hardResetRoom(roomId);

    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    // Merge waiting users
    for (const username in lobby.waitingUsers) {
        const user = lobby.waitingUsers[username];
        const s = io.sockets.sockets.get(user.socketId);
        if (!s) continue;
        s.join(roomId);
        rooms[roomId].users[username] = { username: user.username, avatar: user.avatar, socketId: user.socketId };
        lobby.users[username] = user;
    }
    lobby.waitingUsers = {};

    lobby.gameStarted = true;
    lobby.resultTimeRunning = false;
    lobby.currentRoomId = roomId;
    restarting[roomId] = true;

    // Reset coins & results
    for (const username in rooms[roomId].users) {
        liveCoins[roomId][username] = 0;
        roomResults[roomId][username] = 0;
        rooms[roomId].users[username].coins = 0;
    }

    io.to(roomId).emit("MATCH_FOUND", { roomId, players: Object.values(rooms[roomId].users) });

    setTimeout(() => {
        restarting[roomId] = false;
        io.to(roomId).emit("ROOM_USERS", { users: rooms[roomId].users });
        for (const username in rooms[roomId].users) {
            io.to(roomId).emit("TOURNAMENT_COIN_UPDATE", { username, coins: 0 });
        }

        startTournamentTimer(tournamentId); // ✅ Start next tournament round
    }, 2000);
}

// ------------------- HELPER FUNCTIONS -------------------
function hardResetRoom(roomId) {
    liveCoins[roomId] = {};
    roomResults[roomId] = {};
    if (rooms[roomId]?.users) {
        for (const u in rooms[roomId].users) rooms[roomId].users[u].coins = 0;
    }
}

function removeUserEverywhere(username, socketId) {
    // Find missing username by socketId
    if (!username && socketId) {
        for (const tId in lobbies) {
            const lobby = lobbies[tId];
            for (const u in lobby.users) if (lobby.users[u].socketId === socketId) username = u;
            for (const u in lobby.waitingUsers) if (lobby.waitingUsers[u].socketId === socketId) username = u;
        }
    }
    if (!username) return;

    for (const tId in lobbies) {
        const lobby = lobbies[tId];
        delete lobby.users[username];
        delete lobby.waitingUsers[username];
    }

    for (const roomId in rooms) {
        delete rooms[roomId].users[username];
        delete liveCoins?.[roomId]?.[username];
        delete roomResults?.[roomId]?.[username];
    }
}

// ------------------- TOURNAMENT TIMER -------------------
function startTournamentTimer(tournamentId) {
    if (tournamentTimers[tournamentId]) {
        clearInterval(tournamentTimers[tournamentId]);
    }

    tournamentState[tournamentId] = { startTime: Date.now() };
    const startTime = tournamentState[tournamentId].startTime;
    const endTime = startTime + TOURNAMENT_TIME * 1000;

    tournamentTimers[tournamentId] = setInterval(() => {
        const now = Date.now();
        const tournamentTime = Math.max(0, Math.ceil((endTime - now) / 1000));
        io.to(tournamentId).emit("TOURNAMENT_STATE", { tournamentTime });

        if (tournamentTime <= 0) {
            clearInterval(tournamentTimers[tournamentId]);
            delete tournamentTimers[tournamentId];

            const lobby = lobbies[tournamentId];
            if (lobby && lobby.currentRoomId) startResultTimer(tournamentId, lobby.currentRoomId);
        }
    }, 1000);
}

// ------------------- START SERVER -------------------
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Matchmaking Server started on port", PORT));