
var MultiSet = require("./multiset").MultiSet;

// How many strings start with prefix?
var data = new MultiSet();
var best = new MultiSet();
var current = new MultiSet();

exports.current = current;
exports.data = data;

exports.dataSize = function () {
    return JSON.stringify(data).length + JSON.stringify(current).length; 
};

exports.clear = function () {
    data = new MultiSet();
    best = new MultiSet();
    current = new MultiSet();
};

exports.occurrences = function (str) {
    return data.get(str); 
};

exports.copy = function () {
    return {data: data.copy(), current: current.copy()};
};

exports.reset = function (obj) {
    data = new MultiSet();
    current = new MultiSet();
    obj.data.iter(function (el, num) { data.set(el, num); });
    obj.current.iter(function (el,v) { current.set(el, {val: v.val, str: v.str}); });
};

exports.differences = function (obj) {
    obj.data.iter(function (el, num) { if (data.get(el) != num) console.log(el + " has bad number"); });
    obj.current.iter(function (el,v) {
        var cell = current.getValue(el);
        if (cell.str != v.str)  console.log(el + " has bad completion");
        if (cell.val != v.val)  console.log(el + " has bad weight");
    });
};

function addPrefixes(str, scale) {
    for (var i = 1; i <= str.length && i < 80; i++) {
        data.add(str.substr(0, i), scale);
    }
}

exports.COST = 5;

function checkCell(ms, el, str, v) {
    var cell = ms.getValue(el);
    if (!cell) {
        cell = {val:0, str:el};
        ms.set(el, cell);
    }
    if (cell.val < v) {
        // console.log("Complete " + el + " to " + str);
        cell.val = v;
        cell.str = str;
    }
}

var dirties = new MultiSet();
var dirty_stack = [];

exports.dirty = function (str) {
    for (var i = 1; i <= str.length && i < 80; i++) {
        var el = str.substr(0, i);
        if (!dirties.getValue(el)) {
            var v = current.getValue(el);
            if (v) dirties.add(el, {val: v.val, str: v.str, data: data.get(el)});
            else dirties.add(el, {data: data.get(el)});
        }
    }
};

exports.pushDirty = function () {
    dirty_stack.push(dirties);
    dirties = new MultiSet();
};

exports.restoreDirty = function () {
    dirties.iter(function (el, val) { if (val.val) current.set(el, val); data.set(el, val.data); });
    dirties = dirty_stack.pop() || new MultiSet();
};

function check(str) {
    // Evaluate string
    var total = data.get(str);
    // For all prefixes, check if good completion
    for (var i = 0; i < str.length-1; i++) {
        var old = str.substr(0, i);
        var el = old + str[i];
        // var alt = old + reverseCase(str[i]);
        // checkCell(best, el, str, (str.length - el.length - 1) * total - exports.COST*data.get(alt));
        checkCell(current, el, str, (str.length - el.length) * total);
    }
}

function checkPrefixes(str) {
    for (var i = 1; i <= str.length && i < 80; i++) {
        check(str.substr(0, i));
    }
}

exports.checkPrefixes = checkPrefixes;
exports.addPrefixes = addPrefixes;

function addWord(str, scale) {
    addPrefixes(str, scale || 1);
    checkPrefixes(str);
}

exports.addWord = addWord;

var word_re = /[A-Za-z0-9_$\.]+/g;

function tokenize1(str) {
    var lst = str.match(word_re) || [];
    return MultiSet.fromList(lst);
}

function tokenize(str) {
    var lst = str.match(word_re) || [];
    var res = new MultiSet();
    lst.forEach(function (el) {
        res.add(el);
        if (el.indexOf(".") != -1) el.split(".").forEach(function (str) { res.add(str); });
    });
    return res;
}

function tokenize2(str) {
    str = str.replace(/[ \t\n]+/g, " ");
    var tokens = str.match(word_re);
    var delims = str.split(word_re);
    // var res = [];
    if (!tokens) return [];
    var res = new MultiSet();
    for (var i = 0; i < tokens.length-1; i++) {
        res.add(tokens[i]+delims[i+1]+tokens[i+1]);
    }
    console.log("Tokens: " + tokens.length + " Multi: " + res.list().length);
    return res;
}

function doTick(f) {
    f();
}

var tick = typeof process == "object" ? process.nextTick : doTick;

function batch(f, lst, num, cont) {
    var x = 0;
    var update = function () {
        if (x >= lst.length) {
            if (cont) cont();
            return;
        }
        for (var i = 0; i < num && x < lst.length; i++, x++) f(lst[x]);
        tick(update);
    };
    update();
}

exports.addString = function (str, scale, cont) {
    scale = scale || 1;
    var ms = tokenize(str);
    var lst = [];
    ms.iter(function (el,num) { lst.push([el,num]); });
    batch(function (el) { addPrefixes(el[0], scale*el[1]); }, lst, 100, function () {
        batch(function (el) { checkPrefixes(el[0]); }, lst, 100, function () {
            if (cont) cont();
        });
    });
};

exports.changeString = function (old_str, new_str) {
    // console.log("Start");
    var old_lst = tokenize(old_str);
    var new_lst = tokenize(new_str);
    // console.log("Tokenized " + old_lst.count(/.*/) + ", " + new_lst.count(/.*/));
    var lst = MultiSet.add(new_lst, MultiSet.scale(old_lst, -1));
    // console.log("Added " + MultiSet.scale(old_lst, -1).count(/.*/));
    var x = 0;
    lst.iter(function (el,num) { x += Math.abs(num); if (num != 0) addPrefixes(el, num); });
    lst.iter(function (el,num) { if (num != 0) checkPrefixes(el); });
    // console.log("Stop " + x);
};

exports.addMS = function (ms, scale) {
    scale = scale || 1;
    ms.iter(function (el,num) { if (num != 0) addPrefixes(el, num*scale); });
    ms.iter(function (el,num) { if (num != 0) checkPrefixes(el); });
};

function re_escape(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

function reverseCase(str) {
	if (str == str.toLowerCase()) return str.toUpperCase();
	else return str.toLowerCase();
}

exports.reverseCase = reverseCase;

var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
chars += chars.toLowerCase();

// var letters = [""];
var letters = [];

for (var i in chars) letters.push(chars[i]);

// Calculate with ...
function capComplete(o_str) {
	var vals = new MultiSet();
	var keys = new MultiSet();
	for (var i = 0; i < letters.length; i++) {
		var str = o_str + letters[i];
		var cell = current.getValue(str);
		if (!cell || cell.val <= 0) continue;
		keys.set(cell.str, letters[i]);
		vals.add(cell.str, cell.val);
	}
    // Sort...
	var res = [];
	var lst = vals.list();
	for (var i in lst) {
		var str = lst[i][0];
        res.push({key:keys.get(str), string:str});
	}
	return {lst:res, current:current.getValue(o_str)};
}

function allCaps(str) {
    return str == str.toUpperCase();
}

exports.allCaps = allCaps;

function augment(res, str) {
    if (res.current) res.current = {str: str + res.current.str};
    res.lst.forEach(function(el) { el.string = str + el.string; });
    return res;
}

exports.simpleComplete = function (str) {
    var cell = current.getValue(str);
    /*
    if (!cell && str.indexOf(".") != -1) {
        var i = str.indexOf(".") + 1;
        var rest = str.substr(i);
        return str.substr(0,i) + exports.simpleComplete(rest);
    }*/
    return cell ? cell.str : str;
};

exports.dotComplete = function (str) {
    var cell = current.getValue(str);
    if (!cell && str.indexOf(".") != -1) {
        var i = str.indexOf(".") + 1;
        var rest = str.substr(i);
        return str.substr(0,i) + exports.dotComplete(rest);
    }
    return cell ? cell.str : str;
};

function splitPrefix(str, pat) {
    var delim = str.match(pat) || [];
    var lst = str.split(pat);
    var res = [str];
    var loc = 0;
    lst.forEach(function (el, i) {
        if (!delim[i]) return;
        loc += el.length + delim[i].length;
        if (loc < str.length) res.push(str.substr(loc));
    });
    return res;
}

exports.augmentedAdd = function (str, pat, factor) {
    // Split with pattern
    // splitPrefix(str, pat).forEach(function (w) { addWord(w, factor); });
    addWord(str, factor);
    var lst = str.split(pat);
    for (var i = 1; i < lst.length; i++) addWord(lst[i], factor);
};

exports.augmentedComplete = function (str, pat) {
    var cell = current.getValue(str);
    if (!cell) {
        var ind = str.split(pat)[0].length;
        if (ind == str.length) return str;
        var pat_length = str.substr(ind).match(pat)[0].length;
        return str.substr(0,ind+pat_length) + exports.augmentedComplete(str.substr(ind+pat_length), pat);
    }
    return cell ? cell.str : str;
};

exports.augmentedCompletions = function (str, pat) {
    var res = [];
    var cell = current.getValue(str);
    if (cell) res.push(cell.str);
    var ind = str.split(pat)[0].length;
    if (ind < str.length) {
        var pat_length = str.substr(ind).match(pat)[0].length;
        exports.augmentedCompletions(str.substr(ind+pat_length), pat).forEach(function (el) { res.push(str.substr(0,ind+pat_length) + el); });
    }
    return res;
};

function complete(o_str) {
    // Try to complete it
    var res = capComplete(o_str);
    if (!res.current && o_str.indexOf(".") != -1) {
        var i = o_str.indexOf(".") + 1;
        var rest = o_str.substr(i);
        res = augment(capComplete(rest), o_str.substr(0,i));
    }
    return res;
}

exports.capComplete = complete;

exports.handleComplete = function (msg) {
    return exports.capComplete(String(msg.string));
};

