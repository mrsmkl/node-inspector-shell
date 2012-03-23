
/*

var sel = window.getSelection();
var ran = sel.getRangeAt(0);
boxForAnchorAtStart(sel, ran);

*/

var util = require("../lib/utils");

var system = new util.Handler("../lib/local-complete.js");

function f(name) { return function (x) { return x[name]; }; }

function getSourceIds() {
    // Need to get file ids
    // Get all sources...
    var ids = [];
    // WebInspector.panels.scripts._presentationModel._rawSourceCodes.forEach(function (el) { ids = ids.concat(el._scripts); });
    var scripts = WebInspector.debuggerModel.scripts;
    for (var i  in scripts) ids.push(scripts[i]);
    // forEach(function (el) { ids = ids.concat(el._scripts); });
    return ids;
}

function getSources(lst, cont) {
    var res = [];
    function loaded(error, str, sc) {
        res.push({file: error ? "" : str, filename: sc.sourceURL});
        console.log(sc.sourceURL);
        if (res.length == lst.length) cont(res);
    }
    lst.forEach(function (sc) { DebuggerAgent.getScriptSource(sc.scriptId, function (err,str) { loaded(err,str,sc); }); });
}

var initialized = false;

function getCompletions(word, cont) {
    if (!initialized) {
        initialized = true;
        getSources(getSourceIds(), function (lst) {
            lst.forEach(function (el) { system.handle({type:"save", file:el.file, filename: el.filename}); });
        });
    }
    system.handle({type:"complete", string:word}, function (obj) {
        var lst = [];
        if (obj.current) lst.push(obj.current.str);
        if (obj.lst) obj.lst.forEach(function (x) { lst.push(x.string); });
        cont(lst);
    });
}

function lastLeaf(elem) {
    if (elem.lastChild) return lastLeaf(elem.lastChild);
    else return elem;
}

function prev(elem) {
    if (elem.previousSibling) return elem.previousSibling;
    else return prev(elem.parentNode);
}

// the selection might be in a crappy position with offsets and stuff

// Find the location 
function goBack(sel, num) {
    var ran = sel.getRangeAt(0);
    var node = ran.startContainer;
    var offset = ran.startOffset;
    // Normalize so that we are in a text node, or the offset is 0
    if (node.firstChild) {
        node = node.childNodes[offset];
        offset = 0;
    }
    if (offset >= num) {
        var nr = document.createRange();
        nr.setStart(node, offset - num);
        nr.setEnd(node, offset - num);
        return nr;
    }
    else {
        num -= offset;
        node = prev(node);
        while (true) {
            var len = node.textContent.length;
            if (len >= num) {
                if (node.lastChild) node = node.lastChild;
                else {
                    var nr = document.createRange();
                    nr.setStart(node, len - num);
                    nr.setEnd(node, len - num);
                    return nr;
                }
            }
            else {
                node = prev(node);
                num -= len;
            }
        }
    }
}

function boxForAnchorAtStart(selection, textRange) {
    var rangeCopy = selection.getRangeAt(0).cloneRange();
    var anchorElement = document.createElement("span");
    anchorElement.textContent = "\u200B";
    textRange.insertNode(anchorElement);
    var box = anchorElement.boxInWindow(window);
    anchorElement.parentElement.removeChild(anchorElement);
    selection.removeAllRanges();
    selection.addRange(rangeCopy);
    return box;
}

// Implement this wrapper so that can show the box at TextViewer
function PromptWrapper(viewer) {
    this.viewer = viewer;
    this.sug = "";
}

PromptWrapper.prototype = {
    applySuggestion: function (suggestion, isIntermediateSuggestion) {
        this.sug = suggestion;
    },
    acceptSuggestion: function () {
        this.viewer.beginUpdates();
        this.viewer._enterTextChangeMode();
        if (this.sug.length == 0) return;
        var range = this.viewer._getSelection();
        var newRange = this.viewer._setText(range, this.sug);
        newRange = newRange.collapseToEnd();
        this.viewer._exitTextChangeMode(range, newRange);
        this.viewer.endUpdates();
        this.viewer._restoreSelection(newRange, true);
        this.sug = "";
    },
    userEnteredText: function () {
    },
};

/*
    this._inputElement = inputElement;
    var bodyElement = inputElement.ownerDocument.body;
    
    var wrap = new PromptWrapper();
    var box = new WebInspector.SuggestBox(wrap, document.body, "generic-suggest");
    box.updateSuggestions({x:0, y: 0, width:0, height: 20}, ["abc", "kissa", "kävelee"], true);

*/

/**
 * @constructor
 */
WebInspector.SuggestBox = function(textPrompt, bodyElement, className)
{
    this._textPrompt = textPrompt;
    this._selectedElement = null;
    this._boundOnScroll = this._onscrollresize.bind(this, true);
    this._boundOnResize = this._onscrollresize.bind(this, false);
    window.addEventListener("scroll", this._boundOnScroll, true);
    window.addEventListener("resize", this._boundOnResize, true);

    this._bodyElement = bodyElement;
    this._element = bodyElement.ownerDocument.createElement("div");
    this._element.className = "suggest-box " + (className || "");
    this._element.addEventListener("mousedown", this._onboxmousedown.bind(this), true);
    this.containerElement = this._element.createChild("div", "container");
    this.contentElement = this.containerElement.createChild("div", "content");
    this._prefixLength = 0;
}

WebInspector.SuggestBox.prototype = {
    get visible()
    {
        return !!this._element.parentElement;
    },

    get hasSelection()
    {
        return !!this._selectedElement;
    },

    _onscrollresize: function(isScroll, event)
    {
        if (isScroll && this._element.isAncestor(event.target) || !this.visible)
            return;
        this._updateBoxPositionWithExistingAnchor();
    },

    _updateBoxPositionWithExistingAnchor: function()
    {
        if (this._anchorBox) this._updateBoxPosition(this._anchorBox);
    },

    /**
     * @param {AnchorBox} anchorBox
     */
    _updateBoxPosition: function(anchorBox)
    {
        // Measure the content element box.
        this.contentElement.style.display = "inline-block";
        document.body.appendChild(this.contentElement);
        this.contentElement.positionAt(0, 0);
        var contentWidth = this.contentElement.offsetWidth;
        var contentHeight = this.contentElement.offsetHeight;
        this.contentElement.style.display = "block";
        this.containerElement.appendChild(this.contentElement);

        // Lay out the suggest-box relative to the anchorBox.
        this._anchorBox = anchorBox;
        const spacer = 6;

        const suggestBoxPaddingX = 21;
        var maxWidth = document.body.offsetWidth - anchorBox.x - spacer;
        var width = Math.min(contentWidth, maxWidth - suggestBoxPaddingX) + suggestBoxPaddingX;
        var paddedWidth = contentWidth + suggestBoxPaddingX;
        var boxX = anchorBox.x;
        if (width < paddedWidth) {
            // Shift the suggest box to the left to accommodate the content without trimming to the BODY edge.
            maxWidth = document.body.offsetWidth - spacer;
            width = Math.min(contentWidth, maxWidth - suggestBoxPaddingX) + suggestBoxPaddingX;
            boxX = document.body.offsetWidth - width;
        }

        const suggestBoxPaddingY = 2;
        var boxY;
        var aboveHeight = anchorBox.y;
        var underHeight = document.body.offsetHeight - anchorBox.y - anchorBox.height;
        var maxHeight = Math.max(underHeight, aboveHeight) - spacer;
        var height = Math.min(contentHeight, maxHeight - suggestBoxPaddingY) + suggestBoxPaddingY;
        if (underHeight >= aboveHeight) {
            // Locate the suggest box under the anchorBox.
            boxY = anchorBox.y + anchorBox.height;
            this._element.removeStyleClass("above-anchor");
            this._element.addStyleClass("under-anchor");
        } else {
            // Locate the suggest box above the anchorBox.
            boxY = anchorBox.y - height;
            this._element.removeStyleClass("under-anchor");
            this._element.addStyleClass("above-anchor");
        }

        this._element.positionAt(boxX, boxY);
        this._element.style.width = width + "px";
        this._element.style.height = height + "px";
    },

    hide: function()
    {
        if (!this.visible)
            return;

        this._element.parentElement.removeChild(this._element);
        delete this._selectedElement;
    },

    _onboxmousedown: function(event)
    {
        event.preventDefault();
    },

    removeFromElement: function()
    {
        window.removeEventListener("scroll", this._boundOnScroll, true);
        window.removeEventListener("resize", this._boundOnResize, true);
        this._element.parentElement.removeChild(this._element);
    },

    /**
     * @param {string=} text
     * @param {boolean=} isIntermediateSuggestion
     */
    _applySuggestion: function(text, isIntermediateSuggestion)
    {
        if (!this.visible || !(text || this._selectedElement))
            return false;

        var suggestion = text || this._selectedElement.textContent;
        if (!suggestion)
            return false;

        this._textPrompt.applySuggestion(suggestion.substr(this._prefixLength), isIntermediateSuggestion);
        return true;
    },

    /**
     * @param {string=} text
     */
    acceptSuggestion: function(text)
    {
        var result = this._applySuggestion(text, false);
        this.hide();
        if (!result)
            return false;

        this._textPrompt.acceptSuggestion();

        return true;
    },

    _onNextItem: function(event, isPageScroll)
    {
        var children = this.contentElement.childNodes;
        if (!children.length)
            return false;

        if (!this._selectedElement)
            this._selectedElement = this.contentElement.firstChild;
        else {
            if (!isPageScroll)
                this._selectedElement = this._selectedElement.nextSibling || this.contentElement.firstChild;
            else {
                var candidate = this._selectedElement;

                for (var itemsLeft = this._rowCountPerViewport; itemsLeft; --itemsLeft) {
                    if (candidate.nextSibling)
                        candidate = candidate.nextSibling;
                    else
                        break;
                }

                this._selectedElement = candidate;
            }
        }
        this._updateSelection();
        this._applySuggestion(undefined, true);
        return true;
    },

    _onPreviousItem: function(event, isPageScroll)
    {
        var children = this.contentElement.childNodes;
        if (!children.length)
            return false;

        if (!this._selectedElement)
            this._selectedElement = this.contentElement.lastChild;
        else {
            if (!isPageScroll)
                this._selectedElement = this._selectedElement.previousSibling || this.contentElement.lastChild;
            else {
                var candidate = this._selectedElement;

                for (var itemsLeft = this._rowCountPerViewport; itemsLeft; --itemsLeft) {
                    if (candidate.previousSibling)
                        candidate = candidate.previousSibling;
                    else
                        break;
                }

                this._selectedElement = candidate;
            }
        }
        this._updateSelection();
        this._applySuggestion(undefined, true);
        return true;
    },

    /**
     * @param {AnchorBox} anchorBox
     * @param {Array.<string>=} completions
     * @param {boolean=} canShowForSingleItem
     */
    updateSuggestions: function(anchorBox, word, completions, canShowForSingleItem)
    {
        if (this._suggestTimeout) {
            clearTimeout(this._suggestTimeout);
            delete this._suggestTimeout;
        }
        this._prefixLength = word.length;
        this._completionsReady(anchorBox, word, completions, canShowForSingleItem);
    },

    _onItemMouseDown: function(text, event)
    {
        this.acceptSuggestion(text);
        event.stopPropagation();
        event.preventDefault();
    },

    _createItemElement: function(prefix, text)
    {
        var element = document.createElement("div");
        element.className = "suggest-box-content-item source-code";
        element.tabIndex = -1;
        if (prefix && prefix.length && !text.indexOf(prefix)) {
            var prefixElement = element.createChild("span", "prefix");
            prefixElement.textContent = prefix;
            var suffixElement = element.createChild("span", "suffix");
            suffixElement.textContent = text.substring(prefix.length);
        } else {
            var suffixElement = element.createChild("span", "suffix");
            suffixElement.textContent = text;
        }
        element.addEventListener("mousedown", this._onItemMouseDown.bind(this, text), false);
        return element;
    },

    /**
     * @param {boolean=} canShowForSingleItem
     */
    _updateItems: function(word, items, canShowForSingleItem)
    {
        this.contentElement.removeChildren();

        var userEnteredText = word;
        for (var i = 0; i < items.length; ++i) {
            var item = items[i];
            var currentItemElement = this._createItemElement(userEnteredText, item);
            this.contentElement.appendChild(currentItemElement);
        }

        this._selectedElement = canShowForSingleItem ? this.contentElement.firstChild : null;
        this._updateSelection();
    },

    _updateSelection: function()
    {
        // FIXME: might want some optimization if becomes a bottleneck.
        for (var child = this.contentElement.firstChild; child; child = child.nextSibling) {
            if (child !== this._selectedElement)
                child.removeStyleClass("selected");
        }
        if (this._selectedElement) {
            this._selectedElement.addStyleClass("selected");
            this._selectedElement.scrollIntoViewIfNeeded(false);
        }
    },

    /**
     * @param {Array.<string>=} completions
     * @param {boolean=} canShowForSingleItem
     */
    _canShowBox: function(completions, canShowForSingleItem)
    {
        if (!completions || !completions.length)
            return false;

        if (completions.length > 1)
            return true;

        // Do not show a single suggestion if it is the same as user-entered prefix, even if allowed to show single-item suggest boxes.
        return canShowForSingleItem && completions[0] !== this._textPrompt.userEnteredText();
    },

    _rememberRowCountPerViewport: function()
    {
        if (!this.contentElement.firstChild)
            return;

        this._rowCountPerViewport = Math.floor(this.containerElement.offsetHeight / this.contentElement.firstChild.offsetHeight);
    },

    /**
     * @param {AnchorBox} anchorBox
     * @param {Array.<string>=} completions
     * @param {boolean=} canShowForSingleItem
     */
    _completionsReady: function(anchorBox, word, completions, canShowForSingleItem)
    {
        if (this._canShowBox(completions, canShowForSingleItem)) {
            this._updateItems(word, completions, canShowForSingleItem);
            this._updateBoxPosition(anchorBox);
            if (!this.visible)
                this._bodyElement.appendChild(this._element);
            this._rememberRowCountPerViewport();
        } else
            this.hide();
    },

    upKeyPressed: function(event)
    {
        return this._onPreviousItem(event, false);
    },

    downKeyPressed: function(event)
    {
        return this._onNextItem(event, false);
    },

    pageUpKeyPressed: function(event)
    {
        return this._onPreviousItem(event, true);
    },

    pageDownKeyPressed: function(event)
    {
        return this._onNextItem(event, true);
    },

    enterKeyPressed: function(event)
    {
        var hasSelectedItem = !!this._selectedElement;
        this.acceptSuggestion();

        // Report the event as non-handled if there is no selected item,
        // to commit the input or handle it otherwise.
        return hasSelectedItem;
    },

    tabKeyPressed: function(event)
    {
        return this.enterKeyPressed(event);
    }
}

function enterPrefix(doc_str) {
    var last_line = doc_str.split("\n").slice(-1).join("");
    if (!last_line.match(/[:;\{] *$/) && last_line.match(/[A-Za-z_$]/)) {
        var stack = parenStack(doc_str);
        return reverseParens((stack.match(/[\(\[]*$/) || []).join("")) + ";";
    }
    return "";
}

var INDENT_LEVEL = 4;
        
        function countIndent(line) {
            for (var i = 0; i < line.length; i++) {
                if (line.charAt(i) != " ") break;
            }
            return i;
        }
        
        function countBraces(line) {
            var res = 0;
            for (var i = 0; i < line.length; i++) {
                if (line.charAt(i) == "{") res++;
                if (line.charAt(i) == "}") res--;
            }
            return res > 0 ? res : 0;
        }
        
        function makeSpaces(n) {
            var str = "";
            for (var i = 0; i < n; i++) str += " ";
            return str;
        }

        function indent(last_line) {
            return countIndent(last_line) + INDENT_LEVEL*countBraces(last_line);
        }

        function lastWord(ln) {
            var lines = ln.split(/[ \n]/);
            return lines.length > 0 ? lines[lines.length-1] : "";
        }

        function parenStack(str) {
            var res = "";
            for (var i = 0; i < str.length; i++)  {
                if (str.charAt(i).match(/[\[\(\{]/)) res += str.charAt(i);
                else if (str.charAt(i).match(/[\]\)\}]/)) res = res.substr(0, res.length-1);
            }
            return res;
        }
        
        function countParens(ln) {
            var res = 0;
            for (var i = 0; i < ln.length; i++) {
                if (ln[i] == "(") res++;
                else if (ln[i] == ")") res--;
            }
            return res;
        }
        
        function semi(last_line) {
            if (countParens(last_line) <= 0 && countBraces(last_line) <= 0) res = ";\n" + makeSpaces(indent(last_line));
            else res = "; ";
        }

        function rbrace(last_line, doc_str) {
            var stack = parenStack(doc_str);
            var pars = (stack.match(/[\(\[]+$/) || []).join("");
            var res = "";
            if (pars) {
                pars = reverseParens(pars);
                res += pars + semi(last_line + pars);
            }
            if (last_line.substr(last_line.length - INDENT_LEVEL) == makeSpaces(INDENT_LEVEL)) {
                // console.log("Shifting");
                return {shift: INDENT_LEVEL, res: res + "}"};
            }
            else if (countBraces(last_line) > 0) {
                return {shift: 0, res: res + "}"};
            }
            else {
                var pad = makeSpaces(indent(last_line) - INDENT_LEVEL);
                return {shift: 0, res: res+"\n"+pad+"}\n"+pad};
            }
        }

        var rp = {};
        ["()","{}","[]"].forEach(function (el) { rp[el[0]] = el[1]; rp[el[1]] = el[0]; });

        function reverseParens(str) {
            var res = "";
            for (var i = 0; i < str.length; i++) {
                if (rp[str.charAt(i)]) res = rp[str.charAt(i)] + res;
                else res = str.charAt(i) + res;
            }
            return res;
        }

        function matchParen(str, par) {
            var rev = rp[par];
            var level = 1;
            for (var j = str.length-1; j >= 0; j--) {
                if (str.charAt(j) == par) level++;
                else if (str.charAt(j) == rev) level--;
                if (level == 0) return j-1;
            }
            return 0;
        }
        
        function matchParens(str, pars) {
            var i = str.length-1;
            for (var j = pars.length-1; j >= 0; j--) {
                i = matchParen(str, i, pars[j]);
            }
            return i;
        }

        function handle(str, last_line, doc_str) {

            var prev = doc_str.substr(doc_str.length-1);
            var stack = parenStack(doc_str);

            if (str == ";") {
                var lw = lastWord(doc_str.substr(0, matchParen(doc_str, ")")));
                // console.log(lw);
                var in_for = last_line.match(/for[ ]*\(/) && countParens(last_line) > 0;
                if (!in_for && countBraces(last_line) <= 0) res = ";";
                else res = "; ";
                // For parens need special handling
                var parens = "";
                while (stack.match(/[\(\[]$/)) {
                    if (stack.match(/\($/) && lw != "for") parens += ")";
                    else if (stack.match(/\[$/)) parens += "]";
                    stack = stack.substr(0, stack.length-1);
                }
                res = parens + res;
            }
            else if (str == "\n") {
                var spaces = last_line.match(/[ ]*$/);
                shift = spaces ? spaces[0].length : 0;
                var pad = makeSpaces(indent(last_line));
                // Determine if we should insert semicolon
                var prefix = "";
                last_line = last_line.substr(0, last_line.length-shift);
                if (last_line.match(/[^:;\{]$/) && last_line.match(/[A-Za-z_$]/)) {
                    var stack = parenStack(doc_str);
                    prefix = reverseParens((stack.match(/[\(\[]*$/) || []).join("")) + ";";
                }
                res = {shift: shift, res: prefix+"\n"+pad};
            }
            else if (str == ",") {
                res = ", ";
            }
            else if (str == ":") {
                if (last_line.match(/^[ ]*(case )/)) res = ":\n" + makeSpaces(indent(last_line) + INDENT_LEVEL);
                else res = ": ";
            }
            else if (str == "{" && lastWord(doc_str).match(/function/)) {
                res = "() { ";
                // res = "() {\n" + makeSpaces(indent(last_line)+2);
                if (last_line.match(/[^ ]$/)) res = " " + res;
            }
            else if (str == "{" && last_line.match(/(\)|try)[ ]*$/)) {
                res = "{ "; //  + makeSpaces(indent(last_line)+2);
                if (last_line.match(/[^ ]$/)) res = " " + res;
            }
            else if (str.match(/[&\+\*\/=\|<>]/) && prev.match(/[A-Za-z0-9_]/)) {
                res = " " + str;
            }
            else if (prev.match(/[&\+\*\/=\|<>\)]/) && str.match(/[A-Za-z0-9_]/)) {
                res = " " + str;
            }
            else if (str == "(" && lastWord(doc_str).match(/if|while|for|function|switch|catch/)) {
                res = " " + str;
            }
            else if (str == ")") {
                res = reverseParens((stack.match(/[^\(]*$/) || []).join()) + ")";
                if (lastWord(doc_str.substr(0, matchParen(doc_str, ")"))).match(/function|switch|catch/)) {
                    res = res + " "; // " {\n" + makeSpaces(indent(last_line)+2);
                }
            }
            else if (str == "]") {
                res = reverseParens((stack.match(/[^\[]*$/) || []).join()) + "]";
            }
            else if (str == "}") {
                res = rbrace(last_line, doc_str);
            }
            else res = str;
            
            return res;
        }


