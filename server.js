var http = require("http");
var fs = require("fs");
var url = require("url");
var path = require("path");
var websocket = require("websocket").server;
var process = require("process");

var clients = [];
var perdedores = [];
var buffer = [];
var blocks = [];
var reload = true;

const PORT = 3000;

function start() {
    log(`Starting with PID ${process.pid}`);
    backup().then(() => {
        log("Backup done");
        startServer().then(() => {
            startWebsocket();
            log(`Server is online on port ${PORT}`);
            loadFiles().then(() => {
                log(`Server "database" loaded`);
            }).catch(err => {
                log(`Failed to load server "database":\n${err}`);
            });
            startWatches("./Files", () => {
                bufferFiles().then(qtd => {
                    log(`${qtd} requestable files loaded`);
                }).catch(err => {
                    log(`Failed to load requestable files:\n${err}`);
                });
            });
        }).catch(err => {
            log(`Server failed to start:\n${err}`);
        });
    }).catch(err => {
        log(`Failed to make backup:\n${err}`);
    })
}

var httpServer = http.createServer((req, res) => {
    if (invalidReq(req.url)) {
        if (isIPBlocked(req.connection.remoteAddress)) {
            res.destroy();
        } else {
            log(`Striked ip ${req.connection.remoteAddress} for the ${strikeIP(req.connection.remoteAddress)} time from requesting ${req.url}`)
            res.end("Strike");
        }
        return;
    }
    log(`Req: ${req.url} from ${req.connection.remoteAddress}`);
    if (req.method === "GET") {
        var pathname = decodeURI(url.parse(req.url).pathname);
        var response;
        if (shorcuts[pathname]) {
            pathname = shorcuts[pathname];
            response = buffer.find(file => { return file.path == pathname; });
        } else {
            response = buffer.find(file => { return file.path == pathname; });
            if (response)
                pathname = response.path;
            else {
                response = buffer.find(file => { return file.path.startsWith(pathname) && file.path.endsWith(".html"); });
                if (response)
                    pathname = response.path;
                /*else
                    if (req.headers.referer && pathname != "/favicon.ico") {
                        var relativePath = req.headers.referer.split(req.headers.host)[1];
                        if (relativePath && relativePath != "/") {
                            if (shorcuts[relativePath])
                                relativePath = shorcuts[relativePath];
                            log(`Relative path: ${relativePath}`);
                            pathname = `${relativePath}${pathname}`;
                            var response = buffer.find(file => { return file.path == pathname; });
                            if (response)
                                return redirect(response.path, req, res);
                        }
                    }*/
            }
        }
        if (response) {
            res.writeHead(200, { "Content-Type": exts[path.parse(pathname).ext] || "text/plain", "Content-Disposition": `filename=${path.basename(pathname)}` });
            res.end(response.stream);
        } else {
            log("File not buffered")
            fs.exists(`./Files${pathname}`, exists => {
                if (exists) {
                    pathname = `./Files${pathname}`;
                    fs.stat(pathname, (err, stat) => {
                        if (!err && stat.isDirectory()) {
                            log(`Folder requested: ${pathname}`);
                            res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
                            fs.readdir(pathname, (err, files) => {
                                if (err) return res.end("Error");
                                var resp = [];
                                files.forEach(file => {
                                    resp.push({ name: file, path: `/${pathname.split("./Files/")[1]}/${file}`, folder: fs.statSync(`${pathname}/${file}`).isDirectory() });
                                });
                                res.end(buffer.find(file => {
                                    return file.path == "/pasta.html";
                                }).stream.toString().replace("%context%", JSON.stringify(resp)));
                            });
                        } else {
                            res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
                            res.end("Algo de MUITO errado aconteceu que não tem como acontecer mas aconteceu o.O")
                            log(`FAIL: ${pathname} ${err.message}`);
                        }
                    })
                } else {
                    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(buffer.find(file => {
                        return file.path == "/new404.html";
                    }).stream.toString().replace("%filename%", pathname));
                    log(`File requested not found: ${pathname}`);
                }
            });
        }
    } else {
        res.end("uhhh.... não sei exatamente o que fazer com requests que não são GET...");
        log(`Not a GET request: ${req.url}`);
    }
}).on("connection", socket => {
    if (isIPBlocked(socket.remoteAddress)) {
        log(`Blocked IP tried to connect: ${socket.remoteAddress}`);
        socket.destroy();
    }
});;

function redirect(to, req, res) {
    res.writeHead(302, { "Location": `http://${req.headers.host}${encodeURI(to)}` });
    res.end();
}

function startServer() {
    return new Promise((resolve, reject) => {
        httpServer.listen(PORT).on("listening", () => {
            resolve();
        }).on("error", err => {
            reject(err);
        });
    });
}

function invalidReq(url) {
    return invalids.find(invalid => { return url.includes(invalid) })
}

function strikeIP(ip) {
    var i = blocks.findIndex(block => { return block.ip == ip });
    if (i == -1) {
        blocks.push({ ip: ip, strikes: 0 });
        return strikeIP(ip);
    } else {
        blocks[i].strikes++;
        fs.writeFile("./blocks.json", JSON.stringify(blocks, null, 2), () => { });
        return blocks[i].strikes;
    }
}

function isIPBlocked(ip) {
    var blocked = blocks.find(fIP => { return fIP.ip == ip })
    if (blocked && blocked.strikes >= 3) return true;
    return false;
}

function bufferFiles() {
    return new Promise((resolve, reject) => {
        /**
         * 
         * @param {Array} object 
         */
        function flatten(object) {
            var flattened = new Array();
            object.forEach(element => {
                if (element instanceof Array)
                    flattened = flattened.concat(flatten(element));
                else
                    flattened.push(element);
            });
            return flattened;
        }
        readFiles("./Files").then(responses => {
            buffer = flatten(responses);
            resolve(buffer.length)
        }).catch(err => {
            reject(err);
        });
    });
}

function backup(suffix) {
    return new Promise((resolve, reject) => {
        var directory = `./Backups/${new Date().toLocaleString().replace(/\//g, "-").replace(/:/g, "-")}${suffix || ""}`;
        fs.exists(directory, exists => {
            if (exists) {
                if (suffix != undefined) suffix++;
                else suffix = 1;
                backup(suffix).then(res => resolve(res)).catch(err => reject(err));
            } else {
                fs.mkdir(directory, err => {
                    if (err) return reject(err);
                    fs.copyFile("./perdedores.json", `${directory}/perdedores.json`, err => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
        });
    });
}

function readFiles(path) {
    return new Promise((resolve, reject) => {
        fs.readdir(path, (err, items) => {
            if (err) return reject(err);
            var reads = [];
            items.forEach(item => {
                reads.push(new Promise((resolve, reject) => {
                    var itemPath = `${path}/${item}`;
                    fs.stat(itemPath, (err, stats) => {
                        if (err) return reject(err);
                        if (stats.isDirectory())
                            readFiles(itemPath).then(files => {
                                resolve(files);
                            }).catch(err => {
                                reject(err);
                            });
                        else
                            fs.readFile(itemPath, (err, data) => {
                                if (err) reject(err);
                                else resolve({ path: itemPath.replace("./Files", ""), stream: new Buffer.from(data) });
                            })
                    });
                }));
            });
            Promise.all(reads).then(files => {
                resolve(files);
            }).catch(err => {
                reject(err);
            });
        });
    });
}

function startWatches(path, reloadFiles) {
    reloadFiles();
    fs.readdir(path, (err, items) => {
        items.forEach(item => {
            fs.lstat(`${path}/${item}`, (err, stats) => {
                if (!err && stats.isDirectory())
                    startWatches(`${path}/${item}`, reloadFiles);
            });
        });
    })
    log(`Watching folder '${path}' for changes`);
    fs.watch(path, (event, file) => {
        log(`File changed (${file}, ${event}), rebuffering files...`);
        reloadFiles();
        reload = true;
        updateAllClients();
    });
}

function loadFiles() {
    return new Promise((resolve, reject) => {
        files = [loadJSONFile("./perdedores.json", true), loadJSONFile("./blocks.json", true)];
        Promise.all(files).then(resolved => {
            perdedores = resolved[0];
            blocks = resolved[1];
            resolve();
        }).catch(err => {
            reject(err);
        });
    });
}

function loadJSONFile(path, emptyIfErr) {
    return new Promise((resolve, reject) => {
        fs.readFile(path, (err, data) => {
            if (err)
                if (emptyIfErr) resolve([]);
                else reject(err);
            else
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    if (emptyIfErr) resolve([]);
                    else reject(err);
                }
        });
    });
}

function genNick() {
    var nick;
    do {
        nick = `usr:${Math.random().toString(36).replace("0.", "")}`;
    } while (perdedores.find(perdedor => { return nick == perdedor.nick }))
    return nick;
}

function genID() {
    var ID;
    do {
        ID = Math.random().toString(36).replace("0.", "");
    } while (perdedores.find(perdedor => { return ID == perdedor.id }))
    return ID;
}

function checkSockets() {
    var logouts = false;
    clients.forEach((client, i) => {
        if (!client.connection.connected) {
            log(`User log-out: ${clients.splice(i, 1)[0].id}, ${clients.length} user(s) online`);
            logouts = true;
        }
    });
    if (logouts) perdedores = perdedores.filter(perdedor => { return perdedor.times > 0 || clients.find(client => { return client.id == perdedor.id }) });
}

function updateAllClients() {
    var tTimes = 0;
    perdedores.forEach(val => {
        tTimes += val.times;
    })
    checkSockets()
    updateFile();
    perdedores.sort((a, b) => {
        if (a.times > b.times)
            return -1;
        if (a.times < b.times)
            return 1;
        return 0;
    });
    var leaderBoard = JSON.parse(JSON.stringify(perdedores.slice(0, 9)));
    leaderBoard.forEach(player => {
        player.id = undefined;
    })

    clients.forEach((client, i) => {
        var index = perdedores.findIndex(val => {
            return val.id == client.id;
        })
        if (index == -1) log("Could not find index to send new info");
        else {
            client.connection.send(JSON.stringify({ leaderBoard: leaderBoard, usrs: perdedores.length, tTimes: tTimes, me: perdedores[index], reload: reload, txt: true }));
        }
    });
    reload = false;
}

var websocketServer;
function startWebsocket() {
    websocketServer = new websocket({
        httpServer: httpServer
    });
    websocketServer.on("request", req => {
        var connection = req.accept(null, req.origin);
        connection.on("message", msg => {
            try {
                data = JSON.parse(msg.utf8Data);
                var client = clients.find(client => { return client.connection == connection });
                var id;
                var index = -1;
                if (client) {
                    id = client.id;
                    index = perdedores.findIndex(perdedor => { return perdedor.id == id });
                }

                if (data.click) {
                    if (index == -1) log(`Could not find the index for the id ${id}`);
                    else {
                        perdedores[index].times++;
                        log(`User ${perdedores[index].nick} lost ${perdedores[index].times} time(s)`);
                    }
                    updateAllClients();
                } if (data.id) {
                    if (data.id == "?") {
                        connection.send(JSON.stringify({ newID: genID() }));
                        log("Sending ID to new user");
                    } else {
                        if (!clients.find(client => { return client.id == data.id && client.connection == connection })) {
                            clients.push({ connection: connection, id: data.id });
                            var perdedorLogin = perdedores.find(perdedor => { return perdedor.id == data.id });
                            if (!perdedorLogin) {
                                log(`New user: ${data.id}, ${clients.length} user(s) online`);
                                perdedorLogin = perdedores[perdedores.push({ id: data.id, times: 0, nick: genNick() }) - 1];
                            }
                            log(`User log-in: ${perdedorLogin.nick}, ${clients.length} user(s) online`);
                            checkSockets()
                            updateAllClients();
                        }
                    }
                } else if (data.showID) {
                    log(`Nick to show ID: ${data.showID}`)
                    if (index != -1) {
                        var perdedorToCopy = perdedores.find(perdedor => { return perdedor.nick.toLowerCase() == data.showID.toLowerCase() });
                        clients.forEach(client => {
                            if (client.id == perdedorToCopy.id)
                                client.connection.send(JSON.stringify({ showID: true }));
                        });
                    }
                } else if (data.changeToID) {
                    data.changeToID = data.changeToID.toLowerCase();
                    if (index != -1) {
                        var playerToCopy = perdedores.find(perdedor => { return perdedor.id == data.changeToID });
                        if (playerToCopy) {
                            connection.send(JSON.stringify({ alert: "Link feito com sucesso!", newID: playerToCopy.id }));
                            log(`User ${perdedores.nick} merged with ${data.changeToID}`);
                            playerToCopy.times += perdedores[index].times;
                            perdedores.splice(index, 1);
                        } else {
                            connection.send(JSON.stringify({ alert: "Não há nenhum navegador aberto com esse código." }));
                        }
                    }
                } else if (data.newNick) {
                    if (index == -1) {
                        log("User not found");
                        return;
                    }
                    if (data.newNick.length < 2 || data.newNick.length > 16) {
                        connection.send(JSON.stringify({ alert: "Seu nick tem que ter no mínimo 2 e no máximo 16 caracteres" }));
                    } else {
                        data.newNick = data.newNick.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        if (perdedores[index].nick == data.newNick)
                            connection.send(JSON.stringify({ alert: "Seu novo nick não pode ser igual ao atual" }));
                        else if (perdedores.find(perdedor => { return perdedor.nick.toLowerCase() == data.newNick.toLowerCase() && perdedores[index].nick != perdedor.nick }))
                            connection.send(JSON.stringify({ nickInUse: data.newNick }));
                        else {
                            log(`User nick change: from '${perdedores[index].nick}' to '${data.newNick}'`);
                            perdedores[index].nick = data.newNick;
                            perdedores[index].customNick = true;
                        }
                        updateAllClients();
                    }
                }
            } catch (ex) {
                log(`Erro: ${ex.message}`);
            }
        })
        connection.on("close", () => {
            checkSockets()
        })
    });
}

var nextFileUpdate = 0;
function updateFile() {
    if (new Date().getTime() > nextFileUpdate) {
        fs.writeFile("./perdedores.json", JSON.stringify(perdedores, null, 2), () => { });
        nextFileUpdate = new Date().getTime() + 5000;
    } else setTimeout(updateFile, nextFileUpdate - new Date().getTime());
}

function log(msg) {
    console.log(`${new Date().toLocaleString()}: ${msg}`);
}

const invalids = [".php", ".cgi", ".txt", ".xml", ".shtml", ".action"]

const exts = {
    ".ico": "image/x-icon",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".eot": "appliaction/vnd.ms-fontobject",
    ".ttf": "aplication/font-sfnt"
};

const shorcuts = {
    "/": "/ojogo.html",
    "/index": "/ojogo.html",
    "/index.html": "/ojogo.html",
}

process.once('SIGUSR2', () => {
    log("Stopping server...")
    httpServer.close();
    backup().then(() => {
        process.kill(process.pid, 'SIGUSR2');
    }).catch(err => {
        log(`Unable to do backup:\n${err}`);
        process.kill(process.pid, 'SIGUSR2');
    });
});
start();