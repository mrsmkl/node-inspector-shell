
var net = require("net");

//////////////////////////////////////////////////////////////////////////////////
// Connection to v8 debugger

function Connection(port) {
    port = port || 5858;
    
    this.properties = {};
    this.seq = 100;
    
    this.onconnect = null;
    
    this.running = true;

    this.onmessage = function (msg) {
        console.log("Not handling messages");
        console.log(msg);
    };

    this.handlers = {};
    
    this.trySocket(port);
}

Connection.prototype.trySocket = function (port) {    
    var cache = "";
    var waiting = 0;
    var initialized = false;
    var self = this;

    var socket = net.createConnection(port, "127.0.0.1");
    socket.setEncoding("ascii");

    socket.on("connect", function () {
        console.log("Connected");
        if (self.onconnect) self.onconnect();
    });
    
    socket.on("error", function () { setTimeout(self.trySocket(port), 1000); });

    socket.on("closed", function () {
        console.log("Socket closed");
    });
    
    var gotMessage = function () {
        var li = cache.lastIndexOf("}");
        if (li > 0) waiting = li+1;
        var msg = cache.substr(0, waiting);
        cache = cache.substr(waiting);
        // console.log("Got message");
        /*
        console.log(waiting);
        console.log(msg.length);
        console.log(cache);
        */
        // console.log(msg);
        var obj = JSON.parse(msg);
        // console.log(obj);
        // Can be response or event
        if (obj.event != "scriptCollected" && typeof obj.running == "boolean") self.running = obj.running;
        if (obj.request_seq) {
             if (self.handlers[obj.request_seq]) self.handlers[obj.request_seq](obj);
        }
        else self.onmessage(obj);
        waiting = 0;
    };

    var handle = function (str) {
        if (!initialized) {
            if (str.match(/^Content-Length:/)) {
                initialized = true;
                console.log("Initialized");
                // cmd("backtrace");
            }
            else if (str.match(/:/)) {
                var lst = str.split(": ");
                self.properties[lst[0]] = lst[1];
            }
        }
        else {
            while (str.length > 0) {
                if (str.match(/^Content-Length:/)) {
                    var lst = str.split(": ");
                    waiting = parseInt(lst[1]);
                    // console.log(str);
                    // console.log("Waiting for " + waiting);
                    return;
                }
                else if (waiting > 0 && str.length >= waiting) {
                    gotMessage();
                }
                else {
                    // console.log(str);
                    return;
                }
                str = cache;
            }
        }
    };

    socket.on("data", function (str) {
        // console.log(JSON.stringify(String(str)));
        // cache += String(str).replace(/\r/g, '');
        cache += String(str);
        var lst = cache.split(/[\n\r]/);
        for (var i = 0; i < lst.length; i++) {
            cache = lst[i];
            handle(lst[i]);
        }
        // cache = lst[i];
        // console.log("Cache: " + cache);
        // if (waiting <= cache.length && waiting > 0) gotMessage();
    });

    this.socket = socket;
}

Connection.prototype.command = function (type, args, cont) {
    var obj = {
        seq: this.seq++,
        type: "request",
        command: type,
        arguments: args,
    };
    var str = JSON.stringify(obj);
    // console.log(str);
    this.socket.write("Content-Length: " + str.length + "\r\n\r\n" + str);
    // this.socket.write("Content-Length: " + str.length + "\r\n\r\n" + str+"\n");
    // this.socket.flush();
    this.handlers[obj.seq] = cont;
};

exports.Connection = Connection;

