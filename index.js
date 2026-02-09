const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: { origin: "*" } //// allow Unity
});

const rooms = {};

const lobbies = {
    // tournamentId : {
    // users: {},
    // lobbyTime,
    // lobbyInterval
    // }
};

const tournamentResults = {};
const roomResults = {};


io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("USERNAME", ({ username, avatar, tournamentId }) => {

        if (!lobbies[tournamentId]) {
            lobbies[tournamentId] = {
                users: {},
                lobbyTime: LOBBY_TIME,
                lobbyInterval: null,
                gameStarted: false,
                waitingUsers: {}
            };
        }

        const lobby = lobbies[tournamentId];
        // If tournament already started → move new players into waiting list
        if (lobby.gameStarted === true) {

            lobby.waitingUsers[username] = {
                username,
                avatar,
                socketId: socket.id
            };

            socket.join(tournamentId);

            socket.emit("WAITING_STATE", {
                msg: "Tournament in progress. You will enter next round."
            });

            console.log(username, "joined waiting list");

            return; // VERY IMPORTANT — do not add to lobby.users
        }

        if (lobby.users[username]) {
            lobby.users[username].socketId = socket.id;
            lobby.users[username].disconnected = false;
        }
        else {
            lobby.users[username] = {
                username,
                avatar,
                socketId: socket.id,
                disconnected: false
            };
        }

        socket.join(tournamentId);
        io.to(tournamentId).emit("USER_LIST", lobby.users);
        startLobbyTimer(tournamentId);

    });


    socket.on("GET_LOBBY_USERS", ({ tournamentId }) => {
        if (!lobbies[tournamentId]) return;
        socket.emit("USER_LIST", lobbies[tournamentId].users);
    });

    socket.on("JOIN_ROOM", ({ roomId, username }) => {

        if (!rooms[roomId])
            rooms[roomId] = { users: {} };

        rooms[roomId].users[username] = {
            ...rooms[roomId].users[username],
            socketId: socket.id
        };
        // FULL FIX: CLEAR OLD RESULTS WHEN USER ENTERS ROOM AGAIN
        if (!roomResults[roomId])
            roomResults[roomId] = {};
        else
            delete roomResults[roomId][username];

        socket.join(roomId);

        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId].users
        });
    });


  
    socket.on("TOURNAMENT_PLAYER_RESULT", ({ roomId, username, coins }) => {

        if (!roomResults[roomId])
            roomResults[roomId] = {};

        roomResults[roomId][username] = coins;

        const expected = Object.keys(rooms[roomId]?.users || {}).length;
        const received = Object.keys(roomResults[roomId]).length;

        if (expected > 0 && received === expected) {

            io.to(roomId).emit(
                "TOURNAMENT_RESULT",
                roomResults[roomId]
            );

            const tournamentId = roomId.split("_ROOM_")[0];

            setTimeout(() => {
                resetTournament(tournamentId);
            }, 2000);
        }
    });



    socket.on("TOURNAMENT_COIN_UPDATE", ({ username, roomId, coins }) => {
        if (rooms[roomId] && rooms[roomId].users[username]) {
            io.to(roomId).emit("TOURNAMENT_COIN_UPDATE", { username, coins });
        }
    });


    socket.on("LEAVE_GAME", ({ roomId, username }) => {
        if (rooms[roomId]) {
            delete rooms[roomId].users[username];

        }
       
        socket.leave(roomId);

        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId]?.users
        });
    });


    socket.on("LEAVE_LOBBY", ({ tournamentId }) => {
        const lobby = lobbies[tournamentId];
        if (!lobby) return;

        let removed = false;

        for (const username in lobby.users) {
            if (lobby.users[username].socketId === socket.id) {
                delete lobby.users[username];
                removed = true;
                break;
            }
        }

        socket.leave(tournamentId);

        io.to(tournamentId).emit("USER_LIST", lobby.users);

        console.log("User left lobby:", socket.id);

        if (Object.keys(lobby.users).length === 0) {
            resetTournament(tournamentId);
        }
    });

    socket.on("disconnect", () => {
        for (const tId in lobbies) {
            const lobby = lobbies[tId];

            for (const username in lobby.users) {
                if (lobby.users[username].socketId === socket.id) {

                    // DELETE USER WHEN APP CLOSES
                    delete lobby.users[username];
                    console.log("User fully removed:", username);

                    io.to(tId).emit("USER_LIST", lobby.users);

                    // IF NO USER LEFT → RESET TOURNAMENT
                    if (Object.keys(lobby.users).length === 0) {
                        resetTournament(tId);
                    }

                    break;
                }
            }
        }
    });

});

const LOBBY_TIME = 40;

function startLobbyTimer(tournamentId) {
    const lobby = lobbies[tournamentId];
    if (lobby.lobbyInterval) return;

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

//const PLAYERS_PER_MATCH = 1;

function createMatches(tournamentId) {
    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    lobby.gameStarted = true;

    const usernames = Object.keys(lobby.users);

    for (let i = 0; i < usernames.length; i++ /*+= PLAYERS_PER_MATCH*/) {
        const group = usernames.slice(i, /*i + PLAYERS_PER_MATCH*/);
      //  if (group.length < PLAYERS_PER_MATCH) break;

        const roomId = tournamentId + "_ROOM_" + Date.now();

        rooms[roomId] = { users: {} };
        lobby.currentRoomId = roomId;
       // group.forEach(username =>
            usernames.forEach(username => {
            const user = lobby.users[username];
            const s = io.sockets.sockets.get(user.socketId);
            if (!s) return;

            s.join(roomId);

            rooms[roomId].users[username] = {
                username: user.username,
                avatar: user.avatar,
                socketId: user.socketId
            };
        });

        // SEND ROOM USERS
        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId].users
        });

        // SEND MATCH FOUND
        io.to(roomId).emit("MATCH_FOUND", {
            roomId,
            players: group.map(u => lobby.users[u])
        });

        startTournamentTimer(tournamentId);
    }
}


const TOURNAMENT_TIME = 100;
const ROUND_TIME = 40;

const tournamentTimers = {};
const tournamentState = {};

function startTournamentTimer(tournamentId) {

    const lobby = lobbies[tournamentId];   // ⭐ REQUIRED

    let lastRound = 1;

    if (!tournamentState[tournamentId]) {
        tournamentState[tournamentId] = { startTime: Date.now() };
    }

    if (tournamentTimers[tournamentId]) return;

    const startTime = tournamentState[tournamentId].startTime;
    const endTime = startTime + TOURNAMENT_TIME * 1000;

    tournamentTimers[tournamentId] = setInterval(() => {
        const now = Date.now();

        const tournamentTime = Math.max(0, Math.ceil((endTime - now) / 1000));
        const elapsed = Math.floor((now - startTime) / 1000);
        const round = Math.floor(elapsed / ROUND_TIME) + 1;
        const roundTime = Math.max(1, ROUND_TIME - (elapsed % ROUND_TIME));

        io.to(tournamentId).emit("TOURNAMENT_STATE", {
            tournamentTime,
            round,
            roundTime
        });

        // ⭐ NEW USERS SHOULD ENTER NEXT ROUND HERE
        if (lobby && Object.keys(lobby.waitingUsers).length > 0) {

            const newUsers = Object.keys(lobby.waitingUsers);

            // create rooms for new users
            createMatchesForNewUsers(tournamentId, lobby.waitingUsers);

            // move users to main lobby list
            for (const user of newUsers) {
                lobby.users[user] = lobby.waitingUsers[user];
            }

            lobby.waitingUsers = {};

            io.to(tournamentId).emit("USER_LIST", lobby.users);

            console.log("Waiting users moved and matched:", newUsers);
        }

        // END OF TOURNAMENT
        if (tournamentTime <= 0) {
            clearInterval(tournamentTimers[tournamentId]);
        }

    }, 1000);
}


function createMatchesForNewUsers(tournamentId, newUsers) {

    const lobby = lobbies[tournamentId];
    if (!lobby || !lobby.currentRoomId) return;

    const roomId = lobby.currentRoomId;  // ⭐ USE SAME ROOM

    for (const username in newUsers) {
        const user = newUsers[username];
        const s = io.sockets.sockets.get(user.socketId);
        if (!s) continue;

        s.join(roomId); // ⭐ JOIN SAME ROOM

        rooms[roomId].users[username] = {
            username: user.username,
            avatar: user.avatar,
            socketId: user.socketId
        };
    }

    io.to(roomId).emit("ROOM_USERS", {
        users: rooms[roomId].users
    });

    io.to(roomId).emit("MATCH_FOUND", {
        roomId,
        players: Object.values(rooms[roomId].users)
    });
}


function resetTournament(tournamentId) {
    console.log("Reset tournament:", tournamentId);

    const lobby = lobbies[tournamentId];

    if (lobby?.lobbyInterval)
        clearInterval(lobby.lobbyInterval);

    if (tournamentTimers[tournamentId])
        clearInterval(tournamentTimers[tournamentId]);

    delete lobbies[tournamentId];
    delete tournamentTimers[tournamentId];
    delete tournamentState[tournamentId];


    for (const roomId in rooms) {
        if (roomId.startsWith(tournamentId)) {
            delete rooms[roomId];
        }
    }

    for (const r in roomResults) {
        if (r.startsWith(tournamentId)) {
            delete roomResults[r];
        }
    }

    lobbies[tournamentId] = {
        users: {},
        lobbyTime: 40,
        lobbyInterval: null,
        gameStarted: false
    };
    console.log("New empty lobby created for:", tournamentId);

}
function roomIsEmpty(roomId) {
    return !rooms[roomId] || Object.keys(rooms[roomId].users).length === 0;
}

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log("Matchmaking Server start on port", PORT);
});
