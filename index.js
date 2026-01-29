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
                gameStarted: false
            };
        }

        const lobby = lobbies[tournamentId];

        if (lobby.gameStarted) {
            socket.emit("LOBBY_CLOSED");
            return;
        }

        // lobbies[tournamentId].users[socket.id] = username;
        lobbies[tournamentId].users[socket.id] = { username, avatar };

        socket.join(tournamentId);

        io.to(tournamentId).emit("USER_LIST", lobbies[tournamentId].users);

        startLobbyTimer(tournamentId);
    });
   /* socket.on("USERNAME", ({ username, avatar, tournamentId }) => {

        if (!lobbies[tournamentId]) {
            lobbies[tournamentId] = {
                users: {},
                lobbyTime: LOBBY_TIME,
                lobbyInterval: null,
                gameStarted: false
            };
        }

        const lobby = lobbies[tournamentId];

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

       *//* socket.join(tournamentId);

        io.to(tournamentId).emit("USER_LIST", lobby.users);

        startLobbyTimer(tournamentId);*//*

        socket.join(tournamentId);

        // user list
        socket.emit("USER_LIST", lobby.users);

        socket.emit("LOBBY_TIMER", {
            time: lobby.lobbyTime
        });

        startLobbyTimer(tournamentId);

    });*/


    socket.on("GET_LOBBY_USERS", ({ tournamentId }) => {
        if (!lobbies[tournamentId]) return;
        socket.emit("USER_LIST", lobbies[tournamentId].users);
    });

   /* socket.on("JOIN_ROOM", ({ roomId }) => {
        let userData = null;

        for (const tId in lobbies) {
            if (lobbies[tId].users[socket.id]) {
                userData = lobbies[tId].users[socket.id];
                break;
            }
        }

        if (!userData) return;

        socket.join(roomId);

       *//* if (!rooms[roomId]) {
            rooms[roomId] = { users: {} };
        }

        rooms[roomId].users[socket.id] = {
            username: userData.username,
            avatar: userData.avatar
        };*//*

        if (!rooms[roomId]) {
            rooms[roomId] = { users: {} };
        }

        if (Object.keys(rooms[roomId].users).length >= PLAYERS_PER_MATCH) {
            console.log("Room full:", roomId);
            return;
        }

        rooms[roomId].users[socket.id] = {
            username: userData.username,
            avatar: userData.avatar
        };


        io.to(roomId).emit("ROOM_USERS", { users: rooms[roomId].users });
    });
*/

    socket.on("JOIN_ROOM", ({ roomId }) => {
        if (!roomId) return;

        let userData = null;
        for (const tId in lobbies) {
            if (lobbies[tId].users[socket.id]) {
                userData = lobbies[tId].users[socket.id];
                break;
            }
        }
        if (!userData) return;

        if (!rooms[roomId])
            rooms[roomId] = { users: {} };

        if (!rooms[roomId].users[socket.id]) {
            rooms[roomId].users[socket.id] = {
                username: userData.username,
                avatar: userData.avatar
            };
        }

        socket.join(roomId);

        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId].users
        });
    });
    /*socket.on("JOIN_ROOM", ({ roomId, username }) => {

        if (!rooms[roomId])
            rooms[roomId] = { users: {} };

        rooms[roomId].users[username] = {
            ...rooms[roomId].users[username],
            socketId: socket.id
        };

        socket.join(roomId);

        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId].users
        });
    });*/


    /* 
    socket.on("TOURNAMENT_PLAYER_RESULT", ({ tournamentId, coins }) => {
      console.log("RESULT RECEIVED:", tournamentId, coins);
  
      if (!tournamentResults[tournamentId])
        tournamentResults[tournamentId] = {};
  
      const username = lobbies[tournamentId]?.users[socket.id]?.username;
      if (!username) return;
  
      const username = user.username;
      tournamentResults[tournamentId][username] = coins;
  
      const receivedCount = Object.keys(tournamentResults[tournamentId]).length;
      const expectedCount = Object.keys(lobbies[tournamentId].users).length;
  
      console.log(`RESULT COUNT ${receivedCount}/${expectedCount}`);
  
      checkAndSendResult(tournamentId);
    });
    */

    /*socket.on("TOURNAMENT_PLAYER_RESULT", ({ tournamentId, coins }) => {
        console.log("RESULT RECEIVED:", tournamentId, coins);

        if (!tournamentResults[tournamentId])
            tournamentResults[tournamentId] = {};

        const user = lobbies[tournamentId]?.users[socket.id];
        if (!user) return;

        const username = user.username; // STRING

        tournamentResults[tournamentId][username] = coins;

        checkAndSendResult(tournamentId);
    });*/

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



    socket.on("TOURNAMENT_COIN_UPDATE", ({ username, coins }) => {
        for (const roomId in rooms) {
            // if (rooms[roomId].users[socket.id])
            if (rooms[roomId].users[username])

            {
                io.to(roomId).emit("TOURNAMENT_COIN_UPDATE", { username, coins });
            }
        }
    });

   /* socket.on("LEAVE_GAME", ({ roomId }) => {
        console.log("Player left game:", socket.id, "room:", roomId);

        // remove from room
        if (rooms[roomId]) {
            delete rooms[roomId].users[socket.id];
        }

        socket.leave(roomId);

        io.to(roomId).emit("ROOM_USERS", { users: rooms[roomId]?.users });

        for (const tId in lobbies) {
            if (lobbies[tId].users[socket.id]) {
                delete lobbies[tId].users[socket.id];

                // if result already started, re-check completion
               *//* if (tournamentResults[tId]) {
                    checkAndSendResult(tId);
                }*//*
                break;
            }
        }
    });*/
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

        if (lobby.users[socket.id]) {
            delete lobby.users[socket.id];
            socket.leave(tournamentId);

            io.to(tournamentId).emit("USER_LIST", lobby.users);

            console.log("User left lobby:", socket.id);

            // optional: stop timer if empty
            if (Object.keys(lobby.users).length === 0) {
                resetTournament(tournamentId);
            }
        }
    });

    /*socket.on("disconnect", () => {
        for (const tId in lobbies) {
            const lobby = lobbies[tId];
            if (lobby.users[socket.id]) {
                delete lobby.users[socket.id];
                io.to(tId).emit("USER_LIST", lobby.users);

                if (Object.keys(lobby.users).length === 0) {
                    resetTournament(tId);
                }
            }
        }
    });*/
    socket.on("disconnect", () => {
        for (const tId in lobbies) {
            const lobby = lobbies[tId];

            for (const username in lobby.users) {
                if (lobby.users[username].socketId === socket.id) {
                    lobby.users[username].disconnected = true;
                    console.log("User disconnected:", username);
                }
            }
        }
    });

});

const LOBBY_TIME = 40;
/*let lobbyTime = LOBBY_TIME;
let lobbyInterval = null;*/

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

const PLAYERS_PER_MATCH = 2;

/*function createMatches(tournamentId) {
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

        startTournamentTimer(tournamentId);
    }
}
*/
function createMatches(tournamentId) {
    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    lobby.gameStarted = true;

    const lobbyUsers = Object.keys(lobby.users);
    const sockets = lobbyUsers.map(id => io.sockets.sockets.get(id));

    for (let i = 0; i < sockets.length; i += PLAYERS_PER_MATCH) {
        const group = sockets.slice(i, i + PLAYERS_PER_MATCH);
        if (group.length < PLAYERS_PER_MATCH) break;

        const roomId = tournamentId + "_ROOM_" + Date.now();

        // create room
        rooms[roomId] = { users: {} };

        group.forEach(s => {
            s.join(roomId);

            // REGISTER USER IN ROOM
            rooms[roomId].users[s.id] = {
                username: lobby.users[s.id].username,
                avatar: lobby.users[s.id].avatar
            };
        });

        // SEND USERS TO CLIENT (THIS WAS MISSING)
        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId].users
        });

        io.to(roomId).emit("MATCH_FOUND", {
            roomId,
            players: group.map(s => lobby.users[s.id])
        });

        startTournamentTimer(tournamentId);
    }
}
/*function createMatches(tournamentId) {
    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    lobby.gameStarted = true;

    const usernames = Object.keys(lobby.users);

    for (let i = 0; i < usernames.length; i += PLAYERS_PER_MATCH) {
        const group = usernames.slice(i, i + PLAYERS_PER_MATCH);
        if (group.length < PLAYERS_PER_MATCH) break;

        const roomId = tournamentId + "_ROOM_" + Date.now();

        rooms[roomId] = { users: {} };

        group.forEach(username => {
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
}*/


const TOURNAMENT_TIME = 100;
const ROUND_TIME = 40;

const tournamentTimers = {};
const tournamentState = {};

function startTournamentTimer(tournamentId) {
    let lastRound = 1;

    // RESET state if new
    if (!tournamentState[tournamentId]) {
        tournamentState[tournamentId] = { startTime: Date.now() };
    }

    if (tournamentTimers[tournamentId]) return;

    const startTime = tournamentState[tournamentId].startTime;
    const endTime = startTime + TOURNAMENT_TIME * 1000;

    tournamentTimers[tournamentId] = setInterval(() => {
        const now = Date.now();

        const tournamentTime = Math.max(
            0,
            Math.ceil((endTime - now) / 1000)
        );

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

/*function sendTournamentResult(tournamentId) {
    for (const roomId in rooms) {
        if (roomId.startsWith(tournamentId)) {
            io.to(roomId).emit(
                "TOURNAMENT_RESULT",
                tournamentResults[tournamentId] || {}
            );
        }
    }

    setTimeout(() => {
        resetTournament(tournamentId);
    }, 3000);
}*/

/*function resetTournament(tournamentId) {
    console.log("Reset tournament:", tournamentId);

    if (lobbies[tournamentId]?.lobbyInterval)
        clearInterval(lobbies[tournamentId].lobbyInterval);

    if (tournamentTimers[tournamentId])
        clearInterval(tournamentTimers[tournamentId]);

    delete lobbies[tournamentId];
    delete tournamentTimers[tournamentId];
    delete tournamentState[tournamentId];
    //delete tournamentResults[tournamentId];

    for (const roomId in rooms) {
        if (roomId.startsWith(tournamentId)) {
            delete rooms[roomId];
        }
    }
}
*/

/*function resetTournament(tournamentId) {
    console.log("Reset tournament:", tournamentId);

    if (lobbies[tournamentId]?.lobbyInterval)
        clearInterval(lobbies[tournamentId].lobbyInterval);

    if (tournamentTimers[tournamentId])
        clearInterval(tournamentTimers[tournamentId]);

    delete lobbies[tournamentId];
    delete tournamentTimers[tournamentId];
    delete tournamentState[tournamentId];

    lobbyTime = LOBBY_TIME;

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

}*/
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
}


/*function checkAndSendResult(tournamentId) {
    const receivedCount = Object.keys(
        tournamentResults[tournamentId] || {}
    ).length;

    const expectedCount = Object.keys(
        lobbies[tournamentId]?.users || {}
    ).length;

    console.log(`[CHECK RESULT] ${receivedCount}/${expectedCount}`);

    if (expectedCount === 0 || receivedCount === expectedCount) {
        sendTournamentResult(tournamentId);
    }
}*/

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log("Matchmaking Server start on port", PORT);
});
