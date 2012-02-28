
var Connection = require("./v8debug").Connection;
var spawn = require("child_process").spawn;

var port = 5858;

exports.make = function (args, opt) {

opt = opt || {};

console.log(args);

var child = spawn("node", ["--debug" + (opt.paused ? "-brk" : "") + "="+port].concat(args));

port++;

// State related variables
var conn;

var evaled = { };
var eval_count = 1;

var stored_scripts = [];
var debugger_enabled = false;

// var paused = false;

// There could be many sockets listening here...
var socket;

function postMessage(meth, args) {
    if (socket) {
        socket.emit("message", JSON.stringify({method:meth, params: args}));
    }
}

child.stderr.on("data", function (buf) {
    console.log("Error " + String(buf));
    setTimeout(function () {
        if (!conn) {
            conn = new Connection(obj.port);
            conn.onconnect = obj.onconnect;
            conn.onmessage = function (msg) {
                console.log("Handling event:");
                console.log(msg);
                handleEvent(msg);
            // handlers.forEach(function (f) { f(msg); });
            };
        }
    }, 100);
    postMessage("Console.messageAdded", {message: {level:"error", source: "console-api", text:String(buf)}});
});

child.stdout.on("data", function (buf) {
    console.log("Got " + String(buf));
    postMessage("Console.messageAdded", {message: {level:"log", source: "console-api", text:String(buf)}});
});

child.on("exit", function (code) {
    console.log("Child exited");
    postMessage("Console.messageAdded", {message: {level:"log", source: "console-api", text:"Ended with code " + code}});
    if (obj.onexit) obj.onexit();
});

// var handlers = [];

var not_impl = function (x, cont) {
    cont({});
    // cont({error: "Not implemented"});
};

var Network = {
    enable: not_impl,
};

var Page = {
    enable: not_impl,
};

var CSS = {
    enable: not_impl,
};

var Worker = {
    enable: not_impl,
};

var Console = {
    enable: not_impl,
};

var Inspector = {
    enable: not_impl,
};

var Database = {
    enable: not_impl,
};

var DOMStorage = {
    enable: not_impl,
};

function objectFromHandle(res, prefix) {
    if (res.type == "number") return {type:"number", value: res.value};
    else if (res.type == "string") return {type:"string", value: res.value};
    else if (res.type == "undefined") return {type:"undefined", value: res.value};
    else if (res.type == "null") return {type:"null", value: res.text};
    else if (res.type == "boolean") return {type:"boolean", value: res.value};
    else if (res.type == "function") return {type:"function", objectId: prefix, description: res.text};
    // else if (res.text == "#<Buffer>") return {type:"string", value: "How to get it ..."};
    else if (res.type == "object") return {type:"object", objectId: prefix, description: res.className};
    else return {type:"object", objectId: prefix, description: res.className};
}

function valueFromHandle(ctx, res, prefix) {
    if (res.type == "object" || res.type == "function") {
        var obj = {};
        if (res.properties) res.properties.forEach(function (el) {
            if (ctx[el.ref]) obj[el.name] = ctx[el.ref].value;
        });
        return {type:"object", objectId: prefix, description: res.text, value: obj};
    }
    else return objectFromHandle(res, prefix);
}

function makeId(parent_id, val) {
    if (parent_id.match(/^__eval\$/)) return parent_id + "[" + JSON.stringify(val.name) + "]";
    else return String(val.ref);
}

function makeObject(resp, val, id) {
    if (val.ref) {
        var res = ref(resp, val);
        if (!res) return {type:"string", value: "Deep fetching not implemented"};
        else return objectFromHandle(res, id);
    }
    return val;
}

function makeProperty(name, val) {
    return {
        configurable: true,
        enumerable: false,
        name : String(name),
        value : val,
        writable: true,
    };
}

function getPropertyArray(resp, id, parent_id) {
    if (!resp.body) return [];
    var arr = [];
    var props = resp.body[id].properties;
    for (var i in props) {
        var id = makeId(parent_id, props[i]);
        var obj = makeObject(resp, props[i], id);
        arr.push(makeProperty(props[i].name, obj));
    }
    return arr;
}

function simpleEval(expr, cont, frame) {
    eval_count++;
    expr = "eval(" + JSON.stringify(expr) + ")";
    var vname = "__eval$" + eval_count;
    var e = "var " + vname + " = " + expr + "; if (" + vname + " instanceof Buffer) " + vname + "=String(" + vname + "); " + vname;
    conn.command("evaluate", {expression:e, global: typeof(frame) == "number" ? false : true, frame: frame}, function (resp) {
        if (!resp.body) {
            cont({result:{result:{type:"error", description: resp.message}, wasThrown: true}});
            return;
        }
        // If paused, return other stuff
        if (!conn.running) cont({result:{result:objectFromHandle(resp.body, String(resp.body.handle))}});
        else cont({result:{result:objectFromHandle(resp.body, vname)}});
    });
}

// Does not realy return deep expressions...
function valueEval(expr, cont) {
    eval_count++;
    expr = "eval(" + JSON.stringify(expr) + ")";
    var vname = "__eval$" + eval_count;
    var e = "var " + vname + " = " + expr + "; if (" + vname + " instanceof Buffer) " + vname + "=String(" + vname + "); " + vname;
    conn.command("evaluate", {expression:e, global: true}, function (resp) {
        if (!resp.body) {
            cont({result:{result:{type:"error", description: resp.message}}});
            return;
        }
        var ctx = {};
        ctx[resp.body.handle] = resp.body;
        resp.refs.forEach(function (r) { ctx[r.handle] = r; });
        cont({result:{result:valueFromHandle(ctx, resp.body, vname)}});
    });
}

function propertyEval(expr, cont) {
    conn.command("evaluate", {expression:expr, global: true}, function (resp) {
        if (!resp.body) {
            cont({result:{result:{type:"string", value: resp.error}}});
            return;
        }
        var ctx = {body: {}, refs: resp.refs};
        ctx.refs.push(resp.body);
        // Then other handles
        resp.refs.forEach(function (r) { ctx.body[r.handle] = r; });
        var arr = getPropertyArray(ctx, resp.body.handle, expr);
        cont({result:{result:arr}});
    });
}

var Runtime = {
    getProperties: function (x,cont) {
        if (x.objectId.match(/^__eval\$/)) {
            propertyEval(x.objectId, cont);
        }
        else {
            var oid = parseInt(x.objectId);
            conn.command("lookup", {handles:[oid]}, function (resp) {
                var arr = getPropertyArray(resp, oid, x.objectId);
                cont({result:{result:arr}});
            });
        }
    },
    evaluate: function (x,cont) {
        simpleEval(x.expression, cont);
    },
    callFunctionOn: function (x,cont) {
        // Get handles and args
        var args = [];
        [{type:"object", objectId: x.objectId}].concat(x.arguments).forEach(function (el) {
            if (el && el.type == "object" && el.objectId.match(/^__eval\$/)) {
                args.push(el.objectId);
            }
            else if (el && el.value) args.push(el.value);
        });
        var expr = "(function () { var ___f = " + x.functionDeclaration + "; return ___f.call(" + args.join(",") + "); })();";
        valueEval(expr, cont);
    },
    releaseObjectGroup: function (x, cont) {
        cont({});
    },
    releaseObject: function (x, cont) {
        cont({});
    }
};

// Here could also test regex
function scriptByName(name) {
    var res = [];
    stored_scripts.forEach(function (sc) {
        if (sc.name == name) res.push(sc);
    });
    return res;
}

function scriptById(name) {
    var res = [];
    stored_scripts.forEach(function (sc) {
        if (sc.id == name) res.push(sc);
    });
    return res;
}

var save_on_edit = true;

var Debugger = {
    canSetScriptSource: function (x, cont) {
        // Possible with "changelive" command
        cont({result: {result:true}});
        // cont({result: {result:false}});
    },
    continueToLocation: function (x, cont) {
        // conn.command("continue", {}, function () { cont({}); });
    },
    disable: function (x, cont) {
        cont({});
    },
    enable: function (x, cont) {
        debugger_enabled = true;
        initDebugger();
        cont({});
    },
    evaluateOnCallFrame: function (x, cont) {
        simpleEval(x.expression, cont, parseInt(x.callFrameId));
    },
    getScriptSource: function (x, cont) {
        conn.command("scripts", {includeSource: true, ids:[parseInt(x.scriptId)]}, function (resp) {
            cont({result:{scriptSource:resp.body && resp.body.length > 0 ? resp.body[0].source : ""}});
        });
    },
    pause: function (x, cont) {
        conn.command("suspend", {}, function () {
            // Do a backtrace here ...
            sendBacktrace();
            cont({});
            /*
            conn.command("frame", {number:0}, function () {
                // emit as message
                // Make a completely fake frame
                var frame = {
                    callFrameId: "0",
                    functionName: "No frame, waiting for something to happen",
                    location: {scriptId: String(stored_scripts[0].id), lineNumber: 0, columnNumber: 0},
                    scopeChain: [],
                    this: null,
                };
                postMessage("Debugger.paused", {reason:"other", callFrames:[frame]});
            });
            */
        });
    },
    removeBreakpoint: function (x, cont) {
        conn.command("clearbreakpoint", {breakpoint:parseInt(x.breakpointId)}, function () { cont({}); });
    },
    resume: function (x, cont) {
        // paused = false;
        conn.command("continue", {stepaction: "out", stepcount: 10}, function (msg) {
            // console.log(msg);
            postMessage("Debugger.resumed", {});
            cont({});
        });
    },
    searchInContent: function (x, cont) {
        // Call my stuffs?
        // Perhaps store the script here...
    },
    setBreakpoint: function (x, cont) {
        conn.command("setbreakpoint", {type:"scriptId", target:parseInt(x.location.scriptId), line:x.location.lineNumber, column:x.location.columnNumber, condition: x.condition}, function (resp) {
            cont({result:{actualLocation:{lineNumber:x.lineNumber, scriptId:x.location.scriptId}, breakpointId: String(resp.body.breakpoint)}});
        });
    },
    setBreakpointByUrl: function (x, cont) {
        conn.command("setbreakpoint", {type:"script", target:x.url, line:x.lineNumber, condition: x.condition}, function (resp) {
            var lst = [];
            var script_id = String(scriptByName(x.url)[0].id);
            resp.body.actual_locations.forEach(function (l) {
                lst.push({lineNumber: l.line, columnNumber: l.column, scriptId: script_id});
            });
            cont({result:{locations:lst, breakpointId: String(resp.body.breakpoint)}});
        });
    },
    setBreakpointsActive: function (x, cont) {
        // Perhaps with 'changebreakpoint' ???
    },
    setPauseOnExceptions: function (x, cont) {
        // x.state
        var type = {};
        if (x.state == "uncaught") type = {type:"uncaught", enabled:true};
        else if (x.state == "none") type = {type:"all", enabled:false};
        else if (x.state == "all") type = {type:"all", enabled:true};
        conn.command("setexceptionbreak", type, function (resp) { cont({}); });
    },
    setScriptSource: function (x, cont) {
        var id = parseInt(x.scriptId);
        var fname = scriptById(id)[0].name;
        console.log("Doing live edit: " + fname);
        conn.command("changelive", {script_id: id, new_source: x.scriptSource}, function (resp) {
            if (resp.body && resp.body.stepin_recommended) makeBacktrace(function (lst) { cont({result:{callFrames:lst}}); });
            else cont({});
        });
    },
    stepInto: function (x, cont) {
        conn.command("continue", {stepaction:"in"}, function () { cont({}); });
    },
    stepOut: function (x, cont) {
        conn.command("continue", {stepaction:"out"}, function () { cont({}); });
    },
    stepOver: function (x, cont) {
        conn.command("continue", {stepaction:"next"}, function () { cont({}); });
    },
    

    //// Not documented
    causesRecompilation: function (x, cont) {
        cont({result:{result:false}});
    },
    supportsNativeBreakpoints: function (x, cont) {
        cont({result:{result:true}});
    },
};

var Profiler = {
    causesRecompilation: function (x, cont) {
        cont({result:{result:false}});
    },
    isSampling: function (x, cont) {
        cont({result: {result:true}});
    },
    hasHeapProfiler: function (x, cont) {
        cont({result: {result:true}});
    },
};

var objs = {
    "Network": Network,
    "Page": Page,
    "CSS": CSS,
    "Worker": Worker,
    "Console": Console,
    "Inspector": Inspector,
    "Database": Database,
    "DOMStorage": DOMStorage,
    "Runtime": Runtime,
    "Debugger": Debugger,
    "Profiler": Profiler,
};

function convertScript(sc) {
    var lines = sc.source.split("\n");
    return {
        method:"Debugger.scriptParsed",
        params: {
            scriptId: String(sc.id),
            url: sc.name,
            startLine: 0,
            startColumn: 0,
            endLine: lines.length,
            endColumn: lines[lines.length-1].length,
        }
    };
}

function ref(ev, id) {
    if (!id.ref) return id;
    if (!ev.refs) return null;
    for (var i = 0; i < ev.refs.length; i++) {
        if (id.ref == ev.refs[i].handle) return ev.refs[i];
    }
    return null;
}

function getScopes(lst, fr, cont) {
    var types = ["global", "local", "with", "closure", "catch"];
    var res = [];
    var handle = function (i) {
        if (i == lst.length) cont(res);
        else {
            conn.command("scope", {number:lst[i].index, frameNumber:fr}, function (resp) {
                res.push({type: types[resp.body.type], object:{type:"object", objectId: String(resp.body.object.ref)}});
                handle(i+1);
            });
        }
    };
    handle(0);
}

function makeFrame(resp, fr, cont) {
    getScopes(fr.scopes, fr.index, function (scopes) {
        var script = ref(resp, fr.script);
        var frame = {
            callFrameId: String(fr.index),
            functionName: ref(resp, fr.func).name,
            location: {scriptId: String(script.id), lineNumber: fr.line, columnNumber: fr.column},
            scopeChain: scopes,
            this: null, /* what should this be??? */
        };
        cont(frame);
    });
}

function makeBacktrace(cont) {
    conn.command("backtrace", {}, function (resp) {
        var frames = [];
        var handle = function (i) {
            if (i == resp.body.frames.length) cont(frames);
            else makeFrame(resp, resp.body.frames[i], function (frame) { frames.push(frame); handle(i+1); });
        };
        if (!resp.body || !resp.body.frames) {
            var frame = {
                callFrameId: "0",
                functionName: "No frame, waiting for something to happen",
                location: {scriptId: String(stored_scripts[0].id), lineNumber: 0, columnNumber: 0},
                scopeChain: [],
                this: null,
            };
            cont([frame]);
        }
        else handle(0);
    });
}

function sendBacktrace() {
    makeBacktrace(function (frames) { postMessage("Debugger.paused", {reason:"other", callFrames:frames}); });
}

function convertScript(sc) {
    var obj = {
        scriptId: String(sc.id),
        url: sc.name,
        startLine: 0,
        startColumn: 0,
        endLine: sc.lineCount,
        endColumn: 0,
    };
    return obj;
}

function handleEvent(ev) {
    switch (ev.event) {
        case "break":
            // conn.command("backtrace", {fromFrame:0, bottom:true}, function (resp) {
            // paused = true;
            conn.command("backtrace", {}, function (resp) {
                if (!resp.body) {
                    var frame = {
                        callFrameId: "0",
                        functionName: ev.body.invocationText,
                        location: {scriptId: String(ev.body.script.id), lineNumber: ev.body.sourceLine, columnNumber: ev.body.sourceColumn},
                        scopeChain: [],
                        this: null,
                    };
                    postMessage("Debugger.paused", {reason:"other", callFrames:[frame]});
                    return;
                }
                var frames = [];
                var handle = function (i) {
                    if (i == resp.body.frames.length) postMessage("Debugger.paused", {reason:"other", callFrames:frames});
                    else makeFrame(resp, resp.body.frames[i], function (frame) { frames.push(frame); handle(i+1); });
                };
                handle(0);
            });
            break;
        case "afterCompile":
            if (ev.body.script.name) {
                // var sc = ev.body.script;
                // Put to script list
                stored_scripts.push(ev.body.script);
                postMessage("Debugger.scriptParsed", convertScript(ev.body.script));
            }
            // cont(convertScript(ev.body));
            break;
    }
}

function initDebugger() {
    console.log("Initializing");
    stored_scripts.forEach(function (sc) { postMessage("Debugger.scriptParsed", convertScript(sc)); });
    if (!conn.running) {
        console.log("Sending backtrace");
        sendBacktrace();
    }
    // Send breakpoints
    conn.command("listbreakpoints", {}, function (resp) {
        resp.body.breakpoints.forEach(function(bp) {
            var script_id = String(scriptByName(bp.script_name)[0].id);
            var l = bp.actual_locations[0];
            var loc = {lineNumber: l.line, columnNumber: l.column, scriptId: script_id};
            postMessage("Debugger.breakpointResolved", {breakpointId: String(bp.number), location: loc});
        });
    });
}

function initialize(socket_) {
    obj.socket = socket = socket_;
    socket.on("disconnect", function () {
        debugger_enabled = false;
    });
    debugger_enabled = false;
    if (stored_scripts.length > 0) {
        if (debugger_enabled) initDebugger();
    }
    else conn.command("scripts", {includeSource: true}, function (resp) {
        // resp.body should be a list of scripts
        console.log("Got response for scripts");
        stored_scripts = resp.body;
        if (debugger_enabled) initDebugger();
    });
}

function processMessage(obj, cont) {
    var lst = obj.method.split(".");
    var domain = objs[lst[0]];
    if (!domain) return;
    var method = domain[lst[1]];
    if (method) method(obj.params, function (reply) {
        if (reply) {
            reply.id = obj.id;
            cont(reply);
        }
    });
}

var obj = {initialize: initialize, process: processMessage, port: port-1, onconnect: null, socket:null, cp:child};

return obj;

}

