const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: { origin: "*" } //// allow Unity
});

//const users = {}; // socket.id -> username
const rooms = {};
const playerHealth = {}; // socket.id -> health
const roomScores = {}; // roomId -> { socketId: score }

const lobbies = {
    // tournamentId : {
    //   users: {},
    //   lobbyTime,
    //   lobbyInterval
    // }
};
const finishedRooms = new Set();


io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("USERNAME", ({ username, tournamentId }) => {

        if (!lobbies[tournamentId]) {
            lobbies[tournamentId] = {
                users: {},
                lobbyTime: LOBBY_TIME,
                lobbyInterval: null,
                gameStarted: false
            };
        }
        const lobby = lobbies[tournamentId];

        if (lobby.gameStarted) {
            socket.emit("LOBBY_CLOSED");
            return;
        }
        lobbies[tournamentId].users[socket.id] = username;

        socket.join(tournamentId);

        io.to(tournamentId).emit("USER_LIST", lobbies[tournamentId].users);

        startLobbyTimer(tournamentId);
    });

    socket.on("GET_LOBBY_USERS", ({ tournamentId }) => {
        if (!lobbies[tournamentId]) return;

        socket.emit("USER_LIST", lobbies[tournamentId].users);
    });

   

    socket.on("JOIN_ROOM", ({ roomId }) => {

        let username = null;

        for (const tId in lobbies) {
            if (lobbies[tId].users[socket.id]) {
                username = lobbies[tId].users[socket.id];
                break;
            }
        }
        if (!username) return;


        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = { users: {} };
            roomScores[roomId] = {};
        }

        rooms[roomId].users[socket.id] = username;
        roomScores[roomId][socket.id] = 0;
        playerHealth[socket.id] = 100;

        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId].users
        });

     
    });

  
    

    socket.on("LEAVE_GAME", ({ roomId }) => {

        console.log("Player left game:", socket.id, "room:", roomId);

        // remove from room users
        if (rooms[roomId]) {
            delete rooms[roomId].users[socket.id];
            delete roomScores[roomId][socket.id];
        }

        delete playerHealth[socket.id];

        socket.leave(roomId);

        // notify remaining players
        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId]?.users || {}
        });

        io.to(roomId).emit("SCORE_UPDATE", {
            scores: roomScores[roomId] || {},
            users: rooms[roomId]?.users || {}
        });
    });

   /* socket.on("GET_USERS", () => {
        socket.emit("USER_LIST", users);
    });*/

    socket.on("disconnect", () => {
        for (const tId in lobbies) {
            const lobby = lobbies[tId];

            delete lobby.users[socket.id];
            io.to(tId).emit("USER_LIST", lobby.users);

            if (Object.keys(lobby.users).length === 0) {
                if (lobby.lobbyInterval) {
                    clearInterval(lobby.lobbyInterval);
                }

                delete lobbies[tId]; 
                console.log("Lobby reset:", tId);
            }
        }
    });



});

const LOBBY_TIME = 50; 
let lobbyTime = LOBBY_TIME;
let lobbyInterval = null;

function startLobbyTimer(tournamentId) {

    const lobby = lobbies[tournamentId];
    if (lobby.lobbyInterval) return;

    lobby.lobbyInterval = setInterval(() => {

        lobby.lobbyTime--;

        io.to(tournamentId).emit("LOBBY_TIMER", {
            time: lobby.lobbyTime
        });

        if (lobby.lobbyTime <= 0) {
            clearInterval(lobby.lobbyInterval);
            lobby.lobbyInterval = null;

            createMatches(tournamentId);
        }

    }, 1000);
}

const PLAYERS_PER_MATCH = 2;
//const matches = {}; // roomId -> players

function createMatches(tournamentId) {

    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    lobby.gameStarted = true;

    const lobbyUsers = Object.keys(lobbies[tournamentId].users);
    const sockets = lobbyUsers.map(id => io.sockets.sockets.get(id));

    for (let i = 0; i < sockets.length; i += PLAYERS_PER_MATCH) {

        const group = sockets.slice(i, i + PLAYERS_PER_MATCH);
        if (group.length < PLAYERS_PER_MATCH) break;

        const roomId = tournamentId + "_ROOM_" + Date.now();

        group.forEach(s => s.join(roomId));

        io.to(roomId).emit("MATCH_FOUND", {
            roomId,
            players: group.map(s => lobbies[tournamentId].users[s.id])
        });

        startGameTimer(roomId);

    }
}

const GAME_TIME = 300; // 5 minutes in seconds
const gameTimers = {}; // roomId -> { time, interval }

function startGameTimer(roomId) {

    if (gameTimers[roomId]) return;

    gameTimers[roomId] = {
        time: GAME_TIME,
        interval: setInterval(() => {

            gameTimers[roomId].time--;

            io.to(roomId).emit("GAME_TIMER", {
                time: gameTimers[roomId].time
            });

            if (gameTimers[roomId].time <= 0) {
                endGame(roomId);
            }

        }, 1000)
    };
}

function endGame(roomId) {

    clearInterval(gameTimers[roomId].interval);
    delete gameTimers[roomId];

    io.to(roomId).emit("GAME_OVER", {
        scores: roomScores[roomId] || {}
    });

    setTimeout(() => {
        delete rooms[roomId];
        delete roomScores[roomId];
        finishedRooms.delete(roomId);
    }, 5000);

    const tournamentId = roomId.split("_ROOM_")[0];
    delete lobbies[tournamentId];
}

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log("Matchmaking Server start on port", PORT);
});

