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


const roomResults = {};
const liveCoins = {};   


io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("USERNAME", ({ username, avatar, tournamentId }) => {

        if (!lobbies[tournamentId]) {
            lobbies[tournamentId] = {
                users: {},
                lobbyTime: LOBBY_TIME,
                lobbyInterval: null,
                gameStarted: false,
                waitingUsers: {},
                roundProcessed: {},
                resultTimeRunning: false
            };
        }
       
        const lobby = lobbies[tournamentId];
        if (lobby.resultTimeRunning === true) {
            socket.emit("LOBBY_CLOSED", {
                msg: "Tournament result is being calculated. Please wait!"
            });
            return;   // ⭐ STOP USER FROM ENTERING
        }
        // If tournament already started → move new players into waiting list
        if (lobby.gameStarted === true) {
            
            lobby.waitingUsers[username] = {
                username,
                avatar,
                socketId: socket.id
            };

            socket.join(tournamentId);
            // ⭐ SEND WAITING USER IN USER_LIST
            io.to(tournamentId).emit("USER_LIST", {
                ...lobby.users,
                ...lobby.waitingUsers
            });

            socket.emit("WAITING_STATE", {
                msg: "Tournament in progress. You will enter next round."
            });

            console.log(username, "joined waiting list");

            return; 
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
       // io.to(tournamentId).emit("USER_LIST", lobby.users);
        io.to(tournamentId).emit("USER_LIST", {
            ...lobby.users,
            ...lobby.waitingUsers
        });

        startLobbyTimer(tournamentId);

    });


    socket.on("GET_LOBBY_USERS", ({ tournamentId }) => {
        const lobby = lobbies[tournamentId];
        if (!lobby) return;

        socket.emit("USER_LIST", {
            ...lobby.users,
            ...lobby.waitingUsers
        });
    });


    socket.on("JOIN_ROOM", ({ roomId, username }) => {

        if (!rooms[roomId])
            rooms[roomId] = { users: {} };

        rooms[roomId].users[username] = {
            ...rooms[roomId].users[username],
            socketId: socket.id
        };
        if (!roomResults[roomId])
            roomResults[roomId] = {};

        if (!liveCoins[roomId])
            liveCoins[roomId] = {};

        socket.join(roomId);

        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId].users
        });

        for (const user in liveCoins[roomId]) {
            socket.emit("TOURNAMENT_COIN_UPDATE", {
                username: user,
                coins: liveCoins[roomId][user]
            });
        }

        for (const user in roomResults[roomId]) {
            socket.emit("TOURNAMENT_COIN_UPDATE", {
                username: user,
                coins: roomResults[roomId][user]
            });
        }

    });


  
    socket.on("TOURNAMENT_PLAYER_RESULT", ({ roomId, username, coins }) => {

        if (!roomResults[roomId])
            roomResults[roomId] = {};

        roomResults[roomId][username] = coins;

        const expected = Object.keys(rooms[roomId]?.users || {}).length;
        const received = Object.keys(roomResults[roomId]).length;

        if (expected > 0 && received === expected) {

            io.to(roomId).emit("TOURNAMENT_RESULT", roomResults[roomId]);

            const tournamentId = roomId.split("_ROOM_")[0];

            // ⭐ Start synchronized 15-second result timer
            startResultTimer(tournamentId, roomId);
        }

    });



    socket.on("TOURNAMENT_COIN_UPDATE", ({ username, roomId, coins }) => {

        if (!liveCoins[roomId]) liveCoins[roomId] = {};
        liveCoins[roomId][username] = coins;   // ⭐ STORE LIVE COINS

        // SEND TO ALL players in room
        io.to(roomId).emit("TOURNAMENT_COIN_UPDATE", { username, coins });

        // Also send to waiting users
        const tournamentId = roomId.split("_ROOM_")[0];
        const lobby = lobbies[tournamentId];

        if (lobby && lobby.waitingUsers) {
            for (const wUser in lobby.waitingUsers) {
                const s = io.sockets.sockets.get(lobby.waitingUsers[wUser].socketId);
                if (s) {
                    s.emit("TOURNAMENT_COIN_UPDATE", { username, coins });
                }
            }
        }
    });


    socket.on("LEAVE_GAME", ({ roomId, username }) => {

        const tournamentId = roomId.split("_ROOM_")[0];
        const lobby = lobbies[tournamentId];

        removeUserEverywhere(username, socket.id);
        socket.leave(roomId);

        const roomUsers = rooms[roomId]?.users || {};
        if (lobby && lobby.gameStarted && Object.keys(roomUsers).length === 0) {
            console.log("Last user left running tournament → RESET");
            resetTournament(tournamentId);
        }

        io.to(roomId).emit("ROOM_USERS", {
            users: rooms[roomId]?.users
        });
    });


    socket.on("LEAVE_LOBBY", ({ tournamentId, username }) => {

        const lobby = lobbies[tournamentId];
        if (!lobby) return;

        if (lobby.gameStarted === false) {
            // lobby NOT started → allow removal
            removeUserEverywhere(username, socket.id);
        }
        socket.leave(tournamentId);

        const totalPlayers =
            Object.keys(lobby.users).length +
            Object.keys(lobby.waitingUsers).length;

        if (lobby.gameStarted && totalPlayers === 0) {
            console.log("Last user left lobby while running → RESET");
            resetTournament(tournamentId);
        }

        io.to(tournamentId).emit("USER_LIST", {
            ...lobby.users,
            ...lobby.waitingUsers
        });
    });



    /*socket.on("disconnect", () => {

        removeUserEverywhere(null, socket.id);

        console.log("User fully removed", socket.id);

    });*/

    socket.on("disconnect", () => {
        console.log("Disconnect detected:", socket.id);

        // Wait 5 seconds before removing
        setTimeout(() => {
            removeUserEverywhere(null, socket.id);
            console.log("User fully removed after timeout:", socket.id);
        }, 5000);
    });

});

const LOBBY_TIME = 40;

function startLobbyTimer(tournamentId) {
    const lobby = lobbies[tournamentId];
   if (lobby.lobbyInterval) return;
   /* if (lobby.lobbyInterval !== null) {
        clearInterval(lobby.lobbyInterval);
        lobby.lobbyInterval = null;
    }*/

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

/*//const PLAYERS_PER_MATCH = 1;

function createMatches(tournamentId) {
    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    lobby.gameStarted = true;

    const usernames = Object.keys(lobby.users);

    for (let i = 0; i < usernames.length; i++ *//*+= PLAYERS_PER_MATCH*//*) {
        const group = usernames.slice(i, *//*i + PLAYERS_PER_MATCH*//*);
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

                delete lobby.users[username];
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
    io.to(tournamentId).emit("USER_LIST", lobby.users);
}*/
function createMatches(tournamentId) {
    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    lobby.gameStarted = true;

    const usernames = Object.keys(lobby.users);

    // ⭐ CREATE ONLY ONE ROOM
    const roomId = tournamentId + "_ROOM_1";
    rooms[roomId] = { users: {} };
    lobby.currentRoomId = roomId;

    // ⭐ Move ALL players into SAME ROOM
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

    // ⭐ SEND ROOM USERS
    io.to(roomId).emit("ROOM_USERS", {
        users: rooms[roomId].users
    });

    // ⭐ SEND MATCH_FOUND
    io.to(roomId).emit("MATCH_FOUND", {
        roomId,
        players: Object.values(rooms[roomId].users)
    });

   
    io.to(tournamentId).emit("USER_LIST", {
        ...lobby.users,
        ...lobby.waitingUsers
    });

    // ⭐ Clear lobby players (but after MATCH_FOUND)
    lobby.users = {};

    startTournamentTimer(tournamentId);
}

function startResultTimer(tournamentId, roomId) {
    let resultTime = 15;
    lobbies[tournamentId].resultTimeRunning = true;
    io.to(tournamentId).emit("LOBBY_CLOSED");
    const interval = setInterval(() => {
        io.to(roomId).emit("RESULT_TIMER", { resultTime });

        resultTime--;

       /* if (resultTime < 0) {
            clearInterval(interval);
            lobbies[tournamentId].resultTimeRunning = false;
            // after result timer finish → reset tournament
            resetTournament(tournamentId);
        }*/

        if (resultTime < 0) {
            clearInterval(interval);
            lobbies[tournamentId].resultTimeRunning = false;

            // ⭐ SEND WINNERS RANK TO ALL PLAYERS
            const finalRoom = rooms[roomId]?.users || {};
            const finalScores = roomResults[roomId] || {};

            const ranking = Object.keys(finalScores)
                .sort((a, b) => finalScores[b] - finalScores[a]) 
                .map((username, index) => ({
                    username,
                    rank: index + 1
                }));

            io.to(roomId).emit("PRIZE_RANK", ranking);
            io.to(tournamentId).emit("PRIZE_RANK", ranking);

            io.to(roomId).emit("LOBBY_OPEN");
            io.to(tournamentId).emit("LOBBY_OPEN");

            resetTournament(tournamentId);
        }


    }, 1000);
}


const TOURNAMENT_TIME = 100;
const ROUND_TIME = 40;

const tournamentTimers = {};
const tournamentState = {};

function startTournamentTimer(tournamentId) {

    const lobby = lobbies[tournamentId];   

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

        if (round !== lastRound && !lobby.roundProcessed[round]) {

            lastRound = round;
            lobby.roundProcessed[round] = true;  // ⭐ PREVENT DOUBLE TRIGGER

            if (Object.keys(lobby.waitingUsers).length > 0) {

                createMatchesForNewUsers(tournamentId, lobby.waitingUsers);

                for (const user in lobby.waitingUsers) {
                    lobby.users[user] = lobby.waitingUsers[user];
                }

                lobby.waitingUsers = {};

              //  io.to(tournamentId).emit("USER_LIST", lobby.users);
                io.to(tournamentId).emit("USER_LIST", {
                    ...lobby.users,
                    ...lobby.waitingUsers
                });

                console.log("New users joined at start of round:", round);
            }
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
    const lobby = lobbies[tournamentId];
    if (!lobby) return;

    // RESET states
    lobby.users = {};
    lobby.waitingUsers = {};
    lobby.gameStarted = false;
    lobby.currentRoomId = null;
    lobby.roundProcessed = {};

    // DELETE rooms & results
    for (const roomId in rooms) {
        if (roomId.startsWith(tournamentId)) {
            delete rooms[roomId];
            delete liveCoins[roomId];
            delete roomResults[roomId];
        }
    }

    if (tournamentTimers[tournamentId]) {
        clearInterval(tournamentTimers[tournamentId]);
        delete tournamentTimers[tournamentId];
    }
    if (lobby.lobbyInterval) {
        clearInterval(lobby.lobbyInterval);
        lobby.lobbyInterval = null;
    }
    delete tournamentState[tournamentId];  
   
    console.log("Tournament fully reset:", tournamentId);
}


function removeUserEverywhere(username, socketId) {

    //  Find username if missing
    if (!username && socketId) {
        for (const tId in lobbies) {
            const lobby = lobbies[tId];
            for (const u in lobby.users) {
                if (lobby.users[u].socketId === socketId) username = u;
            }
            for (const u in lobby.waitingUsers) {
                if (lobby.waitingUsers[u].socketId === socketId) username = u;
            }
        }
    }

    if (!username) return;

    //  Remove from all lobbies
    for (const tId in lobbies) {
        const lobby = lobbies[tId];

        delete lobby.users[username];
        delete lobby.waitingUsers[username];

        const totalPlayers =
            Object.keys(lobby.users).length +
            Object.keys(lobby.waitingUsers).length;

       /* if (lobby.gameStarted) {
            const total =
                Object.keys(lobby.users).length +
                Object.keys(lobby.waitingUsers).length;

            if (total === 0) {
                console.log("Running tournament became empty → RESET");
                resetTournament(tId);
            }
        }*/
        if (lobby.gameStarted) {

            if (lobby.waitingUsers[username]) {
                delete lobby.waitingUsers[username];
            }
        } else {
            delete lobby.users[username];
            delete lobby.waitingUsers[username];
        }

        if (!lobby.gameStarted && totalPlayers === 0) {
            console.log("Reset lobby because empty:", tId);

            if (lobby.lobbyInterval) clearInterval(lobby.lobbyInterval);

            lobbies[tId] = {
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
    }

    //  Remove from rooms
    for (const roomId in rooms) {
        delete rooms[roomId].users[username];
        if (liveCoins[roomId]) delete liveCoins[roomId][username];
        if (roomResults[roomId]) delete roomResults[roomId][username];

        // delete empty rooms
        if (Object.keys(rooms[roomId].users).length === 0) {
            delete rooms[roomId];
        }
    }
}

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log("Matchmaking Server start on port", PORT);
});
