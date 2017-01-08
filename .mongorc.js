// ######## Load mesh ########
// See https://www.skratchdot.com/projects/mesh/
load('/usr/local/scripts/mesh.js');

// ########  Will load collectionFields variable (Northwind json output generated from Variety.js) ########
load('/usr/local/scripts/dbInfo.js');

collections = _.keys(collectionFields);

prompt = function () {
    return db + ' : ' + (new Date()).toLocaleDateString() + ' @ ' + (new Date()).toLocaleTimeString() + '> ';
}

// ######## Global vars ########
queryHasCollection = false;
sqlQuery = '';
matches = null;
selectedCollection = '';
snippetMap = {
    'w': 'where',
    'sc': 'showCollections()',
    'ob': 'order by ',
    'nw': 'use Northwind'
};

// ######## Start of SQL to Mongo conversion code ########
DB.prototype.sql = function(sql, makeUgly){
    var line = '************************************************************************ ';
    print(line);
    print('Original SQL: ' + colorize(sql, 'magenta', true, true));
    var query = parseSQL(sql);
    var count = this[query.collection].find(query.filter).count();
    print(' ------------ ' + count.toString() + ' DOCUMENT(S) RETURNED ------------ ');

    if (queryHasCollection || sqlQuery != '')
        resetGlobalVars();

    if (makeUgly){
        print(line);
        return this[query.collection].find(query.filter, query.projection).sort(query.sort).limit(query.limit);
    } else {
        print(line);
        return this[query.collection].find(query.filter, query.projection).sort(query.sort).limit(query.limit).pretty();
    }
}

DBCollection.prototype.fields = function(){
    var collection = this.getName();
    generateFieldTable(collection);
}

sqlKeywords = ['select', 'top', 'from', 'join', 'where', 'groupby', 'orderby', 'having']; // keep "top x" in mind
logicalOperators = ['!=', '<=', '>=', '<', '>', '=', '!in', 'in', 'like'];

var hasTop, hasWhere, hasOrderBy, processed = [], whereValsWithSpaces, hasOr, filterFields, operators, sqlishFilter, filter;
parseSQL = function(sql){
    whereValsWithSpaces = [], filterFields = [], operators = [], sqlishFilter = [], filter = {};
    hasTop = (sql.indexOf(' top ') > -1), hasWhere = (sql.indexOf('where') > -1), hasOrderBy = (sql.indexOf('order by') > -1), hasOr = (sql.indexOf(' or ') > -1);
    var limit, join, sort;
    var arr = parseOperatorsInArray(sql);


    getNext(arr); // remove Select

    if (hasTop){
        getNext(arr); // remove top
        limit = getLimit(arr);
    }

    var projection = getProjection(arr);

    getNext(arr); // remove From
    var collection = validateCollection(getNext(arr)[0]);

    if (collection === 'Invalid Collection.'){
        throw 'Invalid Collection';
    }

    if (hasWhere){
        var orObj = {}, orArr = [];
        sqlishFilter.forEach(function(f, fk){
            if (hasOr){
                orArr.push(processFilter(f, {}));
            } else {
                processFilter(f, filter);
            }
        });

        if (hasOr){
            filter = { $or: orArr };
        }

        getNext(arr, 2); // remove where and clause, since its handled earlier
    }

    if (hasOrderBy){
        getNext(arr); // remove order by
        sort = getSort(arr);
    }


    var ret = {
        collection: collection,
        projection: projection,
        filter: filter,
        sort: sort || {},
        limit: limit || 20
    };

    print('Converted Command: ' + colorize('db.' + ret.collection + '.find(' + JSON.stringify(ret.filter) + ', ' + JSON.stringify(ret.projection) + ').sort(' + JSON.stringify(ret.sort) + ').limit(' + ret.limit + ')', 'red', true, true));
    return ret;
};

parseOperatorsInArray = function(equation){
    var completeArr = [], tmpArr = [];
    sqlKeywords.forEach(function (e, k) { // for each operator
        if (completeArr.length === 0) { // if empty, split equation and do first load to completeArr.
            tmpArr = equation.split(e);
            spliceOperatorIntoTmpArr(tmpArr, e); // adds operator between every item in array
            tmpArr = tmpArr.filter(function (item) { return item.length > 0; });
            tmpArr.forEach(function (e, k) {

                if (e.indexOf('where') > -1){
                    buildWhere(e);
                }
                completeArr.push(e.replace(/\s/g, ''));
            });
        } else {
            for (var n = 0; n < completeArr.length; n++) {
                if (completeArr[n].indexOf(e) > -1 && completeArr[n].length > 1) {
                    var idx = n;
                    tmpArr = completeArr[n].split(e);
                    spliceOperatorIntoTmpArr(tmpArr, e);
                    tmpArr = tmpArr.filter(function (item) { return item.length > 0; });
                    completeArr.splice(idx, 1); // remove old text element
                    for (var x = 0; x < tmpArr.length ; x++) {
                        var newIdx = (idx + x);
                        completeArr.splice(newIdx, 0, tmpArr[x]);
                    }
                }
            }
        }
    });
    return completeArr;
};

spliceOperatorIntoTmpArr = function(tmpArr, e){
    var tmpLen = tmpArr.length + (tmpArr.length - 1);
    for (var i = 1; i < tmpLen; i++) {
        tmpArr.splice(i, 0, e);
        i++;
    }
};

buildWhere = function(e){

    var originalWhere = hasOrderBy ? e.substring(e.indexOf('where'), e.indexOf(' order by')) : e.substring(e.indexOf('where'), e.length);
    var splitWhere = originalWhere.split(' '), splitLength = splitWhere.length;
    var isRightSide = false, isOperator = false, isKeyword = false, filterValsToPush = [];

    splitWhere.forEach(function(el, idx){

        isKeyword = ((sqlKeywords.indexOf(el) > -1) || el === 'and' || el === 'or');
        isOperator = (logicalOperators.indexOf(el) > -1); // true if operator

        if (isKeyword){
            isRightSide = false; // false if sql keyword
        }

        if (isOperator){
            operators.push(el);
            isRightSide = true;
        }

        if (!isOperator && !isKeyword){
            if (isRightSide){
                filterValsToPush.push(el);
            } else {
                filterFields.push(el);
            }
        }

        if ((el === 'and' || el === 'or' || idx === (splitLength - 1)) && filterValsToPush.length > 0){
            var preservedVal = filterValsToPush.join(' ');
            whereValsWithSpaces.push(preservedVal);
            filterValsToPush = [];
        }
    });

    for (var i = 0; i < filterFields.length; i++){
        sqlishFilter.push(({ field: filterFields[i], operator: operators[i], value: whereValsWithSpaces[i] }));
    }
};

getNext = function(arr, howMany){
    howMany = howMany ? howMany : 1;
    if (arr.length > 0){

        var lastIn = arr.splice(0, howMany);
        processed.push(lastIn);
        return lastIn;
    }
};

getLimit = function(arr){
    var topN = arr[0].replace(/[^0-9.]/g, '');
    // remove top n from fields portion of arr
    arr[0] = arr[0].replace(/\d+/g, '');
    return parseInt(topN);
};

getProjection = function(arr){
    var projection = {}, selectFields = _.first(getNext(arr));
    if (selectFields !== '*'){
        selectFields.replace(/\s/g, '').split(',').forEach(function(e, k){
            var show = 1;
            if (e.substr(0,1) === '!'){
                show = 0;
                e = e.substr(1,1000);
            }
            projection[e] = show;
        });
    }
    return projection;
};

processFilter = function(filterObj, filter){
    var field = filterObj['field'];
    var operator = filterObj['operator'];
    var val = !isNaN(filterObj['value']) ? parseFloat(filterObj['value']) : filterObj['value'];

    switch (operator){
        case '=':
            filter[field] = val;
            break;
        case '!=':
            filter[field] = { $ne: val };
            break;
        case '>':
            filter[field] = { $gt: val };
            break;
        case '<':
            filter[field] = { $lt: val };
            break;
        case '>=':
            filter[field] = { $gte: val };
            break;
        case '<=':
            filter[field] = { $lte: val };
            break;
        case 'in':
            filter[field] = { $in: val.split(',') };
            break;
        case '!in':
            filter[field] = { $nin: val.split(',') };
            break;
        case 'like':
            filter[field] = { $regex: '^' + val + '.*' }; // for now, just match from start.
            break;
    }
    return filter;
};

getSort = function(arr){
    var sort = {}, sortFields = getNext(arr)[0], field, order, val;
    sortFields.split(',').forEach(function(e, k){
        if (e.substring(e.length - 4, e.length) === 'desc'){
            field = e.substring(0, e.length - 4);
            val = -1;
        }  else if (e.substring(e.length - 3, e.length) === 'asc'){
            field = e.substring(0, e.length - 3);
            val = 1;
        } else {
            field = e;
            val = 1;
        }

        sort[field] = val;
    });
    return sort;
};

validateCollection = function(collection){
    return _.contains(collections,collection) ? collection : 'Invalid Collection.';
};

// ######## Start of custom auto-complete code ########
function interceptAutoComplete(prefix, global, parts){
    if (prefix.length === 0){ // space only
        return ["')"];
    }

    var first = parts[0].toLowerCase();
    var expandToText = snippetMap[first];
    var lastChar = first.substring(first.length - 1, first.length);
    var lastTwoChars = first.substring(first.length - 2, first.length);

    if (first === 'sel'){
        sqlQuery = "db.sql('select * from ";
        return [sqlQuery];
    } else if (expandToText){
        return [expandToText];
    } else if (!queryHasCollection && isNaN(lastChar)) {
        return printCollections(first);
    } else if (!queryHasCollection) {
        return selectCollection(lastTwoChars, lastChar);
    } else if (queryHasCollection && isNaN(lastChar)) {
        return printFields(first);
    } else {
        return selectField(lastTwoChars, lastChar)
    }
}

function printMatches(isField){
    if (matches.length > 0){
        print('\n');
        matches.forEach(function(m, i){
            var str = i + ': ' + m
            print(colorize(str, 'green', true, false));
        });
    } else {
        resetGlobalVars();
        return [''];
    }
}

function printCollections(first){
    // No collection has been selected yet, and user isn't passing number for selection...
    if (_.contains(collections, first)){
        selectedCollection = first;
        sqlQuery += selectedCollection;

        return [selectedCollection];
    }

    matches = _.filter(collections, function(c){
        return c.toLowerCase().substring(0, (first.length)) === first;
    });

    printMatches();
}

function selectCollection(lastTwoChars, lastChar){
    // no collection is selected yet, but user is passing number for selection...
    var num = !isNaN(lastTwoChars) ? lastTwoChars : lastChar;
    selectedCollection = matches[num];
    queryHasCollection = true;
    print('\n');
    generateFieldTable(selectedCollection);

    if (sqlQuery === ''){
        sqlQuery = "db.sql('select * from " + selectedCollection;
        return [sqlQuery];
    }

    sqlQuery += selectedCollection;
    return [selectedCollection];
}

function printFields(first){
    // collection has been selected and user is trying to select field based on initial string
    var collection = collectionFields[selectedCollection];
    var filteredFields = _.filter(collection, function(c){
        return c.field.toLowerCase().substring(0, (first.length)) === first;
    });
    matches = _.map(_.sortBy(filteredFields, 'field'), function(d, i) {
        return d.field;
    });

    printMatches();
}

function selectField(lastTwoChars, lastChar){
    // collection has been selected, as well as field string, now user is passing number to select one...
    var num = !isNaN(lastTwoChars) ? lastTwoChars : lastChar;
    var field = matches[num];

    return [field];
}

function showCollections(){
    return db.getCollectionNames();
}

function resetGlobalVars (){
    queryHasCollection = false;
    sqlQuery = '';
    matches = null;
    selectedCollection = '';
}

function generateFieldTable(collection){
    var table = new AsciiTable(collection);
    table.setHeading('#', 'Field', 'Types');

    var fields = collectionFields[collection];
    _.map(_.sortBy(fields, 'field'), function(d, i) {
        return table.addRow(i, d.field, d.types)
    });
    return print(colorize(table, 'cyan', true, false));
}


// ######## Code from mongo shell utils ########
// See https://api.mongodb.com/js/current/symbols/src/src_mongo_shell_utils.js.html
shellAutocomplete = function(
    /*prefix*/) {  // outer scope function called on init. Actual function at end

    var universalMethods =
        "db.sql('select constructor prototype toString valueOf toLocaleString hasOwnProperty propertyIsEnumerable"
            .split(' ');

    var builtinMethods = {};  // uses constructor objects as keys
    builtinMethods[Array] =
        "length concat join pop push reverse shift slice sort splice unshift indexOf lastIndexOf every filter forEach map some isArray reduce reduceRight"
            .split(' ');
    builtinMethods[Boolean] = "".split(' ');  // nothing more than universal methods
    builtinMethods[Date] =
        "getDate getDay getFullYear getHours getMilliseconds getMinutes getMonth getSeconds getTime getTimezoneOffset getUTCDate getUTCDay getUTCFullYear getUTCHours getUTCMilliseconds getUTCMinutes getUTCMonth getUTCSeconds getYear parse setDate setFullYear setHours setMilliseconds setMinutes setMonth setSeconds setTime setUTCDate setUTCFullYear setUTCHours setUTCMilliseconds setUTCMinutes setUTCMonth setUTCSeconds setYear toDateString toGMTString toISOString toLocaleDateString toLocaleTimeString toTimeString toUTCString UTC now"
            .split(' ');
    if (typeof JSON != "undefined") {  // JSON is new in V8
        builtinMethods["[object JSON]"] = "parse stringify".split(' ');
    }
    builtinMethods[Math] =
        "E LN2 LN10 LOG2E LOG10E PI SQRT1_2 SQRT2 abs acos asin atan atan2 ceil cos exp floor log max min pow random round sin sqrt tan"
            .split(' ');
    builtinMethods[Number] =
        "MAX_VALUE MIN_VALUE NEGATIVE_INFINITY POSITIVE_INFINITY toExponential toFixed toPrecision"
            .split(' ');
    builtinMethods[RegExp] =
        "global ignoreCase lastIndex multiline source compile exec test".split(' ');
    builtinMethods[String] =
        "length charAt charCodeAt concat fromCharCode indexOf lastIndexOf match replace search slice split substr substring toLowerCase toUpperCase trim trimLeft trimRight"
            .split(' ');
    builtinMethods[Function] = "call apply bind".split(' ');
    builtinMethods[Object] =
        "bsonsize create defineProperty defineProperties getPrototypeOf keys seal freeze preventExtensions isSealed isFrozen isExtensible getOwnPropertyDescriptor getOwnPropertyNames"
            .split(' ');

    builtinMethods[Mongo] = "find update insert remove".split(' ');
    builtinMethods[BinData] = "hex base64 length subtype".split(' ');

    var extraGlobals =
        "Infinity NaN undefined null true false decodeURI decodeURIComponent encodeURI encodeURIComponent escape eval isFinite isNaN parseFloat parseInt unescape Array Boolean Date Math Number RegExp String print load gc MinKey MaxKey Mongo NumberInt NumberLong ObjectId DBPointer UUID BinData HexData MD5 Map Timestamp JSON"
            .split(' ');
    if (typeof NumberDecimal !== 'undefined') {
        extraGlobals[extraGlobals.length] = "NumberDecimal";
    }

    var isPrivate = function(name) {
        if (shellAutocomplete.showPrivate)
            return false;
        if (name == '_id')
            return false;
        if (name[0] == '_')
            return true;
        if (name[name.length - 1] == '_')
            return true;  // some native functions have an extra name_ method
        return false;
    };

    var customComplete = function(obj) {
        try {
            if (obj.__proto__.constructor.autocomplete) {
                var ret = obj.constructor.autocomplete(obj);
                if (ret.constructor != Array) {
                    print("\nautocompleters must return real Arrays");
                    return [];
                }
                return ret;
            } else {
                return [];
            }
        } catch (e) {
            // print( e ); // uncomment if debugging custom completers
            return [];
        }
    };

    var worker = function(prefix) {
        var global = (function() {
            return this;
        }).call();  // trick to get global object
        var parts = prefix.split('.');

        // ######## Intercept worker function ########
        var intercept = interceptAutoComplete(prefix, global, parts);
        if (intercept){
            return intercept;
        }
        // ######## End ########

        var curObj = global;

        for (var p = 0; p < parts.length - 1; p++) {  // doesn't include last part
            curObj = curObj[parts[p]];
            if (curObj == null)
                return [];
        }

        var lastPrefix = parts[parts.length - 1] || '';
        var lastPrefixLowercase = lastPrefix.toLowerCase();
        var beginning = parts.slice(0, parts.length - 1).join('.');
        if (beginning.length)
            beginning += '.';

        var possibilities = [];

        var noDuplicates =
        {};  // see http://dreaminginjavascript.wordpress.com/2008/08/22/eliminating-duplicates/
        for (var i = 0; i < possibilities.length; i++) {
            var p = possibilities[i];
            if (typeof(curObj[p]) == "undefined" && curObj != global)
                continue;  // extraGlobals aren't in the global object
            if (p.length == 0 || p.length < lastPrefix.length)
                continue;
            if (lastPrefix[0] != '_' && isPrivate(p))
                continue;
            if (p.match(/^[0-9]+$/))
                continue;  // don't array number indexes
            if (p.substr(0, lastPrefix.length).toLowerCase() != lastPrefixLowercase)
                continue;

            var completion = beginning + p;
            if (curObj[p] && curObj[p].constructor == Function && p != 'constructor')
                completion += '(';

            noDuplicates[completion] = 0;
        }

        var ret = [];
        for (var i in noDuplicates)
            ret.push(i);

        return ret;
    };

    // this is the actual function that gets assigned to shellAutocomplete
    return function(prefix) {
        try {
            __autocomplete__ = worker(prefix).sort();
        } catch (e) {
            print("exception during autocomplete: " + tojson(e.message));
            __autocomplete__ = [];
        }
    };
}();

// -----------------------------------------------------------------------------------------------------------------------------------------

/*
 *
 * Mongo-Hacker
 * MongoDB Shell Enhancements for Hackers
 *
 * Tyler J. Brock - 2013
 *
 * http://tylerbrock.github.com/mongo-hacker
 *
 */

if (_isWindows()) {
    print("\nSorry! MongoDB Shell Enhancements for Hackers isn't compatible with Windows.\n");
}

if (typeof db !== 'undefined') {
    var current_version = parseFloat(db.serverBuildInfo().version).toFixed(2)

    if (current_version < 2.2) {
        print("Sorry! MongoDB Shell Enhancements for Hackers is only compatible with Mongo 2.2+\n");
    }
}

mongo_hacker_config = {
    verbose_shell:  true,      // additional verbosity
    index_paranoia: true,      // querytime explain
    enhance_api:    true,      // additonal api extensions
    indent:         2,         // number of spaces for indent
    uuid_type:      'default', // 'java', 'c#', 'python' or 'default'
    banner_message: 'Mongo-Hacker ', //banner message
    version:        '0.0.3',    // current mongo-hacker version
    show_banner:     true,      // show mongo-hacker version banner on startup

    // Shell Color Settings
    // [<color>, <bold>, <underline>]
    // Colors available: red, green, yellow, blue, magenta, cyan
    colors: {
        'number':     [ 'blue', false, false ],
        'null':       [ 'red', false, false ],
        'undefined':  [ 'magenta', false, false ],
        'objectid':   [ 'green', false, false ],
        'string':     [ 'green', false, false ],
        'function':   [ 'magenta', false, false ],
        'date':       [ 'blue', false, false ],
        'uuid':       [ 'cyan', false, false]
    }
}

if (mongo_hacker_config['show_banner']) {
    print(mongo_hacker_config['banner_message'] + mongo_hacker_config['version']);
}

//----------------------------------------------------------------------------
// Color Functions
//----------------------------------------------------------------------------
__ansi = {
    csi: String.fromCharCode(0x1B) + '[',
    reset: '0',
    text_prop: 'm',
    foreground: '3',
    bright: '1',
    underline: '4',

    colors: {
        red: '1',
        green: '2',
        yellow: '3',
        blue: '4',
        magenta: '5',
        cyan: '6'
    }
};

function controlCode( parameters ) {
    if ( parameters === undefined ) {
        parameters = "";
    }
    else if (typeof(parameters) == 'object' && (parameters instanceof Array)) {
        parameters = parameters.join(';');
    }

    return __ansi.csi + String(parameters) + String(__ansi.text_prop);
};

function applyColorCode( string, properties ) {
    return controlCode(properties) + String(string) + controlCode();
};

function colorize( string, color, bright, underline ) {
    var params = [];
    var code = __ansi.foreground + __ansi.colors[color];

    params.push(code);

    if ( bright === true ) params.push(__ansi.bright);
    if ( underline === true ) params.push(__ansi.underline);

    return applyColorCode( string, params );
};
__indent = Array(mongo_hacker_config.indent + 1).join(' ');

ObjectId.prototype.toString = function() {
    return this.str;
};

ObjectId.prototype.tojson = function(indent, nolint) {
    return tojson(this);
};

Date.prototype.tojson = function() {

    var UTC = Date.printAsUTC ? 'UTC' : '';

    var year = this['get'+UTC+'FullYear']().zeroPad(4);
    var month = (this['get'+UTC+'Month']() + 1).zeroPad(2);
    var date = this['get'+UTC+'Date']().zeroPad(2);
    var hour = this['get'+UTC+'Hours']().zeroPad(2);
    var minute = this['get'+UTC+'Minutes']().zeroPad(2);
    var sec = this['get'+UTC+'Seconds']().zeroPad(2);

    if (this['get'+UTC+'Milliseconds']())
        sec += '.' + this['get'+UTC+'Milliseconds']().zeroPad(3);

    var ofs = 'Z';
    if (!Date.printAsUTC) {
        var ofsmin = this.getTimezoneOffset();
        if (ofsmin !== 0){
            ofs = ofsmin > 0 ? '-' : '+'; // This is correct
            ofs += (ofsmin/60).zeroPad(2);
            ofs += (ofsmin%60).zeroPad(2);
        }
    }

    var isodate =  colorize('"' + [year, month, date].join('-') + 'T' + hour +':' + minute + ':' + sec + ofs + '"', "cyan");
    return 'ISODate(' + isodate + ')';
};

Array.tojson = function( a , indent , nolint ){
    var lineEnding = nolint ? " " : "\n";

    if (!indent)
        indent = "";

    if ( nolint )
        indent = "";

    if (a.length === 0) {
        return "[ ]";
    }

    var s = "[" + lineEnding;
    indent += __indent;
    for ( var i=0; i<a.length; i++){
        s += indent + tojson( a[i], indent , nolint );
        if ( i < a.length - 1 ){
            s += "," + lineEnding;
        }
    }
    if ( a.length === 0 ) {
        s += indent;
    }

    indent = indent.substring(__indent.length);
    s += lineEnding+indent+"]";
    return s;
};

NumberLong.prototype.tojson = function() {
    return 'NumberLong(' + colorize('"' + this.toString().match(/-?\d+/)[0] + '"', "red") + ')';
};

NumberInt.prototype.tojson = function() {
    return 'NumberInt(' + colorize('"' + this.toString().match(/-?\d+/)[0] + '"', "red") + ')';
};

BinData.prototype.tojson = function(indent , nolint) {
    if (this.subtype() === 3) {
        return 'UUID(' + colorize('"' + uuidToString(this) + '"', "cyan") + ', ' + colorize('"' + mongo_hacker_config['uuid_type'] + '"', "cyan") + ')'
    } else if (this.subtype() === 4) {
        return 'UUID(' + colorize('"' + uuidToString(this, "default") + '"', "cyan") + ')'
    } else {
        return 'BinData(' + colorize(this.subtype(), "red") + ', ' + colorize('"' + this.base64() + '"', "green", true) + ')';
    }
};

DBQuery.prototype.shellPrint = function(){
    try {
        var start = new Date().getTime();
        var n = 0;
        while ( this.hasNext() && n < DBQuery.shellBatchSize ){
            var s = this._prettyShell ? tojson( this.next() ) : tojson( this.next() , "" , true );
            print( s );
            n++;
        }

        var output = [];

        if (typeof _verboseShell !== 'undefined' && _verboseShell) {
            var time = new Date().getTime() - start;
            var slowms = getSlowms();
            var fetched = "Fetched " + n + " record(s) in ";
            if (time > slowms) {
                fetched += colorize(time + "ms", "red", true);
            } else {
                fetched += colorize(time + "ms", "green", true);
            }
            output.push(fetched);
        }

        var paranoia = mongo_hacker_config.index_paranoia;

        if (typeof paranoia !== 'undefined' && paranoia) {
            var explain = this.clone();
            explain._ensureSpecial();
            explain._query.$explain = true;
            explain._limit = Math.abs(n._limit) * -1;
            var result = explain.next();
            var type = result.cursor;

            if (type !== undefined) {
                var index_use = "Index[";
                if (type == "BasicCursor") {
                    index_use += colorize( "none", "red", true);
                } else {
                    index_use += colorize( result.cursor.substring(12), "green", true );
                }
                index_use += "]";
                output.push(index_use);
            }
        }

        if ( this.hasNext() ) {
            ___it___  = this;
            output.push("More[" + colorize("true", "green", true) + "]");
        }
        print(output.join(" -- "));
    }
    catch ( e ){
        print( e );
    }
};

tojsonObject = function( x, indent, nolint ) {
    var lineEnding = nolint ? " " : "\n";
    var tabSpace = nolint ? "" : __indent;

    assert.eq( ( typeof x ) , "object" , "tojsonObject needs object, not [" + ( typeof x ) + "]" );

    if (!indent)
        indent = "";

    if ( typeof( x.tojson ) == "function" && x.tojson != tojson ) {
        return x.tojson(indent,nolint);
    }

    if ( x.constructor && typeof( x.constructor.tojson ) == "function" && x.constructor.tojson != tojson ) {
        return x.constructor.tojson( x, indent , nolint );
    }

    if ( x.toString() == "[object MaxKey]" )
        return "{ $maxKey : 1 }";
    if ( x.toString() == "[object MinKey]" )
        return "{ $minKey : 1 }";

    var s = "{" + lineEnding;

    // push one level of indent
    indent += tabSpace;

    var total = 0;
    for ( var k in x ) total++;
    if ( total === 0 ) {
        s += indent + lineEnding;
    }

    var keys = x;
    if ( typeof( x._simpleKeys ) == "function" )
        keys = x._simpleKeys();
    var num = 1;
    for ( var key in keys ){

        var val = x[key];
        if ( val == DB.prototype || val == DBCollection.prototype )
            continue;

        s += indent + colorize("\"" + key + "\"", "yellow") + ": " + tojson( val, indent , nolint );
        if (num != total) {
            s += ",";
            num++;
        }
        s += lineEnding;
    }

    // pop one level of indent
    indent = indent.substring(__indent.length);
    return s + indent + "}";
};


tojson = function( x, indent , nolint ) {
    if ( x === null )
        return colorize("null", "red", true);

    if ( x === undefined )
        return colorize("undefined", "magenta", true);

    if ( x.isObjectId ) {
        return 'ObjectId(' + colorize('"' + x.str + '"', "green", false, true) + ')';
    }

    if (!indent)
        indent = "";

    var s;
    switch ( typeof x ) {
        case "string": {
            s = "\"";
            for ( var i=0; i<x.length; i++ ){
                switch (x[i]){
                    case '"': s += '\\"'; break;
                    case '\\': s += '\\\\'; break;
                    case '\b': s += '\\b'; break;
                    case '\f': s += '\\f'; break;
                    case '\n': s += '\\n'; break;
                    case '\r': s += '\\r'; break;
                    case '\t': s += '\\t'; break;

                    default: {
                        var code = x.charCodeAt(i);
                        if (code < 0x20){
                            s += (code < 0x10 ? '\\u000' : '\\u00') + code.toString(16);
                        } else {
                            s += x[i];
                        }
                    }
                }
            }
            s += "\"";
            return colorize(s, "green", true);
        }
        case "number":
            return colorize(x, "red");
        case "boolean":
            return colorize("" + x, "blue");
        case "object": {
            s = tojsonObject( x, indent , nolint );
            if ( ( nolint === null || nolint === true ) && s.length < 80 && ( indent === null || indent.length === 0 ) ){
                s = s.replace( /[\s\r\n ]+/gm , " " );
            }
            return s;
        }
        case "function":
            return colorize(x.toString(), "magenta");
        default:
            throw "tojson can't handle type " + ( typeof x );
    }

};


// ######## ascii-table.min.js ########
// https://github.com/sorensen/ascii-table

!function(){"use strict";function t(t,e){this.options=e||{},this.reset(t)}var e=Array.prototype.slice,i=Object.prototype.toString;t.VERSION="0.0.8",t.LEFT=0,t.CENTER=1,t.RIGHT=2,t.factory=function(e,i){return new t(e,i)},t.align=function(e,i,r,n){return e===t.LEFT?t.alignLeft(i,r,n):e===t.RIGHT?t.alignRight(i,r,n):e===t.CENTER?t.alignCenter(i,r,n):t.alignAuto(i,r,n)},t.alignLeft=function(t,e,i){if(!e||0>e)return"";(void 0===t||null===t)&&(t=""),"undefined"==typeof i&&(i=" "),"string"!=typeof t&&(t=t.toString());var r=e+1-t.length;return 0>=r?t:t+Array(e+1-t.length).join(i)},t.alignCenter=function(e,i,r){if(!i||0>i)return"";(void 0===e||null===e)&&(e=""),"undefined"==typeof r&&(r=" "),"string"!=typeof e&&(e=e.toString());var n=e.length,o=Math.floor(i/2-n/2),s=Math.abs(n%2-i%2),i=e.length;return t.alignRight("",o,r)+e+t.alignLeft("",o+s,r)},t.alignRight=function(t,e,i){if(!e||0>e)return"";(void 0===t||null===t)&&(t=""),"undefined"==typeof i&&(i=" "),"string"!=typeof t&&(t=t.toString());var r=e+1-t.length;return 0>=r?t:Array(e+1-t.length).join(i)+t},t.alignAuto=function(e,r,n){(void 0===e||null===e)&&(e="");var o=i.call(e);if(n||(n=" "),r=+r,"[object String]"!==o&&(e=e.toString()),e.length<r)switch(o){case"[object Number]":return t.alignRight(e,r,n);default:return t.alignLeft(e,r,n)}return e},t.arrayFill=function(t,e){for(var i=new Array(t),r=0;r!==t;r++)i[r]=e;return i},t.prototype.reset=t.prototype.clear=function(e){return this.__name="",this.__nameAlign=t.CENTER,this.__rows=[],this.__maxCells=0,this.__aligns=[],this.__colMaxes=[],this.__spacing=1,this.__heading=null,this.__headingAlign=t.CENTER,this.setBorder(),"[object String]"===i.call(e)?this.__name=e:"[object Object]"===i.call(e)&&this.fromJSON(e),this},t.prototype.setBorder=function(t,e,i,r){return this.__border=!0,1===arguments.length&&(e=i=r=t),this.__edge=t||"|",this.__fill=e||"-",this.__top=i||".",this.__bottom=r||"'",this},t.prototype.removeBorder=function(){return this.__border=!1,this.__edge=" ",this.__fill=" ",this},t.prototype.setAlign=function(t,e){return this.__aligns[t]=e,this},t.prototype.setTitle=function(t){return this.__name=t,this},t.prototype.getTitle=function(){return this.__name},t.prototype.setTitleAlign=function(t){return this.__nameAlign=t,this},t.prototype.sort=function(t){return this.__rows.sort(t),this},t.prototype.sortColumn=function(t,e){return this.__rows.sort(function(i,r){return e(i[t],r[t])}),this},t.prototype.setHeading=function(t){return(arguments.length>1||"[object Array]"!==i.call(t))&&(t=e.call(arguments)),this.__heading=t,this},t.prototype.getHeading=function(){return this.__heading.slice()},t.prototype.setHeadingAlign=function(t){return this.__headingAlign=t,this},t.prototype.addRow=function(t){return(arguments.length>1||"[object Array]"!==i.call(t))&&(t=e.call(arguments)),this.__maxCells=Math.max(this.__maxCells,t.length),this.__rows.push(t),this},t.prototype.getRows=function(){return this.__rows.slice().map(function(t){return t.slice()})},t.prototype.addRowMatrix=function(t){for(var e=0;e<t.length;e++)this.addRow(t[e]);return this},t.prototype.addData=function(t,e,r){if("[object Array]"!==i.call(t))return this;for(var n=0,o=t.length;o>n;n++){var s=e(t[n]);r?this.addRowMatrix(s):this.addRow(s)}return this},t.prototype.clearRows=function(){return this.__rows=[],this.__maxCells=0,this.__colMaxes=[],this},t.prototype.setJustify=function(t){return 0===arguments.length&&(t=!0),this.__justify=!!t,this},t.prototype.toJSON=function(){return{title:this.getTitle(),heading:this.getHeading(),rows:this.getRows()}},t.prototype.parse=t.prototype.fromJSON=function(t){return this.clear().setTitle(t.title).setHeading(t.heading).addRowMatrix(t.rows)},t.prototype.render=t.prototype.valueOf=t.prototype.toString=function(){for(var e,i=this,r=[],n=this.__maxCells,o=t.arrayFill(n,0),s=3*n,h=this.__rows,a=this.__border,l=this.__heading?[this.__heading].concat(h):h,_=0;_<l.length;_++)for(var u=l[_],g=0;n>g;g++){var p=u[g];o[g]=Math.max(o[g],p?p.toString().length:0)}this.__colMaxes=o,e=this.__justify?Math.max.apply(null,o):0,o.forEach(function(t){s+=e?e:t+i.__spacing}),e&&(s+=o.length),s-=this.__spacing,a&&r.push(this._seperator(s-n+1,this.__top)),this.__name&&(r.push(this._renderTitle(s-n+1)),a&&r.push(this._seperator(s-n+1))),this.__heading&&(r.push(this._renderRow(this.__heading," ",this.__headingAlign)),r.push(this._rowSeperator(n,this.__fill)));for(var _=0;_<this.__rows.length;_++)r.push(this._renderRow(this.__rows[_]," "));a&&r.push(this._seperator(s-n+1,this.__bottom));var f=this.options.prefix||"";return f+r.join("\n"+f)},t.prototype._seperator=function(e,i){return i||(i=this.__edge),i+t.alignRight(i,e,this.__fill)},t.prototype._rowSeperator=function(){var e=t.arrayFill(this.__maxCells,this.__fill);return this._renderRow(e,this.__fill)},t.prototype._renderTitle=function(e){var i=" "+this.__name+" ",r=t.align(this.__nameAlign,i,e-1," ");return this.__edge+r+this.__edge},t.prototype._renderRow=function(e,i,r){for(var n=[""],o=this.__colMaxes,s=0;s<this.__maxCells;s++){var h=e[s],a=this.__justify?Math.max.apply(null,o):o[s],l=a,_=this.__aligns[s],u=r,g="alignAuto";"undefined"==typeof r&&(u=_),u===t.LEFT&&(g="alignLeft"),u===t.CENTER&&(g="alignCenter"),u===t.RIGHT&&(g="alignRight"),n.push(t[g](h,l,i))}var p=n.join(i+this.__edge+i);return p=p.substr(1,p.length),p+i+this.__edge},["Left","Right","Center"].forEach(function(i){var r=t[i.toUpperCase()];["setAlign","setTitleAlign","setHeadingAlign"].forEach(function(n){t.prototype[n+i]=function(){var t=e.call(arguments).concat(r);return this[n].apply(this,t)}})}),"undefined"!=typeof exports?module.exports=t:this.AsciiTable=t}.call(this);