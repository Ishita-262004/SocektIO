const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: { origin: "*" } //// allow Unity
});

const rooms = {};


const lobbies = {
    // tournamentId : {
    //   users: {},
    //   lobbyTime,
    //   lobbyInterval
    // }
};
const tournamentResults = {};
const tournamentState = {
    // tournamentId: "waiting" | "running" | "finished"
};


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
            tournamentState[tournamentId] = "waiting";
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
        }

        rooms[roomId].users[socket.id] = username;
     

        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId].users
        });

     
    });

    socket.on("TOURNAMENT_PLAYER_RESULT", ({ tournamentId, coins }) => {
        console.log("RESULT RECEIVED:", tournamentId, coins);

        if (!tournamentResults[tournamentId])
            tournamentResults[tournamentId] = {};

        const username = lobbies[tournamentId]?.users[socket.id];
        if (!username) return;

        tournamentResults[tournamentId][username] = coins;

        const receivedCount =
            Object.keys(tournamentResults[tournamentId]).length;

        const expectedCount =
            Object.keys(lobbies[tournamentId].users).length;

        console.log(
            `RESULT COUNT ${receivedCount}/${expectedCount}`
        );

        if (receivedCount === expectedCount) {
            sendTournamentResult(tournamentId);
        }
    });

    socket.on("TOURNAMENT_COIN_UPDATE", ({ username, coins }) => {
        for (const roomId in rooms) {
            if (rooms[roomId].users[socket.id]) {
                io.to(roomId).emit("TOURNAMENT_COIN_UPDATE", {
                    username,
                    coins
                });
            }
        }
    });

    socket.on("LEAVE_GAME", ({ roomId }) => {

        console.log("Player left game:", socket.id, "room:", roomId);

        // remove from room users
        if (rooms[roomId]) {
            delete rooms[roomId].users[socket.id];
        }

        socket.leave(roomId);

        // notify remaining players
        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId]?.users 
        });

      
    });



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

            if (Object.keys(lobby.users).length === 0) {

                if (lobby.lobbyInterval) {
                    clearInterval(lobby.lobbyInterval);
                }

                if (tournamentTimers[tId]) {
                    clearInterval(tournamentTimers[tId]);
                    delete tournamentTimers[tId];
                }

                delete tournamentState[tId];
                delete lobbies[tId];

                console.log("Tournament reset:", tId);
            }
        }
    });

});

const LOBBY_TIME = 40; 
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

function createMatches(tournamentId) {

    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    lobby.gameStarted = true;
    tournamentState[tournamentId] = "running";
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
        startTournamentTimer(tournamentId);
    }
}

const TOURNAMENT_TIME = 100;
const ROUND_TIME = 40;
const tournamentTimers = {};
const tournamentState = {};

function startTournamentTimer(tournamentId) {
    let lastRound = 1;

    // RESET state if new
    if (!tournamentState[tournamentId]) {
        tournamentState[tournamentId] = {
            startTime: Date.now()
        };
    }

   
    if (tournamentTimers[tournamentId]) return;

    const startTime = tournamentState[tournamentId].startTime;
    const endTime = startTime + TOURNAMENT_TIME * 1000;

    tournamentTimers[tournamentId] = setInterval(() => {

        const now = Date.now();

        const tournamentTime =
            Math.max(0, Math.ceil((endTime - now) / 1000));

        const elapsed = Math.floor((now - startTime) / 1000);

        const round = Math.floor(elapsed / ROUND_TIME) + 1;
        const roundTime = Math.max(1, ROUND_TIME - (elapsed % ROUND_TIME));

        io.to(tournamentId).emit("TOURNAMENT_STATE", {
            tournamentTime,
            round,
            roundTime
        });

        if (round !== lastRound) {
            io.to(tournamentId).emit("ROUND_ENDED", { round: lastRound });
            lastRound = round;
        }
        if (tournamentTime <= 0) {
            clearInterval(tournamentTimers[tournamentId]);
            console.log("Tournament ended. Waiting for player results...");
        }

    }, 1000);
}

function sendTournamentResult(tournamentId) {
    tournamentState[tournamentId] = "finished";
    for (const roomId in rooms) {
        if (roomId.startsWith(tournamentId)) {
            io.to(roomId).emit(
                "TOURNAMENT_RESULT",
                tournamentResults[tournamentId] || {}
            );
        }
    }

    setTimeout(() => {
        delete lobbies[tournamentId];
        delete tournamentResults[tournamentId];
        delete tournamentTimers[tournamentId];
        delete tournamentState[tournamentId];
        console.log("Tournament fully cleaned:", tournamentId);
    }, 10000);
}

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log("Matchmaking Server start on port", PORT);
});

