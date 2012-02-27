
importScripts("require.js");

var MultiSet = require("./multiset").MultiSet;
var util = require("./utils");
var complete = require("./fast-complete");

// files.load("js_current", function () { ca.addLineCompletion(); });

var docs = {};
var parents = {};

// Could perhaps store it in local storage...

var initialized = false;

function searchFile(fn, str, term, res) {
    var lst = str.split("\n");
    var parents = [];
    for (var i = 0; i < lst.length; i++) {
        var el = lst[i];
        if (el.match(term)) {
            var obj = {filename:fn, type:"line", line:i+1, data:el, rank: 0, parents: parents};
            if (el.match(/function/)) obj.rank++;
            // obj.rank += 1 / el.length;
            res.push(obj); 
        }
    }
}

function handleSearch(obj) {
    var term = util.validRegex(obj.string);
    var res = [];
    for (var i in docs) {
        searchFile(i, docs[i], term, res);
    }
    // Sort by rank
    res.sort(function (a,b) {return b.rank-a.rank;});
    return res.slice(0,100);
}

var handle = {
    search: handleSearch,
    complete: function (obj) { return complete.handleComplete(obj); },
};

function handler(msg, post) {
    var obj = JSON.parse(msg.data);
    if (obj.type == "save") {
        var os = docs[obj.filename];
        if (!os) complete.addString(obj.file);
        else complete.changeString(os, obj.file);
        docs[obj.filename] = obj.file;
    }
    else post(JSON.stringify({lst:handle[obj.type](obj), id:obj.id}));
}

onmessage = function (msg) {
    handler(msg, postMessage);
};

// When ran as shared worker
onconnect = function (ev) {
    var port = ev.ports[0];
    port.onmessage = function (msg) {
        handler(msg, function (x) { port.postMessage(x); });
    };
};

