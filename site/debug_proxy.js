
var express = require("express");
var sockio = require("socket.io");
var session = require("./debug_session");
var fs = require("fs");

//////////////////////////////////////////////////////////////////////////////////////////////
// Web server that is supposed to implement the WIP protocol, or at least some part of it ...
var app = express.createServer();
var io = sockio.listen(app);

io.set('log level', 1);

app.all('*', function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    next();
});

var root_dir = "site/";

// Needed for getting script sources...
app.use(express.static(root_dir));

app.listen(4040, "0.0.0.0");

var children = {};

console.log(process.argv);

if (process.argv.length > 2) children[5858] = session.make(process.argv.slice(2));

function subDirs(str, cont) {
    fs.readdir(str, function (err,files) {
        if (err || files.length == 0) {
            cont([]);
            return;
        }
        var num = 0;
        var res = [];
        var step = function () {
            num++; 
            if (num == files.length) {
                console.log("Got: " + str);
                cont(res);
            }
        };
        files.forEach(function (el) {
            res.push(str + el);
            subDirs(str + el + "/", function (lst) {
                res = res.concat(lst);
                step();
            });
        });
    });
}

function listDirectory(dir, cont) {
    console.log("Listing...");
    fs.readdir(dir, function (err, lst) {
        if (err || !lst) {
            cont([]);
            return;
        }
        var res = [];
        function handle(i) {
            fs.stat(dir + lst[i], function (err,stat) {
                console.log(err);
                var obj;
                if (err) obj = {name: lst[i], is_dir: false};
                else obj = {
                    // name: lst[i].substr(dir.length),
                    name: lst[i],
                    is_dir: stat && stat.isDirectory(),
                };
                res.push(obj);
                if (res.length == lst.length) cont(res);
                else handle(i+1);
            });
        }
        if (res.length == lst.length) cont(res);
        else handle(0);
    });
}

function processList() {
    var res = [];
    for (var i in children) {
        res.push({id:i, name:children[i].main, status: children[i].status});
    }
    return res;
}

var sockets = [];

function processUpdate() {
    var lst = processList();
    sockets.forEach(function (s) {
        s.emit("list_processes", lst);
    });
}

io.sockets.on("connection", function (socket) {
    console.log("Client connected");
    sockets.push(socket);
    socket.on("list_directory", function (obj, cont) {
        console.log("Listing directory " + obj.dir);
        listDirectory(root_dir + obj.dir, cont);
    });
    socket.on("list_processes", function (obj, cont) {
        cont(processList());
    });
    socket.on("save_file", function (obj) {
        var save_source = "\n" + obj.file.split("\n").slice(1,-1).join("\n") + "\n";
        fs.writeFile(obj.filename, save_source);
    });
    socket.on("new_file", function (obj, cont) {
        fs.writeFile(root_dir + obj.filename, "", function () { cont(); });
    });
    socket.on("new_directory", function (obj, cont) {
        fs.mkdir(root_dir + obj.filename, 0777, function () { cont(); });
    });
    socket.on("kill_process", function (obj) {
        children[obj.id].cp.kill();
    });
    socket.on("launch", function (obj, cont) {
        var child = session.make([root_dir + obj.main].concat(obj.args), {paused: obj.paused});
        children[obj.id] = child;
        child.main = obj.main;
        child.status = "unconnected";
        processUpdate();
        child.onconnect = function () {
            if (cont) cont({port:child.port});
            if (child.listener) child.listener({msg:"Connected"});
            child.status = "connected";
            processUpdate();
        };
        child.onexit = function () {
            child.status = "exited";
            processUpdate();
        };
    });
    socket.on("register", function (obj, cont) {
        var child = children[obj.port];
        if (!child) return;
        socket.on("message", function (msg) {
            child.process(JSON.parse(msg), function (reply) { socket.emit("message", JSON.stringify(reply)); });
        });
        child.initialize(socket);
        if (child.status != "unconnected") cont({msg:"Connected"});
        else child.listener = cont;
    });
});

process.on('uncaughtException', function(err) {
    console.log("Uncaught exception");
    console.log(err);
});


